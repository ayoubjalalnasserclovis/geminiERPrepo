'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole, TEAM_ROLES, type Role } from '@/lib/auth/require';

/**
 * Server actions de la cloche de notifications (CEO 2026-06-12).
 * Table `propria_notifications` — RLS : chacun ne lit/écrit que les siennes.
 * Toutes les requêtes filtrent quand même user_id = user.id côté code
 * (défense en profondeur, et le CEO a un SELECT élargi par la RLS).
 */

const STAFF: Role[] = [...TEAM_ROLES];

export type AppNotification = {
  id: string;
  kind: 'mention' | 'assignation' | 'autre';
  title: string;
  body: string | null;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

/** Les 15 dernières notifications + compteur de non-lues. */
export async function getMyNotificationsAction(): Promise<
  | { ok: true; notifications: AppNotification[]; unread: number }
  | { ok: false; error: string }
> {
  const user = await assertRole(STAFF);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('propria_notifications')
    .select('id, kind, title, body, href, read_at, created_at')
    .eq('user_id', user.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(15);
  if (error) return { ok: false, error: error.message };

  const { count } = await supabase
    .from('propria_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
    .is('deleted_at', null);

  return {
    ok: true,
    notifications: (data ?? []) as AppNotification[],
    unread: count ?? 0,
  };
}

const markReadSchema = z.object({ notification_id: z.string().uuid() });

/** Marque UNE notification comme lue (destinataire uniquement). */
export async function markNotificationReadAction(input: { notification_id: string }) {
  const user = await assertRole(STAFF);
  const parsed = markReadSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_notifications')
    .update({ read_at: new Date().toISOString() } as any)
    .eq('id', parsed.data.notification_id)
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}

/** Marque TOUTES mes notifications non-lues comme lues. */
export async function markAllReadAction() {
  const user = await assertRole(STAFF);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_notifications')
    .update({ read_at: new Date().toISOString() } as any)
    .eq('user_id', user.id)
    .is('read_at', null)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
