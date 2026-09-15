import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFinanceAudit, type FinanceAuditTable } from '@/lib/finance/audit';
import { logDeletion } from '@/lib/audit/deletion';

/**
 * Cascade automatique : quand un encaissement / paiement est soft-deleted
 * côté projet, on retire aussi les allocations bancaires qui le référencent
 * (CEO 2026-06-16).
 *
 * Sinon les transactions bancaires apparaîtraient comme "rapprochées" alors
 * que leur cible n'existe plus → la trésorerie afficherait des allocations
 * orphelines impossibles à corriger autrement qu'à la main.
 *
 * Stratégie :
 *   1. SELECT les allocations actives sur la cible
 *   2. Pour chaque allocation : snapshot, soft-delete, log corbeille,
 *      log finance audit 'unallocate' sur la cible (déjà supprimée par
 *      l'appelant — c'est un double event utile pour comprendre l'historique).
 *
 * Best-effort : ne throw jamais. Un échec ici ne doit pas bloquer la
 * suppression principale (qui a déjà été commitée par l'appelant).
 */

/**
 * Mapping des tables financières vers la colonne FK correspondante dans
 * `bank_transaction_allocations`.
 */
const FK_COLUMN: Record<string, string> = {
  travaux_payments:        'travaux_payment_id',
  travaux_encaissements:   'travaux_encaissement_id',
  achats_payments:         'achats_payment_id',
  achats_encaissements:    'achats_encaissement_id',
  services_payments:       'services_payment_id',
  payments:                'payment_id',
};

export type CascadeKind = keyof typeof FK_COLUMN extends string
  ? 'travaux_payments' | 'travaux_encaissements'
    | 'achats_payments' | 'achats_encaissements'
    | 'services_payments' | 'payments'
  : never;

export async function cascadeDeallocateOnDelete(params: {
  /** Table financière de la cible supprimée */
  table: CascadeKind;
  /** ID du record supprimé */
  recordId: string;
  /** Auteur de la suppression (pour les logs) */
  actorId: string | null;
}): Promise<void> {
  const fkCol = FK_COLUMN[params.table];
  if (!fkCol) return;

  try {
    const admin = createAdminClient();

    // 1. Récupère les allocations actives liées à ce record
    const { data: allocs } = await admin
      .from('bank_transaction_allocations')
      .select('*')
      .eq(fkCol, params.recordId)
      .is('deleted_at', null);

    const rows = (allocs ?? []) as any[];
    if (rows.length === 0) return;

    const now = new Date().toISOString();
    const allocIds = rows.map((r) => r.id);

    // 2. Soft-delete en bloc
    await admin
      .from('bank_transaction_allocations')
      .update({ deleted_at: now } as any)
      .in('id', allocIds);

    // 3. Log corbeille + finance audit pour chaque allocation
    for (const a of rows) {
      const amount = Number(a.amount_mad ?? 0);
      await logDeletion({
        table: 'bank_transaction_allocations',
        recordId: a.id,
        actorId: params.actorId,
        label: `Allocation banque ${amount.toFixed(0)} MAD (cascade suppression ${params.table})`,
        snapshot: a,
      });
      // Trace côté cible : on a déjà loggué le delete par ailleurs, on
      // ajoute juste un événement "unallocate" pour le timeline finance.
      // (Le record est déjà soft-deleted mais le log conserve la trace.)
      if (params.table !== 'services_payments') {
        // services_payments n'est pas dans FinanceAuditTable (out of scope)
        await logFinanceAudit({
          table: params.table as FinanceAuditTable,
          recordId: params.recordId,
          action: 'unallocate',
          actorId: params.actorId,
          label: `Allocation banque retirée (cascade suppression de la ligne)`,
          payload: {
            transaction_id: a.transaction_id,
            allocation_id: a.id,
            amount_mad: amount,
            reason: 'cascade_on_delete',
          },
        });
      }
    }
  } catch (e: any) {
    // Best-effort — ne throw jamais.
    console.warn('[cascade-deallocate] failed', {
      table: params.table,
      recordId: params.recordId,
      error: e?.message,
    });
  }
}
