'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit, type FinanceAuditTable } from '@/lib/finance/audit';
import { pickLotByVendorName } from '@/lib/finance/supplier-match';

/**
 * Server Actions pour l'allocation des transactions bancaires aux projets / postes.
 *
 * Garde-fou : somme des allocations actives ≤ montant de la transaction.
 * Permission : CEO + finance (lecture pour developer)
 */

const ALLOCATION_TYPES = [
  'travaux','achats','services','honoraires','propria','cabinet_charge',
  'cabinet_fiscal','cabinet_social','frais_bancaire','intercompany','autre',
] as const;

const SERVICE_CATEGORIES = [
  'architecte','geometre','bureau_etudes','juridique_notariat',
  'photo_video','decoration_design','marketing_communication',
  'conseil','autre_service',
] as const;

// ─── Ajout d'une allocation manuelle ─────────────────────────────────────

const allocateSchema = z.object({
  transaction_id: z.string().uuid(),
  project_id: z.string().uuid().optional().nullable(),
  allocation_type: z.enum(ALLOCATION_TYPES),
  amount_mad: z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Montant invalide'),
  notes: z.string().optional().nullable(),
  travaux_lot_id: z.string().uuid().optional().nullable(),
  achats_lot_id: z.string().uuid().optional().nullable(),
  services_lot_id: z.string().uuid().optional().nullable(),
  payment_id: z.string().uuid().optional().nullable(),
  // Pour services : si pas de lot encore, on peut le créer à la volée
  service_category: z.enum(SERVICE_CATEGORIES).optional().nullable(),
  provider_id: z.string().uuid().optional().nullable(),
  provider_name: z.string().optional().nullable(),
  // Si true → on saute le check de doublons (utilisateur a confirmé "créer quand même")
  force_create: z.union([z.literal('true'), z.literal('false'), z.boolean()]).optional().nullable(),
  // CEO 2026-06-16 : rattachement explicite à un acompte planifié existant
  // (travaux_payments.id ou achats_payments.id, status='pending')
  // Si fourni, on UPDATE l'acompte existant au lieu de créer un nouveau.
  existing_acompte_id: z.string().uuid().optional().nullable(),
});

export type PotentialDuplicate = {
  source: 'travaux_payment' | 'travaux_encaissement' | 'achats_payment' | 'achats_encaissement' | 'services_payment';
  id: string;
  description: string;
  amount_mad: number;
  date: string;
  partner_name: string | null;
};

/** Acompte planifié candidat au rattachement (CEO 2026-06-16) */
export type AcompteCandidate = {
  table: 'travaux_payments' | 'achats_payments';
  id: string;
  lot_id: string;
  lot_label: string;          // ex : "Lot 3 · Gros œuvre"
  partner_name: string;       // artisan_name ou supplier_name
  acompte_number: number | null;
  amount_total: number;
  scheduled_date: string | null;
  notes: string | null;
};

export type AllocateResult =
  | { ok: true }
  | { ok: true; matched_existing: { table: string; id: string } } // rattachement effectué
  | { ok: false; error: string }
  | { ok: false; duplicates: PotentialDuplicate[] }
  | { ok: false; acompte_candidates: AcompteCandidate[] }; // plusieurs candidats à choisir

const DUP_AMOUNT_TOLERANCE = 1; // ±1 MAD pour gérer les arrondis bancaires
const DUP_DATE_WINDOW_DAYS = 7;
const ACOMPTE_MATCH_TOLERANCE = 1; // ±1 MAD pour matcher un acompte planifié

// Types qui se répètent vraiment dans le temps pour le même bénéficiaire
// (vs travaux/achats où chaque ligne va sur un projet différent → pas de mapping)
const LEARNABLE_TYPES = new Set([
  'cabinet_charge',
  'cabinet_fiscal',
  'cabinet_social',
  'frais_bancaire',
  'intercompany',
]);

/**
 * Enregistre un mapping bénéficiaire → catégorie pour les futurs imports.
 * Upsert : si un mapping existe déjà pour ce bénéficiaire, on le met à jour.
 * Idempotent : on n'écrit que pour les types charges récurrentes.
 */
async function saveLearnedMapping(args: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  beneficiary: string | null;
  category_code: string | null;
  allocation_type: string;
}) {
  const { supabase, userId, beneficiary, category_code, allocation_type } = args;
  if (!beneficiary || beneficiary.trim().length < 3) return;
  if (!LEARNABLE_TYPES.has(allocation_type)) return;

  const cleanBenef = beneficiary.trim();

  // Cherche un mapping existant pour ce bénéficiaire
  const { data: existing } = await supabase
    .from('bank_category_mappings')
    .select('id')
    .eq('bank_label_match', cleanBenef)
    .eq('match_type', 'contains')
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('bank_category_mappings')
      .update({
        allocation_type,
        category_code: category_code ?? 'autre',
      } as any)
      .eq('id', (existing as any).id);
  } else {
    await supabase.from('bank_category_mappings').insert({
      bank_label_match: cleanBenef,
      match_type: 'contains',
      category_code: category_code ?? 'autre',
      allocation_type,
      created_by: userId,
    } as any);
  }
}

/**
 * Cherche un payment/encaissement déjà existant sur le projet qui pourrait être
 * le même que cette transaction bancaire (saisie manuelle d'abord puis import banque).
 *
 * Filtre out les lignes déjà liées à une autre transaction (signe que c'est un vrai
 * autre paiement, pas un doublon).
 */
async function findPotentialDuplicates(args: {
  supabase: ReturnType<typeof createClient>;
  projectId: string;
  allocationType: 'travaux' | 'achats' | 'services';
  amount: number;
  isCredit: boolean;
  isDebit: boolean;
  txDate: string;
}): Promise<PotentialDuplicate[]> {
  const { supabase, projectId, allocationType, amount, isCredit, isDebit, txDate } = args;
  const txDateObj = new Date(txDate);
  const minDate = new Date(txDateObj);
  minDate.setDate(minDate.getDate() - DUP_DATE_WINDOW_DAYS);
  const maxDate = new Date(txDateObj);
  maxDate.setDate(maxDate.getDate() + DUP_DATE_WINDOW_DAYS);
  const minIso = minDate.toISOString().slice(0, 10);
  const maxIso = maxDate.toISOString().slice(0, 10);

  const lowAmt = amount - DUP_AMOUNT_TOLERANCE;
  const highAmt = amount + DUP_AMOUNT_TOLERANCE;

  // Récupère les IDs déjà liés à une transaction bancaire pour les exclure
  const linkedFields = {
    travaux_payment: 'travaux_payment_id',
    travaux_encaissement: 'travaux_encaissement_id',
    achats_payment: 'achats_payment_id',
    achats_encaissement: 'achats_encaissement_id',
    services_payment: 'services_payment_id',
  };

  const dups: PotentialDuplicate[] = [];

  async function fetchLinkedIds(field: string): Promise<Set<string>> {
    const { data } = await supabase
      .from('bank_transaction_allocations')
      .select(field)
      .not(field, 'is', null)
      .is('deleted_at', null);
    return new Set(((data ?? []) as any[]).map((r) => r[field]).filter(Boolean));
  }

  if (allocationType === 'travaux' && isDebit) {
    const linkedIds = await fetchLinkedIds(linkedFields.travaux_payment);
    const { data } = await supabase
      .from('travaux_payments')
      .select('id, artisan_name, amount_paid, paid_at, scheduled_date, description')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .gte('amount_paid', lowAmt)
      .lte('amount_paid', highAmt);
    for (const p of (data ?? []) as any[]) {
      if (linkedIds.has(p.id)) continue;
      const refDate = p.paid_at ?? p.scheduled_date;
      if (!refDate) continue;
      if (refDate < minIso || refDate > maxIso) continue;
      dups.push({
        source: 'travaux_payment',
        id: p.id,
        description: p.description ?? 'Paiement artisan',
        amount_mad: Number(p.amount_paid),
        date: refDate,
        partner_name: p.artisan_name,
      });
    }
  }

  if (allocationType === 'travaux' && isCredit) {
    const linkedIds = await fetchLinkedIds(linkedFields.travaux_encaissement);
    const { data } = await supabase
      .from('travaux_encaissements')
      .select('id, amount_mad, received_at, notes')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .gte('amount_mad', lowAmt)
      .lte('amount_mad', highAmt)
      .gte('received_at', minIso)
      .lte('received_at', maxIso);
    for (const e of (data ?? []) as any[]) {
      if (linkedIds.has(e.id)) continue;
      dups.push({
        source: 'travaux_encaissement',
        id: e.id,
        description: e.notes ?? 'Encaissement client travaux',
        amount_mad: Number(e.amount_mad),
        date: e.received_at,
        partner_name: null,
      });
    }
  }

  if (allocationType === 'achats' && isDebit) {
    const linkedIds = await fetchLinkedIds(linkedFields.achats_payment);
    const { data } = await supabase
      .from('achats_payments')
      .select('id, supplier_name, amount_paid, paid_at, scheduled_date, description')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .gte('amount_paid', lowAmt)
      .lte('amount_paid', highAmt);
    for (const p of (data ?? []) as any[]) {
      if (linkedIds.has(p.id)) continue;
      const refDate = p.paid_at ?? p.scheduled_date;
      if (!refDate) continue;
      if (refDate < minIso || refDate > maxIso) continue;
      dups.push({
        source: 'achats_payment',
        id: p.id,
        description: p.description ?? 'Paiement fournisseur',
        amount_mad: Number(p.amount_paid),
        date: refDate,
        partner_name: p.supplier_name,
      });
    }
  }

  if (allocationType === 'achats' && isCredit) {
    const linkedIds = await fetchLinkedIds(linkedFields.achats_encaissement);
    const { data } = await supabase
      .from('achats_encaissements')
      .select('id, amount_mad, received_at, notes')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .gte('amount_mad', lowAmt)
      .lte('amount_mad', highAmt)
      .gte('received_at', minIso)
      .lte('received_at', maxIso);
    for (const e of (data ?? []) as any[]) {
      if (linkedIds.has(e.id)) continue;
      dups.push({
        source: 'achats_encaissement',
        id: e.id,
        description: e.notes ?? 'Encaissement client achats',
        amount_mad: Number(e.amount_mad),
        date: e.received_at,
        partner_name: null,
      });
    }
  }

  if (allocationType === 'services' && isDebit) {
    const linkedIds = await fetchLinkedIds(linkedFields.services_payment);
    const { data } = await supabase
      .from('services_payments')
      .select('id, amount_paid, paid_at, description, provider:artisans(name)')
      .eq('project_id', projectId)
      .is('deleted_at', null)
      .gte('amount_paid', lowAmt)
      .lte('amount_paid', highAmt)
      .gte('paid_at', minIso)
      .lte('paid_at', maxIso);
    for (const p of (data ?? []) as any[]) {
      if (linkedIds.has(p.id)) continue;
      dups.push({
        source: 'services_payment',
        id: p.id,
        description: p.description ?? 'Paiement prestataire service',
        amount_mad: Number(p.amount_paid),
        date: p.paid_at,
        partner_name: (p as any).provider?.name ?? null,
      });
    }
  }

  return dups;
}

export async function allocateTransactionAction(formData: FormData): Promise<AllocateResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée — session expirée ?' };
  }
  const supabase = createClient();

  let data;
  try {
    const raw: Record<string, any> = {};
    for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
    data = allocateSchema.parse(raw);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  // Récupère la transaction pour valider que la somme des allocations ne dépasse pas
  const { data: tx, error: txErr } = await supabase
    .from('bank_transactions')
    .select('id, debit_mad, credit_mad, operation_date, beneficiary, label, deleted_at')
    .eq('id', data.transaction_id)
    .single();

  if (txErr || !tx || tx.deleted_at) {
    return { ok: false, error: 'Transaction introuvable' };
  }

  const txAny = tx as any;
  const txAmount = Math.abs(Number(txAny.debit_mad ?? txAny.credit_mad ?? 0));
  const newAllocAmount = Math.abs(Number(data.amount_mad));
  const isCredit = Number(txAny.credit_mad ?? 0) > 0;
  const isDebit = Number(txAny.debit_mad ?? 0) > 0;
  const txDate: string = txAny.operation_date ?? new Date().toISOString().slice(0, 10);
  const txBeneficiary: string =
    (txAny.beneficiary && String(txAny.beneficiary).trim()) ||
    String(txAny.label ?? '').slice(0, 100) ||
    'Bénéficiaire inconnu';

  // Somme des allocations déjà créées sur cette transaction
  const { data: existingAllocs } = await supabase
    .from('bank_transaction_allocations')
    .select('amount_mad')
    .eq('transaction_id', data.transaction_id)
    .is('deleted_at', null);

  const allocatedSoFar = (existingAllocs ?? []).reduce(
    (s: number, a: any) => s + Math.abs(Number(a.amount_mad)),
    0
  );

  if (allocatedSoFar + newAllocAmount > txAmount + 0.01) {
    return {
      ok: false,
      error:
        `Tu essaies d'allouer ${newAllocAmount.toFixed(2)} MAD mais la transaction fait ${txAmount.toFixed(2)} MAD. ` +
        (allocatedSoFar > 0
          ? `Déjà alloué : ${allocatedSoFar.toFixed(2)} MAD. Reste ${(txAmount - allocatedSoFar).toFixed(2)} MAD à allouer.`
          : `Le montant à allouer ne peut pas dépasser ${txAmount.toFixed(2)} MAD.`),
    };
  }

  // Si allocation projet, vérifie que le projet existe
  if (data.project_id) {
    const { data: proj } = await supabase
      .from('projects')
      .select('id, deleted_at')
      .eq('id', data.project_id)
      .single();
    if (!proj || proj.deleted_at) {
      return { ok: false, error: 'Projet introuvable ou supprimé' };
    }
  }

  // ─── Détection de doublons potentiels (anti double-saisie) ──────────────
  // On évite de créer un payment/encaissement projet si une saisie manuelle
  // existante semble correspondre à la même réalité économique (±1 MAD, ±7j).
  // Si trouvé, on retourne la liste pour que l'UI propose : Rattacher / Créer quand même.
  //
  // CEO 2026-06-17 : skip la détection si l'utilisateur a EXPLICITEMENT choisi
  // un acompte existant via `existing_acompte_id`. Dans ce cas il a déjà vu
  // les acomptes existants dans la popover / le formulaire et a fait son choix.
  // Re-bloquer ici sur la détection serait incohérent (le rapprochement d'un
  // acompte déjà payé manuellement est légitime).
  const forceCreate = data.force_create === true || data.force_create === 'true';
  const hasExplicitAcompte = !!data.existing_acompte_id;
  const detectableType = ['travaux', 'achats', 'services'].includes(data.allocation_type);
  if (!forceCreate && !hasExplicitAcompte && detectableType && data.project_id) {
    const dups = await findPotentialDuplicates({
      supabase,
      projectId: data.project_id,
      allocationType: data.allocation_type as 'travaux' | 'achats' | 'services',
      amount: newAllocAmount,
      isCredit,
      isDebit,
      txDate,
    });
    if (dups.length > 0) {
      return { ok: false, duplicates: dups };
    }
  }

  // ─── Cas Services : créer auto le lot + le payment ────────────────────────
  let services_lot_id = data.services_lot_id ?? null;
  let services_payment_id: string | null = null;

  // Track des lots auto-créés pour audit (post-commit)
  const autoCreatedLots: Array<{ table: FinanceAuditTable; id: string; allocation_type: string }> = [];

  if (data.allocation_type === 'services' && data.project_id) {
    if (!services_lot_id) {
      if (!data.service_category) {
        return { ok: false, error: 'Catégorie de service requise pour créer un lot services' };
      }
      const { data: newLot, error: lotErr } = await supabase
        .from('services_lots')
        .insert({
          project_id: data.project_id,
          provider_id: data.provider_id ?? null,
          service_category: data.service_category,
          devis_prestataire_mad: newAllocAmount,
          status: 'en_cours',
          description: data.notes ?? null,
        } as any)
        .select('id')
        .single();
      if (lotErr || !newLot) {
        return { ok: false, error: `Création du lot services : ${lotErr?.message ?? 'erreur'}` };
      }
      services_lot_id = newLot.id;
      autoCreatedLots.push({ table: 'services_lots', id: newLot.id, allocation_type: 'services' });
    }

    const { data: newPay, error: payErr } = await supabase
      .from('services_payments')
      .insert({
        project_id: data.project_id,
        lot_id: services_lot_id,
        provider_id: data.provider_id ?? null,
        paid_at: new Date().toISOString().slice(0, 10),
        amount_total: newAllocAmount,
        amount_paid: newAllocAmount,
        status: 'paye',
        description: data.notes ?? 'Versement via allocation bancaire',
      } as any)
      .select('id')
      .single();
    if (payErr || !newPay) {
      return { ok: false, error: `Création du paiement services : ${payErr?.message ?? 'erreur'}` };
    }
    services_payment_id = newPay.id;
  }

  // ─── Cas Travaux : créer auto encaissement (crédit) ou payment (débit) ───
  let travaux_payment_id: string | null = null;
  let travaux_encaissement_id: string | null = null;

  if (data.allocation_type === 'travaux' && data.project_id) {
    if (isCredit) {
      const { data: newEnc, error: encErr } = await supabase
        .from('travaux_encaissements')
        .insert({
          project_id: data.project_id,
          amount_mad: newAllocAmount,
          received_at: txDate,
          payment_method: 'virement',
          notes: data.notes ?? `Virement reçu de ${txBeneficiary} — allocation banque`,
        } as any)
        .select('id')
        .single();
      if (encErr || !newEnc) {
        return { ok: false, error: `Création de l'encaissement travaux : ${encErr?.message ?? 'erreur'}` };
      }
      travaux_encaissement_id = newEnc.id;
    } else if (isDebit) {
      // ─── Rattachement à un acompte existant (CEO 2026-06-16) ─────────────
      // Deux cas valides :
      //   a) Acompte PLANIFIÉ (pending) → on le marque payé et on attache
      //      l'allocation banque (transition pending → paid)
      //   b) Acompte DÉJÀ PAYÉ MANUELLEMENT → on attache juste l'allocation
      //      banque pour le rapprocher (badge "Saisie manuelle" → "Rapproché").
      //      On NE touche pas au montant payé (la saisie manuelle est la source
      //      de vérité). On met juste paid_at à la date banque pour cohérence.
      if (data.existing_acompte_id) {
        const { data: existing } = await supabase
          .from('travaux_payments')
          .select('id, project_id, lot_id, amount_total, amount_paid, status, paid_at, notes')
          .eq('id', data.existing_acompte_id)
          .single();
        if (!existing || (existing as any).project_id !== data.project_id) {
          return { ok: false, error: 'Acompte introuvable sur ce projet' };
        }
        const ex = existing as any;
        const isAlreadyPaid = ex.status === 'paid' && Number(ex.amount_paid ?? 0) >= Number(ex.amount_total) - 0.01;
        if (isAlreadyPaid) {
          // Cas (b) : on rapproche un acompte déjà payé manuellement.
          // On ne change ni status ni amount_paid. On note juste le rapprochement.
          const noteSuffix = `Rapproché à transaction banque ${txDate} (${txBeneficiary})`;
          await supabase
            .from('travaux_payments')
            .update({
              notes: ex.notes
                ? `${ex.notes} · ${noteSuffix}`
                : noteSuffix,
            } as any)
            .eq('id', data.existing_acompte_id);
        } else {
          // Cas (a) : transition pending/partial → paid (ou partial complété)
          const newAmountPaid = Math.min(
            Number(ex.amount_total) + 0.01,
            Number(ex.amount_paid ?? 0) + newAllocAmount,
          );
          const fullyPaid = newAmountPaid >= Number(ex.amount_total) - 0.01;
          const { error: updErr } = await supabase
            .from('travaux_payments')
            .update({
              amount_paid: newAmountPaid,
              paid_at: txDate,
              status: fullyPaid ? 'paid' : 'partial',
              notes: data.notes ?? `Rattaché à transaction banque (${txBeneficiary})`,
            } as any)
            .eq('id', data.existing_acompte_id);
          if (updErr) return { ok: false, error: `Mise à jour de l'acompte travaux : ${updErr.message}` };
        }
        travaux_payment_id = data.existing_acompte_id;
      } else {
      // Récupère artisan_name depuis le lot si fourni, sinon utilise le bénéficiaire
      let artisanName = txBeneficiary;
      let resolvedLotId: string | null = data.travaux_lot_id ?? null;

      if (resolvedLotId) {
        const { data: lot } = await supabase
          .from('travaux_lots')
          .select('artisan_name, artisan:artisans(name)')
          .eq('id', resolvedLotId)
          .single();
        if (lot) {
          artisanName = (lot as any)?.artisan?.name ?? (lot as any)?.artisan_name ?? txBeneficiary;
        }
      } else {
        // ─── Garde-fou anti-orphelin (CEO 2026-06-16) ──────────────────────
        // Avant ce garde-fou, ~10 paiements (472k MAD) ont été créés sans lot
        // → invisibles côté fiche projet. On garantit maintenant qu'aucun
        // paiement n'est créé sans lot rattaché.
        //
        // 1) Si un lot existe déjà pour (project, artisan) → on l'utilise.
        // 2) Sinon → on crée auto un lot "divers" avec note de traçabilité.
        //
        // CEO 2026-08-19 (session B, anti-doublons) : matching TOLÉRANT
        // (casse/accents/suffixes juridiques + inclusion) via
        // pickLotByVendorName, au lieu de l'égalité stricte qui recréait un
        // lot doublon dès que le bénéficiaire bancaire s'écrivait autrement.
        const { data: existingLots } = await supabase
          .from('travaux_lots')
          .select('id, numero, artisan_name, artisan:artisans(name)')
          .eq('project_id', data.project_id)
          .is('deleted_at', null)
          .order('numero', { ascending: true });
        const matchedTravauxLot = pickLotByVendorName(
          (existingLots ?? []).map((l: any) => ({
            id: l.id,
            numero: l.numero,
            vendor_name: l.artisan?.name ?? l.artisan_name ?? null,
          })),
          artisanName,
        );
        if (matchedTravauxLot) {
          resolvedLotId = matchedTravauxLot.id;
        } else {
          // Pas de lot → on en crée un automatiquement (catégorie 'divers').
          //
          // Fix bug Mamoun Zidouh (CEO 2026-06-30) : la contrainte UNIQUE est
          // maintenant partielle (WHERE deleted_at IS NULL, migration
          // 20260630130000) mais on garde une défense en profondeur :
          // 1) MAX(numero) calculé SANS filtrer deleted_at → on ne réutilise
          //    jamais un slot ayant déjà existé dans l'histoire du projet.
          // 2) Retry sur 23505 (race rare entre lecture MAX et INSERT).
          let createdId: string | null = null;
          let lastErrMsg = 'erreur';
          for (let attempt = 0; attempt < 5; attempt++) {
            const { data: maxRow } = await supabase
              .from('travaux_lots')
              .select('numero')
              .eq('project_id', data.project_id)
              .order('numero', { ascending: false })
              .limit(1);
            const nextNumero = ((maxRow?.[0] as any)?.numero ?? 0) + 1 + attempt;
            const { data: createdLot, error: lotErr } = await supabase
              .from('travaux_lots')
              .insert({
                project_id: data.project_id,
                numero: nextNumero,
                category: 'divers',
                artisan_name: artisanName,
                devis_artisan_mad: newAllocAmount,
                status: 'en_cours',
                description: `Lot créé automatiquement à l'allocation banque (versement ${txBeneficiary})`,
              } as any)
              .select('id')
              .single();
            if (!lotErr && createdLot) {
              createdId = (createdLot as any).id;
              break;
            }
            lastErrMsg = lotErr?.message ?? 'erreur';
            // 23505 = unique_violation → on retente avec numero+1 (race)
            if ((lotErr as any)?.code !== '23505') break;
          }
          if (!createdId) {
            return { ok: false, error: `Création auto du lot travaux : ${lastErrMsg}` };
          }
          resolvedLotId = createdId;
          autoCreatedLots.push({ table: 'travaux_lots', id: resolvedLotId!, allocation_type: 'travaux' });
        }
      }

      // P0 fix (2026-06-19) : calculer le prochain acompte_number libre du lot.
      // Sans ça, l'acompte naît orphelin et l'édition côté UI échoue.
      const { data: maxRowTrv } = await supabase
        .from('travaux_payments')
        .select('acompte_number')
        .eq('lot_id', resolvedLotId!)
        .is('deleted_at', null)
        .not('acompte_number', 'is', null)
        .order('acompte_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const newAcompteNumber = (((maxRowTrv as any)?.acompte_number ?? 0) + 1);

      const { data: newPay, error: payErr } = await supabase
        .from('travaux_payments')
        .insert({
          project_id: data.project_id,
          lot_id: resolvedLotId, // garanti non-null par le garde-fou ci-dessus
          acompte_number: newAcompteNumber,
          artisan_name: artisanName,
          currency: 'MAD',
          amount_total: newAllocAmount,
          amount_paid: newAllocAmount,
          paid_at: txDate,
          status: 'paid',
          payment_type: newAcompteNumber === 1 ? 'acompte' : 'autre',
          notes: data.notes ?? `Versement à ${txBeneficiary} — allocation banque`,
        } as any)
        .select('id')
        .single();
      if (payErr || !newPay) {
        return { ok: false, error: `Création du paiement travaux : ${payErr?.message ?? 'erreur'}` };
      }
      travaux_payment_id = newPay.id;
      } // ferme le else (création nouveau paiement)
    }
  }

  // ─── Cas Achats : créer auto encaissement (crédit) ou payment (débit) ───
  let achats_payment_id: string | null = null;
  let achats_encaissement_id: string | null = null;

  if (data.allocation_type === 'achats' && data.project_id) {
    if (isCredit) {
      const { data: newEnc, error: encErr } = await supabase
        .from('achats_encaissements')
        .insert({
          project_id: data.project_id,
          amount_mad: newAllocAmount,
          received_at: txDate,
          payment_method: 'virement',
          notes: data.notes ?? `Virement reçu de ${txBeneficiary} — allocation banque`,
        } as any)
        .select('id')
        .single();
      if (encErr || !newEnc) {
        return { ok: false, error: `Création de l'encaissement achats : ${encErr?.message ?? 'erreur'}` };
      }
      achats_encaissement_id = newEnc.id;
    } else if (isDebit) {
      // Rattachement à un acompte existant (CEO 2026-06-16) — voir explication
      // détaillée côté travaux. Supporte rapprochement d'acomptes déjà payés
      // manuellement (badge "Saisie manuelle" → "Rapproché banque").
      if (data.existing_acompte_id) {
        const { data: existing } = await supabase
          .from('achats_payments')
          .select('id, project_id, lot_id, amount_total, amount_paid, status, notes')
          .eq('id', data.existing_acompte_id)
          .single();
        if (!existing || (existing as any).project_id !== data.project_id) {
          return { ok: false, error: 'Acompte introuvable sur ce projet' };
        }
        const ex = existing as any;
        const isAlreadyPaid = ex.status === 'paid' && Number(ex.amount_paid ?? 0) >= Number(ex.amount_total) - 0.01;
        if (isAlreadyPaid) {
          const noteSuffix = `Rapproché à transaction banque ${txDate} (${txBeneficiary})`;
          await supabase
            .from('achats_payments')
            .update({
              notes: ex.notes ? `${ex.notes} · ${noteSuffix}` : noteSuffix,
            } as any)
            .eq('id', data.existing_acompte_id);
        } else {
          const newAmountPaid = Math.min(
            Number(ex.amount_total) + 0.01,
            Number(ex.amount_paid ?? 0) + newAllocAmount,
          );
          const fullyPaid = newAmountPaid >= Number(ex.amount_total) - 0.01;
          const { error: updErr } = await supabase
            .from('achats_payments')
            .update({
              amount_paid: newAmountPaid,
              paid_at: txDate,
              status: fullyPaid ? 'paid' : 'partial',
              notes: data.notes ?? `Rattaché à transaction banque (${txBeneficiary})`,
            } as any)
            .eq('id', data.existing_acompte_id);
          if (updErr) return { ok: false, error: `Mise à jour de l'acompte achats : ${updErr.message}` };
        }
        achats_payment_id = data.existing_acompte_id;
      } else {
      let supplierName = txBeneficiary;
      let resolvedAchatsLotId: string | null = data.achats_lot_id ?? null;
      if (resolvedAchatsLotId) {
        const { data: lot } = await supabase
          .from('achats_lots')
          .select('supplier_name, supplier:artisans(name)')
          .eq('id', resolvedAchatsLotId)
          .single();
        if (lot) {
          supplierName = (lot as any)?.supplier?.name ?? (lot as any)?.supplier_name ?? txBeneficiary;
        }
      } else {
        // Garde-fou anti-orphelin (CEO 2026-06-16) — même logique que travaux.
        //
        // CEO 2026-08-19 (session B, anti-doublons) : matching TOLÉRANT via
        // pickLotByVendorName — un lot réel existant (notamment converti
        // depuis la page Estimations) est réutilisé même si le bénéficiaire
        // bancaire s'écrit différemment ("MAISON AZAR SARL" ↔ "Maison Azar").
        const { data: existingLots } = await supabase
          .from('achats_lots')
          .select('id, numero, supplier_name, supplier:artisans(name)')
          .eq('project_id', data.project_id)
          .is('deleted_at', null)
          .order('numero', { ascending: true });
        const matchedAchatsLot = pickLotByVendorName(
          (existingLots ?? []).map((l: any) => ({
            id: l.id,
            numero: l.numero,
            vendor_name: l.supplier?.name ?? l.supplier_name ?? null,
          })),
          supplierName,
        );
        if (matchedAchatsLot) {
          resolvedAchatsLotId = matchedAchatsLot.id;
        } else {
          // Fix bug Mamoun Zidouh (CEO 2026-06-30) : avant, MAX(numero) filtrait
          // deleted_at IS NULL → si un lot soft-deleté occupait le numero+1,
          // l'INSERT échouait sur la contrainte UNIQUE non partielle.
          // La contrainte est devenue partielle (migration 20260630130000)
          // mais on garde défense en profondeur :
          // 1) MAX calculé SANS filtrer deleted_at (jamais réutiliser un slot
          //    historique → pas de confusion utilisateur).
          // 2) Retry sur 23505 (race rare).
          let createdId: string | null = null;
          let lastErrMsg = 'erreur';
          for (let attempt = 0; attempt < 5; attempt++) {
            const { data: maxRow } = await supabase
              .from('achats_lots')
              .select('numero')
              .eq('project_id', data.project_id)
              .order('numero', { ascending: false })
              .limit(1);
            const nextNumero = ((maxRow?.[0] as any)?.numero ?? 0) + 1 + attempt;
            const { data: createdLot, error: lotErr } = await supabase
              .from('achats_lots')
              .insert({
                project_id: data.project_id,
                numero: nextNumero,
                category: 'divers',
                supplier_name: supplierName,
                devis_fournisseur_mad: newAllocAmount,
                status: 'commande',
                description: `Lot créé automatiquement à l'allocation banque (versement ${txBeneficiary})`,
              } as any)
              .select('id')
              .single();
            if (!lotErr && createdLot) {
              createdId = (createdLot as any).id;
              break;
            }
            lastErrMsg = lotErr?.message ?? 'erreur';
            if ((lotErr as any)?.code !== '23505') break;
          }
          if (!createdId) {
            return { ok: false, error: `Création auto du lot achats : ${lastErrMsg}` };
          }
          resolvedAchatsLotId = createdId;
          autoCreatedLots.push({ table: 'achats_lots', id: resolvedAchatsLotId!, allocation_type: 'achats' });
        }
      }
      // P0 fix (2026-06-19) : symétrie travaux — calculer prochain acompte_number libre.
      const { data: maxRowAch } = await supabase
        .from('achats_payments')
        .select('acompte_number')
        .eq('lot_id', resolvedAchatsLotId!)
        .is('deleted_at', null)
        .not('acompte_number', 'is', null)
        .order('acompte_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      const newAchatsAcompteNumber = (((maxRowAch as any)?.acompte_number ?? 0) + 1);

      const { data: newPay, error: payErr } = await supabase
        .from('achats_payments')
        .insert({
          project_id: data.project_id,
          lot_id: resolvedAchatsLotId,
          acompte_number: newAchatsAcompteNumber,
          supplier_name: supplierName,
          currency: 'MAD',
          amount_total: newAllocAmount,
          amount_paid: newAllocAmount,
          paid_at: txDate,
          status: 'paid',
          notes: data.notes ?? `Versement à ${txBeneficiary} — allocation banque`,
        } as any)
        .select('id')
        .single();
      if (payErr || !newPay) {
        return { ok: false, error: `Création du paiement achats : ${payErr?.message ?? 'erreur'}` };
      }
      achats_payment_id = newPay.id;
      } // ferme le else (création nouveau paiement)
    }
  }

  const { data: insertedAlloc, error: insertError } = await supabase
    .from('bank_transaction_allocations')
    .insert({
      transaction_id: data.transaction_id,
      project_id: data.project_id ?? null,
      allocation_type: data.allocation_type,
      amount_mad: newAllocAmount,
      notes: data.notes ?? null,
      allocated_by: me.id,
      travaux_lot_id: data.travaux_lot_id ?? null,
      achats_lot_id: data.achats_lot_id ?? null,
      services_lot_id: services_lot_id,
      services_payment_id: services_payment_id,
      payment_id: data.payment_id ?? null,
      travaux_payment_id,
      travaux_encaissement_id,
      achats_payment_id,
      achats_encaissement_id,
    } as any)
    .select('id')
    .single();

  if (insertError) {
    // ─── Rollback des lignes finance auto-créées ─────────────────────────
    // Si l'insert allocation échoue APRÈS création d'un encaissement/payment/lot,
    // on soft-delete les lignes orphelines pour éviter des fantômes côté fiche
    // projet (encaissement visible sans transaction bancaire liée).
    const rollbackTs = new Date().toISOString();
    const rollbackTargets: Array<{ table: string; id: string }> = [];
    if (travaux_encaissement_id) rollbackTargets.push({ table: 'travaux_encaissements', id: travaux_encaissement_id });
    if (travaux_payment_id && !data.existing_acompte_id) rollbackTargets.push({ table: 'travaux_payments', id: travaux_payment_id });
    if (achats_encaissement_id) rollbackTargets.push({ table: 'achats_encaissements', id: achats_encaissement_id });
    if (achats_payment_id && !data.existing_acompte_id) rollbackTargets.push({ table: 'achats_payments', id: achats_payment_id });
    if (services_payment_id) rollbackTargets.push({ table: 'services_payments', id: services_payment_id });
    for (const t of rollbackTargets) {
      try {
        await supabase.from(t.table).update({ deleted_at: rollbackTs } as any).eq('id', t.id);
      } catch { /* best-effort rollback */ }
    }
    for (const lot of autoCreatedLots) {
      try {
        await supabase.from(lot.table).update({ deleted_at: rollbackTs } as any).eq('id', lot.id);
      } catch { /* best-effort rollback */ }
    }
    return { ok: false, error: `Impossible de créer l'allocation : ${insertError.message}` };
  }
  const newAllocationId: string | null = (insertedAlloc as any)?.id ?? null;

  // ─── Audit log : trace l'allocation sur la ligne finance touchée ────────
  const auditCommon = {
    actorId: me.id,
    label: `Allocation banque ${newAllocAmount.toFixed(0)} MAD (${txBeneficiary})`,
    payload: {
      transaction_id: data.transaction_id,
      amount_mad: newAllocAmount,
      operation_date: txDate,
      beneficiary: txBeneficiary,
      allocation_type: data.allocation_type,
    },
  };
  const targets: Array<{ table: FinanceAuditTable; id: string }> = [];
  if (travaux_encaissement_id) targets.push({ table: 'travaux_encaissements', id: travaux_encaissement_id });
  if (travaux_payment_id) targets.push({ table: 'travaux_payments', id: travaux_payment_id });
  if (achats_encaissement_id) targets.push({ table: 'achats_encaissements', id: achats_encaissement_id });
  if (achats_payment_id) targets.push({ table: 'achats_payments', id: achats_payment_id });
  if (data.payment_id) targets.push({ table: 'payments', id: data.payment_id });
  for (const t of targets) {
    await logFinanceAudit({
      table: t.table,
      recordId: t.id,
      action: 'allocate',
      ...auditCommon,
    });
  }

  // ─── Audit log additionnel : event sur la transaction bancaire ───────────
  await logFinanceAudit({
    table: 'bank_transactions',
    recordId: data.transaction_id,
    action: 'allocate',
    actorId: me.id,
    label: `Allocation manuelle ${newAllocAmount.toFixed(0)} MAD${data.project_id ? ` (${data.allocation_type})` : ` (${data.allocation_type})`}`,
    payload: {
      allocation_id: newAllocationId,
      target_table:
        travaux_encaissement_id ? 'travaux_encaissements' :
        travaux_payment_id ? 'travaux_payments' :
        achats_encaissement_id ? 'achats_encaissements' :
        achats_payment_id ? 'achats_payments' :
        services_payment_id ? 'services_payments' :
        data.payment_id ? 'payments' : null,
      target_id:
        travaux_encaissement_id ?? travaux_payment_id ??
        achats_encaissement_id ?? achats_payment_id ??
        services_payment_id ?? data.payment_id ?? null,
      amount: newAllocAmount,
      allocation_type: data.allocation_type,
      project_id: data.project_id ?? null,
    },
  });

  // ─── Audit log : lots auto-créés via cette allocation ────────────────────
  for (const lot of autoCreatedLots) {
    await logFinanceAudit({
      table: lot.table,
      recordId: lot.id,
      action: 'create',
      actorId: me.id,
      label: 'Auto-créé via allocation banque',
      payload: {
        source_bank_transaction_id: data.transaction_id,
        allocation_type: lot.allocation_type,
        project_id: data.project_id ?? null,
      },
    });
  }

  // Apprentissage : si charge récurrente, mémoriser le mapping pour les futurs imports
  await saveLearnedMapping({
    supabase,
    userId: me.id,
    beneficiary: txBeneficiary,
    category_code: (txAny as any).category_code ?? null,
    allocation_type: data.allocation_type,
  });

  revalidatePath(`/finance/tresorerie/transactions/${data.transaction_id}`);
  revalidatePath('/finance/tresorerie/reconciliation');
  revalidatePath('/finance/tresorerie');
  if (data.project_id) {
    revalidatePath(`/projects/${data.project_id}`);
    revalidatePath(`/projects/${data.project_id}/travaux`);
    revalidatePath(`/projects/${data.project_id}/achats`);
    revalidatePath(`/projects/${data.project_id}/services`);
  }
  return { ok: true };
}

// ─── Allocation en bloc (charges récurrentes) ────────────────────────────
//
// Cas d'usage : 5 salaires identiques → tu coches les 5 lignes dans le tableau
// et tu cliques "Allouer ensemble · charges cabinet". Chaque transaction est
// allouée à 100% du montant restant avec le type choisi.
//
// Limité aux types SANS projet (cabinet_charge / cabinet_fiscal / cabinet_social
// / frais_bancaire / intercompany / autre) — pour travaux/achats/services/honoraires
// où le projet diffère ligne à ligne, le bulk n'a pas de sens.

const BULK_ALLOWED_TYPES = [
  'cabinet_charge','cabinet_fiscal','cabinet_social',
  'frais_bancaire','intercompany','autre',
] as const;

const bulkAllocateSchema = z.object({
  transaction_ids: z.array(z.string().uuid()).min(1).max(200),
  allocation_type: z.enum(BULK_ALLOWED_TYPES),
  notes: z.string().optional().nullable(),
});

export type BulkAllocateResult =
  | { ok: true; created: number; skipped: number }
  | { ok: false; error: string };

export async function bulkAllocateChargesAction(input: {
  transaction_ids: string[];
  allocation_type: string;
  notes?: string | null;
}): Promise<BulkAllocateResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  const supabase = createClient();

  let data;
  try {
    data = bulkAllocateSchema.parse(input);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  // Récupère toutes les transactions concernées (avec beneficiary pour l'apprentissage)
  const { data: txs, error: txErr } = await supabase
    .from('bank_transactions')
    .select('id, debit_mad, credit_mad, beneficiary, label, category_code, deleted_at')
    .in('id', data.transaction_ids)
    .is('deleted_at', null);

  if (txErr || !txs) {
    return { ok: false, error: `Lecture transactions : ${txErr?.message ?? 'erreur'}` };
  }

  // Récupère les allocations existantes (actives) pour calculer le reste à allouer par transaction
  const { data: existing } = await supabase
    .from('bank_transaction_allocations')
    .select('transaction_id, amount_mad')
    .in('transaction_id', data.transaction_ids)
    .is('deleted_at', null);

  const allocatedByTx = new Map<string, number>();
  for (const a of (existing ?? []) as any[]) {
    const prev = allocatedByTx.get(a.transaction_id) ?? 0;
    allocatedByTx.set(a.transaction_id, prev + Math.abs(Number(a.amount_mad)));
  }

  const rows: any[] = [];
  let skipped = 0;
  for (const tx of txs as any[]) {
    const txAmount = Math.abs(Number(tx.debit_mad ?? tx.credit_mad ?? 0));
    const alreadyAllocated = allocatedByTx.get(tx.id) ?? 0;
    const remaining = Math.max(0, txAmount - alreadyAllocated);
    if (remaining < 0.01) {
      skipped += 1;
      continue;
    }
    rows.push({
      transaction_id: tx.id,
      project_id: null,
      allocation_type: data.allocation_type,
      amount_mad: remaining,
      notes: data.notes ?? null,
      allocated_by: me.id,
    });
  }

  if (rows.length === 0) {
    return { ok: false, error: 'Toutes les transactions sélectionnées sont déjà allouées intégralement.' };
  }

  const { data: insertedAllocs, error: insErr } = await supabase
    .from('bank_transaction_allocations')
    .insert(rows as any)
    .select('id, transaction_id, amount_mad');

  if (insErr) {
    return { ok: false, error: `Échec allocation groupée : ${insErr.message}` };
  }

  // ─── Audit log : 1 event par transaction touchée ────────────────────────
  for (const a of (insertedAllocs ?? []) as any[]) {
    await logFinanceAudit({
      table: 'bank_transactions',
      recordId: a.transaction_id,
      action: 'bulk_update',
      actorId: me.id,
      label: `Allocation en lot (${data.allocation_type}) ${Number(a.amount_mad).toFixed(0)} MAD`,
      payload: {
        allocation_id: a.id,
        allocation_type: data.allocation_type,
        amount: Number(a.amount_mad),
        bulk_size: rows.length,
      },
    });
  }

  // Apprentissage : enregistrer les mappings bénéficiaires uniques de ce bulk
  const seenBeneficiaries = new Set<string>();
  for (const tx of txs as any[]) {
    const benef = (tx.beneficiary && String(tx.beneficiary).trim()) || null;
    if (!benef || seenBeneficiaries.has(benef)) continue;
    seenBeneficiaries.add(benef);
    await saveLearnedMapping({
      supabase,
      userId: me.id,
      beneficiary: benef,
      category_code: tx.category_code ?? null,
      allocation_type: data.allocation_type,
    });
  }

  revalidatePath('/finance/tresorerie');
  revalidatePath('/finance/tresorerie/reconciliation');
  return { ok: true, created: rows.length, skipped };
}

// ─── Suppression d'une allocation ────────────────────────────────────────

export async function removeAllocationAction(
  allocationId: string,
  transactionId: string
): Promise<AllocateResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  const supabase = createClient();
  const now = new Date().toISOString();

  // Récupère les FK de l'allocation pour soft-delete les lignes créées en cascade
  const { data: alloc } = await supabase
    .from('bank_transaction_allocations')
    .select('id, project_id, amount_mad, travaux_payment_id, travaux_encaissement_id, achats_payment_id, achats_encaissement_id, services_payment_id, payment_id')
    .eq('id', allocationId)
    .single();

  const a = alloc as any;
  if (a) {
    if (a.travaux_payment_id)
      await supabase.from('travaux_payments').update({ deleted_at: now } as any).eq('id', a.travaux_payment_id);
    if (a.travaux_encaissement_id)
      await supabase.from('travaux_encaissements').update({ deleted_at: now } as any).eq('id', a.travaux_encaissement_id);
    if (a.achats_payment_id)
      await supabase.from('achats_payments').update({ deleted_at: now } as any).eq('id', a.achats_payment_id);
    if (a.achats_encaissement_id)
      await supabase.from('achats_encaissements').update({ deleted_at: now } as any).eq('id', a.achats_encaissement_id);
    if (a.services_payment_id)
      await supabase.from('services_payments').update({ deleted_at: now } as any).eq('id', a.services_payment_id);
  }

  const { error } = await supabase
    .from('bank_transaction_allocations')
    .update({ deleted_at: now } as any)
    .eq('id', allocationId);

  if (error) {
    return { ok: false, error: `Impossible de supprimer l'allocation : ${error.message}` };
  }

  // ─── Audit log : trace la désallocation sur la cible de l'allocation ────
  if (a) {
    const auditCommon = {
      actorId: me.id,
      label: `Allocation banque retirée${a.amount_mad ? ` (${Number(a.amount_mad).toFixed(0)} MAD)` : ''}`,
      payload: {
        transaction_id: transactionId,
        allocation_id: allocationId,
        amount_mad: a.amount_mad ? Number(a.amount_mad) : null,
      },
    };
    const targets: Array<{ table: FinanceAuditTable; id: string }> = [];
    if (a.travaux_encaissement_id) targets.push({ table: 'travaux_encaissements', id: a.travaux_encaissement_id });
    if (a.travaux_payment_id) targets.push({ table: 'travaux_payments', id: a.travaux_payment_id });
    if (a.achats_encaissement_id) targets.push({ table: 'achats_encaissements', id: a.achats_encaissement_id });
    if (a.achats_payment_id) targets.push({ table: 'achats_payments', id: a.achats_payment_id });
    if (a.payment_id) targets.push({ table: 'payments', id: a.payment_id });
    for (const t of targets) {
      await logFinanceAudit({
        table: t.table,
        recordId: t.id,
        action: 'unallocate',
        ...auditCommon,
      });
    }

    // Event direct sur la ligne d'allocation supprimée
    await logFinanceAudit({
      table: 'bank_transaction_allocations',
      recordId: allocationId,
      action: 'delete',
      actorId: me.id,
      label: `Allocation supprimée${a.amount_mad ? ` (${Number(a.amount_mad).toFixed(0)} MAD)` : ''}`,
      payload: {
        transaction_id: transactionId,
        amount_mad: a.amount_mad ? Number(a.amount_mad) : null,
        project_id: a.project_id ?? null,
        cascaded_targets: targets.map((t) => ({ table: t.table, id: t.id })),
      },
    });
  }

  revalidatePath(`/finance/tresorerie/transactions/${transactionId}`);
  revalidatePath('/finance/tresorerie/reconciliation');
  revalidatePath('/finance/tresorerie');
  if (a?.project_id) {
    revalidatePath(`/projects/${a.project_id}`);
    revalidatePath(`/projects/${a.project_id}/travaux`);
    revalidatePath(`/projects/${a.project_id}/achats`);
    revalidatePath(`/projects/${a.project_id}/services`);
  }
  return { ok: true };
}

// ─── Rapprochement auto (depuis suggestion) ──────────────────────────────

const attachSchema = z.object({
  transaction_id: z.string().uuid(),
  source: z.enum(['travaux_payment', 'achats_payment', 'travaux_encaissement', 'achats_encaissement', 'services_payment', 'honoraires_payment']),
  source_id: z.string().uuid(),
  project_id: z.string().uuid().optional().nullable(),
  amount_mad: z.string().regex(/^-?\d+(\.\d{1,2})?$/),
});

export async function attachToStonizPaymentAction(formData: FormData): Promise<AllocateResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }
  const supabase = createClient();

  let data;
  try {
    const raw: Record<string, any> = {};
    for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
    data = attachSchema.parse(raw);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  // Déduit allocation_type depuis source
  const allocation_type: string = (() => {
    switch (data.source) {
      case 'travaux_payment':
      case 'travaux_encaissement':
        return 'travaux';
      case 'achats_payment':
      case 'achats_encaissement':
        return 'achats';
      case 'services_payment':
        return 'services';
      case 'honoraires_payment':
        return 'honoraires';
    }
  })();

  // ─── Garde-fou anti-double-rattachement (CEO 2026-07-02) ─────────────────
  // Bug diagnostiqué sur projet Yassine El Faiq (a313063e) : 3 virements clients
  // de 50k MAD chacun avaient été rapprochés successivement au MÊME encaissement
  // planifié → travaux_encaissements affichait 50k au lieu de 150k côté fiche
  // projet, car 3 allocations pointaient vers la même ligne finance sans que
  // l'action ne bloque.
  //
  // Règle métier : 1 allocation banque = 1 ligne finance (encaissement/payment).
  // Si la ligne cible est déjà rapprochée à une allocation active, on refuse
  // et on invite l'utilisateur à créer un NOUVEL encaissement via l'allocation
  // manuelle (avec force_create côté allocateTransactionAction).
  const sourceFieldMap: Record<string, string> = {
    travaux_payment: 'travaux_payment_id',
    travaux_encaissement: 'travaux_encaissement_id',
    achats_payment: 'achats_payment_id',
    achats_encaissement: 'achats_encaissement_id',
    services_payment: 'services_payment_id',
    honoraires_payment: 'payment_id',
  };
  const targetField = sourceFieldMap[data.source];
  if (targetField) {
    const { data: existingAlloc, error: existingErr } = await supabase
      .from('bank_transaction_allocations')
      .select('id, transaction_id, amount_mad')
      .eq(targetField, data.source_id)
      .is('deleted_at', null)
      .limit(1);
    if (existingErr) {
      return { ok: false, error: `Vérification anti-doublon : ${existingErr.message}` };
    }
    if (existingAlloc && existingAlloc.length > 0) {
      return {
        ok: false,
        error:
          `Cette ligne finance est déjà rapprochée à une autre transaction bancaire. ` +
          `Créer un NOUVEL encaissement/paiement via allocation manuelle (bouton "Créer quand même") ` +
          `au lieu de rattacher à l'existant.`,
      };
    }
  }

  // Champs spécifiques selon source
  const allocFields: Record<string, any> = {
    transaction_id: data.transaction_id,
    project_id: data.project_id ?? null,
    allocation_type,
    amount_mad: Math.abs(Number(data.amount_mad)),
    notes: `Rapprochement auto depuis ${data.source}`,
    allocated_by: me.id,
  };

  if (data.source === 'travaux_payment') {
    allocFields.travaux_payment_id = data.source_id;
    const { data: p } = await supabase
      .from('travaux_payments')
      .select('lot_id')
      .eq('id', data.source_id)
      .single();
    if (p) allocFields.travaux_lot_id = (p as any).lot_id;
  } else if (data.source === 'travaux_encaissement') {
    allocFields.travaux_encaissement_id = data.source_id;
  } else if (data.source === 'achats_payment') {
    allocFields.achats_payment_id = data.source_id;
    const { data: p } = await supabase
      .from('achats_payments')
      .select('lot_id')
      .eq('id', data.source_id)
      .single();
    if (p) allocFields.achats_lot_id = (p as any).lot_id;
  } else if (data.source === 'achats_encaissement') {
    allocFields.achats_encaissement_id = data.source_id;
  } else if (data.source === 'services_payment') {
    allocFields.services_payment_id = data.source_id;
    const { data: p } = await supabase
      .from('services_payments')
      .select('lot_id')
      .eq('id', data.source_id)
      .single();
    if (p) allocFields.services_lot_id = (p as any).lot_id;
  } else if (data.source === 'honoraires_payment') {
    allocFields.payment_id = data.source_id;
  }

  const { error } = await supabase
    .from('bank_transaction_allocations')
    .insert(allocFields as any);

  if (error) {
    return { ok: false, error: `Échec du rapprochement : ${error.message}` };
  }

  // QA-BUG-034 (décision CEO 2026-06-14) : rapprocher un virement réel d'un
  // encaissement encore PLANIFIÉ le bascule en 'recu', avec la date du virement,
  // pour qu'il compte enfin comme encaissé (sinon il resterait « à encaisser »).
  let basculedToRecu = false;
  if (data.source === 'travaux_encaissement' || data.source === 'achats_encaissement') {
    const { data: txRow } = await supabase
      .from('bank_transactions')
      .select('operation_date')
      .eq('id', data.transaction_id)
      .single();
    const txDate: string = (txRow as any)?.operation_date ?? new Date().toISOString().slice(0, 10);
    const table = data.source === 'travaux_encaissement' ? 'travaux_encaissements' : 'achats_encaissements';
    const { data: updated } = await supabase
      .from(table)
      .update({ status: 'recu', received_at: txDate } as any)
      .eq('id', data.source_id)
      .eq('status', 'planifie') // n'affecte que les planifiés (idempotent)
      .select('id');
    basculedToRecu = (updated ?? []).length > 0;
    if (basculedToRecu) {
      await logFinanceAudit({
        table: table as FinanceAuditTable,
        recordId: data.source_id,
        action: 'status_change',
        actorId: me.id,
        label: 'Bascule planifié → reçu via rapprochement banque',
        payload: {
          status: { before: 'planifie', after: 'recu' },
          received_at: { before: null, after: txDate },
          transaction_id: data.transaction_id,
        },
      });
    }
  }

  // ─── Audit log : trace l'allocation sur la ligne finance touchée ────────
  const sourceTableMap: Record<string, FinanceAuditTable | null> = {
    travaux_payment: 'travaux_payments',
    travaux_encaissement: 'travaux_encaissements',
    achats_payment: 'achats_payments',
    achats_encaissement: 'achats_encaissements',
    services_payment: null, // services_payments hors scope finance_audit_log
    honoraires_payment: 'payments',
  };
  const auditTable = sourceTableMap[data.source] ?? null;
  if (auditTable) {
    await logFinanceAudit({
      table: auditTable,
      recordId: data.source_id,
      action: 'allocate',
      actorId: me.id,
      label: `Rapproché à transaction banque (${Math.abs(Number(data.amount_mad)).toFixed(0)} MAD)`,
      payload: {
        transaction_id: data.transaction_id,
        amount_mad: Math.abs(Number(data.amount_mad)),
        source: data.source,
      },
    });
  }

  revalidatePath(`/finance/tresorerie/transactions/${data.transaction_id}`);
  revalidatePath('/finance/tresorerie/reconciliation');
  revalidatePath('/finance/tresorerie');
  if (data.project_id) {
    revalidatePath(`/projects/${data.project_id}`);
    revalidatePath(`/projects/${data.project_id}/travaux`);
    revalidatePath(`/projects/${data.project_id}/achats`);
  }
  return { ok: true };
}
