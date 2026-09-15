import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Helper d'audit finance — log centralisé des actions sur encaissements/
 * paiements (CEO 2026-06-16).
 *
 * Usage typique dans une server action :
 *
 *   import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';
 *
 *   // CREATE
 *   await logFinanceAudit({
 *     table: 'achats_encaissements',
 *     recordId: newRow.id,
 *     action: 'create',
 *     actorId: user.id,
 *     label: `Encaissement ${formatMad(amount)} créé`,
 *     payload: { amount, scheduled_date, status: 'planifie' },
 *   });
 *
 *   // UPDATE avec diff
 *   const diff = computeFinanceDiff(before, after, ['amount','scheduled_date','status']);
 *   if (Object.keys(diff).length > 0) {
 *     await logFinanceAudit({
 *       table: 'achats_encaissements',
 *       recordId: existing.id,
 *       action: diff.status ? 'status_change' : 'update',
 *       actorId: user.id,
 *       label: `Modifié (${Object.keys(diff).join(', ')})`,
 *       payload: diff,
 *     });
 *   }
 *
 * Best-effort : si l'insert audit échoue, on log en console mais on ne
 * propage PAS l'erreur — l'audit ne doit jamais bloquer une action métier.
 */

export type FinanceAuditTable =
  | 'achats_encaissements'
  | 'travaux_encaissements'
  | 'achats_payments'
  | 'travaux_payments'
  | 'payments'
  | 'achats_lots'
  | 'travaux_lots'
  | 'bank_transactions'
  | 'bank_transaction_allocations'
  | 'bank_balances'
  | 'bank_accounts'
  | 'bank_companies'
  | 'bank_category_mappings'
  | 'vendor_documents'
  | 'services_lots'
  | 'services_payments'
  | 'stoniz_wallet_expenses'
  // CEO 2026-06-30 : documents fiche projet (titre foncier, plans 3D, contrats…)
  // — pattern supprimer + ré-uploader + historique étendu depuis vendor_documents.
  | 'documents'
  // CEO 2026-08-19 (session B) : estimations achats cloisonnées — la contrainte
  // CHECK correspondante est étendue par la migration 20260819120000.
  | 'achats_estimations'
  // CEO 2026-08-24 : audit des modifications sur la fiche projet (dates chantier
  // édit inline, sous-phase). Étendu par la migration 20260824100000.
  | 'projects';

export type FinanceAuditAction =
  | 'create'
  | 'update'
  | 'status_change'
  | 'allocate'
  | 'unallocate'
  | 'delete'
  | 'validate'
  | 'attach_doc'
  | 'bulk_update'
  | 'category_change'
  | 'pending_merge'
  | 'mask'
  | 'unmask';

export type FinanceAuditEntry = {
  table: FinanceAuditTable;
  recordId: string;
  action: FinanceAuditAction;
  actorId: string | null;
  /** Résumé court humain (ex : "Encaissement 3 200 MAD créé") */
  label?: string;
  /** Diff structuré ou payload libre (montants, before/after, etc.) */
  payload?: Record<string, any>;
};

/**
 * Insère une ligne dans finance_audit_log. Ne throw jamais.
 */
export async function logFinanceAudit(entry: FinanceAuditEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('finance_audit_log').insert({
      table_name: entry.table,
      record_id: entry.recordId,
      action: entry.action,
      actor_id: entry.actorId,
      label: entry.label ?? null,
      payload: entry.payload ?? {},
    } as any);
  } catch (e: any) {
    console.warn('[finance-audit] insert failed', { entry, error: e?.message });
  }
}

/**
 * Variante bulk : insère plusieurs lignes en un seul round-trip BDD. Utilisé
 * pour l'import XLSX trésorerie où on peut avoir 200+ events à logger.
 * Chunke par 500 pour ne pas dépasser la taille de payload Supabase.
 * Best-effort comme logFinanceAudit : ne throw jamais.
 */
export async function logFinanceAuditBulk(entries: FinanceAuditEntry[]): Promise<void> {
  if (entries.length === 0) return;
  try {
    const admin = createAdminClient();
    const rows = entries.map((entry) => ({
      table_name: entry.table,
      record_id: entry.recordId,
      action: entry.action,
      actor_id: entry.actorId,
      label: entry.label ?? null,
      payload: entry.payload ?? {},
    }));
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      await admin.from('finance_audit_log').insert(chunk as any);
    }
  } catch (e: any) {
    console.warn('[finance-audit] bulk insert failed', { count: entries.length, error: e?.message });
  }
}

/**
 * Calcule un diff before/after sur une liste de champs explicites.
 * Retourne un objet { [field]: { before, after } } pour les champs qui
 * ont changé. Les champs identiques sont exclus.
 */
export function computeFinanceDiff(
  before: Record<string, any> | null | undefined,
  after: Record<string, any> | null | undefined,
  fields: string[],
): Record<string, { before: any; after: any }> {
  if (!before || !after) return {};
  const out: Record<string, { before: any; after: any }> = {};
  for (const f of fields) {
    const b = before[f];
    const a = after[f];
    // Comparaison stricte avec normalisation des null/undefined
    const bN = b ?? null;
    const aN = a ?? null;
    if (JSON.stringify(bN) !== JSON.stringify(aN)) {
      out[f] = { before: bN, after: aN };
    }
  }
  return out;
}

/**
 * Charge l'historique d'audit pour une ligne donnée, avec le nom de
 * l'auteur résolu via profiles. Utilisé par le composant FinanceAuditTimeline.
 */
export async function getFinanceAuditEntries(
  table: FinanceAuditTable,
  recordId: string,
): Promise<Array<{
  id: string;
  occurred_at: string;
  action: FinanceAuditAction;
  label: string | null;
  payload: any;
  actor_id: string | null;
  actor_name: string | null;
}>> {
  const admin = createAdminClient();
  const { data: logs } = await admin
    .from('finance_audit_log')
    .select('id, occurred_at, action, label, payload, actor_id')
    .eq('table_name', table)
    .eq('record_id', recordId)
    .order('occurred_at', { ascending: false });

  const rows = (logs ?? []) as any[];
  // Hydrate les noms d'auteurs
  const actorIds = Array.from(new Set(rows.map((r) => r.actor_id).filter(Boolean)));
  if (actorIds.length === 0) {
    return rows.map((r) => ({ ...r, actor_name: null }));
  }
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, full_name')
    .in('id', actorIds);
  const nameMap = new Map<string, string>(
    (profiles ?? []).map((p: any) => [p.id, p.full_name]),
  );
  return rows.map((r) => ({
    ...r,
    actor_name: r.actor_id ? nameMap.get(r.actor_id) ?? null : null,
  }));
}
