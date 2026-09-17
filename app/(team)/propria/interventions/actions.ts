'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole, type Role, type SessionUser } from '@/lib/auth/require';
import { optionalUuid, optionalEmail } from '@/lib/validators/zod-helpers';
import { parseScope } from '@/lib/propria/intervention-scope';
import { logInterventionActivity, diffInterventionFields, TRACKED_EDIT_FIELDS } from '@/lib/propria/intervention-activity';
import { notifyUsers } from '@/lib/propria/notify';
import { logPropriaAudit } from '@/lib/propria/audit';
import { logDeletion } from '@/lib/audit/deletion';

// ─── Helpers défensifs (pattern "session expirée" 2026-06-23) ──────────────
// Toute Server Action publique enveloppe sa logique dans try/catch et renvoie
// { ok: true, ... } | { ok: false, error: string } pour que le client puisse
// afficher un message sans crash. Les NEXT_REDIRECT (redirect()) sont
// re-throw pour préserver le mécanisme natif Next.js.
function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e && typeof (e as any).digest === 'string' && (e as any).digest.startsWith('NEXT_REDIRECT');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

// Rôles : back office (peut tout faire, valider/refuser) vs terrain (propria).
const BACK_OFFICE: Role[] = ['ceo', 'assistante'];
const FIELD_OR_OFFICE: Role[] = ['ceo', 'assistante', 'propria'];

const schema = z.object({
  // Portée : "unit:<uuid>" (une suite) ou "property:<uuid>" (le bien entier).
  scope: z.preprocess(
    (v) => (v == null ? '' : v),
    z.string().min(1, 'Sélectionnez un lot ou le bien entier'),
  ),
  // Type : intervention (action technique) vs tâche (action non-technique)
  // — défaut intervention pour préserver la rétrocompatibilité.
  kind: z.enum(['intervention','tache']).default('intervention'),
  intervention_type_id: optionalUuid,
  type_label: z.string().optional().nullable(),
  description: z.string().min(2),
  occurred_at: z.string(),
  due_date: z.string().optional().nullable(),
  urgency: z.enum(['critique','haute','normale','basse']),
  responsable_id: optionalUuid,
  assigned_to_id: optionalUuid,
  provider_id: optionalUuid,
  cost_propria_mad: z.coerce.number().optional().nullable(),
  client_billing_mad: z.coerce.number().optional().nullable(),
  charge_to: z.enum(['client','propria','copropriete','a_definir']).optional(),
  hostaway_ref: z.string().optional().nullable(),
  hostaway_integrated: z.boolean().default(false),
  observations: z.string().optional().nullable(),
  paid_from_wallet_id: optionalUuid,
});

// ─── Helper : synchronise la wallet_expense liée à une intervention ───────
//
// Règles métier validées par le CEO 2026-06-04 :
//   • cost > 0 + paid_from_wallet_id renseigné → crée / met à jour l'expense
//   • cost = 0 ou paid_from_wallet_id NULL → SOFT-DELETE de l'expense liée
//   • Si l'expense existante est déjà is_validated=true → on REFUSE la modif
//     (le CEO doit "dévalider" d'abord)
//   • Solde insuffisant : warning UI uniquement, pas de blocage côté serveur
//
// Canon soft-delete (CLAUDE.md §3) : jamais de hard-delete sur de l'argent.
// On pose deleted_at = now() + journalisation (propria_audit_log + corbeille
// deletion_log, snapshot complet pour rollback).
//
// ⚠ Contrainte BDD à connaître : l'index UNIQUE partiel
// `uniq_propria_expense_per_intervention` porte sur (linked_intervention_id)
// WHERE linked_intervention_id IS NOT NULL — il n'exclut PAS les lignes
// soft-deletées. Un simple INSERT après suppression logique violerait donc la
// contrainte. On « réanime » (deleted_at = null) la ligne supprimée au lieu
// d'en insérer une nouvelle. Pas de cascade bancaire : la caisse Propria est
// du cash MAD, elle n'est jamais référencée par bank_transaction_allocations.
async function syncWalletExpenseForIntervention(args: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  interventionId: string;
  cost: number | null;
  paidFromWalletId: string | null;
  propertyId: string | null;
  propriaUnitId: string | null;
  description: string;
  chargeTo: string | null;
  occurredAt: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, userId, interventionId, cost, paidFromWalletId } = args;
  const validCost = cost != null && Number(cost) > 0;
  const shouldHaveExpense = validCost && !!paidFromWalletId;

  // Cherche l'expense liée VIVANTE (deleted_at IS NULL) — snapshot complet,
  // il sert au log de suppression.
  const { data: existing } = await supabase
    .from('propria_wallet_expenses')
    .select('*')
    .eq('linked_intervention_id', interventionId)
    .is('deleted_at', null)
    .maybeSingle();

  // Lock : si l'expense est déjà validée, on refuse toute modification
  if (existing && (existing as any).is_validated) {
    const wantChange =
      !shouldHaveExpense
      || (existing as any).wallet_id !== paidFromWalletId
      || Number((existing as any).amount_mad) !== Number(cost);
    if (wantChange) {
      return {
        ok: false,
        error: 'Cette intervention a déjà une dépense caisse validée. Dévalide d\'abord la dépense pour la modifier.',
      };
    }
    return { ok: true };
  }

  if (!shouldHaveExpense) {
    if (existing) {
      const expenseId = (existing as any).id;
      const { error } = await supabase
        .from('propria_wallet_expenses')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', expenseId)
        .is('deleted_at', null);
      if (error) return { ok: false, error: `Suppression expense : ${error.message}` };

      await logPropriaAudit({
        supabase,
        table: 'propria_wallet_expenses',
        recordId: expenseId,
        actorId: userId,
        action: 'delete',
        label: `Dépense caisse retirée (intervention sans coût ou sans caisse)`,
        payload: {
          amount_mad: (existing as any).amount_mad,
          wallet_id: (existing as any).wallet_id,
          linked_intervention_id: interventionId,
        },
      });
      await logDeletion({
        table: 'propria_wallet_expenses',
        recordId: expenseId,
        actorId: userId,
        label: `Dépense caisse Propria - ${(existing as any).description ?? 'intervention'} - ${(existing as any).amount_mad} MAD`,
        snapshot: existing,
      });
    }
    return { ok: true };
  }

  const payload: any = {
    wallet_id: paidFromWalletId,
    spent_at: args.occurredAt,
    property_id: args.propertyId,
    propria_unit_id: args.propriaUnitId,
    category: 'intervention',
    description: args.description?.slice(0, 200) ?? 'Intervention Propria',
    amount_mad: Number(cost),
    charge_to: args.chargeTo,
    linked_intervention_id: interventionId,
  };

  if (existing) {
    const { error } = await supabase
      .from('propria_wallet_expenses')
      .update(payload)
      .eq('id', (existing as any).id);
    if (error) return { ok: false, error: `Mise à jour expense : ${error.message}` };
  } else {
    // Aucune expense vivante. Une expense SOFT-DELETÉE peut cependant encore
    // occuper la contrainte UNIQUE sur linked_intervention_id : dans ce cas on
    // la réanime au lieu d'insérer (sinon : violation de contrainte).
    const { data: buried } = await supabase
      .from('propria_wallet_expenses')
      .select('id')
      .eq('linked_intervention_id', interventionId)
      .not('deleted_at', 'is', null)
      .maybeSingle();

    if (buried) {
      const { error } = await supabase
        .from('propria_wallet_expenses')
        .update({ ...payload, deleted_at: null, is_validated: false, validated_at: null, validated_by: null } as any)
        .eq('id', (buried as any).id);
      if (error) return { ok: false, error: `Réactivation expense : ${error.message}` };
      await logPropriaAudit({
        supabase,
        table: 'propria_wallet_expenses',
        recordId: (buried as any).id,
        actorId: userId,
        action: 'restore',
        label: `Dépense caisse réactivée (coût ré-saisi sur l'intervention)`,
        payload: { amount_mad: Number(cost), wallet_id: paidFromWalletId, linked_intervention_id: interventionId },
      });
    } else {
      // Note : la table propria_wallet_expenses n'a pas de colonne created_by ;
      // on ne l'inclut donc pas dans le payload (auteur traçable via linked_intervention.created_by).
      const { error } = await supabase
        .from('propria_wallet_expenses')
        .insert(payload as any);
      if (error) return { ok: false, error: `Création expense : ${error.message}` };
    }
  }
  return { ok: true };
}

/**
 * Décision CEO 2026-06-08 : l'équipe terrain (propria) s'organise librement.
 * N'importe quel propria peut piloter n'importe quelle tâche propria
 * (démarrer, soumettre, déposer preuve…). Seuls validation/refus restent
 * réservés au back-office (vérifié dans chaque action individuelle).
 *
 * Donc ici plus de check assigned_to_id / created_by : on charge simplement
 * l'intervention pour son statut. Le filtrage par rôle se fait via assertRole.
 */
async function loadInterventionForActor(_user: SessionUser, id: string) {
  const supabase = createClient();
  const { data: intervention, error } = await supabase
    .from('propria_interventions')
    .select('id, status, assigned_to_id, created_by, submitted_at, started_at')
    .eq('id', id)
    .single();
  if (error || !intervention) throw new Error('Intervention introuvable');
  return { supabase, intervention };
}

function revalidateIntervention(id: string) {
  revalidatePath(`/propria/interventions/${id}`);
  revalidatePath('/propria/interventions');
  revalidatePath('/propria/mes-taches');
}

function clean(raw: Record<string, FormDataEntryValue>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'hostaway_integrated') {
      out[k] = v === 'oui';
    } else {
      out[k] = v === '' ? null : v;
    }
  }
  return out;
}

/**
 * Persiste une erreur dans app_error_logs pour pouvoir la lire en BDD quand
 * les logs Vercel ne sont plus disponibles. Best-effort : si l'insert échoue,
 * on ne casse pas le flux d'erreur principal.
 */
async function logAppError(
  supabase: ReturnType<typeof createClient>,
  source: string,
  userId: string | null,
  message: string,
  details?: any,
  payload?: any,
) {
  try {
    await supabase.from('app_error_logs').insert({
      source,
      user_id: userId,
      message: message?.slice(0, 1000) ?? null,
      details: details ?? null,
      payload: payload ?? null,
    } as any);
  } catch {
    // ignore — never let the logger break the actual error path
  }
}

export async function createInterventionAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(['ceo','assistante','propria']);
    const supabase = createClient();

    // Étape 1 : parse + validation des champs envoyés par le form
    let parsed;
    try {
      parsed = schema.parse(clean(Object.fromEntries(formData)));
    } catch (e: any) {
      console.error('[createInterventionAction] zod parse error', e?.errors ?? e?.message);
      await logAppError(supabase, 'createInterventionAction:zod', user.id,
        e?.errors?.[0]?.message ?? e?.message ?? 'zod error',
        { errors: e?.errors },
        Object.fromEntries(formData),
      );
      throw new Error(
        `Données du formulaire invalides : ${e?.errors?.[0]?.message ?? e?.message ?? 'erreur de validation'}`,
      );
    }
    const { scope, ...rest } = parsed;
    const scopeCols = parseScope(scope);

    const insertPayload: any = { ...rest, ...scopeCols, created_by: user.id, status: 'a_traiter' };

    const { data: row, error } = await supabase
      .from('propria_interventions')
      .insert(insertPayload)
      .select('id, property_id, propria_unit_id, occurred_at, description, cost_propria_mad, paid_from_wallet_id, charge_to')
      .single();
    if (error) {
      console.error('[createInterventionAction] insert error', {
        message: error.message,
        details: (error as any).details,
        hint: (error as any).hint,
        code: (error as any).code,
        payload: insertPayload,
      });
      await logAppError(supabase, 'createInterventionAction:insert', user.id,
        error.message,
        { code: (error as any).code, hint: (error as any).hint, details: (error as any).details },
        insertPayload,
      );
      throw new Error(`Insertion intervention : ${error.message}`);
    }

    // Cascade vers wallet_expense si cost > 0 et caisse renseignée
    const sync = await syncWalletExpenseForIntervention({
      supabase,
      userId: user.id,
      interventionId: row.id,
      cost: rest.cost_propria_mad ?? null,
      paidFromWalletId: rest.paid_from_wallet_id ?? null,
      propertyId: (row as any).property_id,
      propriaUnitId: (row as any).propria_unit_id,
      description: (row as any).description ?? rest.description ?? '',
      chargeTo: rest.charge_to ?? null,
      occurredAt: rest.occurred_at,
    });
    if (!sync.ok) {
      // Si la cascade échoue à la création, on rollback l'intervention pour ne pas
      // se retrouver avec une intervention orpheline.
      console.error('[createInterventionAction] sync wallet error', sync.error);
      await supabase.from('propria_interventions').delete().eq('id', row.id);
      throw new Error(`Liaison caisse : ${sync.error}`);
    }

    // Trace l'événement de création dans la timeline
    await logInterventionActivity({
      supabase,
      interventionId: row.id,
      actorId: user.id,
      action: 'created',
      payload: { kind: rest.kind ?? 'intervention', urgency: rest.urgency },
    });

    // Notification in-app si quelqu'un est assigné dès la création (best effort,
    // auto-exclusion gérée dans notifyUsers — pas de mail pour les assignations).
    if (rest.assigned_to_id) {
      await notifyUsers({
        supabase,
        actorId: user.id,
        userIds: [rest.assigned_to_id],
        kind: 'assignation',
        title: `On t'a assigné une ${rest.kind === 'tache' ? 'tâche' : 'intervention'}`,
        body: rest.description?.slice(0, 80) ?? null,
        href: `/propria/interventions/${row.id}`,
      });
    }

    revalidatePath('/propria/interventions');
    revalidatePath('/propria/caisse');
    redirect(`/propria/interventions/${row.id}`);
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateInterventionAction(
  id: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(['ceo','assistante','propria']);
    const { scope, ...rest } = schema.parse(clean(Object.fromEntries(formData)));
    const scopeCols = parseScope(scope);
    const supabase = createClient();

    // Charge l'état complet AVANT l'update — sert à la cascade caisse ET au
    // calcul du diff qui sera consigné dans l'historique d'activité.
    const beforeSelect = ['id', ...TRACKED_EDIT_FIELDS].join(', ');
    const { data: current } = await supabase
      .from('propria_interventions')
      .select(beforeSelect)
      .eq('id', id)
      .single();
    if (!current) throw new Error('Intervention introuvable');

    const { error } = await supabase
      .from('propria_interventions')
      .update({ ...rest, ...scopeCols } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    // Calcul du diff sur les champs trackés. On loggue seulement si quelque
    // chose a réellement changé (évite de polluer la timeline avec des
    // « saves » qui ne modifient rien).
    const after = { ...(current as any), ...rest, ...scopeCols };
    const diff = diffInterventionFields(current as any, after as any);
    if (Object.keys(diff).length > 0) {
      await logInterventionActivity({
        supabase,
        interventionId: id,
        actorId: user.id,
        action: 'edited',
        payload: { diff },
      });
    }

    // Notification in-app si l'assigné a CHANGÉ vers quelqu'un (best effort).
    // On s'appuie sur le diff calculé ci-dessus pour ne notifier que les
    // vraies ré-assignations (pas les saves sans changement).
    const assignedDiff = diff['assigned_to_id'];
    if (assignedDiff && assignedDiff.after) {
      await notifyUsers({
        supabase,
        actorId: user.id,
        userIds: [String(assignedDiff.after)],
        kind: 'assignation',
        title: `On t'a assigné une ${rest.kind === 'tache' ? 'tâche' : 'intervention'}`,
        body: rest.description?.slice(0, 80) ?? null,
        href: `/propria/interventions/${id}`,
      });
    }

    // Cascade vers wallet_expense après l'update
    const sync = await syncWalletExpenseForIntervention({
      supabase,
      userId: user.id,
      interventionId: id,
      cost: rest.cost_propria_mad ?? null,
      paidFromWalletId: rest.paid_from_wallet_id ?? null,
      propertyId: (scopeCols as any).property_id ?? null,
      propriaUnitId: (scopeCols as any).propria_unit_id ?? null,
      description: rest.description,
      chargeTo: rest.charge_to ?? null,
      occurredAt: rest.occurred_at,
    });
    if (!sync.ok) {
      // L'update intervention est déjà passé — on remonte l'erreur mais on ne rollback pas
      // (le user verra l'erreur dans l'UI et pourra ajuster)
      throw new Error(`Liaison caisse : ${sync.error}`);
    }

    revalidatePath(`/propria/interventions/${id}`);
    revalidatePath('/propria/interventions');
    revalidatePath('/propria/caisse');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

const statusSchema = z.enum(['a_traiter','en_cours','a_valider','cloture','refusee','annule']);

export async function setInterventionStatusAction(
  id: string,
  status: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // CEO 2026-06-10 : ouvert au rôle propria (gestion de leurs interventions).
    const user = await assertRole(['ceo','assistante','propria']);
    const s = statusSchema.parse(status);
    const supabase = createClient();
    // Récupère l'ancien statut pour pouvoir le tracer dans l'historique
    const { data: before } = await supabase
      .from('propria_interventions')
      .select('status')
      .eq('id', id)
      .single();
    const { error } = await supabase
      .from('propria_interventions')
      .update({
        status: s,
        closed_at: (s === 'cloture' || s === 'annule') ? new Date().toISOString() : null,
      } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'status_changed',
      payload: { from: (before as any)?.status ?? null, to: s },
    });

    revalidatePath(`/propria/interventions/${id}`);
    revalidatePath('/propria/interventions');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── WORKFLOW TÂCHE TERRAIN : démarrer / soumettre / valider / refuser ──────

/** a_traiter|refusee → en_cours. Terrain (assigné) ou back office.
 *  Remplit started_at au 1er démarrage (cohérence module ménage 2026-06-09). */
export async function startInterventionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let user: SessionUser | null = null;
  try {
    user = await assertRole(FIELD_OR_OFFICE);
    const { supabase, intervention } = await loadInterventionForActor(user, id);
    const currentStatus = (intervention as any)?.status;
    if (currentStatus === 'cloture' || currentStatus === 'annule') {
      throw new Error('Cette intervention est clôturée ou annulée. Utilisez la réouverture back-office si nécessaire.');
    }

    const update: any = { status: 'en_cours' };
    if (!(intervention as any)?.started_at) {
      update.started_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from('propria_interventions')
      .update(update)
      .eq('id', id);
    if (error) {
      await logAppError(supabase, 'startInterventionAction:update', user.id,
        error.message,
        { code: (error as any).code, hint: (error as any).hint, details: (error as any).details },
        { intervention_id: id, role: user.role },
      );
      throw new Error(`Démarrage : ${error.message}`);
    }

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'status_changed',
      payload: { from: (intervention as any)?.status ?? null, to: 'en_cours' },
    });

    revalidateIntervention(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    // Persist toute exception non liée à l'update (loadInterventionForActor, etc.)
    try {
      const sb = createClient();
      await logAppError(sb, 'startInterventionAction:throw', user?.id ?? null,
        errorMessage(e),
        { stack: (e as any)?.stack ? String((e as any).stack).slice(0, 4000) : null },
        { intervention_id: id, role: user?.role ?? null },
      );
    } catch { /* ignore */ }
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * → a_valider. Le terrain (ou le back office) déclare la tâche réalisée.
 * Bloqué tant qu'aucune preuve photo/vidéo n'a été déposée.
 */
export async function submitForValidationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const { supabase, intervention } = await loadInterventionForActor(user, id);
    const currentStatus = (intervention as any)?.status;
    if (currentStatus === 'cloture' || currentStatus === 'annule') {
      throw new Error('Cette intervention est clôturée ou annulée et ne peut pas être soumise pour validation.');
    }

    const { count } = await supabase
      .from('propria_intervention_proofs')
      .select('id', { count: 'exact', head: true })
      .eq('intervention_id', id)
      .is('deleted_at', null);
    if (!count || count < 1) {
      throw new Error('Déposez au moins une preuve (photo ou vidéo) avant de soumettre pour validation.');
    }

    const { error } = await supabase
      .from('propria_interventions')
      .update({ status: 'a_valider', submitted_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'submitted',
      payload: null,
    });

    revalidateIntervention(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** a_valider → cloture. Back office / CEO uniquement (pas l'exécutant). */
export async function validateInterventionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_interventions')
      .update({
        status: 'cloture',
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        refusal_reason: null,
      } as any)
      .eq('id', id)
      .eq('status', 'a_valider');
    if (error) throw new Error(error.message);

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'validated',
      payload: null,
    });

    revalidateIntervention(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * a_valider → a_traiter (à refaire), avec motif. Back office / CEO uniquement.
 * Incrémente refused_count (proxy qualité terrain) et trace le motif.
 */
export async function refuseInterventionAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const cleanReason = (reason ?? '').trim();
    if (cleanReason.length < 3) throw new Error('Indiquez un motif de refus (≥ 3 caractères).');

    const supabase = createClient();
    // Lecture du compteur courant pour l'incrément (pas de calcul dérivé stocké
    // en dur : c'est un compteur d'événements, pas une valeur financière).
    const { data: cur } = await supabase
      .from('propria_interventions')
      .select('refused_count')
      .eq('id', id)
      .single();

    const { error } = await supabase
      .from('propria_interventions')
      .update({
        status: 'refusee',
        refusal_reason: cleanReason,
        refused_at: new Date().toISOString(),
        refused_count: (cur?.refused_count ?? 0) + 1,
        submitted_at: null,
        validated_by: null,
        validated_at: null,
      } as any)
      .eq('id', id)
      .eq('status', 'a_valider');
    if (error) throw new Error(error.message);

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'refused',
      payload: { reason: cleanReason },
    });

    revalidateIntervention(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Annuler une tâche (back office). */
export async function cancelInterventionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_interventions')
      .update({ status: 'annule', closed_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'cancelled',
      payload: null,
    });

    revalidateIntervention(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Réouvrir une tâche clôturée (back office) → en_cours, efface la validation. */
export async function reopenInterventionAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_interventions')
      .update({
        status: 'en_cours',
        validated_by: null,
        validated_at: null,
        closed_at: null,
      } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    await logInterventionActivity({
      supabase,
      interventionId: id,
      actorId: user.id,
      action: 'reopened',
      payload: null,
    });

    revalidateIntervention(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── PREUVES PHOTO / VIDÉO (upload direct navigateur → stockage) ────────────

const PROOF_MIME = [
  'image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif',
  'video/mp4', 'video/quicktime', 'video/webm',
];
const PROOF_MAX_SIZE = 209715200; // 200 Mo

function proofExt(fileName: string): string {
  const raw = (fileName.split('.').pop() || 'bin').toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(raw) ? raw : 'bin';
}

/**
 * Étape 1 : autorise l'acteur, vérifie le type/poids, renvoie une URL signée
 * à usage unique. Le navigateur enverra ensuite les octets directement au
 * stockage (contourne le plafond ~4,5 Mo des Server Actions Vercel → vidéo OK).
 */
export async function createInterventionProofUploadUrl(args: {
  interventionId: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}): Promise<{ ok: true; path: string; token: string } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const { interventionId, fileName, fileType, fileSize } = args;
    if (!interventionId) return { ok: false, error: 'Tâche manquante' };
    if (!fileSize) return { ok: false, error: 'Fichier vide' };
    if (fileSize > PROOF_MAX_SIZE) {
      const mb = (fileSize / (1024 * 1024)).toFixed(0);
      return { ok: false, error: `Fichier trop volumineux : ${mb} Mo (max 200 Mo)` };
    }
    if (!PROOF_MIME.includes(fileType)) {
      return { ok: false, error: `Type non supporté : ${fileType || 'inconnu'}` };
    }
    await loadInterventionForActor(user, interventionId);

    // L'autorisation métier a été vérifiée juste au-dessus. On bypasse les
    // policies storage avec le service_role pour générer l'URL signée :
    // les policies par défaut du bucket n'autorisent que l'assigné, ce qui
    // n'est plus aligné avec la règle "n'importe quel propria peut".
    const admin = createAdminClient();
    const path = `${interventionId}/${crypto.randomUUID()}.${proofExt(fileName)}`;
    const { data, error } = await admin.storage
      .from('intervention-proofs')
      .createSignedUploadUrl(path);
    if (error || !data) {
      return { ok: false, error: error?.message ?? 'Impossible de préparer l\'upload' };
    }
    return { ok: true, path: data.path, token: data.token };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Étape 2 : enregistre la fiche preuve une fois les octets envoyés au stockage. */
export async function recordInterventionProofAction(args: {
  interventionId: string;
  storagePath: string;
  fileType: string;
  fileSize: number;
  caption?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const { interventionId, storagePath, fileType, fileSize, caption } = args;
    if (!interventionId || !storagePath) return { ok: false, error: 'Données manquantes' };
    if (!storagePath.startsWith(`${interventionId}/`)) {
      return { ok: false, error: 'Chemin de stockage incohérent' };
    }
    await loadInterventionForActor(user, interventionId);

    const supabase = createClient();
    const h = headers();
    const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null;
    const ua = h.get('user-agent') ?? null;
    const mediaType = fileType.startsWith('video/') ? 'video' : 'photo';

    const { error } = await supabase.from('propria_intervention_proofs').insert({
      intervention_id: interventionId,
      storage_path: storagePath,
      media_type: mediaType,
      mime_type: fileType,
      file_size_bytes: fileSize,
      caption: caption ?? null,
      uploaded_by: user.id,
      uploaded_ip: ip,
      uploaded_user_agent: ua,
    } as any);
    if (error) {
      await supabase.storage.from('intervention-proofs').remove([storagePath]);
      return { ok: false, error: error.message };
    }
    revalidateIntervention(interventionId);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Renvoie les preuves d'une tâche avec URL signées (1h) pour affichage. */
export async function getInterventionProofUrls(interventionId: string) {
  const user = await assertRole(FIELD_OR_OFFICE);
  await loadInterventionForActor(user, interventionId);
  const supabase = createClient();
  const { data: proofs } = await supabase
    .from('propria_intervention_proofs')
    .select('id, storage_path, media_type, mime_type, caption, uploaded_by, created_at')
    .eq('intervention_id', interventionId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  if (!proofs) return [];
  // Read signed URL via admin pour bypasser la policy storage qui n'accepte
  // que l'assigné — l'autorisation métier a été vérifiée plus haut.
  const admin = createAdminClient();
  return Promise.all(
    proofs.map(async (p: any) => {
      const { data } = await admin.storage
        .from('intervention-proofs')
        .createSignedUrl(p.storage_path, 3600);
      return { ...p, url: data?.signedUrl ?? null };
    })
  );
}

/** Soft-delete d'une preuve + retrait du stockage (back office). */
export async function deleteInterventionProofAction(
  proofId: string,
  interventionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { data: proof } = await supabase
      .from('propria_intervention_proofs')
      .select('storage_path')
      .eq('id', proofId)
      .single();
    const { error } = await supabase
      .from('propria_intervention_proofs')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', proofId);
    if (error) throw new Error(error.message);
    if (proof?.storage_path) {
      await supabase.storage.from('intervention-proofs').remove([proof.storage_path]);
    }
    revalidateIntervention(interventionId);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── PRESTATAIRES ───────────────────────────────────────────────────────────

const providerSchema = z.object({
  name: z.string().min(2),
  function: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: optionalEmail,
  indicative_rate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function createProviderAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(['ceo','assistante','propria']);
    const data = providerSchema.parse(clean(Object.fromEntries(formData)));
    const supabase = createClient();
    const { error } = await supabase.from('propria_providers').insert(data as any);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/interventions/parametres');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateProviderAction(
  id: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(['ceo','assistante','propria']);
    const data = providerSchema.parse(clean(Object.fromEntries(formData)));
    const supabase = createClient();
    const { error } = await supabase.from('propria_providers').update(data as any).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/interventions/parametres');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function toggleProviderActiveAction(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    // CEO 2026-06-10 : ouvert au rôle propria avec audit log central.
    await assertRole(['ceo','assistante','propria']);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_providers')
      .update({ is_active: isActive } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/interventions/parametres');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Bulk-assignation des interventions non assignées ────────────────────
//
// CEO 2026-06-09 : un bandeau orange en haut de /propria/interventions et
// du dashboard /propria liste les tâches sans `assigned_to_id`. Clic →
// mini-modale qui permet de cocher N tâches + choisir un assigné → 1 update.
// Workflow simplifié déjà acté : tout staff peut assigner (pas seulement le
// back office), donc on aligne ici sur is_staff() = ceo + assistante + propria
// + developer.

const bulkAssignSchema = z.object({
  intervention_ids: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins une intervention'),
  assigned_to_id: z.string().uuid('Choisissez un collaborateur'),
});

export async function bulkAssignInterventionsAction(
  input: unknown,
): Promise<{ ok: true; updatedCount: number } | { ok: false; error: string }> {
  try {
    const user = await assertRole(['ceo','assistante','propria','developer']);
    const parsed = bulkAssignSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

    const { intervention_ids, assigned_to_id } = parsed.data;
    const supabase = createClient();

    // Snapshot des IDs qui sont ENCORE non assignés (avant le UPDATE) — sert
    // à logger un événement « assigned » par intervention effectivement modifiée.
    const { data: stillUnassigned } = await supabase
      .from('propria_interventions')
      .select('id')
      .in('id', intervention_ids)
      .is('assigned_to_id', null)
      .is('deleted_at', null);
    const toUpdateIds = (stillUnassigned ?? []).map((r: any) => r.id);

    // Garde-fou : on n'écrase pas un assigné déjà renseigné. Donc on filtre
    // sur assigned_to_id IS NULL côté UPDATE (cas concurrent : un autre membre
    // a déjà assigné une partie de la sélection entretemps → on l'ignore
    // silencieusement, le compte renvoyé reflètera le réel).
    const { error, count } = await supabase
      .from('propria_interventions')
      .update({ assigned_to_id } as any, { count: 'exact' })
      .in('id', intervention_ids)
      .is('assigned_to_id', null)
      .is('deleted_at', null);
    if (error) return { ok: false, error: error.message };

    // Récupère le nom du nouvel assigné pour enrichir le payload (lisible
    // dans la timeline sans avoir à re-fetch côté UI).
    const { data: assignee } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('id', assigned_to_id)
      .single();

    // Log un événement par intervention effectivement modifiée
    await Promise.all(toUpdateIds.map((interventionId) =>
      logInterventionActivity({
        supabase,
        interventionId,
        actorId: user.id,
        action: 'assigned',
        payload: {
          assigned_to_id,
          assigned_to_name: (assignee as any)?.full_name ?? null,
          via: 'bulk',
        },
      }),
    ));

    // Notification in-app groupée pour le nouvel assigné (best effort).
    if (toUpdateIds.length > 0) {
      await notifyUsers({
        supabase,
        actorId: user.id,
        userIds: [assigned_to_id],
        kind: 'assignation',
        title: toUpdateIds.length === 1
          ? 'On t\'a assigné une intervention'
          : `On t'a assigné ${toUpdateIds.length} interventions`,
        body: null,
        href: '/propria/interventions',
      });
    }

    revalidatePath('/propria/interventions');
    revalidatePath('/propria');
    return { ok: true, updatedCount: count ?? 0 };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
