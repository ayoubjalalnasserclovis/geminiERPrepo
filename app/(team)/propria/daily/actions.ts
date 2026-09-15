'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole, getSessionUser } from '@/lib/auth/require';

/**
 * Server actions pour les notes du daily Propria (CEO 2026-06-11).
 *
 * Notes partagées (visibles par tout le staff Propria), ajoutables par
 * CEO + Propria + Developer. La RLS WITH CHECK fait le gardien côté BDD ;
 * on double-checke ici en TS pour avoir un message d'erreur clair.
 */

const Allowed = ['ceo', 'propria', 'developer'] as const;

export async function createDailyNoteAction(formData: FormData) {
  const user = await requireRole(Allowed as any);
  const supabase = createClient();

  const schema = z.object({ content: z.string().trim().min(1).max(2000) });
  const parsed = schema.safeParse({ content: formData.get('content') });
  if (!parsed.success) return { ok: false as const, error: 'Note vide ou trop longue.' };

  const { error } = await supabase.from('propria_daily_notes').insert({
    content: parsed.data.content,
    created_by_id: user.id,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/propria/daily');
  return { ok: true as const };
}

export async function toggleDailyNoteResolvedAction(id: string, resolved: boolean) {
  const user = await requireRole(Allowed as any);
  const supabase = createClient();

  const patch = resolved
    ? { resolved_at: new Date().toISOString(), resolved_by_id: user.id }
    : { resolved_at: null, resolved_by_id: null };

  const { error } = await supabase
    .from('propria_daily_notes')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/propria/daily');
  return { ok: true as const };
}

export async function deleteDailyNoteAction(id: string) {
  // CEO only — suppression définitive pas critique mais on garde simple.
  const me = await getSessionUser();
  if (!me || (me.role !== 'ceo' && me.role !== 'developer')) {
    return { ok: false as const, error: 'Seul le CEO peut supprimer.' };
  }
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_daily_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/propria/daily');
  return { ok: true as const };
}
