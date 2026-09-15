'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const ALLOWED_MIME = [
  'application/pdf','image/png','image/jpeg','image/webp','image/heic',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_SIZE = 25 * 1024 * 1024;

const CLIENT_DOC_TYPES = [
  'piece_identite','cin','rib','procuration','justificatif_financement','autre',
];

export async function uploadClientDocumentAction(formData: FormData) {
  const me = await assertRole(['client']);
  const supabase = createClient();

  const file = formData.get('file') as File;
  const project_id = formData.get('project_id') as string;
  const type = formData.get('type') as string;

  if (!file || !file.size) return { ok: false, error: 'Fichier manquant' };
  if (file.size > MAX_SIZE) return { ok: false, error: 'Fichier trop volumineux (max 25 MB)' };
  if (!ALLOWED_MIME.includes(file.type)) return { ok: false, error: `Type non supporté : ${file.type}` };
  if (!CLIENT_DOC_TYPES.includes(type)) return { ok: false, error: 'Type de document invalide' };

  // Vérifier que le client a bien accès à ce projet
  const { data: project } = await supabase
    .from('projects')
    .select('id, client:clients(profile_id)')
    .eq('id', project_id)
    .single();

  if (!project || (project as any).client?.profile_id !== me.id) {
    return { ok: false, error: 'Projet non autorisé' };
  }

  const ext = file.name.split('.').pop();
  const path = `projects/${project_id}/${type}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadErr } = await supabase.storage.from('documents')
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { error: insertErr } = await supabase.from('documents').insert({
    project_id,
    name: file.name,
    type,
    uploaded_by: me.id,
    uploaded_by_role: 'client',
    storage_path: path,
    size_bytes: file.size,
    mime_type: file.type,
    is_visible_to_client: true,
    status: 'recu',
  });

  if (insertErr) {
    await supabase.storage.from('documents').remove([path]);
    return { ok: false, error: insertErr.message };
  }

  revalidatePath('/client/documents');
  return { ok: true };
}
