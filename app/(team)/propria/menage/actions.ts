'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole, type Role } from '@/lib/auth/require';
import { optionalUuid } from '@/lib/validators/zod-helpers';
import { parseScope } from '@/lib/propria/intervention-scope';
import { sendEmail } from '@/lib/email/send';

// ─── Helpers défensifs (session expirée) ───────────────────────────────
// CEO 2026-06-23 : toutes les actions du module ménage encapsulent leur
// logique dans un try/catch et retournent { ok: true } | { ok: false, error }.
// Les redirects Next.js sont re-throwés via la garde isNextRedirect (ils
// passent par un throw d'objet `{ digest: 'NEXT_REDIRECT;...' }`). Les
// composants client peuvent alors afficher un bandeau « Session expirée »
// au lieu de crasher silencieusement.
function isNextRedirect(e: unknown): boolean {
  return !!e && typeof e === 'object' && 'digest' in e
    && typeof (e as any).digest === 'string'
    && (e as any).digest.startsWith('NEXT_REDIRECT');
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

// Rôles : back office (validation, refus) vs terrain (dames de ménage).
const BACK_OFFICE: Role[] = ['ceo', 'assistante'];
// CEO 2026-06-10 : ajout du rôle 'menage' (dame de ménage terrain) — elle
// peut démarrer/soumettre ses ménages, cocher la checklist, upload preuves,
// signaler des incidents. Toutes les actions "field" (FIELD_OR_OFFICE)
// vérifient en plus côté code que assigned_to_id = user.id pour le rôle menage.
const FIELD_OR_OFFICE: Role[] = ['ceo', 'assistante', 'propria', 'menage'];

// ─── Helper d'historique (interne au module ménage) ─────────────────────
type CleaningAction =
  | 'created' | 'edited' | 'status_changed' | 'assigned' | 'unassigned'
  | 'submitted' | 'validated' | 'refused' | 'cancelled' | 'reopened';

async function logCleaningActivity(opts: {
  supabase: ReturnType<typeof createClient>;
  cleaningId: string;
  actorId: string | null;
  action: CleaningAction;
  payload?: any;
}) {
  try {
    await opts.supabase.from('propria_cleaning_activity').insert({
      cleaning_id: opts.cleaningId,
      actor_id: opts.actorId,
      action: opts.action,
      payload: opts.payload ?? null,
    } as any);
  } catch (e: any) {
    console.warn('[cleaning-activity] log failed', e?.message ?? e);
  }
}

const TRACKED_EDIT_FIELDS = [
  'cleaning_type_id','description','urgency','due_date','occurred_at',
  'property_id','propria_unit_id','assigned_to_id','responsable_id','observations',
] as const;

function diffCleaningFields(before: any, after: any) {
  const diff: Record<string, { before: any; after: any }> = {};
  for (const f of TRACKED_EDIT_FIELDS) {
    const b = before?.[f] == null || before?.[f] === '' ? null : before[f];
    const a = after?.[f] == null || after?.[f] === '' ? null : after[f];
    const same = (typeof b === 'number' || typeof a === 'number')
      ? Number(b ?? 0) === Number(a ?? 0)
      : String(b ?? '') === String(a ?? '');
    if (!same) diff[f] = { before: b, after: a };
  }
  return diff;
}

function revalidateCleaning(id: string) {
  revalidatePath(`/propria/menage/${id}`);
  revalidatePath('/propria/menage');
  revalidatePath('/propria');
}

// ─── Schéma de création/édition ─────────────────────────────────────────
const cleaningSchema = z.object({
  scope: z.preprocess(
    (v) => (v == null ? '' : v),
    z.string().min(1, 'Sélectionnez un lot ou le bien entier'),
  ),
  cleaning_type_id: optionalUuid,
  description: z.string().optional().nullable(),
  occurred_at: z.string(),
  due_date: z.string().optional().nullable(),
  urgency: z.enum(['critique','haute','normale','basse']).default('normale'),
  responsable_id: optionalUuid,
  assigned_to_id: optionalUuid,
  observations: z.string().optional().nullable(),
});

function clean(raw: Record<string, FormDataEntryValue>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v === '' || v == null) out[k] = null;
    else out[k] = v;
  }
  return out;
}

// ─── Créer un ménage ────────────────────────────────────────────────────
export async function createCleaningAction(
  formData: FormData,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let newId: string;
  try {
    const user = await assertRole(['ceo','assistante','propria']);
    const supabase = createClient();
    const parsed = cleaningSchema.parse(clean(Object.fromEntries(formData)));
    const { scope, ...rest } = parsed;
    const scopeCols = parseScope(scope);

    const { data: row, error } = await supabase
      .from('propria_cleanings')
      .insert({ ...rest, ...scopeCols, created_by: user.id, status: 'a_traiter' } as any)
      .select('id')
      .single();
    if (error) throw new Error(`Création ménage : ${error.message}`);

    await logCleaningActivity({
      supabase, cleaningId: row.id, actorId: user.id, action: 'created',
      payload: { urgency: rest.urgency, cleaning_type_id: rest.cleaning_type_id ?? null },
    });

    revalidatePath('/propria/menage');
    newId = row.id;
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
  // redirect() hors du try : il throw NEXT_REDIRECT qui ne doit JAMAIS être catché.
  redirect(`/propria/menage/${newId}`);
}

// ─── Mettre à jour un ménage (ouvert à tout staff, historique tracé) ────
export async function updateCleaningAction(
  id: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const parsed = cleaningSchema.parse(clean(Object.fromEntries(formData)));
    const { scope, ...rest } = parsed;
    const scopeCols = parseScope(scope);
    const supabase = createClient();

    const beforeSelect = ['id', ...TRACKED_EDIT_FIELDS].join(', ');
    const { data: before } = await supabase
      .from('propria_cleanings').select(beforeSelect).eq('id', id).single();
    if (!before) throw new Error('Ménage introuvable');

    const { error } = await supabase
      .from('propria_cleanings')
      .update({ ...rest, ...scopeCols } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);

    const after = { ...(before as any), ...rest, ...scopeCols };
    const diff = diffCleaningFields(before, after);
    if (Object.keys(diff).length > 0) {
      await logCleaningActivity({
        supabase, cleaningId: id, actorId: user.id, action: 'edited',
        payload: { diff },
      });
    }
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Soft-delete (back office uniquement) ───────────────────────────────
export async function deleteCleaningAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_cleanings')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/menage');
    revalidatePath('/propria');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Workflow ───────────────────────────────────────────────────────────

/** a_traiter|refusee → en_cours (la dame de ménage démarre).
 *  Remplit started_at uniquement si pas déjà rempli (ré-démarrage d'un refusé
 *  conserve le 1er started_at original — la durée totale est plus parlante). */
export async function startCleaningAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const supabase = createClient();
    const { data: before } = await supabase
      .from('propria_cleanings').select('status, started_at').eq('id', id).single();
    const update: any = { status: 'en_cours' };
    if (!(before as any)?.started_at) {
      update.started_at = new Date().toISOString();
    }
    const { error } = await supabase
      .from('propria_cleanings').update(update).eq('id', id);
    if (error) throw new Error(`Démarrage : ${error.message}`);
    await logCleaningActivity({
      supabase, cleaningId: id, actorId: user.id, action: 'status_changed',
      payload: { from: (before as any)?.status ?? null, to: 'en_cours' },
    });
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** → a_valider. Bloqué tant qu'aucune preuve n'a été déposée. */
export async function submitCleaningForValidationAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const supabase = createClient();
    const { count } = await supabase
      .from('propria_cleaning_proofs')
      .select('id', { count: 'exact', head: true })
      .eq('cleaning_id', id).is('deleted_at', null);
    if (!count || count < 1) {
      throw new Error('Déposez au moins une preuve (photo ou vidéo) avant de soumettre pour validation.');
    }
    const { error } = await supabase
      .from('propria_cleanings')
      .update({ status: 'a_valider', submitted_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);
    await logCleaningActivity({
      supabase, cleaningId: id, actorId: user.id, action: 'submitted', payload: null,
    });
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** a_valider → cloture (back office uniquement). */
export async function validateCleaningAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_cleanings')
      .update({
        status: 'cloture',
        validated_by: user.id,
        validated_at: new Date().toISOString(),
        closed_at: new Date().toISOString(),
        refusal_reason: null,
      } as any)
      .eq('id', id).eq('status', 'a_valider');
    if (error) throw new Error(error.message);
    await logCleaningActivity({
      supabase, cleaningId: id, actorId: user.id, action: 'validated', payload: null,
    });
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** a_valider → refusee avec motif (back office uniquement). */
export async function refuseCleaningAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const cleanReason = (reason ?? '').trim();
    if (cleanReason.length < 3) throw new Error('Indiquez un motif de refus (≥ 3 caractères).');
    const supabase = createClient();
    const { data: cur } = await supabase
      .from('propria_cleanings').select('refused_count').eq('id', id).single();
    const { error } = await supabase
      .from('propria_cleanings')
      .update({
        status: 'refusee',
        refusal_reason: cleanReason,
        refused_at: new Date().toISOString(),
        refused_count: ((cur as any)?.refused_count ?? 0) + 1,
        submitted_at: null,
        validated_by: null,
        validated_at: null,
      } as any)
      .eq('id', id).eq('status', 'a_valider');
    if (error) throw new Error(error.message);
    await logCleaningActivity({
      supabase, cleaningId: id, actorId: user.id, action: 'refused',
      payload: { reason: cleanReason },
    });
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Annuler (back office). */
export async function cancelCleaningAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_cleanings')
      .update({ status: 'annule', closed_at: new Date().toISOString() } as any)
      .eq('id', id);
    if (error) throw new Error(error.message);
    await logCleaningActivity({
      supabase, cleaningId: id, actorId: user.id, action: 'cancelled', payload: null,
    });
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Réouvrir (back office). */
export async function reopenCleaningAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_cleanings')
      .update({
        status: 'en_cours', validated_by: null, validated_at: null, closed_at: null,
      } as any).eq('id', id);
    if (error) throw new Error(error.message);
    await logCleaningActivity({
      supabase, cleaningId: id, actorId: user.id, action: 'reopened', payload: null,
    });
    revalidateCleaning(id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Bulk-assign ───────────────────────────────────────────────────────
const bulkAssignSchema = z.object({
  cleaning_ids: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un ménage'),
  assigned_to_id: z.string().uuid('Choisissez un collaborateur'),
});

export async function bulkAssignCleaningsAction(
  input: unknown,
): Promise<{ ok: true; updatedCount: number } | { ok: false; error: string }> {
  try {
    const user = await assertRole(['ceo','assistante','propria','developer']);
    const parsed = bulkAssignSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { cleaning_ids, assigned_to_id } = parsed.data;
    const supabase = createClient();

    // Snapshot des IDs encore non assignés (anti-concurrence)
    const { data: stillUnassigned } = await supabase
      .from('propria_cleanings')
      .select('id')
      .in('id', cleaning_ids)
      .is('assigned_to_id', null)
      .is('deleted_at', null);
    const toUpdateIds = (stillUnassigned ?? []).map((r: any) => r.id);

    const { error, count } = await supabase
      .from('propria_cleanings')
      .update({ assigned_to_id } as any, { count: 'exact' })
      .in('id', cleaning_ids)
      .is('assigned_to_id', null)
      .is('deleted_at', null);
    if (error) return { ok: false, error: error.message };

    const { data: assignee } = await supabase
      .from('profiles').select('id, full_name').eq('id', assigned_to_id).single();

    await Promise.all(toUpdateIds.map((cleaningId) =>
      logCleaningActivity({
        supabase, cleaningId, actorId: user.id, action: 'assigned',
        payload: {
          assigned_to_id,
          assigned_to_name: (assignee as any)?.full_name ?? null,
          via: 'bulk',
        },
      }),
    ));

    revalidatePath('/propria/menage');
    revalidatePath('/propria');
    return { ok: true, updatedCount: count ?? 0 };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Preuves photo/vidéo ────────────────────────────────────────────────
// On réutilise le bucket existant `intervention-proofs` avec un préfixe
// `cleanings/<id>/...` pour ne pas créer un nouveau bucket inutilement.

const PROOFS_BUCKET = 'intervention-proofs';

export async function createCleaningProofUploadUrl(args: {
  cleaningId: string;
  filename: string;
  contentType: string;
}): Promise<
  | { ok: true; path: string; token: string; signedUrl: string | null; uploadedById: string }
  | { ok: false; error: string }
> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const admin = createAdminClient();
    const ext = (args.filename.split('.').pop() ?? 'bin').toLowerCase();
    const safeExt = ext.replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `cleanings/${args.cleaningId}/${crypto.randomUUID()}.${safeExt}`;
    const { data, error } = await admin.storage.from(PROOFS_BUCKET)
      .createSignedUploadUrl(path);
    if (error) return { ok: false, error: error.message };
    return {
      ok: true,
      path,
      token: (data as any).token,
      signedUrl: (data as any).signedUrl ?? null,
      uploadedById: user.id,
    };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function recordCleaningProofAction(args: {
  cleaningId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  /** general | checklist | equipment | incident */
  section?: 'general' | 'checklist' | 'equipment' | 'incident';
  /** Clé d'item de checklist (si section=checklist ou equipment) */
  checklistItemKey?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(FIELD_OR_OFFICE);
    const supabase = createClient();
    const { error } = await supabase.from('propria_cleaning_proofs').insert({
      cleaning_id: args.cleaningId,
      storage_path: args.storagePath,
      mime_type: args.mimeType,
      size_bytes: args.sizeBytes,
      uploaded_by: user.id,
      section: args.section ?? 'general',
      checklist_item_key: args.checklistItemKey ?? null,
    } as any);
    if (error) return { ok: false, error: error.message };
    revalidateCleaning(args.cleaningId);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function getCleaningProofUrls(cleaningId: string) {
  // CEO 2026-06-22 : 'menage' AJOUTÉ à la whitelist — sans ça la dame de ménage
  // qui ouvre son ménage assigné voyait un crash Server Component (digest
  // 2103554597). Garde supplémentaire ci-dessous : si role=menage, on vérifie
  // qu'elle est bien l'assignée de CE ménage avant de servir les URLs photos
  // (sinon une dame qui devine un UUID verrait les photos d'autres ménages).
  // CEO 2026-06-23 : try/catch défensif — en cas de session expirée on retourne
  // [] au lieu de crasher le Server Component qui consomme cette fonction.
  try {
    const user = await assertRole(['ceo','developer','assistante','propria','menage']);
    const admin = createAdminClient();
    if (user.role === 'menage') {
      const { data: cleaning } = await admin
        .from('propria_cleanings')
        .select('id, assigned_to_id')
        .eq('id', cleaningId)
        .is('deleted_at', null)
        .maybeSingle();
      if (!cleaning || (cleaning as any).assigned_to_id !== user.id) {
        return [] as Array<any>;
      }
    }
    const { data: proofs } = await admin
      .from('propria_cleaning_proofs')
      .select('id, storage_path, mime_type, uploaded_by, created_at, section, checklist_item_key')
      .eq('cleaning_id', cleaningId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    const withUrls = await Promise.all(((proofs ?? []) as any[]).map(async (p) => {
      const { data: signed } = await admin.storage.from(PROOFS_BUCKET)
        .createSignedUrl(p.storage_path, 60 * 60); // 1h
      return {
        id: p.id,
        storagePath: p.storage_path,
        mimeType: p.mime_type,
        uploadedById: p.uploaded_by,
        createdAt: p.created_at,
        signedUrl: signed?.signedUrl ?? null,
        section: (p.section ?? 'general') as 'general' | 'checklist' | 'equipment' | 'incident',
        checklistItemKey: p.checklist_item_key as string | null,
      };
    }));
    return withUrls;
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return [] as Array<any>;
  }
}

export async function deleteCleaningProofAction(
  proofId: string,
  cleaningId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase
      .from('propria_cleaning_proofs')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', proofId);
    if (error) return { ok: false, error: error.message };
    revalidateCleaning(cleaningId);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Incidents ménage (canapé sale, télé cassée, dégradation…) ─────────
//
// Workflow simple en 3 statuts : reported → acknowledged → resolved.
// Tout incident reporté envoie une alerte mail au CEO + assistante.
// Les preuves photo/vidéo de l'incident vivent dans propria_cleaning_proofs
// avec section='incident' et un éventuel checklist_item_key='incident:<id>'.

const incidentSchema = z.object({
  cleaning_id: z.string().uuid(),
  description: z.string().min(3, 'Décrivez l’incident'),
  severity: z.enum(['critique','haute','normale','basse']).default('normale'),
  // Chantier 8 marathon (U8) : pas de signalement sans preuve. Les fichiers
  // sont uploadés AVANT via createCleaningProofUploadUrl, puis liés ici.
  proofs: z.array(z.object({
    storage_path: z.string().min(1),
    mime_type: z.string().min(1),
    size_bytes: z.number().int().nonnegative(),
  })).min(1, 'Au moins une photo est obligatoire pour signaler un incident.'),
});

export async function reportCleaningIncidentAction(
  input: unknown,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
 try {
  const user = await assertRole(FIELD_OR_OFFICE);
  const parsed = incidentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: row, error } = await supabase.from('propria_cleaning_incidents').insert({
    cleaning_id: parsed.data.cleaning_id,
    description: parsed.data.description,
    severity: parsed.data.severity,
    status: 'reported',
    reported_by: user.id,
  } as any).select('id').single();
  if (error) return { ok: false as const, error: error.message };

  // Lie les preuves (déjà uploadées dans le bucket) à l'incident.
  // Si AUCUNE preuve ne peut être enregistrée, on annule le signalement
  // (soft-delete) — un incident sans preuve n'a pas le droit d'exister.
  const proofRows = parsed.data.proofs.map((p) => ({
    cleaning_id: parsed.data.cleaning_id,
    storage_path: p.storage_path,
    mime_type: p.mime_type,
    size_bytes: p.size_bytes,
    uploaded_by: user.id,
    section: 'incident',
    checklist_item_key: `incident:${row.id}`,
  }));
  const { error: proofErr } = await supabase
    .from('propria_cleaning_proofs')
    .insert(proofRows as any);
  if (proofErr) {
    await supabase.from('propria_cleaning_incidents')
      .update({ deleted_at: new Date().toISOString() } as any)
      .eq('id', row.id);
    return { ok: false as const, error: `Enregistrement des photos impossible : ${proofErr.message}` };
  }

  // Email d'alerte aux back-office (CEO + assistante) — best effort
  try {
    const admin = createAdminClient();
    const { data: clean } = await admin
      .from('propria_cleanings')
      .select('id, property_id, propria_unit_id, description')
      .eq('id', parsed.data.cleaning_id).single();

    const { data: reviewers } = await admin
      .from('profiles')
      .select('email, full_name')
      .in('role', ['ceo','assistante'])
      .eq('is_active', true);

    // Récupère le contexte bien/suite pour le mail
    let scopeLabel = '—';
    if ((clean as any)?.propria_unit_id) {
      const { data: u } = await admin
        .from('propria_units')
        .select('code, property:properties(propria_internal_code, name)')
        .eq('id', (clean as any).propria_unit_id).single();
      const p = (u as any)?.property;
      scopeLabel = `${p?.propria_internal_code ?? p?.name ?? 'Bien'} · ${(u as any)?.code ?? ''}`;
    } else if ((clean as any)?.property_id) {
      const { data: p } = await admin
        .from('properties').select('propria_internal_code, name')
        .eq('id', (clean as any).property_id).single();
      scopeLabel = `${(p as any)?.propria_internal_code ?? (p as any)?.name ?? 'Bien'} · Bien entier`;
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const incidentUrl = `${appUrl}/propria/menage/${parsed.data.cleaning_id}#incidents`;
    const sev = parsed.data.severity;
    const sevIcon = sev === 'critique' ? '🔴' : sev === 'haute' ? '🟠' : sev === 'normale' ? '🟡' : '🟢';

    for (const r of (reviewers ?? []) as any[]) {
      try {
        await sendEmail({
          to: r.email,
          template_id: 'cleaning_incident_reported',
          subject: `${sevIcon} Incident ménage signalé · ${scopeLabel}`,
          html: `
            <p>Bonjour ${escapeHtml(r.full_name ?? '')},</p>
            <p><strong>${escapeHtml(user.full_name ?? 'Une dame de ménage')}</strong> vient de signaler un incident
            sur le ménage de <strong>${escapeHtml(scopeLabel)}</strong>.</p>
            <p><strong>Gravité :</strong> ${sevIcon} ${sev}</p>
            <p><strong>Description :</strong></p>
            <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#444">${escapeHtml(parsed.data.description)}</blockquote>
            <p><a href="${incidentUrl}">Voir l'incident et les photos →</a></p>
          `.trim(),
          payload: { cleaning_id: parsed.data.cleaning_id, incident_id: row.id, severity: sev },
          idempotency_key: `cleaning_incident_${row.id}_${r.email}`,
        });
      } catch (e: any) {
        console.warn('[incident-mail] echec', r.email, e?.message);
      }
    }
  } catch (e: any) {
    console.warn('[incident-notify] exception', e?.message);
  }

  revalidateCleaning(parsed.data.cleaning_id);
  revalidatePath('/propria');
  return { ok: true as const, id: row.id };
 } catch (e) {
  if (isNextRedirect(e)) throw e;
  return { ok: false, error: errorMessage(e) };
 }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  } as any)[c]);
}

export async function acknowledgeCleaningIncidentAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { data: cur } = await supabase.from('propria_cleaning_incidents')
      .select('cleaning_id').eq('id', id).single();
    const { error } = await supabase.from('propria_cleaning_incidents').update({
      status: 'acknowledged',
      acknowledged_by: user.id,
      acknowledged_at: new Date().toISOString(),
    } as any).eq('id', id);
    if (error) return { ok: false, error: error.message };
    if (cur) revalidateCleaning((cur as any).cleaning_id);
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Décliner un incident (jugé non recevable). Requiert un motif. */
export async function declineCleaningIncidentAction(
  id: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const cleanReason = (reason ?? '').trim();
    if (cleanReason.length < 3) throw new Error('Indique un motif de déclin (≥ 3 caractères).');
    const supabase = createClient();
    const { data: cur } = await supabase.from('propria_cleaning_incidents')
      .select('cleaning_id, status').eq('id', id).single();
    if (!cur) throw new Error('Incident introuvable');
    if ((cur as any).status === 'resolved' || (cur as any).status === 'declined') {
      throw new Error('Cet incident est déjà clos.');
    }
    const { error } = await supabase.from('propria_cleaning_incidents').update({
      status: 'declined',
      declined_at: new Date().toISOString(),
      declined_by: user.id,
      decline_reason: cleanReason,
      acknowledged_by: user.id,
      acknowledged_at: new Date().toISOString(),
    } as any).eq('id', id);
    if (error) return { ok: false, error: error.message };
    revalidateCleaning((cur as any).cleaning_id);
    revalidatePath('/propria/menage/incidents');
    revalidatePath('/propria');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

/** Transformer un incident en intervention/tâche : crée l'entrée propria_interventions
 *  (scope hérité du ménage source), lie les 2 entités, résout l'incident. */
const transformSchema = z.object({
  incident_id: z.string().uuid(),
  kind: z.enum(['intervention', 'tache']),
  description: z.string().min(2),
  urgency: z.enum(['critique','haute','normale','basse']),
  assigned_to_id: optionalUuid,
});

export async function transformIncidentToInterventionAction(
  input: unknown,
): Promise<{ ok: true; interventionId: string } | { ok: false; error: string }> {
 try {
  const user = await assertRole(BACK_OFFICE);
  const parsed = transformSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { incident_id, kind, description, urgency, assigned_to_id } = parsed.data;

  const supabase = createClient();
  // 1) Charge l'incident + son ménage source pour hériter du scope
  const { data: incident } = await supabase
    .from('propria_cleaning_incidents')
    .select('id, cleaning_id, status, linked_intervention_id')
    .eq('id', incident_id).single();
  if (!incident) return { ok: false as const, error: 'Incident introuvable.' };
  if ((incident as any).status === 'resolved' || (incident as any).status === 'declined') {
    return { ok: false as const, error: 'Cet incident est déjà clos.' };
  }
  if ((incident as any).linked_intervention_id) {
    return { ok: false as const, error: 'Cet incident est déjà lié à une intervention.' };
  }

  const { data: clean } = await supabase
    .from('propria_cleanings')
    .select('id, property_id, propria_unit_id')
    .eq('id', (incident as any).cleaning_id).single();
  if (!clean) return { ok: false as const, error: 'Ménage source introuvable.' };

  // 2) Crée l'intervention avec scope hérité + lien vers l'incident
  const { data: newInt, error: insErr } = await supabase
    .from('propria_interventions')
    .insert({
      property_id: (clean as any).property_id,
      propria_unit_id: (clean as any).propria_unit_id,
      kind,
      description,
      urgency,
      status: 'a_traiter',
      occurred_at: new Date().toISOString().slice(0, 10),
      assigned_to_id: assigned_to_id ?? null,
      created_by: user.id,
      source_cleaning_incident_id: incident_id,
      hostaway_integrated: false,
    } as any)
    .select('id')
    .single();
  if (insErr) return { ok: false as const, error: `Création intervention : ${insErr.message}` };

  // 3) Marque l'incident comme résolu + le lie à l'intervention
  const resolutionNote = `Transformé en ${kind === 'tache' ? 'tâche' : 'intervention'} → /propria/interventions/${newInt.id}`;
  const { error: updErr } = await supabase
    .from('propria_cleaning_incidents')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      acknowledged_by: user.id,
      acknowledged_at: new Date().toISOString(),
      resolution_notes: resolutionNote,
      linked_intervention_id: newInt.id,
    } as any)
    .eq('id', incident_id);
  if (updErr) return { ok: false as const, error: `Update incident : ${updErr.message}` };

  revalidateCleaning((incident as any).cleaning_id);
  revalidatePath('/propria/menage/incidents');
  revalidatePath('/propria/interventions');
  revalidatePath('/propria');
  return { ok: true as const, interventionId: newInt.id };
 } catch (e) {
  if (isNextRedirect(e)) throw e;
  return { ok: false, error: errorMessage(e) };
 }
}

/** Chantier 8 marathon (U8) — Transformation MULTI-CIBLE d'un incident.
 *  Un incident peut générer simultanément : une tâche, une intervention et/ou
 *  un litige (ex : TV cassée → tâche d'achat + intervention installation +
 *  litige AirCover). Chaque objet créé pointe vers l'incident source
 *  (source_cleaning_incident_id). L'incident est résolu avec une note listant
 *  tout ce qui a été créé. Le litige n'est possible que si le ménage source
 *  est lié à une réservation Hostaway (décision M5). */
const transformTargetSchema = z.object({
  description: z.string().min(2),
  urgency: z.enum(['critique','haute','normale','basse']),
  assigned_to_id: optionalUuid,
});
const transformMultiSchema = z.object({
  incident_id: z.string().uuid(),
  tache: transformTargetSchema.optional(),
  intervention: transformTargetSchema.optional(),
  litige: z.object({
    type: z.enum(['caution','degats','frais_contestes','annulation_tardive','tapage','menage','autre']),
    description: z.string().min(2),
    amount: z.coerce.number().positive().optional().nullable(),
  }).optional(),
}).refine((v) => v.tache || v.intervention || v.litige, {
  message: 'Choisis au moins une action (tâche, intervention ou litige).',
});

export async function transformIncidentMultiAction(
  input: unknown,
): Promise<
  | { ok: true; created: string[]; firstInterventionId: string | null }
  | { ok: false; error: string }
> {
 try {
  const user = await assertRole(BACK_OFFICE);
  const parsed = transformMultiSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { incident_id, tache, intervention, litige } = parsed.data;

  const supabase = createClient();
  const { data: incident } = await supabase
    .from('propria_cleaning_incidents')
    .select('id, cleaning_id, status')
    .eq('id', incident_id).single();
  if (!incident) return { ok: false as const, error: 'Incident introuvable.' };
  if ((incident as any).status === 'resolved' || (incident as any).status === 'declined') {
    return { ok: false as const, error: 'Cet incident est déjà clos.' };
  }

  const { data: clean } = await supabase
    .from('propria_cleanings')
    .select('id, property_id, propria_unit_id, hostaway_reservation_id')
    .eq('id', (incident as any).cleaning_id).single();
  if (!clean) return { ok: false as const, error: 'Ménage source introuvable.' };

  // Garde-fou litige AVANT toute écriture : pas de résa → pas de litige.
  if (litige && !(clean as any).hostaway_reservation_id) {
    return {
      ok: false as const,
      error: 'Ce ménage n’est lié à aucune réservation Hostaway — le litige doit être créé manuellement depuis la page Litiges.',
    };
  }

  const created: string[] = [];
  let firstInterventionId: string | null = null;

  // 1) Tâche et/ou intervention (même table, kind différent)
  for (const [kind, target] of [['tache', tache], ['intervention', intervention]] as const) {
    if (!target) continue;
    const { data: newInt, error: insErr } = await supabase
      .from('propria_interventions')
      .insert({
        property_id: (clean as any).property_id,
        propria_unit_id: (clean as any).propria_unit_id,
        kind,
        description: target.description,
        urgency: target.urgency,
        status: 'a_traiter',
        occurred_at: new Date().toISOString().slice(0, 10),
        assigned_to_id: target.assigned_to_id ?? null,
        created_by: user.id,
        source_cleaning_incident_id: incident_id,
        hostaway_integrated: false,
      } as any)
      .select('id').single();
    if (insErr) return { ok: false as const, error: `Création ${kind} : ${insErr.message}` };
    if (!firstInterventionId) firstInterventionId = newInt.id;
    created.push(`${kind === 'tache' ? 'tâche' : 'intervention'} → /propria/interventions/${newInt.id}`);
  }

  // 2) Litige (résa garantie par le garde-fou ci-dessus)
  if (litige) {
    const resaId = (clean as any).hostaway_reservation_id as number;
    const { data: resa } = await supabase
      .from('hostaway_reservations')
      .select('hostaway_listing_db_id')
      .eq('hostaway_id', resaId).single();
    const { data: newLitige, error: litErr } = await supabase
      .from('propria_litiges')
      .insert({
        hostaway_reservation_id: resaId,
        hostaway_listing_db_id: (resa as any)?.hostaway_listing_db_id ?? null,
        propria_unit_id: (clean as any).propria_unit_id ?? null,
        type: litige.type,
        description: litige.description,
        // amount DÉPRÉCIÉ (chantier 6, décision B4) — le montant devient une ligne item.
        currency: 'MAD',
        created_by: user.id,
        source_cleaning_incident_id: incident_id,
      } as any)
      .select('id').single();
    if (litErr) return { ok: false as const, error: `Création litige : ${litErr.message}` };
    if (litige.amount != null && litige.amount > 0) {
      await supabase.from('propria_litige_items').insert({
        litige_id: newLitige.id,
        description: litige.description,
        amount_claimed_mad: litige.amount,
        created_by: user.id,
      } as any);
    }
    created.push(`litige → /propria/litiges#${newLitige.id}`);
  }

  // 3) Résout l'incident avec la liste de tout ce qui a été créé
  const resolutionNote = `Transformé en : ${created.join(' · ')}`;
  const { error: updErr } = await supabase
    .from('propria_cleaning_incidents')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      acknowledged_by: user.id,
      acknowledged_at: new Date().toISOString(),
      resolution_notes: resolutionNote,
      linked_intervention_id: firstInterventionId, // rétro-compat affichages existants
    } as any)
    .eq('id', incident_id);
  if (updErr) return { ok: false as const, error: `Update incident : ${updErr.message}` };

  revalidateCleaning((incident as any).cleaning_id);
  revalidatePath('/propria/menage/incidents');
  revalidatePath('/propria/interventions');
  revalidatePath('/propria/litiges');
  revalidatePath('/propria');
  return { ok: true as const, created, firstInterventionId };
 } catch (e) {
  if (isNextRedirect(e)) throw e;
  return { ok: false, error: errorMessage(e) };
 }
}

export async function resolveCleaningIncidentAction(
  id: string,
  notes: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const user = await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { data: cur } = await supabase.from('propria_cleaning_incidents')
      .select('cleaning_id').eq('id', id).single();
    const { error } = await supabase.from('propria_cleaning_incidents').update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolution_notes: notes ?? null,
      acknowledged_by: user.id,
      acknowledged_at: new Date().toISOString(),
    } as any).eq('id', id);
    if (error) return { ok: false, error: error.message };
    if (cur) revalidateCleaning((cur as any).cleaning_id);
    revalidatePath('/propria/menage/incidents');
    revalidatePath('/propria');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── Settings : gestion des types de ménage ─────────────────────────────
// NOTE 2026-06-23 : createCleaningTypeAction est passée directement à
// <form action={...}> côté HTML natif — sa signature doit rester
// `(FormData) => Promise<void>` pour satisfaire les types React. On garde
// donc le try/catch défensif mais on re-throw l'erreur (Next.js l'affichera
// via error.tsx). Les 2 autres types-actions sont en {ok|error} car appelées
// dans des Server Action wrappers inline.
export async function createCleaningTypeAction(formData: FormData): Promise<void> {
  try {
    await assertRole(BACK_OFFICE);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) throw new Error('Nom requis.');
    const supabase = createClient();
    const { error } = await supabase.from('propria_cleaning_types').insert({
      name,
      display_order: Number(formData.get('display_order') ?? 99),
      is_active: true,
    } as any);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/menage/parametres');
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    throw e;
  }
}

export async function updateCleaningTypeAction(
  id: string,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(BACK_OFFICE);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) throw new Error('Nom requis.');
    const supabase = createClient();
    const { error } = await supabase.from('propria_cleaning_types').update({
      name,
      display_order: Number(formData.get('display_order') ?? 99),
    } as any).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/menage/parametres');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

export async function toggleCleaningTypeActiveAction(
  id: string,
  isActive: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await assertRole(BACK_OFFICE);
    const supabase = createClient();
    const { error } = await supabase.from('propria_cleaning_types')
      .update({ is_active: isActive } as any).eq('id', id);
    if (error) throw new Error(error.message);
    revalidatePath('/propria/menage/parametres');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
