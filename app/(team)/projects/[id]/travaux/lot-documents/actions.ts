'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const ALLOWED_MIME = [
  'application/pdf','image/png','image/jpeg','image/webp','image/heic','image/heif',
];
const MAX_SIZE = 25 * 1024 * 1024;
const TYPES = ['devis_artisan','facture_artisan'];

export async function uploadLotDocumentAction(formData: FormData) {
  const me = await assertRole(['ceo','chef_projet','finance','assistante']);
  const supabase = createClient();

  const file = formData.get('file') as File | null;
  const project_id = String(formData.get('project_id') ?? '');
  const lot_id = String(formData.get('lot_id') ?? '');
  const type = String(formData.get('type') ?? '');
  const artisan_id = String(formData.get('artisan_id') ?? '') || null;
  const document_number = String(formData.get('document_number') ?? '') || null;
  const document_date = String(formData.get('document_date') ?? '') || null;
  // amount_mad volontairement retiré : la source de vérité est le lot (champ devis_artisan_mad / facture_client_mad).
  // Les fichiers ici sont des pièces jointes au lot, pas une donnée comptable.

  if (!file || !file.size) return { ok: false, error: 'Fichier requis' };
  if (file.size > MAX_SIZE) return { ok: false, error: 'Fichier trop volumineux (max 25 MB)' };
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `Format non supporté: ${file.type}` };
  if (!TYPES.includes(type)) return { ok: false, error: 'Type invalide' };
  if (!project_id || !lot_id) return { ok: false, error: 'project_id / lot_id manquant' };

  const ext = file.name.split('.').pop();
  const path = `projects/${project_id}/lots/${lot_id}/${type}/${crypto.randomUUID()}.${ext}`;

  const { error: upErr } = await supabase.storage.from('documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: upErr.message };

  const { error: dbErr } = await supabase.from('documents').insert({
    project_id, lot_id, artisan_id,
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

  revalidatePath(`/projects/${project_id}/travaux`);
  return { ok: true };
}

export async function deleteLotDocumentAction(documentId: string, projectId: string) {
  await assertRole(['ceo','chef_projet','finance']);
  const supabase = createClient();

  const { data: doc } = await supabase.from('documents')
    .select('storage_path').eq('id', documentId).single();

  if (doc?.storage_path) {
    await supabase.storage.from('documents').remove([doc.storage_path]);
  }

  await supabase.from('documents')
    .update({ deleted_at: new Date().toISOString() }).eq('id', documentId);

  revalidatePath(`/projects/${projectId}/travaux`);
  return { ok: true };
}

export async function getLotDocumentSignedUrl(documentId: string) {
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
