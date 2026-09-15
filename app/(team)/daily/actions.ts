'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { DAILY_STONIZ_ROLES } from './roles';

/**
 * Server actions pour les notes du Daily Stoniz (CEO 2026-07-06).
 *
 * Cadrage CEO : Daily Stoniz ouvert à TOUTE l'équipe interne, visibilité
 * complète (écran de réunion partagé). Le rôle client n'y accède jamais,
 * le rôle menage n'a pas ce dashboard.
 * La RLS (is_staff) fait le gardien côté BDD ; on double-checke ici en TS.
 */

export async function createStonizDailyNoteAction(formData: FormData) {
  const user = await requireRole(DAILY_STONIZ_ROLES);
  const supabase = createClient();

  const schema = z.object({ content: z.string().trim().min(1).max(2000) });
  const parsed = schema.safeParse({ content: formData.get('content') });
  if (!parsed.success) return { ok: false as const, error: 'Note vide ou trop longue.' };

  const { error } = await supabase.from('stoniz_daily_notes').insert({
    content: parsed.data.content,
    created_by_id: user.id,
  });
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/daily');
  return { ok: true as const };
}

export async function toggleStonizDailyNoteResolvedAction(id: string, resolved: boolean) {
  const user = await requireRole(DAILY_STONIZ_ROLES);
  const supabase = createClient();

  const patch = resolved
    ? { resolved_at: new Date().toISOString(), resolved_by_id: user.id }
    : { resolved_at: null, resolved_by_id: null };

  const { error } = await supabase
    .from('stoniz_daily_notes')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/daily');
  return { ok: true as const };
}

export async function deleteStonizDailyNoteAction(id: string) {
  // CEO only — cohérent avec le Daily Propria.
  const me = await getSessionUser();
  if (!me || (me.role !== 'ceo' && me.role !== 'developer')) {
    return { ok: false as const, error: 'Seul le CEO peut supprimer.' };
  }
  const supabase = createClient();
  const { error } = await supabase
    .from('stoniz_daily_notes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/daily');
  return { ok: true as const };
}
