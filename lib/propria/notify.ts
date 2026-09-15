import 'server-only';
import type { createClient } from '@/lib/supabase/server';

/**
 * Notifications in-app (CEO 2026-06-12) — helper d'écriture centralisé.
 *
 * Insère N lignes dans `propria_notifications` (une par destinataire).
 * Règles :
 *   • BEST EFFORT : un échec ne fait JAMAIS échouer l'action métier
 *     appelante (try/catch + console.warn, pas de throw).
 *   • Auto-exclusion : on ne se notifie pas soi-même (actorId retiré).
 *   • Dédoublonnage des destinataires (Set) + filtrage des ids vides.
 *
 * L'insert passe par le client RLS de l'appelant : la policy
 * "staff insert notifications" exige is_staff() ET created_by = auth.uid().
 */

export type NotifyKind = 'mention' | 'assignation' | 'autre';

export async function notifyUsers(opts: {
  /** Destinataires (uuid profiles) — doublons et null/undefined tolérés. */
  userIds: Array<string | null | undefined>;
  kind: NotifyKind;
  title: string;
  body?: string | null;
  /** Lien interne app ouvert au clic (ex: /propria/litiges). */
  href?: string | null;
  /** Auteur de l'événement (= auth.uid() de l'appelant, exigé par la RLS). */
  actorId: string;
  supabase: ReturnType<typeof createClient>;
}): Promise<void> {
  try {
    const recipients = Array.from(
      new Set(opts.userIds.filter((id): id is string => !!id)),
    ).filter((id) => id !== opts.actorId); // jamais de notification à soi-même

    if (recipients.length === 0) return;

    const rows = recipients.map((userId) => ({
      user_id: userId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body ?? null,
      href: opts.href ?? null,
      created_by: opts.actorId,
    }));

    const { error } = await opts.supabase
      .from('propria_notifications')
      .insert(rows as any);
    if (error) console.warn('[notify] insert échoué :', error.message);
  } catch (e: any) {
    console.warn('[notify] exception :', e?.message ?? e);
  }
}
