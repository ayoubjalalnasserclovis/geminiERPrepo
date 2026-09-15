'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole, TEAM_ROLES, type Role } from '@/lib/auth/require';
import { notifyUsers } from '@/lib/propria/notify';
import { sendEmail } from '@/lib/email/send';

/**
 * Commentaires internes partagés (décision B5, chantier 6 marathon).
 * UNE table `propria_comments` pour 4 entités : litiges, avis, incidents,
 * check-ups (chantier 11.a — CHECK BDD élargi par 20260613000000_checkup_module.sql).
 * Lecture/écriture : tout le staff. Suppression : CEO uniquement (soft-delete).
 */

const STAFF: Role[] = [...TEAM_ROLES];

const ENTITY_TYPES = ['litige', 'avis', 'incident', 'checkup'] as const;
export type CommentEntityType = (typeof ENTITY_TYPES)[number];

export type PropriaComment = {
  id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  mentions: string[];
  created_at: string;
};

export async function getCommentsAction(input: {
  entity_type: CommentEntityType;
  entity_id: string;
}): Promise<{ ok: true; comments: PropriaComment[] } | { ok: false; error: string }> {
  await assertRole(STAFF);
  if (!ENTITY_TYPES.includes(input.entity_type)) return { ok: false, error: 'Type invalide' };
  const supabase = createClient();
  const { data, error } = await supabase
    .from('propria_comments')
    .select('id, body, author_id, mentions, created_at')
    .eq('entity_type', input.entity_type)
    .eq('entity_id', input.entity_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as any[];
  const authorIds = Array.from(new Set(rows.map((c) => c.author_id).filter(Boolean)));
  const nameMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', authorIds);
    for (const p of (profiles ?? []) as any[]) nameMap.set(p.id, p.full_name);
  }

  return {
    ok: true,
    comments: rows.map((c) => ({
      id: c.id,
      body: c.body,
      author_id: c.author_id,
      author_name: c.author_id ? nameMap.get(c.author_id) ?? null : null,
      mentions: (c.mentions ?? []) as string[],
      created_at: c.created_at,
    })),
  };
}

const addSchema = z.object({
  entity_type: z.enum(ENTITY_TYPES),
  entity_id: z.string().uuid(),
  body: z.string().trim().min(1, 'Commentaire vide'),
  mentions: z.array(z.string().uuid()).default([]),
});

// Libellés + liens de destination par type d'entité commentable.
// (Liens validés : litige → kanban litiges, avis → kanban avis avec le
//  panneau ouvert, incident → liste incidents ménage, checkup → fiche.)
const ENTITY_LABELS: Record<CommentEntityType, string> = {
  litige: 'un litige',
  avis: 'un avis',
  incident: 'un incident ménage',
  checkup: 'un check-up',
};

function entityHref(entityType: CommentEntityType, entityId: string): string {
  switch (entityType) {
    case 'litige': return '/propria/litiges';
    case 'avis': return `/propria/avis?review=${entityId}`;
    case 'incident': return '/propria/menage/incidents';
    case 'checkup': return `/propria/checkups/${entityId}`;
    default: return '/propria';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function addCommentAction(input: unknown) {
  const user = await assertRole(STAFF);
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const data = parsed.data;
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from('propria_comments')
    .insert({
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      body: data.body,
      author_id: user.id,
      mentions: data.mentions,
    } as any)
    .select('id')
    .single();
  if (error) return { ok: false as const, error: error.message };

  // ─── Notifications mentions (CEO 2026-06-12) — BEST EFFORT ─────────────
  // Le commentaire est déjà enregistré : aucun échec ci-dessous ne doit
  // faire échouer l'action. Notification in-app + mail pour chaque mentionné
  // (auteur auto-exclu, doublons dédupliqués dans notifyUsers).
  const mentioned = Array.from(new Set(data.mentions)).filter((id) => id !== user.id);
  if (mentioned.length > 0 && row?.id) {
    const excerpt = data.body.length > 80 ? `${data.body.slice(0, 80)}…` : data.body;
    const href = entityHref(data.entity_type, data.entity_id);
    const typeLabel = ENTITY_LABELS[data.entity_type];

    // 1) In-app
    await notifyUsers({
      supabase,
      actorId: user.id,
      userIds: mentioned,
      kind: 'mention',
      title: `${user.full_name} t'a mentionné`,
      body: excerpt,
      href,
    });

    // 2) Mail (pattern incident ménage : admin client pour lire les emails,
    //    idempotency_key par couple commentaire × destinataire).
    try {
      const admin = createAdminClient();
      const { data: profiles } = await admin
        .from('profiles')
        .select('id, email, full_name')
        .in('id', mentioned)
        .eq('is_active', true);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
      for (const p of (profiles ?? []) as any[]) {
        if (!p.email) continue;
        try {
          await sendEmail({
            to: p.email,
            template_id: 'comment_mention',
            subject: `💬 ${user.full_name} t'a mentionné sur ${typeLabel}`,
            html: `
              <p>Bonjour ${escapeHtml(p.full_name ?? '')},</p>
              <p><strong>${escapeHtml(user.full_name)}</strong> t'a mentionné dans un commentaire sur ${typeLabel} :</p>
              <blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#444">${escapeHtml(excerpt)}</blockquote>
              <p><a href="${appUrl}${href}">Voir dans l'app →</a></p>
            `.trim(),
            payload: {
              comment_id: row.id,
              entity_type: data.entity_type,
              entity_id: data.entity_id,
              mentioned_user_id: p.id,
            },
            idempotency_key: `mention_${row.id}_${p.id}`,
          });
        } catch (e: any) {
          console.warn('[mention-mail] échec', p.email, e?.message);
        }
      }
    } catch (e: any) {
      console.warn('[mention-notify] exception', e?.message);
    }
  }

  return { ok: true as const };
}

export async function deleteCommentAction(input: { comment_id: string }) {
  // Suppression CEO-only (soft-delete, convention n°3).
  await assertRole(['ceo']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_comments')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', input.comment_id);
  if (error) return { ok: false as const, error: error.message };
  return { ok: true as const };
}
