import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Helper canonique pour résoudre le détail d'une demande de validation de
 * paiement (achats / travaux / honoraires, mono ou batch). Utilisé par
 * <ApprovalBreakdownPanel> côté /validations et /mes-demandes-paiement.
 *
 * Stratégie de détection de la source :
 *   1. Si payment_batch_id non null → on tente achats_payments puis
 *      travaux_payments (un batch_id est globalement unique).
 *   2. Sinon si achats_payment_id → mono achats.
 *   3. Sinon si travaux_payment_id → mono travaux.
 *   4. Sinon si payment_id → honoraires Stoniz (pas de lot/doc fournisseur).
 *
 * Pour les acomptes (achats/travaux), on rejoint :
 *   - le lot (achats_lots / travaux_lots) pour la description + N° lot
 *   - le supplier_name (sur le payment) — fallback artisan_name côté travaux
 *   - les vendor_documents attachés au lot ET au payment (facture côté
 *     travaux est sur le payment, côté achats sur le lot)
 *
 * Le retour est groupé PAR LOT, avec N acomptes par lot. Trié lot_numero
 * ASC puis acompte_number ASC. La vue est défensive : si une jointure
 * échoue, on retourne `source: 'unknown'` plutôt que de planter.
 *
 * CEO 2026-06-25 (Phase B1).
 */

export type AcompteBreakdown = {
  payment_id: string;
  acompte_number: number | null;
  acompte_pct: number | null;
  amount: number;
  currency: string;
  scheduled_date: string | null;
  notes: string | null;
  /** Facture côté travaux : invoice_doc_id est sur le payment, pas le lot. */
  invoice_doc: VendorDoc | null;
};

export type VendorDoc = {
  id: string;
  file_name: string;
};

export type LotBreakdown = {
  lot_id: string;
  lot_numero: number | null;
  lot_description: string | null;
  lot_category: string | null;
  supplier_name: string | null;
  /**
   * Montant total du lot en MAD :
   * - achats : unit_price_mad × quantity (si saisis) sinon budget_estimate_mad
   * - travaux : budget_estimate_mad
   * Peut être null si non saisi côté ERP. CEO 2026-06-25.
   */
  lot_total_amount: number | null;
  /** Devis fournisseur sur le lot. */
  quote_doc: VendorDoc | null;
  /** Facture fournisseur sur le lot (achats) OU sur le payment (travaux, agrégée). */
  invoice_doc: VendorDoc | null;
  /** Bon de commande sur le lot (achats only). */
  bc_doc: VendorDoc | null;
  acomptes: AcompteBreakdown[];
};

export type ApprovalBreakdown = {
  source: 'achats' | 'travaux' | 'honoraires' | 'unknown';
  is_batch: boolean;
  lots: LotBreakdown[];
  total_amount: number;
  currency: string;
  /** Cas honoraires : pas de lot, juste un descriptif. */
  honoraires_label?: string | null;
};

export type ApprovalForBreakdown = {
  id: string;
  payment_id: string | null;
  travaux_payment_id: string | null;
  achats_payment_id: string | null;
  payment_batch_id: string | null;
};

type DocRow = { id: string; file_path: string | null; reference: string | null };

function fileNameFromDoc(d: DocRow | null | undefined): VendorDoc | null {
  if (!d || !d.id) return null;
  const fp = d.file_path;
  const name = fp ? (fp.split('/').pop() ?? null) : null;
  return { id: d.id, file_name: name ?? d.reference ?? 'Document' };
}

export async function getApprovalBreakdown(
  approval: ApprovalForBreakdown,
): Promise<ApprovalBreakdown> {
  const supabase = createClient();

  // ─── 1. Cas batch ─────────────────────────────────────────────
  if (approval.payment_batch_id) {
    // Tente achats d'abord
    const achatsBd = await loadAchatsBatch(supabase, approval.payment_batch_id);
    if (achatsBd && achatsBd.lots.length > 0) {
      return { ...achatsBd, is_batch: true, source: 'achats' };
    }
    const travauxBd = await loadTravauxBatch(supabase, approval.payment_batch_id);
    if (travauxBd && travauxBd.lots.length > 0) {
      return { ...travauxBd, is_batch: true, source: 'travaux' };
    }
    return {
      source: 'unknown',
      is_batch: true,
      lots: [],
      total_amount: 0,
      currency: 'EUR',
    };
  }

  // ─── 2. Cas mono achats ───────────────────────────────────────
  if (approval.achats_payment_id) {
    const bd = await loadAchatsMono(supabase, approval.achats_payment_id);
    if (bd) return { ...bd, is_batch: false, source: 'achats' };
  }

  // ─── 3. Cas mono travaux ──────────────────────────────────────
  if (approval.travaux_payment_id) {
    const bd = await loadTravauxMono(supabase, approval.travaux_payment_id);
    if (bd) return { ...bd, is_batch: false, source: 'travaux' };
  }

  // ─── 4. Cas honoraires Stoniz (pas de lot) ────────────────────
  if (approval.payment_id) {
    const bd = await loadHonoraires(supabase, approval.payment_id);
    if (bd) return bd;
  }

  return {
    source: 'unknown',
    is_batch: false,
    lots: [],
    total_amount: 0,
    currency: 'EUR',
  };
}

// ─── Loaders ─────────────────────────────────────────────────────

async function loadAchatsBatch(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
): Promise<Omit<ApprovalBreakdown, 'is_batch' | 'source'> | null> {
  const { data: payments } = await supabase
    .from('achats_payments')
    .select(
      'id, lot_id, supplier_name, currency, amount_total, acompte_number, acompte_pct, scheduled_date, notes',
    )
    .eq('payment_batch_id', batchId)
    .is('deleted_at', null);
  if (!payments || payments.length === 0) return null;

  const lotIds = Array.from(
    new Set((payments as any[]).map((p) => p.lot_id).filter((v): v is string => !!v)),
  );
  const lots = await loadAchatsLots(supabase, lotIds);

  return assembleAchats(payments as any[], lots);
}

async function loadAchatsMono(
  supabase: ReturnType<typeof createClient>,
  paymentId: string,
): Promise<Omit<ApprovalBreakdown, 'is_batch' | 'source'> | null> {
  const { data: payment } = await supabase
    .from('achats_payments')
    .select(
      'id, lot_id, supplier_name, currency, amount_total, acompte_number, acompte_pct, scheduled_date, notes',
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (!payment) return null;

  const lotIds = (payment as any).lot_id ? [(payment as any).lot_id as string] : [];
  const lots = await loadAchatsLots(supabase, lotIds);

  return assembleAchats([payment as any], lots);
}

async function loadAchatsLots(
  supabase: ReturnType<typeof createClient>,
  lotIds: string[],
): Promise<Map<string, any>> {
  if (lotIds.length === 0) return new Map();
  const { data: lots } = await supabase
    .from('achats_lots')
    .select(
      `id, numero, description, category, supplier_name,
       unit_price_mad, quantity, budget_estimate_mad,
       quote_doc:vendor_documents!achats_lots_quote_doc_id_fkey(id, file_path, reference),
       invoice_doc:vendor_documents!achats_lots_invoice_doc_id_fkey(id, file_path, reference),
       bc_doc:vendor_documents!achats_lots_purchase_order_doc_id_fkey(id, file_path, reference)`,
    )
    .in('id', lotIds);
  const map = new Map<string, any>();
  for (const l of (lots ?? []) as any[]) map.set(l.id, l);
  return map;
}

function assembleAchats(
  payments: any[],
  lotsById: Map<string, any>,
): Omit<ApprovalBreakdown, 'is_batch' | 'source'> {
  // Groupe par lot
  const byLot = new Map<string, AcompteBreakdown[]>();
  // Acomptes sans lot (rare mais possible si lot_id = null)
  const orphan: AcompteBreakdown[] = [];
  let total = 0;
  let currency = 'MAD';

  for (const p of payments) {
    const amount = Number(p.amount_total ?? 0);
    total += amount;
    currency = p.currency ?? currency;
    const ac: AcompteBreakdown = {
      payment_id: p.id,
      acompte_number: p.acompte_number ?? null,
      acompte_pct: p.acompte_pct == null ? null : Number(p.acompte_pct),
      amount,
      currency: p.currency ?? 'MAD',
      scheduled_date: p.scheduled_date ?? null,
      notes: p.notes ?? null,
      invoice_doc: null,
    };
    if (p.lot_id) {
      const arr = byLot.get(p.lot_id) ?? [];
      arr.push(ac);
      byLot.set(p.lot_id, arr);
    } else {
      orphan.push(ac);
    }
  }

  const lots: LotBreakdown[] = [];
  for (const [lotId, acomptes] of byLot) {
    const lotRow = lotsById.get(lotId);
    // Montant total du lot (achats) : unit_price × quantity sinon budget_estimate
    const unitPrice = Number(lotRow?.unit_price_mad ?? 0);
    const qty = Number(lotRow?.quantity ?? 0);
    const computed = unitPrice > 0 && qty > 0 ? unitPrice * qty : 0;
    const budgetEst = Number(lotRow?.budget_estimate_mad ?? 0);
    const lotTotal = computed > 0 ? computed : budgetEst > 0 ? budgetEst : null;
    lots.push({
      lot_id: lotId,
      lot_numero: lotRow?.numero ?? null,
      lot_description: lotRow?.description ?? null,
      lot_category: lotRow?.category ?? null,
      supplier_name:
        lotRow?.supplier_name ??
        payments.find((p) => p.lot_id === lotId)?.supplier_name ??
        null,
      lot_total_amount: lotTotal,
      quote_doc: fileNameFromDoc(lotRow?.quote_doc),
      invoice_doc: fileNameFromDoc(lotRow?.invoice_doc),
      bc_doc: fileNameFromDoc(lotRow?.bc_doc),
      acomptes: acomptes.sort(
        (a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0),
      ),
    });
  }
  if (orphan.length > 0) {
    // Pseudo-lot pour les acomptes sans rattachement
    lots.push({
      lot_id: '__orphan__',
      lot_numero: null,
      lot_description: '(Sans lot rattaché)',
      lot_category: null,
      supplier_name: payments[0]?.supplier_name ?? null,
      lot_total_amount: null,
      quote_doc: null,
      invoice_doc: null,
      bc_doc: null,
      acomptes: orphan.sort(
        (a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0),
      ),
    });
  }
  // Tri lots par numero
  lots.sort((a, b) => (a.lot_numero ?? 9999) - (b.lot_numero ?? 9999));

  // Recopie supplier_name depuis le payment si manquant côté lot
  for (const l of lots) {
    if (!l.supplier_name) {
      const supFromPay = payments.find((p) => p.lot_id === l.lot_id)?.supplier_name;
      if (supFromPay) l.supplier_name = supFromPay;
    }
  }

  return { lots, total_amount: total, currency };
}

// ─── Travaux ─────────────────────────────────────────────────────

async function loadTravauxBatch(
  supabase: ReturnType<typeof createClient>,
  batchId: string,
): Promise<Omit<ApprovalBreakdown, 'is_batch' | 'source'> | null> {
  const { data: payments } = await supabase
    .from('travaux_payments')
    .select(
      `id, lot_id, artisan_name, currency, amount_total, acompte_number, acompte_pct, scheduled_date, notes,
       invoice_doc:vendor_documents!travaux_payments_invoice_doc_id_fkey(id, file_path, reference)`,
    )
    .eq('payment_batch_id', batchId)
    .is('deleted_at', null);
  if (!payments || payments.length === 0) return null;

  const lotIds = Array.from(
    new Set((payments as any[]).map((p) => p.lot_id).filter((v): v is string => !!v)),
  );
  const lots = await loadTravauxLots(supabase, lotIds);

  return assembleTravaux(payments as any[], lots);
}

async function loadTravauxMono(
  supabase: ReturnType<typeof createClient>,
  paymentId: string,
): Promise<Omit<ApprovalBreakdown, 'is_batch' | 'source'> | null> {
  const { data: payment } = await supabase
    .from('travaux_payments')
    .select(
      `id, lot_id, artisan_name, currency, amount_total, acompte_number, acompte_pct, scheduled_date, notes,
       invoice_doc:vendor_documents!travaux_payments_invoice_doc_id_fkey(id, file_path, reference)`,
    )
    .eq('id', paymentId)
    .maybeSingle();
  if (!payment) return null;

  const lotIds = (payment as any).lot_id ? [(payment as any).lot_id as string] : [];
  const lots = await loadTravauxLots(supabase, lotIds);

  return assembleTravaux([payment as any], lots);
}

async function loadTravauxLots(
  supabase: ReturnType<typeof createClient>,
  lotIds: string[],
): Promise<Map<string, any>> {
  if (lotIds.length === 0) return new Map();
  const { data: lots } = await supabase
    .from('travaux_lots')
    .select(
      `id, numero, description, category, artisan_name,
       budget_estimate_mad,
       quote_doc:vendor_documents!travaux_lots_quote_doc_id_fkey(id, file_path, reference)`,
    )
    .in('id', lotIds);
  const map = new Map<string, any>();
  for (const l of (lots ?? []) as any[]) map.set(l.id, l);
  return map;
}

function assembleTravaux(
  payments: any[],
  lotsById: Map<string, any>,
): Omit<ApprovalBreakdown, 'is_batch' | 'source'> {
  const byLot = new Map<string, AcompteBreakdown[]>();
  const orphan: AcompteBreakdown[] = [];
  let total = 0;
  let currency = 'MAD';

  for (const p of payments) {
    const amount = Number(p.amount_total ?? 0);
    total += amount;
    currency = p.currency ?? currency;
    const ac: AcompteBreakdown = {
      payment_id: p.id,
      acompte_number: p.acompte_number ?? null,
      acompte_pct: p.acompte_pct == null ? null : Number(p.acompte_pct),
      amount,
      currency: p.currency ?? 'MAD',
      scheduled_date: p.scheduled_date ?? null,
      notes: p.notes ?? null,
      invoice_doc: fileNameFromDoc(p.invoice_doc),
    };
    if (p.lot_id) {
      const arr = byLot.get(p.lot_id) ?? [];
      arr.push(ac);
      byLot.set(p.lot_id, arr);
    } else {
      orphan.push(ac);
    }
  }

  const lots: LotBreakdown[] = [];
  for (const [lotId, acomptes] of byLot) {
    const lotRow = lotsById.get(lotId);
    // Pour les travaux, on prend la première facture trouvée parmi les
    // acomptes comme "représentative" du lot (en pratique, 1 lot = 1 facture
    // finale, on l'attache au payment de solde). Sinon, on laisse null.
    const lotInvoice = acomptes.find((a) => !!a.invoice_doc)?.invoice_doc ?? null;
    // Montant total du lot (travaux) : budget_estimate_mad uniquement
    const budgetEst = Number(lotRow?.budget_estimate_mad ?? 0);
    const lotTotal = budgetEst > 0 ? budgetEst : null;
    lots.push({
      lot_id: lotId,
      lot_numero: lotRow?.numero ?? null,
      lot_description: lotRow?.description ?? null,
      lot_category: lotRow?.category ?? null,
      supplier_name:
        lotRow?.artisan_name ??
        payments.find((p) => p.lot_id === lotId)?.artisan_name ??
        null,
      lot_total_amount: lotTotal,
      quote_doc: fileNameFromDoc(lotRow?.quote_doc),
      invoice_doc: lotInvoice,
      bc_doc: null, // travaux n'a pas de BC
      acomptes: acomptes.sort(
        (a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0),
      ),
    });
  }
  if (orphan.length > 0) {
    lots.push({
      lot_id: '__orphan__',
      lot_numero: null,
      lot_description: '(Sans lot rattaché)',
      lot_category: null,
      supplier_name: payments[0]?.artisan_name ?? null,
      lot_total_amount: null,
      quote_doc: null,
      invoice_doc: orphan.find((a) => !!a.invoice_doc)?.invoice_doc ?? null,
      bc_doc: null,
      acomptes: orphan.sort(
        (a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0),
      ),
    });
  }
  lots.sort((a, b) => (a.lot_numero ?? 9999) - (b.lot_numero ?? 9999));

  return { lots, total_amount: total, currency };
}

// ─── Honoraires Stoniz ───────────────────────────────────────────

async function loadHonoraires(
  supabase: ReturnType<typeof createClient>,
  paymentId: string,
): Promise<ApprovalBreakdown | null> {
  const { data: pay } = await supabase
    .from('payments')
    .select('id, type, amount_expected, currency, due_date, notes')
    .eq('id', paymentId)
    .maybeSingle();
  if (!pay) return null;
  const labels: Record<string, string> = {
    acompte_stoniz: 'Acompte initial Stoniz',
    honoraires_compromis: 'Signature compromis',
    honoraires_livraison: 'Livraison',
    autre: 'Honoraires',
  };
  const label = labels[(pay as any).type] ?? 'Honoraires Stoniz';
  return {
    source: 'honoraires',
    is_batch: false,
    lots: [],
    total_amount: Number((pay as any).amount_expected ?? 0),
    currency: (pay as any).currency ?? 'EUR',
    honoraires_label: label,
  };
}
