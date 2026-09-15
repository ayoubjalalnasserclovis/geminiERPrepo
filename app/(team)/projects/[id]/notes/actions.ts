'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const CATEGORIES = ['note','appel','reunion','suivi_chantier','interne','client','partenaire','alerte'] as const;

const noteSchema = z.object({
  project_id: z.string().uuid(),
  body: z.string().min(1, 'Note vide').max(5000, 'Note trop longue (max 5000 caractères)'),
  category: z.enum(CATEGORIES).default('note'),
  pinned: z.boolean().default(false),
});

export async function addProjectNoteAction(input: unknown) {
  const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante','marketing']);
  const raw: any = { ...(input as any) };
  raw.pinned = raw.pinned === true || raw.pinned === 'true' || raw.pinned === 'on';
  const parsed = noteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase.from('project_notes').insert({
    project_id: parsed.data.project_id,
    body: parsed.data.body.trim(),
    category: parsed.data.category,
    pinned: parsed.data.pinned,
    author_id: me.id,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${parsed.data.project_id}`);
  return { ok: true };
}

export async function updateProjectNoteAction(noteId: string, input: { body?: string; category?: string; pinned?: boolean }) {
  const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante','marketing']);
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('project_notes')
    .select('id, project_id, author_id')
    .eq('id', noteId)
    .single();
  if (!existing) return { ok: false, error: 'Note introuvable' };

  // Seul l'auteur ou le CEO peut editer
  if (existing.author_id !== me.id && me.role !== 'ceo') {
    return { ok: false, error: 'Seul l\'auteur ou le CEO peut modifier cette note' };
  }

  const payload: any = {};
  if (input.body !== undefined) {
    if (input.body.trim().length === 0) return { ok: false, error: 'Note vide' };
    if (input.body.length > 5000) return { ok: false, error: 'Note trop longue' };
    payload.body = input.body.trim();
  }
  if (input.category !== undefined && CATEGORIES.includes(input.category as any)) {
    payload.category = input.category;
  }
  if (input.pinned !== undefined) payload.pinned = input.pinned;

  const { error } = await supabase.from('project_notes').update(payload).eq('id', noteId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${existing.project_id}`);
  return { ok: true };
}

export async function deleteProjectNoteAction(noteId: string) {
  const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante','marketing']);
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('project_notes')
    .select('id, project_id, author_id')
    .eq('id', noteId)
    .single();
  if (!existing) return { ok: false, error: 'Note introuvable' };

  if (existing.author_id !== me.id && me.role !== 'ceo') {
    return { ok: false, error: 'Seul l\'auteur ou le CEO peut supprimer cette note' };
  }

  const { error } = await supabase.from('project_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', noteId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/projects/${existing.project_id}`);
  return { ok: true };
}
