'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole, type Role } from '@/lib/auth/require';
import { logPropriaAudit } from '@/lib/propria/audit';
import { notifyUsers } from '@/lib/propria/notify';
import { getCeoRecipients } from '@/lib/notifications/recipients';
import { sendEmail } from '@/lib/email/send';
import {
  POLICE_RECORDS_TABLE,
  computeMissingFields,
  computeNextStatus,
  normalizeAccompanyingPersons,
  pullDataFromHostawayReservation,
  pullDataFromDirectReservation,
  pullDataFromCashReservation,
  type PoliceRecord,
  type PoliceRecordReservationSource,
} from '@/lib/propria/police-records';
// Helpers livrés par l'agent B (PDF + XLSX).
// Si tsc échoue à l'instant T avant la livraison de B, c'est attendu : ces
// imports sont la source unique de génération de fichiers.
import { renderFichePolicePdf } from '@/lib/propria/police-records-pdf';
import { renderRecapWeeklyXlsx } from '@/lib/propria/police-records-xlsx';

// ============================================================================
// Module "Fiches de police voyageurs" Propria — chantier C (UI + actions).
// Décisions CEO 2026-06-19 :
//   - Périmètre tous voyageurs.
//   - Source data : Hostaway + saisie manuelle + WhatsApp.
//   - 1 fiche par famille, accompagnants en JSONB.
//   - Soumission = impression + dépôt commissariat (workflow status submitted).
//   - Stockage indéfini, soft-delete CEO uniquement.
//   - Accès écriture : ceo + propria + assistante. developer = lecture seule.
// ============================================================================

const WRITE_ROLES: Role[] = ['ceo', 'propria', 'assistante'];
const READ_ROLES: Role[] = ['ceo', 'propria', 'assistante', 'developer'];

function revalidateAll(id?: string) {
  revalidatePath('/propria/fiches-police');
  revalidatePath('/propria');
  if (id) revalidatePath(`/propria/fiches-police/${id}`);
}

// ─── Schémas ─────────────────────────────────────────────────────────────

const accompanyingPersonSchema = z.object({
  last_name: z.string().trim().default(''),
  first_name: z.string().trim().default(''),
  birth_date: z.string().trim().optional().nullable(),
  nationality: z.string().trim().optional().nullable(),
  id_type: z.enum(['cin', 'passport', 'other']).optional().nullable(),
  id_number: z.string().trim().optional().nullable(),
  relation: z.string().trim().optional().nullable(),
});

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date invalide (YYYY-MM-DD)');

const policeRecordFieldsSchema = z.object({
  // Lien réservation polymorphe (optionnel à l'édition manuelle)
  reservation_source: z.enum(['hostaway', 'direct', 'cash']).optional().nullable(),
  reservation_source_id: z.string().uuid().optional().nullable(),

  property_id: z.string().uuid().optional().nullable(),
  propria_unit_id: z.string().uuid().optional().nullable(),

  // Chef de famille
  head_last_name: z.string().trim().optional().nullable(),
  head_first_name: z.string().trim().optional().nullable(),
  head_gender: z.enum(['M', 'F', 'autre']).optional().nullable(),
  head_birth_date: z.union([isoDate, z.literal('')]).optional().nullable(),
  head_birth_place: z.string().trim().optional().nullable(),
  head_nationality: z.string().trim().optional().nullable(),
  head_profession: z.string().trim().optional().nullable(),
  head_id_type: z.enum(['cin', 'passport', 'other']).optional().nullable(),
  head_id_number: z.string().trim().optional().nullable(),
  head_id_issue_date: z.union([isoDate, z.literal('')]).optional().nullable(),
  head_id_expiry_date: z.union([isoDate, z.literal('')]).optional().nullable(),
  head_id_issue_country: z.string().trim().optional().nullable(),
  head_residence_country: z.string().trim().optional().nullable(),
  head_residence_address: z.string().trim().optional().nullable(),

  // Séjour
  arrival_date_morocco: z.union([isoDate, z.literal('')]).optional().nullable(),
  arrival_date_property: z.union([isoDate, z.literal('')]).optional().nullable(),
  expected_departure_date: z.union([isoDate, z.literal('')]).optional().nullable(),
  motif_sejour: z.enum(['tourisme', 'affaires', 'famille', 'transit', 'autre']).optional().nullable(),

  // Accompagnants
  accompanying_persons: z.array(accompanyingPersonSchema).optional().nullable(),

  // Workflow & meta
  data_source: z.enum(['hostaway_portal', 'manual_checkin', 'whatsapp', 'unknown']).optional().nullable(),
  notes: z.string().trim().optional().nullable(),
});

type PoliceRecordInputFields = z.infer<typeof policeRecordFieldsSchema>;

/** Normalise les valeurs pour BDD : '' → null, undefined → undefined (pas écrit). */
function sanitizeForDb(fields: PoliceRecordInputFields): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (v === '') {
      out[k] = null;
      continue;
    }
    if (k === 'accompanying_persons') {
      out[k] = normalizeAccompanyingPersons(v ?? []);
      continue;
    }
    out[k] = v;
  }
  return out;
}

// ─── Création ────────────────────────────────────────────────────────────

const createInputSchema = policeRecordFieldsSchema.extend({});

export type CreatePoliceRecordInput = z.infer<typeof createInputSchema>;

export async function createPoliceRecordAction(
  input: CreatePoliceRecordInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await assertRole(WRITE_ROLES);
  const parsed = createInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }
  const fields = parsed.data;
  const supabase = createClient();

  // Pré-remplissage depuis la source de réservation si fournie.
  let prefill: Partial<PoliceRecord> = {};
  if (fields.reservation_source && fields.reservation_source_id) {
    try {
      if (fields.reservation_source === 'hostaway') {
        prefill = await pullDataFromHostawayReservation(supabase, fields.reservation_source_id);
      } else if (fields.reservation_source === 'direct') {
        prefill = await pullDataFromDirectReservation(supabase, fields.reservation_source_id);
      } else if (fields.reservation_source === 'cash') {
        prefill = await pullDataFromCashReservation(supabase, fields.reservation_source_id);
      }
    } catch (e: any) {
      console.warn('[police-records] prefill failed:', e?.message ?? e);
    }
  }

  // Merge : la saisie manuelle écrase le prefill (l'utilisateur a la priorité).
  const merged = { ...prefill, ...sanitizeForDb(fields) };

  // Default data_source si absent.
  if (merged.data_source == null) merged.data_source = 'unknown';

  const insertRow = {
    ...merged,
    status: computeNextStatus(merged, 'draft'),
    created_by: user.id,
  };

  const { data: row, error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .insert(insertRow as any)
    .select('id')
    .single();

  if (error) {
    return { ok: false, error: `Création fiche police : ${error.message}` };
  }
  const id = (row as any).id as string;

  await logPropriaAudit({
    supabase: supabase as any,
    table: POLICE_RECORDS_TABLE,
    recordId: id,
    actorId: user.id,
    action: 'create',
    label: 'Création fiche police',
    payload: {
      reservation_source: fields.reservation_source ?? null,
      reservation_source_id: fields.reservation_source_id ?? null,
      data_source: merged.data_source ?? null,
    },
  });

  revalidateAll(id);
  return { ok: true, id };
}

// ─── Mise à jour ─────────────────────────────────────────────────────────

export async function updatePoliceRecordAction(
  id: string,
  fields: PoliceRecordInputFields,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole(WRITE_ROLES);
  if (!id) return { ok: false, error: 'ID manquant.' };

  const parsed = policeRecordFieldsSchema.safeParse(fields);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Données invalides.' };
  }

  const supabase = createClient();

  // Bloque la modif d'une fiche déjà soumise ou archivée (sauf CEO).
  const { data: before } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!before) return { ok: false, error: 'Fiche introuvable.' };
  const status = (before as any).status as string;
  if ((status === 'submitted' || status === 'archived') && user.role !== 'ceo') {
    return { ok: false, error: 'Fiche verrouillée (déposée/archivée). Seul le CEO peut la modifier.' };
  }

  const updates = sanitizeForDb(parsed.data);
  updates['updated_by'] = user.id;
  updates['updated_at'] = new Date().toISOString();

  // Recalcule le statut naturel si non figé (submitted/archived)
  if (status !== 'submitted' && status !== 'archived') {
    const mergedForStatus = { ...before, ...updates };
    updates['status'] = computeNextStatus(mergedForStatus as any, status as any);
  }

  const { error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .update(updates as any)
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await logPropriaAudit({
    supabase: supabase as any,
    table: POLICE_RECORDS_TABLE,
    recordId: id,
    actorId: user.id,
    action: 'update',
    label: 'Mise à jour fiche police',
    payload: { fields_changed: Object.keys(updates) },
  });

  revalidateAll(id);
  return { ok: true };
}

// ─── Workflow : marquer complète ─────────────────────────────────────────

export async function markRecordCompleteAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole(WRITE_ROLES);
  const supabase = createClient();

  const { data: record } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!record) return { ok: false, error: 'Fiche introuvable.' };
  if ((record as any).status !== 'draft' && (record as any).status !== 'complete') {
    return { ok: false, error: 'Cette fiche n\'est pas en brouillon.' };
  }

  const missing = computeMissingFields(record as Partial<PoliceRecord>);
  if (missing.length > 0) {
    return { ok: false, error: `Champs manquants : ${missing.join(', ')}` };
  }

  const { error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .update({
      status: 'complete',
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await logPropriaAudit({
    supabase: supabase as any,
    table: POLICE_RECORDS_TABLE,
    recordId: id,
    actorId: user.id,
    action: 'status_change',
    label: 'Fiche police marquée complète',
    payload: { from: 'draft', to: 'complete' },
  });

  revalidateAll(id);
  return { ok: true };
}

// ─── Workflow : marquer déposée (commissariat) ───────────────────────────

export async function markRecordSubmittedAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole(WRITE_ROLES);
  const supabase = createClient();

  const { data: record } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('id, status, head_last_name, head_first_name, property_id, propria_unit_id')
    .eq('id', id)
    .maybeSingle();
  if (!record) return { ok: false, error: 'Fiche introuvable.' };
  if ((record as any).status !== 'complete') {
    return { ok: false, error: 'La fiche doit être complète avant le dépôt.' };
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .update({
      status: 'submitted',
      submitted_at: nowIso,
      submitted_by: user.id,
      updated_by: user.id,
      updated_at: nowIso,
    } as any)
    .eq('id', id)
    .eq('status', 'complete');
  if (error) return { ok: false, error: error.message };

  await logPropriaAudit({
    supabase: supabase as any,
    table: POLICE_RECORDS_TABLE,
    recordId: id,
    actorId: user.id,
    action: 'status_change',
    label: 'Fiche police marquée déposée',
    payload: { from: 'complete', to: 'submitted', submitted_at: nowIso },
  });

  // Notifs CEO (in-app + email best-effort).
  try {
    const admin = createAdminClient();
    const propertyLabel = await resolveLabelForRecord(
      admin,
      (record as any).property_id,
      (record as any).propria_unit_id,
    );
    const ref = await computeReferenceNumber(supabase, id);
    const guestName = [
      (record as any).head_first_name ?? '',
      (record as any).head_last_name ?? '',
    ].filter(Boolean).join(' ') || 'voyageur';

    // In-app
    const { data: ceos } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'ceo')
      .eq('is_active', true);
    await notifyUsers({
      supabase,
      actorId: user.id,
      userIds: ((ceos ?? []) as any[]).map((p) => p.id as string),
      kind: 'autre',
      title: `Fiche police ${ref} déposée`,
      body: `${guestName} — ${propertyLabel}`,
      href: `/propria/fiches-police/${id}`,
    });

    // Email best-effort
    const ceoRecipients = await getCeoRecipients(admin);
    for (const r of ceoRecipients) {
      await sendEmail({
        to: r.email,
        template_id: 'fiche_police_submitted',
        subject: `Fiche police ${ref} déposée commissariat`,
        html: `<p>Bonjour ${r.full_name ?? ''},</p>
<p>La fiche police <strong>${ref}</strong> a été marquée comme déposée au commissariat.</p>
<ul>
  <li>Voyageur : ${guestName}</li>
  <li>Bien : ${propertyLabel}</li>
  <li>Déposée par : ${user.full_name ?? user.email}</li>
  <li>Date dépôt : ${new Date(nowIso).toLocaleString('fr-FR')}</li>
</ul>
<p><a href="${process.env.NEXT_PUBLIC_APP_URL ?? ''}/propria/fiches-police/${id}">Voir la fiche</a></p>`,
        idempotency_key: `fiche-police-submitted-${id}-${r.email}`,
      });
    }
  } catch (e: any) {
    console.warn('[police-records] notif submitted failed:', e?.message ?? e);
  }

  revalidateAll(id);
  return { ok: true };
}

// ─── Workflow : archiver (CEO only) ──────────────────────────────────────

export async function markRecordArchivedAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole(['ceo']);
  const supabase = createClient();

  const { data: record } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('status')
    .eq('id', id)
    .maybeSingle();
  if (!record) return { ok: false, error: 'Fiche introuvable.' };

  const { error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .update({
      status: 'archived',
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    } as any)
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await logPropriaAudit({
    supabase: supabase as any,
    table: POLICE_RECORDS_TABLE,
    recordId: id,
    actorId: user.id,
    action: 'status_change',
    label: 'Fiche police archivée',
    payload: { from: (record as any).status, to: 'archived' },
  });

  revalidateAll(id);
  return { ok: true };
}

// ─── Suppression douce (CEO only) ────────────────────────────────────────

export async function deletePoliceRecordAction(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await assertRole(['ceo']);
  const supabase = createClient();

  const { error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .update({
      deleted_at: new Date().toISOString(),
      deleted_by: user.id,
    } as any)
    .eq('id', id);
  if (error) return { ok: false, error: error.message };

  await logPropriaAudit({
    supabase: supabase as any,
    table: POLICE_RECORDS_TABLE,
    recordId: id,
    actorId: user.id,
    action: 'delete',
    label: 'Soft-delete fiche police',
    payload: { ceo_only: true },
  });

  revalidateAll();
  return { ok: true };
}

// ─── Téléchargement PDF ──────────────────────────────────────────────────

export async function downloadPoliceRecordPdfAction(
  id: string,
): Promise<
  { ok: true; pdfBase64: string; filename: string }
  | { ok: false; error: string }
> {
  await assertRole(READ_ROLES);
  const supabase = createClient();

  const { data: record } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!record) return { ok: false, error: 'Fiche introuvable.' };

  const r = record as PoliceRecord;
  const admin = createAdminClient();
  const propertyName = await resolvePropertyName(admin, r.property_id);
  const unitLabel = await resolveUnitLabel(admin, r.propria_unit_id);
  const referenceNumber = await computeReferenceNumber(supabase, id);

  try {
    const pdfBuffer = await renderFichePolicePdf({
      record: r,
      propertyName,
      unitLabel,
      referenceNumber,
    });
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    const safeRef = referenceNumber.replace(/[^A-Za-z0-9_-]/g, '_');
    return {
      ok: true,
      pdfBase64,
      filename: `fiche-police-${safeRef}.pdf`,
    };
  } catch (e: any) {
    return { ok: false, error: `Génération PDF : ${e?.message ?? e}` };
  }
}

// ─── Téléchargement récap hebdo XLSX ─────────────────────────────────────

export async function downloadWeeklyRecapXlsxAction(
  weekStart: string,
): Promise<
  { ok: true; xlsxBase64: string; filename: string }
  | { ok: false; error: string }
> {
  await assertRole(READ_ROLES);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    return { ok: false, error: 'weekStart doit être une date YYYY-MM-DD (lundi).' };
  }
  const supabase = createClient();

  // Calcule la fin de semaine (dimanche inclus).
  const start = new Date(weekStart + 'T00:00:00Z');
  const end = new Date(start.getTime() + 6 * 86_400_000);
  const weekEnd = end.toISOString().slice(0, 10);

  const { data: records, error } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('*')
    .gte('arrival_date_property', weekStart)
    .lte('arrival_date_property', weekEnd)
    .is('deleted_at', null)
    .order('arrival_date_property', { ascending: true });
  if (error) return { ok: false, error: error.message };

  const list = (records ?? []) as PoliceRecord[];
  // Enrichit avec property name + unit label (forme attendue par agent B :
  // PoliceRecord étendu de property_name/unit_label optionnels)
  const admin = createAdminClient();
  const enriched = await Promise.all(
    list.map(async (r) => ({
      ...r,
      property_name: await resolvePropertyName(admin, r.property_id),
      unit_label: await resolveUnitLabel(admin, r.propria_unit_id),
    })),
  );

  try {
    const xlsxBuffer = await renderRecapWeeklyXlsx({
      records: enriched,
      weekStart,
      weekEnd,
    });
    const xlsxBase64 = Buffer.from(xlsxBuffer).toString('base64');
    return {
      ok: true,
      xlsxBase64,
      filename: `fiches-police-recap-${weekStart}_${weekEnd}.xlsx`,
    };
  } catch (e: any) {
    return { ok: false, error: `Génération XLSX : ${e?.message ?? e}` };
  }
}

// ─── Helpers internes ────────────────────────────────────────────────────

/**
 * Référence affichée : FP-YYYY-NNNN
 * YYYY = année de création de la fiche
 * NNNN = position de la fiche dans l'année (1-indexé) sur 4 chiffres
 *
 * Calcul à la lecture : on prend created_at de la fiche puis on compte les fiches
 * non soft-deleted créées avant ou à la même seconde dans la même année.
 * Pas de colonne BDD dédiée pour V1 (évite les migrations supplémentaires).
 */
async function computeReferenceNumber(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<string> {
  const { data: record } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('created_at')
    .eq('id', id)
    .maybeSingle();
  if (!record) return `FP-XXXX-XXXX`;
  const createdAt = (record as any).created_at as string;
  const year = new Date(createdAt).getUTCFullYear();
  const startOfYear = `${year}-01-01T00:00:00.000Z`;
  const { count } = await supabase
    .from(POLICE_RECORDS_TABLE)
    .select('id', { count: 'exact', head: true })
    .gte('created_at', startOfYear)
    .lte('created_at', createdAt)
    .is('deleted_at', null);
  const n = (count ?? 1).toString().padStart(4, '0');
  return `FP-${year}-${n}`;
}

async function resolvePropertyName(
  admin: ReturnType<typeof createAdminClient>,
  propertyId: string | null,
): Promise<string> {
  if (!propertyId) return '—';
  try {
    const { data } = await admin
      .from('properties')
      .select('name, propria_internal_code')
      .eq('id', propertyId)
      .maybeSingle();
    const p = (data ?? {}) as any;
    return p.propria_internal_code ?? p.name ?? '—';
  } catch {
    return '—';
  }
}

async function resolveUnitLabel(
  admin: ReturnType<typeof createAdminClient>,
  unitId: string | null,
): Promise<string> {
  if (!unitId) return 'Bien entier';
  try {
    const { data } = await admin
      .from('propria_units')
      .select('code, order_index')
      .eq('id', unitId)
      .maybeSingle();
    const u = (data ?? {}) as any;
    return u.code ?? (u.order_index != null ? `Suite ${u.order_index}` : 'Suite');
  } catch {
    return '—';
  }
}

async function resolveLabelForRecord(
  admin: ReturnType<typeof createAdminClient>,
  propertyId: string | null,
  unitId: string | null,
): Promise<string> {
  const propName = await resolvePropertyName(admin, propertyId);
  if (!unitId) return `${propName} · Bien entier`;
  const unitLabel = await resolveUnitLabel(admin, unitId);
  return `${propName} · ${unitLabel}`;
}

// ─── Notification équipe (utilisé par le cron) ───────────────────────────

/**
 * Notifie l'équipe Propria (CEO + propria + assistante) d'une fiche police à
 * compléter. Cible : in-app uniquement (l'email serait trop bruyant — 1 par
 * check-in et par jour).
 *
 * Exporté pour permettre au cron daily-reminders de l'appeler avec le client
 * admin (bypass RLS). Insert via admin pour ne pas dépendre d'un user actor.
 */
export async function notifyPoliceRecordsTeam(
  admin: ReturnType<typeof createAdminClient>,
  opts: { title: string; body: string; href?: string | null },
): Promise<void> {
  try {
    const { data: profiles } = await admin
      .from('profiles')
      .select('id')
      .in('role', ['ceo', 'propria', 'assistante'])
      .eq('is_active', true);
    const userIds = ((profiles ?? []) as any[]).map((p) => p.id as string);
    if (userIds.length === 0) return;

    // Cron = pas d'acteur humain ; on prend le 1er CEO comme created_by, sinon
    // le 1er user de la liste (RLS bypass de toute façon avec admin).
    const { data: ceo } = await admin
      .from('profiles')
      .select('id')
      .eq('role', 'ceo')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();
    const actorId = ((ceo as any)?.id as string | undefined) ?? userIds[0];

    const rows = userIds
      .filter((id) => id !== actorId)
      .map((userId) => ({
        user_id: userId,
        kind: 'autre' as const,
        title: opts.title,
        body: opts.body,
        href: opts.href ?? null,
        created_by: actorId,
      }));
    if (rows.length === 0) return;
    await admin.from('propria_notifications').insert(rows as any);
  } catch (e: any) {
    console.warn('[notifyPoliceRecordsTeam] failed:', e?.message ?? e);
  }
}

// ─── Pour conformité TypeScript : retypage exporté ───────────────────────
export type {
  PoliceRecordInputFields as PoliceRecordFields,
};
