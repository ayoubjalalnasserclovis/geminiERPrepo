'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const ALLOWED_MIME = [
  'application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif',
];
const MAX_SIZE = 25 * 1024 * 1024;
const ARTISAN_DOC_TYPES = [
  'attestation_regularite_fiscale',
  'attestation_rib',
  'attestation_cnss',
  'attestation_assurance',
  'autre',
];

export async function uploadArtisanDocumentAction(formData: FormData) {
  const me = await assertRole(['ceo','chef_projet','finance','assistante']);
  const supabase = createClient();

  const file = formData.get('file') as File | null;
  const artisan_id = String(formData.get('artisan_id') ?? '');
  const type = String(formData.get('type') ?? '');
  const document_number = String(formData.get('document_number') ?? '') || null;
  const document_date = String(formData.get('document_date') ?? '') || null;

  if (!file || !file.size) return { ok: false, error: 'Fichier requis' };
  if (file.size > MAX_SIZE) return { ok: false, error: 'Fichier trop volumineux (max 25 MB)' };
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `Format non supporte : ${file.type}` };
  if (!ARTISAN_DOC_TYPES.includes(type)) return { ok: false, error: 'Type invalide' };
  if (!artisan_id) return { ok: false, error: 'artisan_id manquant' };

  const ext = file.name.split('.').pop();
  const path = `artisans/${artisan_id}/${type}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await supabase.from('documents').insert({
    artisan_id,
    name: file.name,
    type,
    uploaded_by: me.id,
    uploaded_by_role: 'stoniz',
    storage_path: path,
    size_bytes: file.size,
    mime_type: file.type,
    is_visible_to_client: false,
    status: 'recu',
    document_number,
    document_date,
  });
  if (dbErr) {
    await supabase.storage.from('documents').remove([path]);
    return { ok: false, error: dbErr.message };
  }

  revalidatePath(`/artisans/${artisan_id}`);
  return { ok: true };
}

export async function deleteArtisanDocumentAction(documentId: string, artisanId: string) {
  await assertRole(['ceo','chef_projet','finance']);
  const supabase = createClient();

  const { data: doc } = await supabase.from('documents')
    .select('storage_path').eq('id', documentId).single();

  if (doc?.storage_path) {
    await supabase.storage.from('documents').remove([doc.storage_path]);
  }
  await supabase.from('documents')
    .update({ deleted_at: new Date().toISOString() }).eq('id', documentId);

  revalidatePath(`/artisans/${artisanId}`);
  return { ok: true };
}

export async function getArtisanDocumentSignedUrl(documentId: string) {
  await assertRole(['ceo','chef_projet','finance','assistante']);
  const supabase = createClient();
  const { data: doc } = await supabase.from('documents')
    .select('storage_path').eq('id', documentId).single();
  if (!doc) return { ok: false, error: 'Document introuvable' };
  const { data, error } = await supabase.storage.from('documents')
    .createSignedUrl(doc.storage_path, 3600);
  if (error) return { ok: false, error: error.message };
  return { ok: true, url: data.signedUrl };
}
