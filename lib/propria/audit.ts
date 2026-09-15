import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Audit log centralisé Propria.
 *
 * Tracé chaque mutation par membre de l'équipe pour pouvoir répondre à
 * "qui a fait quoi quand" sur les fiches détail.
 *
 * Volontairement silencieux : si l'INSERT du log échoue, l'action principale
 * n'est PAS bloquée (l'audit est important mais ne doit jamais empêcher le
 * métier).
 *
 * @param table  Nom de la table cible (ex: 'properties', 'propria_units')
 * @param recordId UUID de la ligne concernée
 * @param actorId UUID du profile auteur (typiquement user.id)
 * @param action  'create' | 'update' | 'delete' | 'restore' | 'validate'
 *                | 'status_change' | 'assign' | 'custom'
 * @param label   Libellé court humain (optionnel) — ex: "Ajout d'un lot"
 * @param payload Détail JSON de l'action (diff avant/après, valeur changée…)
 */
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'validate'
  | 'status_change'
  | 'assign'
  | 'custom';

export interface LogPropriaAuditInput {
  supabase: SupabaseClient<any, 'public', any>;
  table: string;
  recordId: string;
  actorId: string | null | undefined;
  action: AuditAction;
  label?: string | null;
  payload?: Record<string, unknown> | null;
}

export async function logPropriaAudit(input: LogPropriaAuditInput): Promise<void> {
  const { supabase, table, recordId, actorId, action, label, payload } = input;
  try {
    await supabase.from('propria_audit_log').insert({
      table_name: table,
      record_id: recordId,
      actor_id: actorId ?? null,
      action,
      label: label ?? null,
      payload: payload ?? null,
    } as any);
  } catch {
    // Audit silencieux — on ne bloque jamais l'action métier.
  }
}

/**
 * Helper pour calculer un diff payload entre avant/après.
 * Garde uniquement les champs modifiés (avec valeurs after).
 */
export function computeAuditDiff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown>,
  ignoreKeys: string[] = ['updated_at', 'created_at'],
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (ignoreKeys.includes(k)) continue;
    const a = before?.[k];
    const b = after[k];
    // Normalise undefined/null pour éviter les faux positifs
    const aN = a === undefined ? null : a;
    const bN = b === undefined ? null : b;
    if (JSON.stringify(aN) !== JSON.stringify(bN)) {
      diff[k] = { from: aN, to: bN };
    }
  }
  return diff;
}
