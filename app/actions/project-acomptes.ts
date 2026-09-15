'use server';

import { assertRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';

/**
 * Charge tous les lots d'un projet (travaux ou achats) avec leurs acomptes
 * pour permettre à l'utilisateur de choisir explicitement à quel acompte
 * rattacher une transaction bancaire (CEO 2026-06-16).
 *
 * Évite le bug "création d'une 5e ligne au lieu de rattacher la 1ère pending".
 */

export type Acompte = {
  id: string;
  acompte_number: number | null;
  amount_total: number;
  amount_paid: number;
  scheduled_date: string | null;
  paid_at: string | null;
  status: 'pending' | 'paid' | 'partial' | string;
  notes: string | null;
  /** Match probable avec la transaction en cours (CEO 2026-06-16) */
  match_score?: number; // 0 = pas de match, 1 = match parfait
  is_best_match?: boolean;
  /** Total déjà alloué côté banque (CEO 2026-06-17) */
  bank_allocated_total?: number;
  /** Reste à rapprocher banque (amount_total - bank_allocated_total) */
  bank_remaining?: number;
  /** L'acompte est-il totalement rapproché banque ? (sum allocs >= amount_total) */
  is_fully_bank_allocated?: boolean;
};

export type Lot = {
  id: string;
  numero: number;
  category: string;
  partner_name: string;            // artisan ou supplier
  devis_total: number;
  total_paye: number;
  pending_acomptes: Acompte[];
  paid_acomptes: Acompte[];
};

export async function fetchProjectAcomptes(
  projectId: string,
  kind: 'travaux' | 'achats',
  /** Montant de la transaction à allouer — sert au matching auto (CEO 2026-06-16) */
  targetAmount?: number,
  /** Bénéficiaire de la transaction — privilégie les lots du même artisan */
  targetBeneficiary?: string,
): Promise<{ lots: Lot[] }> {
  await assertRole(['ceo', 'finance', 'developer', 'chef_projet', 'achats']);
  const supabase = createClient();

  const lotsTable = kind === 'travaux' ? 'travaux_lots' : 'achats_lots';
  const paymentsTable = kind === 'travaux' ? 'travaux_payments' : 'achats_payments';
  const partnerCol = kind === 'travaux' ? 'artisan_name' : 'supplier_name';
  const devisCol = kind === 'travaux' ? 'devis_artisan_mad' : 'devis_fournisseur_mad';

  const { data: lots } = await supabase
    .from(lotsTable)
    .select(`id, numero, category, ${partnerCol}, ${devisCol}`)
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('numero', { ascending: true });

  if (!lots || lots.length === 0) return { lots: [] };

  const lotIds = lots.map((l: any) => l.id);
  const { data: payments } = await supabase
    .from(paymentsTable)
    .select('id, lot_id, acompte_number, amount_total, amount_paid, scheduled_date, paid_at, status, notes')
    .in('lot_id', lotIds)
    .is('deleted_at', null)
    .order('acompte_number', { ascending: true });

  const paymentsByLot = new Map<string, any[]>();
  for (const p of (payments ?? []) as any[]) {
    const arr = paymentsByLot.get(p.lot_id) ?? [];
    arr.push(p);
    paymentsByLot.set(p.lot_id, arr);
  }

  // Somme des allocations banque active par paiement (CEO 2026-06-17)
  const paymentIds = (payments ?? []).map((p: any) => p.id);
  const bankAllocatedByPayment = new Map<string, number>();
  if (paymentIds.length > 0) {
    const fkCol = kind === 'travaux' ? 'travaux_payment_id' : 'achats_payment_id';
    const { data: allocs } = await supabase
      .from('bank_transaction_allocations')
      .select(`${fkCol}, amount_mad`)
      .in(fkCol, paymentIds)
      .is('deleted_at', null);
    for (const a of (allocs ?? []) as any[]) {
      const id = a[fkCol];
      if (!id) continue;
      bankAllocatedByPayment.set(
        id,
        (bankAllocatedByPayment.get(id) ?? 0) + Math.abs(Number(a.amount_mad ?? 0)),
      );
    }
  }

  const cleanBenef = (targetBeneficiary ?? '').trim().toLowerCase();

  const rawLots = (lots as any[]).map((l) => {
    const lotPayments = paymentsByLot.get(l.id) ?? [];
    const partnerName: string = l[partnerCol] ?? '—';
    const lotPartnerMatchesBenef =
      cleanBenef.length >= 3 && partnerName.toLowerCase().includes(cleanBenef);
    const pending: Acompte[] = [];
    const paid: Acompte[] = [];
    let total_paye = 0;
    for (const p of lotPayments) {
      const amount_paid = Number(p.amount_paid ?? 0);
      total_paye += amount_paid;
      const amount_total = Number(p.amount_total ?? 0);
      // Score de match : 1 si montant exact (± 5 MAD), 0.8 si ± 1%, 0.6 si ± 5%
      let match_score = 0;
      if (targetAmount != null && targetAmount > 0 && amount_total > 0) {
        const ecart = Math.abs(amount_total - targetAmount);
        const ecartPct = ecart / amount_total;
        if (ecart < 5) match_score = 1;
        else if (ecartPct < 0.01) match_score = 0.9;
        else if (ecartPct < 0.05) match_score = 0.7;
        else if (ecartPct < 0.1) match_score = 0.5;
        // Bonus si lot partenaire matche le bénéficiaire
        if (lotPartnerMatchesBenef && match_score > 0) {
          match_score = Math.min(1, match_score + 0.1);
        }
      }
      const bank_allocated_total = bankAllocatedByPayment.get(p.id) ?? 0;
      const bank_remaining = Math.max(0, amount_total - bank_allocated_total);
      const acompte: Acompte = {
        id: p.id,
        acompte_number: p.acompte_number,
        amount_total,
        amount_paid,
        scheduled_date: p.scheduled_date,
        paid_at: p.paid_at,
        status: p.status ?? 'pending',
        notes: p.notes,
        match_score,
        bank_allocated_total,
        bank_remaining,
        is_fully_bank_allocated: bank_remaining < 0.01 && amount_total > 0 && bank_allocated_total > 0,
      };
      if (acompte.status === 'pending' || amount_paid < acompte.amount_total - 0.01) {
        pending.push(acompte);
      } else {
        paid.push(acompte);
      }
    }
    return {
      id: l.id,
      numero: l.numero,
      category: l.category,
      partner_name: partnerName,
      devis_total: Number(l[devisCol] ?? 0),
      total_paye,
      pending_acomptes: pending,
      paid_acomptes: paid,
    };
  });

  // Marque l'acompte avec le meilleur score (>= 0.5) comme is_best_match.
  // On regarde les pending en priorité, puis les paid SANS bank link (à rapprocher).
  let bestScore = 0;
  let bestRef: Acompte | null = null;
  for (const l of rawLots) {
    for (const a of l.pending_acomptes) {
      if ((a.match_score ?? 0) > bestScore) {
        bestScore = a.match_score ?? 0;
        bestRef = a;
      }
    }
  }
  // Si aucun pending ne convient, regarder les paid pas encore TOTALEMENT rapprochés
  if (!bestRef || bestScore < 0.5) {
    for (const l of rawLots) {
      for (const a of l.paid_acomptes) {
        if (a.is_fully_bank_allocated) continue;
        if ((a.match_score ?? 0) > bestScore) {
          bestScore = a.match_score ?? 0;
          bestRef = a;
        }
      }
    }
  }
  if (bestRef && bestScore >= 0.5) bestRef.is_best_match = true;

  return { lots: rawLots };
}
