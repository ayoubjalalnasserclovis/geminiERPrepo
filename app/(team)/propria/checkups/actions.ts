'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole, type Role } from '@/lib/auth/require';
import { optionalUuid } from '@/lib/validators/zod-helpers';
import { parseScope } from '@/lib/propria/intervention-scope';
import {
  CHECKUP_ITEM_KEYS,
  TOTAL_CHECKUP_ITEMS,
  findCheckupItem,
  CHECKUP_INVENTORY_KEYS,
  CHECKUP_MEASUREMENT_KEYS,
} from '@/lib/propria/checkup-checklist';
import { runCheckupAutomations, type CheckupAutoSummary } from '@/lib/propria/checkups-auto';
import { logPropriaAudit } from '@/lib/propria/audit';
import {
  notifyCheckupAssigned,
  notifyCheckupToValidate,
  notifyCheckupValidated,
} from '@/lib/propria/checkup-notify';

// ============================================================================
// Module Check-up logement — MVP (chantier 11.a, consultant U26, CEO A2).
// Patterns repris du module ménage (app/(team)/propria/menage/actions.ts) :
// workflow statuts, preuves via bucket 'intervention-proofs' + table dédiée,
// checklist par clés stables. Soft-delete partout.
// ============================================================================

const BACK_OFFICE: Role[] = ['ceo', 'assistante'];
const FIELD_OR_OFFICE: Role[] = ['ceo', 'assistante', 'propria'];

// ─── Helpers défensifs "session expirée" ─────────────────────────────────
// Wrappent toutes les server actions du module pour transformer l'auth-fail
// (assertRole throw "Non authentifié" / "Permission refusée") en { ok:false,
// error } proprement remonté au client → bandeau SessionExpiredBanner →
// redirect /login. NEXT_REDIRECT (next/navigation redirect()) doit être
// re-thrown sinon le router ne navigue pas.
function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e && typeof (e as any).digest === 'string' && (e as any).digest.startsWith('NEXT_REDIRECT');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

/**
 * Rôles autorisés à recevoir l'assignation d'un check-up.
 *
 * 2026-06-19 — chef_projet retiré : les pages /propria/checkups n'exigent que
 * ['ceo','developer','assistante','propria'], donc un chef_projet assigné
 * cliquait sur son email et tombait sur un 403. Canon Stoniz : chef_projet ≠
 * équipe propria (cf. mémoire stoniz_roles_launch_day).
 *
 * Bug avant correction : on acceptait n'importe quel staff sauf client →
 * assignait à sourcing/finance/achats qui n'ont aucun accès au module.
 */
const ALLOWED_ASSIGNEE_ROLES = new Set<Role>([
  'ceo', 'assistante', 'propria',
]);

async function assertAssigneeRoleAllowed(
  supabase: ReturnType<typeof createClient>,
  assignedToId: string | null | undefined,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!assignedToId) return { ok: true };
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', assignedToId)
    .maybeSingle();
  if (error) return { ok: false, error: `Vérification assignée : ${error.message}` };
  if (!profile) return { ok: false, error: 'Profil assigné introuvable.' };
  const role = (profile as any).role as Role | null;
  if (!role || !ALLOWED_ASSIGNEE_ROLES.has(role)) {
    return {
      ok: false,
      error: 'Seuls CEO, assistante ou propria peuvent être assignés à un check-up.',
    };
  }
  if ((profile as any).is_active === false) {
    return { ok: false, error: 'Cet utilisateur est désactivé.' };
  }
  return { ok: true };
}

function revalidateCheckup(id: string) {
  revalidatePath(`/propria/checkups/${id}`);
  revalidatePath(`/propria/checkups/${id}/rapport`);
  revalidatePath('/propria/checkups');
  revalidatePath('/propria');
}

function clean(raw: Record<string, FormDataEntryValue>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v === '' || v == null ? null : v;
  return out;
}

// ─── Création / édition ──────────────────────────────────────────────────
const checkupSchema = z.object({
  scope: z.preprocess(
    (v) => (v == null ? '' : v),
    z.string().min(1, 'Sélectionnez un lot ou le bien entier'),
  ),
  assigned_to_id: optionalUuid,
  due_date: z.string().optional().nullable(),
  observations: z.string().optional().nullable(),
});

export async function createCheckupAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const supabase = createClient();
    const parsed = checkupSchema.parse(clean(Object.fromEntries(formData)));
    const { scope, ...rest } = parsed;
    const scopeCols = parseScope(scope);

    // ─── #3 Filter assigned_to_id aux rôles autorisés ─────────────────────
    if (rest.assigned_to_id) {
      const check = await assertAssigneeRoleAllowed(supabase, rest.assigned_to_id);
      if (!check.ok) throw new Error(check.error);
    }

    // ─── #1 Anti-doublon serveur : check applicatif avant l'insert ────────
    // Un index unique partiel BDD complète la sécurité, mais on veut un message
    // d'erreur clair côté UX au lieu de "duplicate key violates...".
    if (rest.due_date) {
      let dupQuery = supabase
        .from('propria_checkups')
        .select('id')
        .in('status', ['a_faire', 'en_cours', 'a_valider'])
        .eq('due_date', rest.due_date)
        .is('deleted_at', null);
      if (scopeCols.propria_unit_id) {
        dupQuery = dupQuery.eq('propria_unit_id', scopeCols.propria_unit_id);
      } else if (scopeCols.property_id) {
        dupQuery = dupQuery
          .eq('property_id', scopeCols.property_id)
          .is('propria_unit_id', null);
      }
      const { data: existingDups } = await dupQuery.limit(1);
      if (existingDups && existingDups.length > 0) {
        throw new Error(
          "Un checkup est déjà programmé pour ce lot à cette date. Annule-le ou modifie l'échéance avant d'en créer un autre.",
        );
      }
    }

    const { data: row, error } = await supabase
      .from('propria_checkups')
      .insert({ ...rest, ...scopeCols, created_by: user.id, status: 'a_faire' } as any)
      .select('id')
      .single();
    if (error) {
      // Filet de sécurité : si l'index unique partiel BDD attrape un doublon
      // (race condition entre 2 clics simultanés), on remonte le même message UX.
      if ((error.message ?? '').toLowerCase().includes('duplicate')) {
        throw new Error(
          "Un checkup est déjà programmé pour ce lot à cette date. Annule-le ou modifie l'échéance avant d'en créer un autre.",
        );
      }
      throw new Error(`Création check-up : ${error.message}`);
    }

    // ─── #4 Audit log Propria (création manuelle uniquement) ──────────────
    await logPropriaAudit({
      supabase: supabase as any,
      table: 'propria_checkups',
      recordId: (row as any).id,
      actorId: user.id,
      action: 'create',
      label: 'Création check-up',
      payload: {
        scope,
        due_date: rest.due_date ?? null,
        assigned_to_id: rest.assigned_to_id ?? null,
        manual: true,
      },
    });

    // ─── #5A Notification : assigné dès la création ───────────────────────
    if (rest.assigned_to_id) {
      const admin = createAdminClient();
      await notifyCheckupAssigned({
        supabase,
        admin: admin as any,
        actorId: user.id,
        checkupId: (row as any).id,
        assignedToId: rest.assigned_to_id,
        propertyId: scopeCols.property_id ?? null,
        propriaUnitId: scopeCols.propria_unit_id ?? null,
        dueDate: rest.due_date ?? null,
      });
    }

    revalidatePath('/propria/checkups');
    redirect(`/propria/checkups/${(row as any).id}`);
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function updateCheckupAction(
  id: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const parsed = checkupSchema.parse(clean(Object.fromEntries(formData)));
    const { scope, ...rest } = parsed;
    const scopeCols = parseScope(scope);
    const supabase = createClient();

    // ─── #3 Filter assigned_to_id aux rôles autorisés ─────────────────────
    if (rest.assigned_to_id) {
      const check = await assertAssigneeRoleAllowed(supabase, rest.assigned_to_id);
      if (!check.ok) throw new Error(check.error);
    }

    // Récupère l'état avant pour détecter la vraie ré-assignation (#5A).
    const { data: before } = await supabase
      .from('propria_checkups')
      .select('assigned_to_id, property_id, propria_unit_id, due_date')
      .eq('id', id)
      .maybeSingle();

    const { error } = await supabase
      .from('propria_checkups')
      .update({ ...rest, ...scopeCols } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    // ─── #5A Notification : assignation si réellement changée ────────────
    const beforeAssignee = (before as any)?.assigned_to_id ?? null;
    const newAssignee = rest.assigned_to_id ?? null;
    if (newAssignee && newAssignee !== beforeAssignee) {
      const admin = createAdminClient();
      await notifyCheckupAssigned({
        supabase,
        admin: admin as any,
        actorId: user.id,
        checkupId: id,
        assignedToId: newAssignee,
        propertyId: scopeCols.property_id ?? null,
        propriaUnitId: scopeCols.propria_unit_id ?? null,
        dueDate: rest.due_date ?? null,
      });
    }

    revalidateCheckup(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Soft-delete (CEO only — convention n°4 actions sensibles). */
export async function deleteCheckupAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(['ceo']);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_checkups')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    // ─── #4 Audit log Propria ─────────────────────────────────────────────
    await logPropriaAudit({
      supabase: supabase as any,
      table: 'propria_checkups',
      recordId: id,
      actorId: user.id,
      action: 'delete',
      label: 'Soft-delete check-up',
      payload: { ceo_only: true },
    });

    revalidatePath('/propria/checkups');
    revalidatePath('/propria');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Workflow ─────────────────────────────────────────────────────────────

/** a_faire → en_cours. started_at rempli une seule fois (durée parlante). */
export async function startCheckupAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(FIELD_OR_OFFICE);
    const supabase = createClient();
    const { data: before } = await supabase
      .from('propria_checkups').select('status, started_at').eq('id', id).single();
    if (!before) throw new Error('Check-up introuvable');
    const update: any = { status: 'en_cours' };
    if (!(before as any).started_at) update.started_at = new Date().toISOString();
    const { error } = await supabase
      .from('propria_checkups').update(update).eq('id', id);
    if (error) throw new Error(`Démarrage : ${error.message}`);
    revalidateCheckup(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Checklist : upsert d'un item (clé stable) ───────────────────────────
const itemSchema = z.object({
  checkup_id: z.string().uuid(),
  item_key: z.string().min(1),
  status: z.enum(['ok', 'probleme', 'na']),
  note: z.string().optional().nullable(),
});

export async function upsertCheckupItemAction(input: unknown) {
  try {
    await assertRole(FIELD_OR_OFFICE);
    const parsed = itemSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    const { checkup_id, item_key, status, note } = parsed.data;
    if (!CHECKUP_ITEM_KEYS.has(item_key)) {
      return { ok: false as const, error: `Item de checklist inconnu : ${item_key}` };
    }

    const supabase = createClient();
    const noteClean = (note ?? '').trim() || null;

    const { data: existing } = await supabase
      .from('propria_checkup_items')
      .select('id')
      .eq('checkup_id', checkup_id)
      .eq('item_key', item_key)
      .is('deleted_at', null)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('propria_checkup_items')
        .update({ status, note: noteClean } as any)
        .eq('id', (existing as any).id);
      if (error) return { ok: false as const, error: error.message };
    } else {
      const { error } = await supabase
        .from('propria_checkup_items')
        .insert({ checkup_id, item_key, status, note: noteClean } as any);
      if (error) return { ok: false as const, error: error.message };
    }
    revalidateCheckup(checkup_id);
    return { ok: true as const };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ─── Soumission (bloquante — règles MVP + classification chantier 4) ─────
// Bloqué si : items non renseignés restants, OU item Problème sans note,
// OU item Problème sans photo, OU classification finale absente,
// OU résumé exécutif absent.
const submitSchema = z.object({
  id: z.string().uuid(),
  final_classification: z.enum(['A','B','C','D']),
  final_summary: z.string().min(10, 'Résumé exécutif requis (au moins 10 caractères).'),
});

export async function submitCheckupAction(
  input: unknown,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const parsed = submitSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues[0].message);
    const { id, final_classification, final_summary } = parsed.data;

    const supabase = createClient();

    const [itemsRes, proofsRes] = await Promise.all([
      supabase.from('propria_checkup_items')
        .select('item_key, status, note')
        .eq('checkup_id', id).is('deleted_at', null),
      supabase.from('propria_checkup_proofs')
        .select('item_key')
        .eq('checkup_id', id).is('deleted_at', null),
    ]);
    const items = (itemsRes.data ?? []) as { item_key: string; status: string; note: string | null }[];
    const proofKeys = new Set(((proofsRes.data ?? []) as any[]).map((p) => p.item_key).filter(Boolean));

    const filled = items.filter((i) => CHECKUP_ITEM_KEYS.has(i.item_key));
    const missing = TOTAL_CHECKUP_ITEMS - filled.length;
    if (missing > 0) {
      throw new Error(`${missing} item(s) de la checklist ne sont pas encore renseignés (OK / Problème / N/A).`);
    }
    const problems = filled.filter((i) => i.status === 'probleme');
    const noNote = problems.filter((i) => !(i.note ?? '').trim());
    if (noNote.length > 0) {
      const labels = noNote.map((i) => findCheckupItem(i.item_key)?.label ?? i.item_key).join(', ');
      throw new Error(`Note obligatoire sur chaque item en Problème — manquante sur : ${labels}.`);
    }
    const noPhoto = problems.filter((i) => !proofKeys.has(i.item_key));
    if (noPhoto.length > 0) {
      const labels = noPhoto.map((i) => findCheckupItem(i.item_key)?.label ?? i.item_key).join(', ');
      throw new Error(`Photo obligatoire sur chaque item en Problème — manquante sur : ${labels}.`);
    }

    const { error } = await supabase
      .from('propria_checkups')
      .update({
        status: 'a_valider',
        submitted_at: new Date().toISOString(),
        final_classification,
        final_summary,
      } as any)
      .eq('id', id)
      .eq('status', 'en_cours');
    if (error) throw new Error(error.message);

    // ─── #4 Audit log Propria + #5B notification "à valider" ──────────────
    // On lit le scope (property/unit) pour les payloads notif.
    const { data: row } = await supabase
      .from('propria_checkups')
      .select('property_id, propria_unit_id')
      .eq('id', id)
      .maybeSingle();

    const problemsCount = problems.length;
    await logPropriaAudit({
      supabase: supabase as any,
      table: 'propria_checkups',
      recordId: id,
      actorId: user.id,
      action: 'status_change',
      label: 'Soumission check-up (en_cours → a_valider)',
      payload: {
        classification: final_classification,
        summary: final_summary.slice(0, 200),
        items_count: filled.length,
        problems_count: problemsCount,
      },
    });

    // Notification email aux CEO + assistantes (best-effort interne)
    const admin = createAdminClient();
    await notifyCheckupToValidate({
      admin: admin as any,
      checkupId: id,
      propertyId: (row as any)?.property_id ?? null,
      propriaUnitId: (row as any)?.propria_unit_id ?? null,
      classification: final_classification,
      summary: final_summary,
    });

    revalidateCheckup(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Annuler (back office). */
export async function cancelCheckupAction(
  id: string,
  reason?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_checkups')
      .update({ status: 'annule' } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    // ─── #4 Audit log Propria ─────────────────────────────────────────────
    await logPropriaAudit({
      supabase: supabase as any,
      table: 'propria_checkups',
      recordId: id,
      actorId: user.id,
      action: 'status_change',
      label: 'Annulation check-up',
      payload: { reason: reason?.trim() || 'Sans raison' },
    });

    revalidateCheckup(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/**
 * Renvoyer au terrain : a_valider → en_cours (back office).
 * ⚠ #2 — Le reopen reset AUSSI final_classification / final_summary.
 * Avant : seuls validated_by/at étaient reset → ancienne classification stale
 * affichée si le terrain corrigeait et resoumettait. Maintenant on remet
 * tout à zéro pour que le valideur doive reclasser explicitement.
 */
export async function reopenCheckupAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_checkups')
      .update({
        status: 'en_cours',
        submitted_at: null,
        validated_by: null,
        validated_at: null,
        final_classification: null,
        final_summary: null,
      } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    // ─── #4 Audit log Propria ─────────────────────────────────────────────
    await logPropriaAudit({
      supabase: supabase as any,
      table: 'propria_checkups',
      recordId: id,
      actorId: user.id,
      action: 'status_change',
      label: 'Renvoi terrain (a_valider → en_cours)',
      payload: {
        reset: ['submitted_at', 'validated_by', 'validated_at', 'final_classification', 'final_summary'],
      },
    });

    revalidateCheckup(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Validation back-office + transformation MULTI-CIBLE des problèmes ──
// Chantier 2 marathon (CEO 2026-06-18) : un même item Problème peut générer
// SIMULTANÉMENT tâche + intervention + litige (combinaison libre).
//
// Format envoyé par la modale :
//   creations[] = { item_key, targets: { tache?, intervention?, litige? } }
//
// Chaque cible peut surcharger description + urgency. Le litige nécessite
// une réservation Hostaway récente sur le lot/bien (sinon message clair).
const targetSchema = z.object({
  description: z.string().min(2).optional(),
  urgency: z.enum(['critique','haute','normale','basse']).optional(),
});
const litigeTargetSchema = z.object({
  description: z.string().min(2).optional(),
  type: z.enum(['caution','degats','frais_contestes','annulation_tardive','tapage','menage','autre']),
  amount: z.coerce.number().positive().optional().nullable(),
});
const validateSchema = z.object({
  checkup_id: z.string().uuid(),
  creations: z.array(z.object({
    item_key: z.string().min(1),
    targets: z.object({
      tache: targetSchema.optional(),
      intervention: targetSchema.optional(),
      litige: litigeTargetSchema.optional(),
    }),
  })).default([]),
});

export async function validateCheckupAction(input: unknown) {
  try {
  const user = await assertRole(BACK_OFFICE);
  const parsed = validateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { checkup_id, creations } = parsed.data;

  const supabase = createClient();
  const { data: checkup } = await supabase
    .from('propria_checkups')
    .select('id, status, property_id, propria_unit_id, due_date, submitted_at, created_at, assigned_to_id, final_classification, final_summary')
    .eq('id', checkup_id).single();
  if (!checkup) return { ok: false as const, error: 'Check-up introuvable.' };
  if ((checkup as any).status !== 'a_valider') {
    return { ok: false as const, error: 'Ce check-up n’est pas en attente de validation.' };
  }

  const { data: itemRows } = await supabase
    .from('propria_checkup_items')
    .select('item_key, status, note')
    .eq('checkup_id', checkup_id).is('deleted_at', null);
  const itemsByKey = new Map(((itemRows ?? []) as any[]).map((i) => [i.item_key, i]));

  const dateLabel = new Date(
    (checkup as any).due_date ?? (checkup as any).submitted_at ?? (checkup as any).created_at,
  ).toLocaleDateString('fr-FR');

  // Garde-fou litige : on a besoin d'une réservation Hostaway récente sur le lot
  // (clés via hostaway_listings.propria_unit_id). On charge la liste si au moins
  // un item demande un litige.
  const needsLitigeContext = creations.some((c) => c.targets.litige);
  let resaForLitige: { hostawayId: number; listingDbId: number } | null = null;
  if (needsLitigeContext) {
    const unitId = (checkup as any).propria_unit_id as string | null;
    // CORRECTION CRITIQUE (CEO 2026-06-18) : un check-up sur le bien entier
    // (propria_unit_id null, property_id rempli) ne permet PAS de créer un litige.
    // L'ancien code laissait passer et la requête Hostaway sans filtre unit_id
    // ramenait n'importe quelle réservation → litige créé sur résa d'un client tiers.
    // → Litige forcé sur un lot précis. Sinon : créer manuellement depuis /propria/litiges.
    if (!unitId) {
      return {
        ok: false as const,
        error: 'Litige impossible : ce check-up porte sur le bien entier (pas un lot précis). Créer le litige manuellement depuis /propria/litiges sur le bon lot.',
      };
    }
    // On récupère la dernière résa terminée récemment (< 30j) sur ce lot.
    const monthAgoIso = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const listingsQuery = supabase.from('hostaway_listings').select('id')
      .is('deleted_at', null)
      .eq('propria_unit_id', unitId); // filtre OBLIGATOIRE (sans, on tape dans tous les listings)
    const { data: listings } = await listingsQuery;
    const listingIds = ((listings ?? []) as any[]).map((l) => l.id as number);
    if (listingIds.length === 0) {
      return { ok: false as const, error: 'Litige impossible : aucun listing Hostaway rattaché à ce lot.' };
    }
    const { data: resas } = await supabase
      .from('hostaway_reservations')
      .select('hostaway_id, hostaway_listing_db_id, departure_date')
      .in('hostaway_listing_db_id', listingIds)
      .in('status', ['new', 'modified'])
      .is('deleted_at', null)
      .gte('departure_date', monthAgoIso)
      .order('departure_date', { ascending: false })
      .limit(1);
    const resa = (resas ?? [])[0] as any;
    if (!resa) {
      return {
        ok: false as const,
        error: 'Litige impossible : aucune réservation Hostaway récente (< 30j) sur ce lot. Créer le litige manuellement depuis /propria/litiges.',
      };
    }
    resaForLitige = { hostawayId: resa.hostaway_id, listingDbId: resa.hostaway_listing_db_id };
  }

  const created: { id: string; kind: 'tache' | 'intervention' | 'litige'; label: string }[] = [];
  for (const c of creations) {
    const item = itemsByKey.get(c.item_key) as any;
    if (!item || item.status !== 'probleme') {
      return { ok: false as const, error: `L'item « ${c.item_key} » n'est pas un problème de ce check-up.` };
    }
    const label = findCheckupItem(c.item_key)?.label ?? c.item_key;
    const note = (item.note ?? '').trim();
    const defaultDescription = `Check-up ${dateLabel} — ${label}${note ? ` : ${note}` : ''}`;
    if (!c.targets.tache && !c.targets.intervention && !c.targets.litige) {
      return { ok: false as const, error: `Aucune cible cochée pour l'item « ${label} ».` };
    }

    // 1) Tâche et/ou intervention (même table propria_interventions, kind différent)
    for (const [kind, target] of [
      ['tache', c.targets.tache],
      ['intervention', c.targets.intervention],
    ] as const) {
      if (!target) continue;
      const { data: newInt, error: insErr } = await supabase
        .from('propria_interventions')
        .insert({
          property_id: (checkup as any).property_id,
          propria_unit_id: (checkup as any).propria_unit_id,
          kind,
          description: target.description ?? defaultDescription,
          urgency: target.urgency ?? 'normale',
          status: 'a_traiter',
          occurred_at: new Date().toISOString().slice(0, 10),
          created_by: user.id,
          source_checkup_id: checkup_id,
          hostaway_integrated: false,
        } as any)
        .select('id').single();
      if (insErr) return { ok: false as const, error: `Création ${kind} (${label}) : ${insErr.message}` };
      created.push({ id: newInt.id, kind, label });
    }

    // 2) Litige (avec contexte résa garanti par le garde-fou plus haut)
    if (c.targets.litige && resaForLitige) {
      const lit = c.targets.litige;
      const { data: newLitige, error: litErr } = await supabase
        .from('propria_litiges')
        .insert({
          hostaway_reservation_id: resaForLitige.hostawayId,
          hostaway_listing_db_id: resaForLitige.listingDbId,
          propria_unit_id: (checkup as any).propria_unit_id ?? null,
          type: lit.type,
          description: lit.description ?? defaultDescription,
          currency: 'MAD',
          created_by: user.id,
          source_checkup_id: checkup_id,
        } as any)
        .select('id').single();
      if (litErr) return { ok: false as const, error: `Création litige (${label}) : ${litErr.message}` };
      if (lit.amount != null && lit.amount > 0) {
        await supabase.from('propria_litige_items').insert({
          litige_id: newLitige.id,
          description: lit.description ?? defaultDescription,
          amount_claimed_mad: lit.amount,
          created_by: user.id,
        } as any);
      }
      created.push({ id: newLitige.id, kind: 'litige', label });
    }
  }

  const { error: updErr } = await supabase
    .from('propria_checkups')
    .update({
      status: 'valide',
      validated_by: user.id,
      validated_at: new Date().toISOString(),
    } as any)
    .eq('id', checkup_id)
    .eq('status', 'a_valider');
  if (updErr) return { ok: false as const, error: updErr.message };

  // ─── #4 Audit log Propria ─────────────────────────────────────────────
  const classification = (checkup as any)?.final_classification ?? null;
  await logPropriaAudit({
    supabase: supabase as any,
    table: 'propria_checkups',
    recordId: checkup_id,
    actorId: user.id,
    action: 'validate',
    label: 'Validation back-office check-up',
    payload: {
      classification,
      created_items: created.length,
      breakdown: {
        tache: created.filter((c) => c.kind === 'tache').length,
        intervention: created.filter((c) => c.kind === 'intervention').length,
        litige: created.filter((c) => c.kind === 'litige').length,
      },
    },
  });

  // ─── #5C Notification : terrain notifié + alerte CEO si C/D ───────────
  const admin = createAdminClient();
  await notifyCheckupValidated({
    supabase,
    admin: admin as any,
    actorId: user.id,
    checkupId: checkup_id,
    originalAssignedToId: (checkup as any)?.assigned_to_id ?? null,
    propertyId: (checkup as any)?.property_id ?? null,
    propriaUnitId: (checkup as any)?.propria_unit_id ?? null,
    classification: classification as 'A' | 'B' | 'C' | 'D' | null,
  });

  revalidateCheckup(checkup_id);
  revalidatePath('/propria/interventions');
  revalidatePath('/propria/mes-taches');
  revalidatePath('/propria/litiges');
  return { ok: true as const, created };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ─── Preuves photo — bucket réutilisé 'intervention-proofs' ──────────────
// Chemin : checkups/<checkup_id>/<uuid>.<ext> (même logique que le ménage).
const PROOFS_BUCKET = 'intervention-proofs';

export async function createCheckupProofUploadUrl(args: {
  checkupId: string;
  filename: string;
  contentType: string;
}) {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const admin = createAdminClient();
    const ext = (args.filename.split('.').pop() ?? 'bin').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `checkups/${args.checkupId}/${crypto.randomUUID()}.${safeExt}`;
    const { data, error } = await admin.storage.from(PROOFS_BUCKET)
      .createSignedUploadUrl(path);
    if (error) return { ok: false as const, error: error.message };
    return {
      ok: true as const,
      path,
      token: (data as any).token,
      signedUrl: (data as any).signedUrl ?? null,
      uploadedById: user.id,
    };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

export async function recordCheckupProofAction(args: {
  checkupId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  /** Clé d'item de checklist (null = photo générale). */
  itemKey?: string | null;
}) {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const supabase = createClient();
    const { error } = await supabase.from('propria_checkup_proofs').insert({
      checkup_id: args.checkupId,
      storage_path: args.storagePath,
      mime_type: args.mimeType,
      size_bytes: args.sizeBytes,
      uploaded_by: user.id,
      item_key: args.itemKey ?? null,
    } as any);
    if (error) return { ok: false as const, error: error.message };
    revalidateCheckup(args.checkupId);
    return { ok: true as const };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

export async function getCheckupProofUrls(checkupId: string) {
  await assertRole(['ceo', 'developer', 'assistante', 'propria']);
  const admin = createAdminClient();
  const { data: proofs } = await admin
    .from('propria_checkup_proofs')
    .select('id, storage_path, mime_type, uploaded_by, created_at, item_key')
    .eq('checkup_id', checkupId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });
  const withUrls = await Promise.all(((proofs ?? []) as any[]).map(async (p) => {
    const { data: signed } = await admin.storage.from(PROOFS_BUCKET)
      .createSignedUrl(p.storage_path, 60 * 60); // 1h
    return {
      id: p.id as string,
      storagePath: p.storage_path as string,
      mimeType: p.mime_type as string | null,
      uploadedById: p.uploaded_by as string | null,
      createdAt: p.created_at as string,
      signedUrl: signed?.signedUrl ?? null,
      itemKey: p.item_key as string | null,
    };
  }));
  return withUrls;
}

// ─── Automatisations 11.b — bouton « Lancer maintenant » (CEO/developer) ──
// Appelle EXACTEMENT la même logique que le cron /api/cron/checkups-auto
// (lib/propria/checkups-auto.ts — une seule source de vérité). Chaque bloc
// est idempotent : relancer le même jour ne crée aucun doublon.
// Client admin (bypass RLS) comme le cron — l'autorisation est portée par
// assertRole ; developer n'a pas le droit d'INSERT via RLS mais peut
// déclencher le traitement système.
export async function runCheckupAutomationsNowAction(): Promise<
  { ok: true; summary: CheckupAutoSummary } | { ok: false; error: string }
> {
  try {
    await assertRole(['ceo', 'developer']);
    const admin = createAdminClient();
    const summary = await runCheckupAutomations(admin as any);
    revalidatePath('/propria/checkups');
    revalidatePath('/propria');
    return { ok: true as const, summary };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

export async function deleteCheckupProofAction(proofId: string, checkupId: string) {
  try {
    await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_checkup_proofs')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', proofId);
    if (error) return { ok: false as const, error: error.message };
    revalidateCheckup(checkupId);
    return { ok: true as const };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ─── Inventaire chiffré (chantier 3 — CEO 2026-06-18) ────────────────────
const inventorySchema = z.object({
  checkup_id: z.string().uuid(),
  item_key: z.string().min(1),
  expected_qty: z.coerce.number().int().min(0).default(6),
  actual_qty: z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  missing_list: z.array(z.string().min(1)).default([]),
  note: z.string().optional().nullable(),
});

export async function upsertCheckupInventoryAction(input: unknown) {
  try {
    await assertRole(FIELD_OR_OFFICE);
    const parsed = inventorySchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    const data = parsed.data;
    if (!CHECKUP_INVENTORY_KEYS.has(data.item_key)) {
      return { ok: false as const, error: `Item d'inventaire inconnu : ${data.item_key}` };
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('propria_checkup_inventory')
      .upsert(
        {
          checkup_id: data.checkup_id,
          item_key: data.item_key,
          expected_qty: data.expected_qty,
          actual_qty: data.actual_qty ?? null,
          missing_list: data.missing_list,
          note: data.note ?? null,
        } as any,
        { onConflict: 'checkup_id,item_key' },
      );
    if (error) return { ok: false as const, error: error.message };
    revalidateCheckup(data.checkup_id);
    return { ok: true as const };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ─── Mesures chiffrées (chantier 3) ──────────────────────────────────────
const measurementSchema = z.object({
  checkup_id: z.string().uuid(),
  item_key: z.string().min(1),
  value_numeric: z.coerce.number(),
  unit: z.string().min(1),
  note: z.string().optional().nullable(),
});

export async function upsertCheckupMeasurementAction(input: unknown) {
  try {
    await assertRole(FIELD_OR_OFFICE);
    const parsed = measurementSchema.safeParse(input);
    if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
    const data = parsed.data;
    if (!CHECKUP_MEASUREMENT_KEYS.has(data.item_key)) {
      return { ok: false as const, error: `Mesure inconnue : ${data.item_key}` };
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('propria_checkup_measurements')
      .upsert(
        {
          checkup_id: data.checkup_id,
          item_key: data.item_key,
          value_numeric: data.value_numeric,
          unit: data.unit,
          note: data.note ?? null,
        } as any,
        { onConflict: 'checkup_id,item_key' },
      );
    if (error) return { ok: false as const, error: error.message };
    revalidateCheckup(data.checkup_id);
    return { ok: true as const };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}

// ─── Transformation inline d'un item check-up (Phase C1 — CEO 2026-06-24) ──
// Permet aux opérateurs terrain (propria) + back-office (ceo + assistante) de
// transformer un item non-OK en tâche/intervention/litige PENDANT le checkup,
// sans attendre la validation finale CEO.
//
// Idempotence garantie par :
// 1. Colonne source_checkup_item_key sur propria_interventions + propria_litiges
// 2. Index unique partiel BDD (migration 20260625…) qui bloque 2 INSERTs avec
//    le même triplet (checkup_id, item_key, kind) — soft-delete aware
// 3. Pré-check applicatif (SELECT 1) avant chaque INSERT pour message UX clair
// 4. Catch sur erreur 23505 (race condition) → on retourne l'ID existant
//
// Garde-fous litige : reproduit la logique de validateCheckupAction L614-658
// (lot précis obligatoire + réservation Hostaway < 30j).
const TRANSFORM_ALLOWED_ROLES: Role[] = ['ceo', 'assistante', 'propria'];

const transformTargetIntervSchema = z.object({
  description: z.string().min(2).optional(),
  urgency: z.enum(['critique', 'haute', 'normale', 'basse']).optional(),
});
const transformTargetLitigeSchema = z.object({
  description: z.string().min(2).optional(),
  type: z.enum(['caution', 'degats', 'frais_contestes', 'annulation_tardive', 'tapage', 'menage', 'autre']),
  amount: z.coerce.number().positive().optional().nullable(),
});
const transformInputSchema = z.object({
  checkup_id: z.string().uuid(),
  item_key: z.string().min(1),
  targets: z.object({
    tache: transformTargetIntervSchema.optional(),
    intervention: transformTargetIntervSchema.optional(),
    litige: transformTargetLitigeSchema.optional(),
  }),
});

export type TransformCheckupItemResult =
  | { ok: true; created: Array<{ kind: 'tache' | 'intervention' | 'litige'; id: string; skipped?: boolean }> }
  | { ok: false; error: string };

export async function transformCheckupItemAction(
  input: unknown,
): Promise<TransformCheckupItemResult> {
  try {
    const user = await assertRole(TRANSFORM_ALLOWED_ROLES);
    const parsed = transformInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0].message };
    }
    const { checkup_id, item_key, targets } = parsed.data;

    if (!CHECKUP_ITEM_KEYS.has(item_key)) {
      return { ok: false as const, error: `Item de checklist inconnu : ${item_key}` };
    }
    if (!targets.tache && !targets.intervention && !targets.litige) {
      return { ok: false as const, error: 'Aucune cible cochée (tâche / intervention / litige).' };
    }

    const supabase = createClient();

    // 1) Charger le checkup + valider l'éligibilité de l'item
    const { data: checkup, error: checkErr } = await supabase
      .from('propria_checkups')
      .select('id, status, property_id, propria_unit_id, due_date, submitted_at, created_at')
      .eq('id', checkup_id)
      .is('deleted_at', null)
      .maybeSingle();
    if (checkErr) return { ok: false as const, error: `Lecture check-up : ${checkErr.message}` };
    if (!checkup) return { ok: false as const, error: 'Check-up introuvable.' };
    if ((checkup as any).status === 'annule') {
      return { ok: false as const, error: 'Ce check-up est annulé.' };
    }

    // 2) Charger l'item et vérifier qu'il est non-OK
    const { data: itemRow, error: itemErr } = await supabase
      .from('propria_checkup_items')
      .select('item_key, status, note')
      .eq('checkup_id', checkup_id)
      .eq('item_key', item_key)
      .is('deleted_at', null)
      .maybeSingle();
    if (itemErr) return { ok: false as const, error: `Lecture item : ${itemErr.message}` };
    if (!itemRow) {
      return { ok: false as const, error: 'Cet item n’a pas encore été renseigné dans la checklist.' };
    }
    if ((itemRow as any).status === 'ok') {
      return { ok: false as const, error: 'Item OK : aucune action à créer.' };
    }

    const itemLabel = findCheckupItem(item_key)?.label ?? item_key;
    const itemNote = ((itemRow as any).note ?? '').trim();
    const dateLabel = new Date(
      (checkup as any).due_date ?? (checkup as any).submitted_at ?? (checkup as any).created_at,
    ).toLocaleDateString('fr-FR');
    const defaultDescription = `Check-up ${dateLabel} — ${itemLabel}${itemNote ? ` : ${itemNote}` : ''}`;

    // 3) Garde-fous litige : Hostaway < 30j + lot précis (cf. validateCheckupAction L614-658)
    let resaForLitige: { hostawayId: number; listingDbId: string } | null = null;
    if (targets.litige) {
      const unitId = (checkup as any).propria_unit_id as string | null;
      if (!unitId) {
        return {
          ok: false as const,
          error:
            'Litige impossible : ce check-up porte sur le bien entier (pas un lot précis). Créer le litige manuellement depuis /propria/litiges sur le bon lot.',
        };
      }
      const monthAgoIso = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
      const { data: listings } = await supabase
        .from('hostaway_listings')
        .select('id')
        .is('deleted_at', null)
        .eq('propria_unit_id', unitId);
      const listingIds = ((listings ?? []) as any[]).map((l) => l.id);
      if (listingIds.length === 0) {
        return {
          ok: false as const,
          error: 'Litige impossible : aucun listing Hostaway rattaché à ce lot.',
        };
      }
      const { data: resas } = await supabase
        .from('hostaway_reservations')
        .select('hostaway_id, hostaway_listing_db_id, departure_date')
        .in('hostaway_listing_db_id', listingIds)
        .in('status', ['new', 'modified'])
        .is('deleted_at', null)
        .gte('departure_date', monthAgoIso)
        .order('departure_date', { ascending: false })
        .limit(1);
      const resa = (resas ?? [])[0] as any;
      if (!resa) {
        return {
          ok: false as const,
          error:
            'Litige impossible : aucune réservation Hostaway récente (< 30j) sur ce lot. Créer le litige manuellement depuis /propria/litiges.',
        };
      }
      resaForLitige = { hostawayId: resa.hostaway_id, listingDbId: resa.hostaway_listing_db_id };
    }

    // 4) Helpers internes — pré-check idempotence + INSERT
    const created: Array<{ kind: 'tache' | 'intervention' | 'litige'; id: string; skipped?: boolean }> = [];

    async function ensureIntervention(
      kind: 'tache' | 'intervention',
      target: { description?: string; urgency?: 'critique' | 'haute' | 'normale' | 'basse' },
    ): Promise<{ ok: true; id: string; skipped: boolean } | { ok: false; error: string }> {
      // Pré-check : existe déjà ?
      const { data: existing } = await supabase
        .from('propria_interventions')
        .select('id')
        .eq('source_checkup_id', checkup_id)
        .eq('source_checkup_item_key', item_key)
        .eq('kind', kind)
        .is('deleted_at', null)
        .maybeSingle();
      if (existing) return { ok: true as const, id: (existing as any).id, skipped: true };

      const { data: row, error: insErr } = await supabase
        .from('propria_interventions')
        .insert({
          property_id: (checkup as any).property_id,
          propria_unit_id: (checkup as any).propria_unit_id,
          kind,
          description: target.description ?? defaultDescription,
          urgency: target.urgency ?? 'normale',
          status: 'a_traiter',
          occurred_at: new Date().toISOString().slice(0, 10),
          created_by: user.id,
          source_checkup_id: checkup_id,
          source_checkup_item_key: item_key,
          hostaway_integrated: false,
        } as any)
        .select('id')
        .single();
      if (insErr) {
        // 23505 = unique violation (race condition entre 2 clics simultanés)
        const isDup =
          (insErr as any).code === '23505' ||
          (insErr.message ?? '').toLowerCase().includes('duplicate');
        if (isDup) {
          const { data: again } = await supabase
            .from('propria_interventions')
            .select('id')
            .eq('source_checkup_id', checkup_id)
            .eq('source_checkup_item_key', item_key)
            .eq('kind', kind)
            .is('deleted_at', null)
            .maybeSingle();
          if (again) return { ok: true as const, id: (again as any).id, skipped: true };
        }
        return { ok: false as const, error: `Création ${kind} : ${insErr.message}` };
      }
      return { ok: true as const, id: (row as any).id, skipped: false };
    }

    // 5) Tâche
    if (targets.tache) {
      const r = await ensureIntervention('tache', targets.tache);
      if (!r.ok) return { ok: false as const, error: r.error };
      created.push({ kind: 'tache', id: r.id, skipped: r.skipped });
    }

    // 6) Intervention
    if (targets.intervention) {
      const r = await ensureIntervention('intervention', targets.intervention);
      if (!r.ok) return { ok: false as const, error: r.error };
      created.push({ kind: 'intervention', id: r.id, skipped: r.skipped });
    }

    // 7) Litige (avec garde-fous validés plus haut)
    if (targets.litige && resaForLitige) {
      const lit = targets.litige;
      // Pré-check idempotence
      const { data: existingLit } = await supabase
        .from('propria_litiges')
        .select('id')
        .eq('source_checkup_id', checkup_id)
        .eq('source_checkup_item_key', item_key)
        .is('deleted_at', null)
        .maybeSingle();
      if (existingLit) {
        created.push({ kind: 'litige', id: (existingLit as any).id, skipped: true });
      } else {
        const { data: newLit, error: litErr } = await supabase
          .from('propria_litiges')
          .insert({
            hostaway_reservation_id: resaForLitige.hostawayId,
            hostaway_listing_db_id: resaForLitige.listingDbId,
            propria_unit_id: (checkup as any).propria_unit_id ?? null,
            type: lit.type,
            description: lit.description ?? defaultDescription,
            currency: 'MAD',
            created_by: user.id,
            source_checkup_id: checkup_id,
            source_checkup_item_key: item_key,
          } as any)
          .select('id')
          .single();
        if (litErr) {
          const isDup =
            (litErr as any).code === '23505' ||
            (litErr.message ?? '').toLowerCase().includes('duplicate');
          if (isDup) {
            const { data: again } = await supabase
              .from('propria_litiges')
              .select('id')
              .eq('source_checkup_id', checkup_id)
              .eq('source_checkup_item_key', item_key)
              .is('deleted_at', null)
              .maybeSingle();
            if (again) {
              created.push({ kind: 'litige', id: (again as any).id, skipped: true });
            } else {
              return { ok: false as const, error: `Création litige : ${litErr.message}` };
            }
          } else {
            return { ok: false as const, error: `Création litige : ${litErr.message}` };
          }
        } else {
          if (lit.amount != null && lit.amount > 0) {
            await supabase.from('propria_litige_items').insert({
              litige_id: (newLit as any).id,
              description: lit.description ?? defaultDescription,
              amount_claimed_mad: lit.amount,
              created_by: user.id,
            } as any);
          }
          created.push({ kind: 'litige', id: (newLit as any).id, skipped: false });
        }
      }
    }

    // 8) Audit log (best-effort)
    await logPropriaAudit({
      supabase: supabase as any,
      table: 'propria_checkups',
      recordId: checkup_id,
      actorId: user.id,
      action: 'custom',
      label: 'Transformation inline item check-up',
      payload: {
        item_key,
        item_label: itemLabel,
        item_status: (itemRow as any).status,
        created: created.map((c) => ({ kind: c.kind, id: c.id, skipped: !!c.skipped })),
      },
    });

    revalidateCheckup(checkup_id);
    revalidatePath('/propria/interventions');
    revalidatePath('/propria/mes-taches');
    revalidatePath('/propria/litiges');
    return { ok: true as const, created };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false as const, error: errorMessage(e) };
  }
}
