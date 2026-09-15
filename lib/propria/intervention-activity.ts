/**
 * Helpers pour journaliser l'activité sur les interventions/tâches Propria.
 *
 * Toutes les actions significatives (création, édition, changement de statut,
 * validation, assignation) sont consignées dans `propria_intervention_activity`
 * et affichées sur la fiche détail sous forme de timeline.
 *
 * Conventions :
 *   • Le log est BEST-EFFORT : si l'écriture échoue, on log un warning mais
 *     on ne casse PAS l'action principale (l'historique est précieux mais
 *     pas plus que la cohérence métier).
 *   • Le payload jsonb varie selon le type d'action — voir la migration BDD.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type ActivityAction =
  | 'created'
  | 'edited'
  | 'status_changed'
  | 'assigned'
  | 'unassigned'
  | 'submitted'
  | 'validated'
  | 'refused'
  | 'cancelled'
  | 'reopened';

/**
 * Insère une ligne dans propria_intervention_activity. N'éveille pas
 * d'exception — log un warning et continue.
 */
export async function logInterventionActivity(opts: {
  supabase: SupabaseClient;
  interventionId: string;
  actorId: string | null;
  action: ActivityAction;
  payload?: any;
}) {
  try {
    const { error } = await opts.supabase
      .from('propria_intervention_activity')
      .insert({
        intervention_id: opts.interventionId,
        actor_id: opts.actorId,
        action: opts.action,
        payload: opts.payload ?? null,
      } as any);
    if (error) {
      console.warn('[intervention-activity] insert error', error.message);
    }
  } catch (e: any) {
    console.warn('[intervention-activity] exception', e?.message ?? e);
  }
}

/**
 * Champs trackés dans les éditions. Tout changement sur l'un de ces
 * champs apparaît dans le payload d'un événement `edited`. Les autres
 * champs (created_at, updated_at, deleted_at, etc.) ne sont jamais logués.
 */
export const TRACKED_EDIT_FIELDS = [
  'kind',
  'description',
  'urgency',
  'due_date',
  'occurred_at',
  'property_id',
  'propria_unit_id',
  'intervention_type_id',
  'type_label',
  'assigned_to_id',
  'responsable_id',
  'provider_id',
  'cost_propria_mad',
  'client_billing_mad',
  'charge_to',
  'paid_from_wallet_id',
  'hostaway_ref',
  'hostaway_integrated',
  'observations',
] as const;

type TrackedField = (typeof TRACKED_EDIT_FIELDS)[number];

/**
 * Calcule le diff entre l'ancien et le nouveau state pour les champs
 * trackés. Normalise null / undefined / '' en null pour comparaison
 * stable. Renvoie un objet `{ champ: { before, after } }` ne contenant
 * que les champs réellement modifiés.
 */
export function diffInterventionFields(
  before: Record<string, any>,
  after: Record<string, any>,
): Record<string, { before: any; after: any }> {
  const diff: Record<string, { before: any; after: any }> = {};
  for (const f of TRACKED_EDIT_FIELDS) {
    const bRaw = before?.[f as TrackedField];
    const aRaw = after?.[f as TrackedField];
    const b = bRaw == null || bRaw === '' ? null : bRaw;
    const a = aRaw == null || aRaw === '' ? null : aRaw;
    // Comparaison "loose" pour gérer les numéros vs strings (cost_propria_mad)
    // et les booléens (hostaway_integrated). Si l'un est un nombre on
    // compare les nombres, sinon les strings.
    const same =
      (typeof b === 'number' || typeof a === 'number')
        ? Number(b ?? 0) === Number(a ?? 0)
        : String(b ?? '') === String(a ?? '');
    if (!same) diff[f] = { before: b, after: a };
  }
  return diff;
}
