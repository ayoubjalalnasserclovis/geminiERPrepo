'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { syncPreReviewTrackings } from '@/lib/propria/pre-review-tracking';
import { notifyUsers } from '@/lib/propria/notify';

/**
 * Server actions Kanban Avis (CEO 2026-06-10).
 *
 * Kanban 1 (avis publiés) : déplacement entre colonnes + dates de tickets.
 * Kanban 2 (avis préventifs) : sentiment + actions équipe + déplacement.
 *
 * Chantier 7 marathon (U9/U10) : chaque changement de statut / sentiment /
 * cause / assignation / relance est journalisé en BEST EFFORT dans
 * propria_review_events (un échec de log ne bloque jamais l'action métier).
 */

// ─── Journal des avis (chantier 7) ───────────────────────────────────

type ReviewKind = 'avis' | 'preventif';
type ReviewEventType = 'statut' | 'relance' | 'sentiment' | 'cause' | 'assignation' | 'autre';

export type ReviewEvent = {
  id: string;
  event_type: ReviewEventType;
  description: string | null;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
};

const REVIEW_COLUMN_LABELS: Record<string, string> = {
  a_traiter: 'À traiter',
  ticket1_ouvert: '1er ticket ouvert',
  ticket1_non_resolu: '1er ticket non résolu',
  ticket2_ouvert: '2ème ticket ouvert',
  gagne: 'Gagné',
  perdu: 'Perdu',
};

const PRE_STATUS_LABELS: Record<string, string> = {
  nouveau: 'À évaluer',
  risque: 'Risque mauvais avis',
  neutre: 'Neutre',
  bon: 'Bon retour attendu',
  action_lancee: 'Action lancée',
  accomplie: 'Mission accomplie',
  ratee: 'Mission ratée',
};

const MAIN_CAUSE_LABELS: Record<string, string> = {
  menage: 'Ménage', acces: 'Accès', cle: 'Clé', climatisation: 'Climatisation',
  internet: 'Internet', bruit: 'Bruit', communication: 'Communication',
  equipement: 'Équipement', prix: 'Prix', autre: 'Autre',
};

/** Best effort — un échec de journalisation ne fait jamais échouer l'action. */
async function logReviewEvent(
  supabase: ReturnType<typeof createClient>,
  e: { review_kind: ReviewKind; review_id: string; event_type: ReviewEventType; description: string; actor_id: string },
) {
  try {
    await supabase.from('propria_review_events').insert(e as any);
  } catch {
    // best effort — on n'interrompt jamais l'action métier
  }
}

async function profileName(supabase: ReturnType<typeof createClient>, id: string | null): Promise<string> {
  if (!id) return '—';
  const { data } = await supabase.from('profiles').select('full_name').eq('id', id).maybeSingle();
  return (data as any)?.full_name ?? '—';
}

/** Lit le journal d'un avis (publié ou préventif) pour la modale ticket. */
export async function getReviewEventsAction(input: {
  review_kind: ReviewKind;
  review_id: string;
}): Promise<{ ok: true; events: ReviewEvent[] } | { ok: false; error: string }> {
  await assertRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();
  const { data, error } = await supabase
    .from('propria_review_events')
    .select('id, event_type, description, actor_id, created_at')
    .eq('review_kind', input.review_kind)
    .eq('review_id', input.review_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as any[];
  const actorIds = Array.from(new Set(rows.map((e) => e.actor_id).filter(Boolean)));
  const nameMap = new Map<string, string | null>();
  if (actorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, full_name').in('id', actorIds);
    for (const p of (profiles ?? []) as any[]) nameMap.set(p.id, p.full_name);
  }

  return {
    ok: true,
    events: rows.map((e) => ({
      id: e.id,
      event_type: e.event_type,
      description: e.description,
      actor_id: e.actor_id,
      actor_name: e.actor_id ? nameMap.get(e.actor_id) ?? null : null,
      created_at: e.created_at,
    })),
  };
}

// ─── KANBAN 1 — Avis publiés ─────────────────────────────────────────

const moveReviewColumnSchema = z.object({
  review_id: z.string().uuid(),
  column: z.enum(['a_traiter','ticket1_ouvert','ticket1_non_resolu','ticket2_ouvert','gagne','perdu']),
});

export async function moveReviewColumnAction(input: unknown) {
  const user = await assertRole(['ceo','assistante','propria']);
  const parsed = moveReviewColumnSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { review_id, column } = parsed.data;
  const supabase = createClient();

  const update: any = {
    kanban_column: column,
    internal_handled_by: user.id,
    internal_handled_at: new Date().toISOString(),
  };
  // Auto-fill dates selon la colonne
  const today = new Date().toISOString().slice(0, 10);
  if (column === 'ticket1_ouvert')        update.ticket1_opened_at      = today;
  if (column === 'ticket1_non_resolu')    update.ticket1_unresolved_at  = today;
  if (column === 'ticket2_ouvert')        update.ticket2_opened_at      = today;
  if (column === 'gagne')                 update.won_at                  = today;
  if (column === 'perdu')                 update.lost_at                 = today;

  const { error } = await supabase.from('hostaway_reviews').update(update).eq('id', review_id);
  if (error) return { ok: false as const, error: error.message };

  await logReviewEvent(supabase, {
    review_kind: 'avis', review_id, event_type: 'statut',
    description: `Colonne → ${REVIEW_COLUMN_LABELS[column] ?? column}`, actor_id: user.id,
  });

  revalidatePath('/propria/avis');
  return { ok: true as const };
}

export async function assignReviewAction(input: { review_id: string; assignee_id: string | null }) {
  const user = await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('hostaway_reviews')
    .update({ assignee_id: input.assignee_id ?? null } as any)
    .eq('id', input.review_id);
  if (error) return { ok: false as const, error: error.message };

  await logReviewEvent(supabase, {
    review_kind: 'avis', review_id: input.review_id, event_type: 'assignation',
    description: input.assignee_id
      ? `Assigné à ${await profileName(supabase, input.assignee_id)}`
      : 'Désassigné',
    actor_id: user.id,
  });

  // Notification in-app au nouvel assigné (best effort, pas de mail).
  if (input.assignee_id) {
    await notifyUsers({
      supabase,
      actorId: user.id,
      userIds: [input.assignee_id],
      kind: 'assignation',
      title: 'On t\'a assigné un avis',
      body: null,
      href: `/propria/avis?review=${input.review_id}`,
    });
  }

  revalidatePath('/propria/avis');
  return { ok: true as const };
}

export async function assignPreReviewAction(input: { tracking_id: string; assignee_id: string | null }) {
  const user = await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('hostaway_pre_review_tracking')
    .update({ assignee_id: input.assignee_id ?? null } as any)
    .eq('id', input.tracking_id);
  if (error) return { ok: false as const, error: error.message };

  await logReviewEvent(supabase, {
    review_kind: 'preventif', review_id: input.tracking_id, event_type: 'assignation',
    description: input.assignee_id
      ? `Assigné à ${await profileName(supabase, input.assignee_id)}`
      : 'Désassigné',
    actor_id: user.id,
  });

  // Notification in-app au nouvel assigné (best effort, pas de mail).
  if (input.assignee_id) {
    await notifyUsers({
      supabase,
      actorId: user.id,
      userIds: [input.assignee_id],
      kind: 'assignation',
      title: 'On t\'a assigné un avis préventif',
      body: null,
      href: '/propria/avis/preventif',
    });
  }

  revalidatePath('/propria/avis/preventif');
  return { ok: true as const };
}

export async function setReviewInternalNoteAction(input: { review_id: string; notes: string | null }) {
  const user = await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('hostaway_reviews')
    .update({
      internal_notes: input.notes ?? null,
      internal_handled_by: user.id,
      internal_handled_at: new Date().toISOString(),
    } as any)
    .eq('id', input.review_id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/avis');
  return { ok: true as const };
}

// ─── KANBAN 2 — Avis préventifs ──────────────────────────────────────

const setSentimentSchema = z.object({
  tracking_id: z.string().uuid(),
  sentiment: z.enum(['bon','neutre','mauvais']),
});

/**
 * Classe le sentiment d'une réservation. Bascule auto le kanban_status
 * depuis 'nouveau' vers 'risque' / 'bon' selon le choix.
 */
export async function setPreReviewSentimentAction(input: unknown) {
  const user = await assertRole(['ceo','assistante','propria']);
  const parsed = setSentimentSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { tracking_id, sentiment } = parsed.data;
  const supabase = createClient();

  // On bascule la colonne kanban si elle est encore "nouveau"
  const { data: cur } = await supabase
    .from('hostaway_pre_review_tracking')
    .select('kanban_status')
    .eq('id', tracking_id)
    .single();

  const updates: any = {
    sentiment,
    sentiment_set_by: user.id,
    sentiment_set_at: new Date().toISOString(),
  };
  // CEO 2026-06-11 : colonne dédiée 'neutre' (avant : neutre était mélangé
  // dans 'risque' ce qui rendait la colonne risque illisible).
  if ((cur as any)?.kanban_status === 'nouveau') {
    if (sentiment === 'mauvais') updates.kanban_status = 'risque';
    else if (sentiment === 'bon') updates.kanban_status = 'bon';
    else updates.kanban_status = 'neutre';
  }
  // Si le user RE-classe le sentiment d'un tracking dans une colonne de
  // pré-classement (risque/neutre/bon), on suit le nouveau sentiment.
  // On ne touche PAS aux colonnes aval (action_lancee/accomplie/ratee).
  else if (['risque','neutre','bon'].includes((cur as any)?.kanban_status)) {
    if (sentiment === 'mauvais') updates.kanban_status = 'risque';
    else if (sentiment === 'bon') updates.kanban_status = 'bon';
    else updates.kanban_status = 'neutre';
  }

  const { error } = await supabase
    .from('hostaway_pre_review_tracking')
    .update(updates)
    .eq('id', tracking_id);
  if (error) return { ok: false as const, error: error.message };

  await logReviewEvent(supabase, {
    review_kind: 'preventif', review_id: tracking_id, event_type: 'sentiment',
    description: `Sentiment → ${sentiment}`, actor_id: user.id,
  });

  revalidatePath('/propria/avis/preventif');
  return { ok: true as const };
}

// ─── QCM cause principale (chantier 7 — préventif négatif) ───────────

const setMainCauseSchema = z.object({
  tracking_id: z.string().uuid(),
  main_cause: z.enum(['menage','acces','cle','climatisation','internet','bruit','communication','equipement','prix','autre']).nullable(),
});

/**
 * Cause principale d'un préventif négatif (QCM chantier 7).
 * Nullable : on peut effacer la cause si erreur de saisie.
 */
export async function setPreReviewMainCauseAction(input: unknown) {
  const user = await assertRole(['ceo','assistante','propria']);
  const parsed = setMainCauseSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { tracking_id, main_cause } = parsed.data;
  const supabase = createClient();

  const { error } = await supabase
    .from('hostaway_pre_review_tracking')
    .update({ main_cause } as any)
    .eq('id', tracking_id);
  if (error) return { ok: false as const, error: error.message };

  await logReviewEvent(supabase, {
    review_kind: 'preventif', review_id: tracking_id, event_type: 'cause',
    description: main_cause
      ? `Cause principale → ${MAIN_CAUSE_LABELS[main_cause] ?? main_cause}`
      : 'Cause principale effacée',
    actor_id: user.id,
  });

  revalidatePath('/propria/avis/preventif');
  return { ok: true as const };
}

const movePreReviewSchema = z.object({
  tracking_id: z.string().uuid(),
  status: z.enum(['nouveau','risque','neutre','bon','action_lancee','accomplie','ratee']),
});

export async function movePreReviewKanbanAction(input: unknown) {
  const user = await assertRole(['ceo','assistante','propria']);
  const parsed = movePreReviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { tracking_id, status } = parsed.data;
  const supabase = createClient();

  const updates: any = { kanban_status: status };
  if (status === 'accomplie' || status === 'ratee') {
    updates.completed_at = new Date().toISOString();
    updates.completion_reason = 'Décision manuelle équipe';
  }

  const { error } = await supabase
    .from('hostaway_pre_review_tracking')
    .update(updates)
    .eq('id', tracking_id);
  if (error) return { ok: false as const, error: error.message };

  await logReviewEvent(supabase, {
    review_kind: 'preventif', review_id: tracking_id, event_type: 'statut',
    description: `Statut → ${PRE_STATUS_LABELS[status] ?? status}`, actor_id: user.id,
  });

  revalidatePath('/propria/avis/preventif');
  return { ok: true as const };
}

const addActionSchema = z.object({
  tracking_id: z.string().uuid(),
  action_type: z.enum(['compensation','message','appel','geste_commercial','relance_positive','autre']),
  description: z.string().optional().nullable(),
  amount: z.coerce.number().optional().nullable(),
  currency: z.string().optional().default('MAD'),
});

export async function addPreReviewActionAction(input: unknown) {
  const user = await assertRole(['ceo','assistante','propria']);
  const parsed = addActionSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const data = parsed.data;
  const supabase = createClient();

  const { error } = await supabase.from('hostaway_pre_review_actions').insert({
    tracking_id: data.tracking_id,
    action_type: data.action_type,
    description: data.description ?? null,
    amount: data.amount ?? null,
    currency: data.currency ?? 'MAD',
    performed_by: user.id,
  } as any);
  if (error) return { ok: false as const, error: error.message };

  // Bascule la carte en "action_lancee" si pas déjà finalisée
  const { data: t } = await supabase
    .from('hostaway_pre_review_tracking')
    .select('kanban_status')
    .eq('id', data.tracking_id)
    .single();
  const cur = (t as any)?.kanban_status;
  if (cur && cur !== 'accomplie' && cur !== 'ratee') {
    await supabase
      .from('hostaway_pre_review_tracking')
      .update({ kanban_status: 'action_lancee' } as any)
      .eq('id', data.tracking_id);
  }

  await logReviewEvent(supabase, {
    review_kind: 'preventif', review_id: data.tracking_id, event_type: 'relance',
    description: `Action ${data.action_type}${data.description ? ` — ${data.description}` : ''}`,
    actor_id: user.id,
  });

  revalidatePath('/propria/avis/preventif');
  return { ok: true as const };
}

export async function setPreReviewNoteAction(input: { tracking_id: string; notes: string | null }) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('hostaway_pre_review_tracking')
    .update({ internal_notes: input.notes ?? null } as any)
    .eq('id', input.tracking_id);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/avis/preventif');
  return { ok: true as const };
}

/**
 * Action manuelle pour forcer la sync des trackings (création + bascule).
 * Utile depuis le bouton "Sync" sur la page Kanban 2.
 */
export async function triggerPreReviewSyncAction() {
  await assertRole(['ceo','assistante','propria','developer']);
  const supabase = createClient();
  try {
    const result = await syncPreReviewTrackings(supabase as any);
    revalidatePath('/propria/avis/preventif');
    return { ok: true as const, ...result };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur' };
  }
}
