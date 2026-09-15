import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Helper serveur pour lister les acomptes éligibles à une demande de paiement
 * groupée (Phase B5 du flux multi-lots — CEO 2026-06-25).
 *
 * Symétrique entre achats et travaux : la même action serveur
 * `requestPaymentForExistingAcomptesAction` est ensuite invoquée depuis
 * `<RequestPaymentDrawer>` avec les `id` retournés ici.
 *
 * Critères d'éligibilité (sélection large, l'UI filtre/préfiltre) :
 *   - project_id matche
 *   - status = 'pending'
 *   - deleted_at IS NULL
 *
 * Les acomptes déjà rattachés à un `payment_batch_id` actif (approval non
 * rejetée) restent inclus dans la liste mais avec `has_active_request = true`
 * — la checkbox sera désactivée côté UI.
 *
 * Idem pour les acomptes ayant une demande individuelle active dans
 * `payment_approvals` (via achats_payment_id / travaux_payment_id).
 *
 * Cohérence canon Stoniz :
 *   - `has_quote` lit `quote_doc_id` sur le lot parent (achats_lots /
 *     travaux_lots).
 *   - `artisan_fiche_ok` réplique la règle de la fonction SQL
 *     `check_artisan_payment_ready` (NULL = OK ; non-NULL = manquant). Si la FK
 *     fournisseur est NULL on retourne `true` (pas de blocage côté UI ; la
 *     server action retombera en mode best-effort si besoin).
 */

export type EligibleAcompte = {
  id: string;
  lot_id: string;
  lot_name: string;
  acompte_number: number | null;
  amount_total: number;
  currency: string;
  scheduled_date: string | null;
  supplier_name: string;
  supplier_id: string | null;
  has_quote: boolean;
  artisan_fiche_ok: boolean;
  has_active_request: boolean;
};

export async function getAcomptesForBulkRequest(
  projectId: string,
  source: 'achats' | 'travaux',
): Promise<EligibleAcompte[]> {
  const supabase = createClient();
  const admin = createAdminClient();

  const paymentsTable = source === 'achats' ? 'achats_payments' : 'travaux_payments';
  const lotsTable = source === 'achats' ? 'achats_lots' : 'travaux_lots';
  const fkCol = source === 'achats' ? 'achats_payment_id' : 'travaux_payment_id';

  // 1) Acomptes pending non supprimés
  const paymentSelect = source === 'achats'
    ? 'id, lot_id, supplier_id, supplier_name, amount_total, currency, acompte_number, scheduled_date, payment_batch_id'
    : 'id, lot_id, artisan_id, artisan_name, amount_total, currency, acompte_number, scheduled_date, payment_batch_id';

  const { data: paymentsRaw, error: payErr } = await supabase
    .from(paymentsTable)
    .select(paymentSelect)
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .is('deleted_at', null)
    .not('lot_id', 'is', null)
    .order('scheduled_date', { ascending: true, nullsFirst: false });

  if (payErr || !paymentsRaw || paymentsRaw.length === 0) return [];

  const payments = paymentsRaw as any[];

  // 2) Lots correspondants (description / numero / quote_doc_id / supplier FK fallback)
  const lotIds = Array.from(new Set(payments.map((p) => p.lot_id).filter(Boolean)));
  const lotSelect = source === 'achats'
    ? 'id, numero, description, supplier_name, supplier_id, quote_doc_id'
    : 'id, numero, description, artisan_name, quote_doc_id';

  const lotsById = new Map<string, any>();
  if (lotIds.length > 0) {
    const { data: lots } = await supabase
      .from(lotsTable)
      .select(lotSelect)
      .in('id', lotIds);
    for (const l of (lots ?? []) as any[]) lotsById.set(l.id, l);
  }

  // 3) Fournisseurs FK : pour le check fiche on regroupe les ids non nuls et on
  //    appelle check_artisan_payment_ready une fois par fournisseur.
  const fkField = source === 'achats' ? 'supplier_id' : 'artisan_id';
  const supplierIds = Array.from(new Set(
    payments
      .map((p) => p[fkField])
      .filter((v): v is string => typeof v === 'string' && v.length > 0),
  ));

  const ficheOkBySupplierId = new Map<string, boolean>();
  for (const sid of supplierIds) {
    try {
      const { data: missing } = await admin.rpc('check_artisan_payment_ready', { p_artisan_id: sid });
      // RPC renvoie NULL si fiche complète, sinon un texte d'erreur.
      ficheOkBySupplierId.set(sid, missing == null);
    } catch {
      ficheOkBySupplierId.set(sid, true); // ne bloque pas l'UI sur erreur RPC
    }
  }

  // 4) Demandes actives (batch ou individuelle)
  const batchIds = Array.from(new Set(payments.map((p) => p.payment_batch_id).filter(Boolean)));
  const paymentIds = payments.map((p) => p.id);

  const activeBatchIds = new Set<string>();
  if (batchIds.length > 0) {
    const { data: approvals } = await supabase
      .from('payment_approvals')
      .select('payment_batch_id, final_status')
      .in('payment_batch_id', batchIds)
      .is('deleted_at', null);
    for (const a of (approvals ?? []) as any[]) {
      if (a.final_status !== 'rejected' && a.payment_batch_id) {
        activeBatchIds.add(a.payment_batch_id);
      }
    }
  }

  const activeIndividualIds = new Set<string>();
  if (paymentIds.length > 0) {
    const { data: approvals } = await supabase
      .from('payment_approvals')
      .select(`id, final_status, ${fkCol}`)
      .in(fkCol, paymentIds)
      .is('deleted_at', null);
    for (const a of (approvals ?? []) as any[]) {
      if (a.final_status !== 'rejected' && a[fkCol]) {
        activeIndividualIds.add(a[fkCol]);
      }
    }
  }

  // 5) Mapping final
  return payments.map((p): EligibleAcompte => {
    const lot = lotsById.get(p.lot_id) ?? {};
    const supplierFk: string | null = p[fkField] ?? null;
    const supplierLabelFromPayment: string | null = (source === 'achats' ? p.supplier_name : p.artisan_name) ?? null;
    const supplierLabelFromLot: string | null = (source === 'achats' ? lot.supplier_name : lot.artisan_name) ?? null;

    const ficheOk = supplierFk ? (ficheOkBySupplierId.get(supplierFk) ?? true) : true;
    const hasBatchActive = !!(p.payment_batch_id && activeBatchIds.has(p.payment_batch_id));
    const hasIndividualActive = activeIndividualIds.has(p.id);

    const numero = lot.numero != null ? `Lot #${lot.numero}` : 'Lot —';
    const desc = lot.description ? ` — ${lot.description}` : '';

    return {
      id: p.id,
      lot_id: p.lot_id,
      lot_name: `${numero}${desc}`,
      acompte_number: p.acompte_number ?? null,
      amount_total: Number(p.amount_total ?? 0),
      currency: p.currency ?? 'MAD',
      scheduled_date: p.scheduled_date ?? null,
      supplier_name: supplierLabelFromPayment || supplierLabelFromLot || 'Fournisseur inconnu',
      supplier_id: supplierFk,
      has_quote: !!lot.quote_doc_id,
      artisan_fiche_ok: ficheOk,
      has_active_request: hasBatchActive || hasIndividualActive,
    };
  });
}
