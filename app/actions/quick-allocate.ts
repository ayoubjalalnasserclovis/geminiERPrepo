'use server';

import { assertRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';

/**
 * Server actions pour l'allocation rapide inline depuis le tableau trésorerie
 * (CEO 2026-06-16).
 *
 * - fetchQuickAllocateContext : tout ce qu'il faut pour la popover en 1 appel
 * - Suggestion auto basée sur bank_category_mappings (apprentissage existant)
 * - Projets actifs lights pour le combobox
 */

export type AllocationSuggestion = {
  allocation_type: string | null;
  /** Confidence : 'learned' (depuis bank_category_mappings) | 'beneficiary_match' | null */
  source: 'learned' | 'beneficiary_match' | null;
  /** Project suggéré si on a déjà alloué une tx au même bénéficiaire récemment */
  project_id: string | null;
};

export type QuickAllocateContext = {
  transaction: {
    id: string;
    operation_date: string | null;
    label: string | null;
    beneficiary: string | null;
    debit_mad: number;
    credit_mad: number;
    /** Montant restant à allouer (montant total − allocations actives) */
    remaining: number;
    is_debit: boolean;
  };
  suggestion: AllocationSuggestion;
  projects: Array<{ id: string; reference: string; client: string; status: string }>;
};

export async function fetchQuickAllocateContext(transactionId: string): Promise<QuickAllocateContext> {
  await assertRole(['ceo', 'finance', 'developer']);
  const supabase = createClient();

  // 1. Transaction + allocations existantes
  const { data: tx } = await supabase
    .from('bank_transactions')
    .select(`
      id, operation_date, label, beneficiary, debit_mad, credit_mad,
      allocations:bank_transaction_allocations(amount_mad, deleted_at)
    `)
    .eq('id', transactionId)
    .single();

  if (!tx) throw new Error('Transaction introuvable');
  const txAny = tx as any;
  const debit = Number(txAny.debit_mad ?? 0);
  const credit = Number(txAny.credit_mad ?? 0);
  const amount = Math.abs(debit || credit);
  const allocated = (txAny.allocations ?? [])
    .filter((a: any) => a.deleted_at == null)
    .reduce((s: number, a: any) => s + Math.abs(Number(a.amount_mad)), 0);
  const remaining = Math.max(0, amount - allocated);

  // 2. Suggestion d'allocation
  let suggestion: AllocationSuggestion = {
    allocation_type: null,
    source: null,
    project_id: null,
  };
  const beneficiary = (txAny.beneficiary || '').trim();
  if (beneficiary && beneficiary.length >= 3) {
    // a) Mapping appris ?
    const { data: mappings } = await supabase
      .from('bank_category_mappings')
      .select('allocation_type')
      .eq('bank_label_match', beneficiary)
      .is('deleted_at', null)
      .limit(1);
    if (mappings && mappings.length > 0) {
      suggestion.allocation_type = (mappings[0] as any).allocation_type;
      suggestion.source = 'learned';
    }

    // b) Allocation récente sur même bénéficiaire ? On regarde via les autres tx
    //    avec le même beneficiary qui ont une allocation active.
    if (!suggestion.allocation_type || !suggestion.project_id) {
      const { data: similar } = await supabase
        .from('bank_transactions')
        .select(`
          id, beneficiary,
          allocations:bank_transaction_allocations(allocation_type, project_id, deleted_at)
        `)
        .ilike('beneficiary', beneficiary)
        .neq('id', transactionId)
        .order('operation_date', { ascending: false })
        .limit(5);
      for (const s of (similar ?? []) as any[]) {
        const allocActive = (s.allocations ?? []).find((a: any) => a.deleted_at == null);
        if (allocActive) {
          if (!suggestion.allocation_type) {
            suggestion.allocation_type = allocActive.allocation_type;
            suggestion.source = suggestion.source ?? 'beneficiary_match';
          }
          if (!suggestion.project_id && allocActive.project_id) {
            suggestion.project_id = allocActive.project_id;
          }
          if (suggestion.allocation_type && suggestion.project_id) break;
        }
      }
    }
  }

  // 3. Liste des projets actifs (pour combobox)
  const { data: projects } = await supabase
    .from('projects')
    .select('id, reference, status, client:clients(full_name)')
    .is('deleted_at', null)
    .neq('status', 'perdu')
    .order('reference', { ascending: false });

  return {
    transaction: {
      id: txAny.id,
      operation_date: txAny.operation_date,
      label: txAny.label,
      beneficiary: txAny.beneficiary,
      debit_mad: debit,
      credit_mad: credit,
      remaining,
      is_debit: debit > 0,
    },
    suggestion,
    projects: (projects ?? []).map((p: any) => ({
      id: p.id,
      reference: p.reference ?? '—',
      client: p.client?.full_name ?? '—',
      status: p.status ?? 'actif',
    })),
  };
}
