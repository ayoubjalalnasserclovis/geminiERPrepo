'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { notifyUsers } from '@/lib/propria/notify';

/**
 * Server actions module Litiges Airbnb (CEO 2026-06-10).
 * 5 colonnes : ouvrir_ticket → ticket_ouvert → appel → gagne/perdu.
 *
 * Chantier 6 marathon (U11, décision B4) : un litige contient N lignes
 * (propria_litige_items, tout en MAD). Les totaux sont DÉRIVÉS via la vue
 * propria_litiges_totals — propria_litiges.amount est DÉPRÉCIÉ (plus écrit).
 */

const LITIGE_WRITERS = ['ceo', 'assistante', 'propria'] as const;

const createSchema = z.object({
  hostaway_reservation_id: z.coerce.number(),
  type: z.enum(['caution','degats','frais_contestes','annulation_tardive','tapage','menage','autre']),
  description: z.string().optional().nullable(),
  amount: z.coerce.number().optional().nullable(),
  currency: z.string().optional().default('MAD'),
});

const ALLOWED_MIME = ['application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif'];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

export async function createLitigeAction(formData: FormData): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  const user = await assertRole(['ceo','assistante','propria']);
  const file = formData.get('file') as File | null;
  formData.delete('file');

  const parsed = createSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;
  const supabase = createClient();

  // Récupère listing + unit depuis la résa
  const { data: resa } = await supabase
    .from('hostaway_reservations')
    .select('hostaway_listing_db_id')
    .eq('hostaway_id', data.hostaway_reservation_id)
    .single();
  if (!resa) return { ok: false, error: 'Réservation Hostaway introuvable' };

  const { data: listing } = await supabase
    .from('hostaway_listings')
    .select('propria_unit_id')
    .eq('id', (resa as any).hostaway_listing_db_id)
    .single();

  const { data: row, error } = await supabase
    .from('propria_litiges')
    .insert({
      hostaway_reservation_id: data.hostaway_reservation_id,
      hostaway_listing_db_id: (resa as any).hostaway_listing_db_id,
      propria_unit_id: (listing as any)?.propria_unit_id ?? null,
      type: data.type,
      description: data.description ?? null,
      // amount DÉPRÉCIÉ (décision B4) : le montant devient une ligne item.
      currency: data.currency ?? 'MAD',
      created_by: user.id,
    } as any)
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  // Décision B4 : le montant saisi à la création devient la 1re ligne du
  // litige (montant demandé, MAD). Total toujours dérivé, jamais stocké.
  if (data.amount != null && data.amount > 0) {
    await supabase.from('propria_litige_items').insert({
      litige_id: row.id,
      description: (data.description ?? '').trim() || `Litige ${data.type}`,
      amount_claimed_mad: data.amount,
      created_by: user.id,
    } as any);
  }

  // Upload optionnel
  if (file && file.size > 0) {
    if (file.size > MAX_FILE_SIZE) return { ok: false, error: 'Fichier trop volumineux (max 10 MB).' };
    if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `Type non supporté : ${file.type}` };
    const ext = (file.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `propria-litiges/${row.id}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, file, { contentType: file.type, upsert: false });
    if (!upErr) {
      await supabase
        .from('propria_litiges')
        .update({ attachment_path: path } as any)
        .eq('id', row.id);
    }
  }

  revalidatePath('/propria/litiges');
  return { ok: true, id: row.id };
}

const moveSchema = z.object({
  litige_id: z.string().uuid(),
  column: z.enum(['ouvrir_ticket','ticket_ouvert','appel','gagne','perdu']),
});

export async function moveLitigeColumnAction(input: unknown) {
  await assertRole(['ceo','assistante','propria']);
  const parsed = moveSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { litige_id, column } = parsed.data;
  const supabase = createClient();

  const today = new Date().toISOString().slice(0, 10);
  const update: any = { kanban_column: column };
  if (column === 'ticket_ouvert' && !await alreadySet(supabase, litige_id, 'ticket_opened_at')) update.ticket_opened_at = today;
  if (column === 'appel' && !await alreadySet(supabase, litige_id, 'call_started_at')) update.call_started_at = today;
  if (column === 'gagne') update.won_at = today;
  if (column === 'perdu') update.lost_at = today;

  const { error } = await supabase.from('propria_litiges').update(update).eq('id', litige_id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/litiges');
  return { ok: true as const };
}

async function alreadySet(supabase: any, id: string, field: string) {
  const { data } = await supabase.from('propria_litiges').select(field).eq('id', id).single();
  return !!data?.[field];
}

export async function assignLitigeAction(input: { litige_id: string; assignee_id: string | null }) {
  const user = await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_litiges')
    .update({ assignee_id: input.assignee_id ?? null } as any)
    .eq('id', input.litige_id);
  if (error) return { ok: false as const, error: error.message };

  // Notification in-app au nouvel assigné (best effort, pas de mail).
  if (input.assignee_id) {
    await notifyUsers({
      supabase,
      actorId: user.id,
      userIds: [input.assignee_id],
      kind: 'assignation',
      title: 'On t\'a assigné un litige',
      body: null,
      href: '/propria/litiges',
    });
  }

  revalidatePath('/propria/litiges');
  return { ok: true as const };
}

export async function setLitigeNoteAction(input: { litige_id: string; notes: string | null }) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_litiges')
    .update({ internal_notes: input.notes ?? null } as any)
    .eq('id', input.litige_id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/litiges');
  return { ok: true as const };
}

const addActionSchema = z.object({
  litige_id: z.string().uuid(),
  action_type: z.enum(['ouverture_ticket','appel','message','escalade','reponse_airbnb','autre']),
  description: z.string().optional().nullable(),
});

export async function addLitigeActionAction(input: unknown) {
  const user = await assertRole(['ceo','assistante','propria']);
  const parsed = addActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const data = parsed.data;
  const supabase = createClient();
  const { error } = await supabase.from('propria_litiges_actions').insert({
    litige_id: data.litige_id,
    action_type: data.action_type,
    description: data.description ?? null,
    performed_by: user.id,
  } as any);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/litiges');
  return { ok: true as const };
}

// ─── Chantier 6 marathon — lignes de litige (décision B4) ────────────────

const itemSchema = z.object({
  litige_id: z.string().uuid(),
  description: z.string().trim().min(2, 'Décris l’élément (ex : table basse cassée)'),
  cost_real_mad: z.coerce.number().nonnegative().optional().nullable(),
  amount_claimed_mad: z.coerce.number().nonnegative().optional().nullable(),
});

const ITEM_PHOTO_MIME = ['image/png','image/jpeg','image/webp','image/heic','image/heif'];

export async function addLitigeItemAction(formData: FormData): Promise<
  | { ok: true; id: string }
  | { ok: false; error: string }
> {
  const user = await assertRole([...LITIGE_WRITERS]);
  const invoice = formData.get('invoice') as File | null;
  const photos = (formData.getAll('photos') as File[]).filter((f) => f && f.size > 0);
  formData.delete('invoice');
  formData.delete('photos');

  const parsed = itemSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const data = parsed.data;
  const supabase = createClient();

  const { data: item, error } = await supabase
    .from('propria_litige_items')
    .insert({
      litige_id: data.litige_id,
      description: data.description,
      cost_real_mad: data.cost_real_mad ?? null,
      amount_claimed_mad: data.amount_claimed_mad ?? null,
      created_by: user.id,
    } as any)
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  // Uploads par ligne — bucket documents, chemin propria-litiges/<litige>/items/<item>/…
  const base = `propria-litiges/${data.litige_id}/items/${item.id}`;
  let invoicePath: string | null = null;
  const photoPaths: string[] = [];

  if (invoice && invoice.size > 0) {
    if (invoice.size > MAX_FILE_SIZE) return { ok: false, error: 'Facture trop volumineuse (max 10 MB).' };
    if (!ALLOWED_MIME.includes(invoice.type)) return { ok: false, error: `Type facture non supporté : ${invoice.type}` };
    const ext = (invoice.name.split('.').pop() ?? 'bin').toLowerCase();
    const path = `${base}/facture-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, invoice, { contentType: invoice.type, upsert: false });
    if (!upErr) invoicePath = path;
  }

  for (const photo of photos) {
    if (photo.size > MAX_FILE_SIZE) continue;
    if (!ITEM_PHOTO_MIME.includes(photo.type)) continue;
    const ext = (photo.name.split('.').pop() ?? 'jpg').toLowerCase();
    const path = `${base}/photo-${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(path, photo, { contentType: photo.type, upsert: false });
    if (!upErr) photoPaths.push(path);
  }

  if (invoicePath || photoPaths.length > 0) {
    await supabase
      .from('propria_litige_items')
      .update({ invoice_path: invoicePath, photo_paths: photoPaths } as any)
      .eq('id', item.id);
  }

  revalidatePath('/propria/litiges');
  return { ok: true, id: item.id };
}

export async function deleteLitigeItemAction(input: { item_id: string }) {
  // Soft-delete uniquement (convention n°3) — la ligne sort des totaux dérivés.
  await assertRole([...LITIGE_WRITERS]);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_litige_items')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', input.item_id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/litiges');
  return { ok: true as const };
}

export type LitigeItemWithUrls = {
  id: string;
  description: string;
  cost_real_mad: number | null;
  amount_claimed_mad: number | null;
  invoiceUrl: string | null;
  photoUrls: string[];
  created_at: string;
};

export async function getLitigeItemsAction(litigeId: string): Promise<
  | { ok: true; items: LitigeItemWithUrls[] }
  | { ok: false; error: string }
> {
  await assertRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();
  const { data, error } = await supabase
    .from('propria_litige_items')
    .select('id, description, cost_real_mad, amount_claimed_mad, invoice_path, photo_paths, created_at')
    .eq('litige_id', litigeId)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };

  const admin = createAdminClient();
  const items = await Promise.all(((data ?? []) as any[]).map(async (i) => {
    let invoiceUrl: string | null = null;
    if (i.invoice_path) {
      const { data: signed } = await admin.storage.from('documents')
        .createSignedUrl(i.invoice_path, 60 * 60);
      invoiceUrl = signed?.signedUrl ?? null;
    }
    const photoUrls: string[] = [];
    for (const p of (i.photo_paths ?? []) as string[]) {
      const { data: signed } = await admin.storage.from('documents')
        .createSignedUrl(p, 60 * 60);
      if (signed?.signedUrl) photoUrls.push(signed.signedUrl);
    }
    return {
      id: i.id,
      description: i.description,
      cost_real_mad: i.cost_real_mad != null ? Number(i.cost_real_mad) : null,
      amount_claimed_mad: i.amount_claimed_mad != null ? Number(i.amount_claimed_mad) : null,
      invoiceUrl,
      photoUrls,
      created_at: i.created_at,
    };
  }));
  return { ok: true, items };
}

// ─── N° dossier AirCover ─────────────────────────────────────────────────

export async function setLitigeAircoverRefAction(input: {
  litige_id: string;
  aircover_reference: string | null;
}) {
  await assertRole([...LITIGE_WRITERS]);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_litiges')
    .update({ aircover_reference: input.aircover_reference?.trim() || null } as any)
    .eq('id', input.litige_id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/litiges');
  return { ok: true as const };
}

// ─── Photos du dernier ménage du lot (lecture seule) ────────────────────
// Pattern signed URLs identique à getCleaningProofUrls (module ménage).

const PROOFS_BUCKET = 'intervention-proofs';

export async function getLastCleaningProofsForLitigeAction(litigeId: string): Promise<
  | { ok: true; cleaning: { id: string; occurred_at: string; status: string } ; proofs: { id: string; signedUrl: string | null; mimeType: string; section: string }[] }
  | { ok: false; error: string }
> {
  await assertRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const { data: litige } = await supabase
    .from('propria_litiges')
    .select('propria_unit_id')
    .eq('id', litigeId)
    .single();
  if (!litige?.propria_unit_id) {
    return { ok: false, error: 'Litige sans lot rattaché — pas de ménage à afficher.' };
  }

  // Dernier ménage du lot, statut le plus avancé d'abord (clôturé > à valider
  // > en cours), le plus récent (occurred_at puis due_date) ensuite.
  const { data: cleanings } = await supabase
    .from('propria_cleanings')
    .select('id, occurred_at, due_date, status')
    .eq('propria_unit_id', (litige as any).propria_unit_id)
    .in('status', ['cloture','a_valider','en_cours'])
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .limit(20);
  const ranked = ((cleanings ?? []) as any[]).sort((a, b) => {
    const prio: Record<string, number> = { cloture: 0, a_valider: 1, en_cours: 2 };
    if (prio[a.status] !== prio[b.status]) return prio[a.status] - prio[b.status];
    return String(b.occurred_at ?? b.due_date ?? '').localeCompare(String(a.occurred_at ?? a.due_date ?? ''));
  });
  const last = ranked[0];
  if (!last) return { ok: false, error: 'Aucun ménage trouvé sur ce lot.' };

  const admin = createAdminClient();
  const { data: proofs } = await admin
    .from('propria_cleaning_proofs')
    .select('id, storage_path, mime_type, section')
    .eq('cleaning_id', last.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  const withUrls = await Promise.all(((proofs ?? []) as any[]).map(async (p) => {
    const { data: signed } = await admin.storage.from(PROOFS_BUCKET)
      .createSignedUrl(p.storage_path, 60 * 60);
    return {
      id: p.id as string,
      signedUrl: signed?.signedUrl ?? null,
      mimeType: p.mime_type as string,
      section: (p.section ?? 'general') as string,
    };
  }));

  return {
    ok: true,
    cleaning: { id: last.id, occurred_at: last.occurred_at ?? last.due_date ?? '', status: last.status },
    proofs: withUrls,
  };
}

// ─── Créer tâche / intervention depuis un litige ─────────────────────────

const LITIGE_TYPE_LABEL: Record<string, string> = {
  caution: 'caution',
  degats: 'dégâts',
  frais_contestes: 'frais contestés',
  annulation_tardive: 'annulation tardive',
  tapage: 'tapage',
  menage: 'ménage',
  autre: 'autre',
};

export async function createInterventionFromLitigeAction(input: {
  litige_id: string;
  kind: 'tache' | 'intervention';
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const user = await assertRole([...LITIGE_WRITERS]);
  if (input.kind !== 'tache' && input.kind !== 'intervention') {
    return { ok: false, error: 'Type invalide' };
  }
  const supabase = createClient();

  const { data: litige } = await supabase
    .from('propria_litiges')
    .select('id, type, description, propria_unit_id')
    .eq('id', input.litige_id)
    .is('deleted_at', null)
    .single();
  if (!litige) return { ok: false, error: 'Litige introuvable.' };
  if (!(litige as any).propria_unit_id) {
    return { ok: false, error: 'Litige sans lot rattaché — crée la tâche/intervention manuellement.' };
  }

  // property_id obligatoire sur propria_interventions → via le lot.
  const { data: unit } = await supabase
    .from('propria_units')
    .select('id, property_id')
    .eq('id', (litige as any).propria_unit_id)
    .single();
  if (!unit?.property_id) return { ok: false, error: 'Bien du lot introuvable.' };

  const typeLabel = LITIGE_TYPE_LABEL[(litige as any).type] ?? (litige as any).type;
  const desc = `Litige ${typeLabel} : ${((litige as any).description ?? '').trim() || 'voir le litige'}`;

  const { data: newInt, error: insErr } = await supabase
    .from('propria_interventions')
    .insert({
      property_id: (unit as any).property_id,
      propria_unit_id: (litige as any).propria_unit_id,
      kind: input.kind,
      description: desc,
      urgency: 'normale',
      status: 'a_traiter',
      occurred_at: new Date().toISOString().slice(0, 10),
      created_by: user.id,
      hostaway_integrated: false,
    } as any)
    .select('id')
    .single();
  if (insErr) return { ok: false, error: insErr.message };

  // Trace dans l'historique du litige.
  await supabase.from('propria_litiges_actions').insert({
    litige_id: input.litige_id,
    action_type: 'autre',
    description: `${input.kind === 'tache' ? 'Tâche' : 'Intervention'} créée → /propria/interventions/${newInt.id}`,
    performed_by: user.id,
  } as any);

  revalidatePath('/propria/litiges');
  revalidatePath('/propria/interventions');
  return { ok: true, id: newInt.id };
}
