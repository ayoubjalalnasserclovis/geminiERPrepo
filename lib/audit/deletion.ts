import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Helper centralisé pour tracer les suppressions (soft-delete) du système
 * dans la table `deletion_log` (CEO 2026-06-16).
 *
 * Cas d'usage : la corbeille admin `/dashboard/suppressions` lit cette table
 * pour afficher qui a supprimé quoi et permettre au CEO de restaurer.
 *
 * Pattern d'utilisation dans une server action :
 *
 *   const supabase = createClient();
 *   // 1. Récupère le snapshot AVANT soft-delete
 *   const { data: row } = await supabase
 *     .from('travaux_lots')
 *     .select('*')
 *     .eq('id', lotId)
 *     .single();
 *   // 2. Soft-delete
 *   await supabase.from('travaux_lots').update({ deleted_at: new Date().toISOString() }).eq('id', lotId);
 *   // 3. Log
 *   await logDeletion({
 *     table: 'travaux_lots',
 *     recordId: lotId,
 *     actorId: user.id,
 *     label: `Lot travaux ${row.artisan_name} - ${row.devis_artisan_mad} MAD`,
 *     snapshot: row,
 *   });
 *
 * Best-effort : si l'insert log échoue, on garde un warn console mais on ne
 * propage PAS l'erreur — un log raté ne doit jamais bloquer une suppression.
 */

/** Tables actuellement supportées par la restauration automatique. */
export type RestorableTable =
  | 'travaux_lots'
  | 'achats_lots'
  | 'services_lots'
  | 'travaux_payments'
  | 'achats_payments'
  | 'services_payments'
  | 'payments'
  | 'travaux_encaissements'
  | 'achats_encaissements'
  | 'projects'
  | 'properties'
  | 'partners'
  | 'artisans'
  | 'propria_interventions'
  | 'propria_cleanings'
  | 'propria_litiges';

export type DeletionLogEntry = {
  table: string;
  recordId: string;
  /** UUID profile de l'auteur (null si action système / cron) */
  actorId: string | null;
  /** Libellé humain « prêt à afficher » dans la corbeille */
  label?: string;
  /** Snapshot complet de la ligne avant suppression (sert à la restauration) */
  snapshot?: Record<string, any> | null;
};

/**
 * Insère une ligne dans deletion_log. Ne throw jamais — best-effort.
 */
export async function logDeletion(entry: DeletionLogEntry): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin.from('deletion_log').insert({
      table_name: entry.table,
      record_id: entry.recordId,
      record_label: entry.label ?? null,
      snapshot: entry.snapshot ?? {},
      deleted_by: entry.actorId,
    } as any);
  } catch (e: any) {
    console.warn('[deletion-log] insert failed', { entry, error: e?.message });
  }
}

/**
 * Restaure un record précédemment soft-deleted : met deleted_at à null sur la
 * table cible et marque le log comme restauré.
 *
 * Sécurité : l'appelant doit faire son propre `assertRole(['ceo'])` AVANT.
 */
export async function restoreDeletion(params: {
  logId: string;
  actorId: string;
  note?: string;
}): Promise<{ ok: true; table: string; recordId: string } | { ok: false; error: string }> {
  const admin = createAdminClient();

  // 1. Charge la ligne du log
  const { data: log, error: readErr } = await admin
    .from('deletion_log')
    .select('id, table_name, record_id, restored_at')
    .eq('id', params.logId)
    .single();
  if (readErr || !log) return { ok: false, error: 'Log introuvable' };
  if ((log as any).restored_at) return { ok: false, error: 'Déjà restauré' };

  const tableName = (log as any).table_name as string;
  const recordId = (log as any).record_id as string;

  // 2. Restaure la ligne cible (deleted_at = null)
  const { error: restoreErr } = await admin
    .from(tableName)
    .update({ deleted_at: null } as any)
    .eq('id', recordId);
  if (restoreErr) {
    return { ok: false, error: `Restauration BDD : ${restoreErr.message}` };
  }

  // 3. Marque le log comme restauré
  await admin
    .from('deletion_log')
    .update({
      restored_at: new Date().toISOString(),
      restored_by: params.actorId,
      restore_note: params.note ?? null,
    } as any)
    .eq('id', params.logId);

  return { ok: true, table: tableName, recordId };
}
