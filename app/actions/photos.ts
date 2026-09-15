'use server';

import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const ALLOWED_MIME = [
  'image/jpeg','image/png','image/webp','image/heic','image/heif',
];
const MAX_SIZE = 15 * 1024 * 1024; // 15 MB (avant compression côté client devrait être 1 MB)

const uploadSchema = z.object({
  project_id: z.string().uuid(),
  entity_type: z.enum(['vct_action','pv_reserve','vct_item','pv_item','intervention','project']),
  entity_id: z.string().uuid(),
  kind: z.enum(['before','after','verified','defaut','reference']),
  hash_sha256: z.string().optional().nullable(),
  width: z.coerce.number().int().optional().nullable(),
  height: z.coerce.number().int().optional().nullable(),
  caption: z.string().optional().nullable(),
});

/**
 * Upload générique de photo sur n'importe quelle entité projet.
 * Capture l'audit trail (IP, UA, hash) pour valeur juridique.
 * Si même hash déjà uploadé pour cette entité → skip (dédup).
 */
export async function uploadProjectPhotoAction(formData: FormData) {
  const user = await assertRole(['ceo','chef_projet','assistante','propria']);
  const supabase = createClient();

  const file = formData.get('file') as File | null;
  if (!file || !file.size) throw new Error('Fichier requis');
  if (file.size > MAX_SIZE) throw new Error('Fichier trop volumineux (max 15 MB)');
  if (!ALLOWED_MIME.includes(file.type)) throw new Error(`Type non supporté : ${file.type}`);

  // Extract et valide les métadonnées
  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) {
    if (k === 'file') continue;
    raw[k] = v === '' ? null : v;
  }
  const data = uploadSchema.parse(raw);

  // Dédup : si hash déjà présent pour cette entité, on ne ré-upload pas
  if (data.hash_sha256) {
    const { data: existing } = await supabase
      .from('project_photos')
      .select('id')
      .eq('entity_type', data.entity_type)
      .eq('entity_id', data.entity_id)
      .eq('hash_sha256', data.hash_sha256)
      .is('deleted_at', null)
      .maybeSingle();
    if (existing) {
      return { skipped: true, reason: 'duplicate', id: existing.id };
    }
  }

  // Audit metadata
  const h = headers();
  const ip = h.get('x-forwarded-for') ?? h.get('x-real-ip') ?? null;
  const ua = h.get('user-agent') ?? null;

  const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase();
  const dateStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = `${data.entity_type.replace('_','-')}/${data.entity_id}/${data.kind}/${dateStr}_${crypto.randomUUID()}.${ext}`;

  // Upload Storage
  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(upErr.message);

  // Insert métadonnées
  const { data: row, error: dbErr } = await supabase
    .from('project_photos')
    .insert({
      project_id: data.project_id,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      kind: data.kind,
      storage_path: path,
      hash_sha256: data.hash_sha256,
      file_size_bytes: file.size,
      mime_type: file.type,
      width: data.width,
      height: data.height,
      uploaded_by: user.id,
      uploaded_ip: ip,
      uploaded_user_agent: ua,
      caption: data.caption,
    } as any)
    .select('id').single();
  if (dbErr) {
    await supabase.storage.from('documents').remove([path]);
    throw new Error(dbErr.message);
  }

  revalidatePath(`/projects/${data.project_id}/reception`);
  revalidatePath(`/projects/${data.project_id}`);
  revalidatePath(`/projects/${data.project_id}/photos`);
  return { ok: true, id: row.id };
}

export async function deleteProjectPhotoAction(photoId: string) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();

  const { data: photo } = await supabase
    .from('project_photos')
    .select('id, project_id, storage_path').eq('id', photoId).single();
  if (!photo) throw new Error('Photo introuvable');

  // Soft delete BDD
  const { error: dbErr } = await supabase
    .from('project_photos')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', photoId);
  if (dbErr) throw new Error(dbErr.message);

  // Suppression hard du Storage (best-effort)
  await supabase.storage.from('documents').remove([photo.storage_path]);

  revalidatePath(`/projects/${photo.project_id}/reception`);
  revalidatePath(`/projects/${photo.project_id}/photos`);
}

const updateCaptionSchema = z.object({
  photo_id: z.string().uuid(),
  caption: z.string().optional().nullable(),
});

export async function updatePhotoCaptionAction(formData: FormData) {
  await assertRole(['ceo','chef_projet']);
  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = updateCaptionSchema.parse(raw);
  const supabase = createClient();

  const { data: photo, error } = await supabase
    .from('project_photos')
    .update({ caption: data.caption } as any)
    .eq('id', data.photo_id)
    .select('project_id').single();
  if (error) throw new Error(error.message);

  revalidatePath(`/projects/${photo.project_id}/reception`);
  revalidatePath(`/projects/${photo.project_id}/photos`);
}
