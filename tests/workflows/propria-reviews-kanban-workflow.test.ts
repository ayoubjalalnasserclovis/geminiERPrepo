import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}));

vi.mock('@/lib/auth/require', () => ({
  assertRole: vi.fn().mockImplementation(async (allowed: Role[]) => {
    const user = getMockUser();
    if (!allowed.includes(user.role)) throw new Error('Permission refusée');
    return user;
  }),
  requireRole: vi.fn().mockImplementation(async (allowed: Role[]) => {
    const user = getMockUser();
    if (!allowed.includes(user.role)) throw new Error('Permission refusée');
    return user;
  }),
  getSessionUser: vi.fn().mockImplementation(async () => getMockUser()),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

const mockNotifyUsers = vi.fn().mockResolvedValue({ ok: true });
vi.mock('@/lib/propria/notify', () => ({
  notifyUsers: (...args: any[]) => mockNotifyUsers(...args),
}));

vi.mock('@/lib/propria/pre-review-tracking', () => ({
  syncPreReviewTrackings: vi.fn().mockResolvedValue({ created: 3, transitioned: 2 }),
}));

import {
  moveReviewColumnAction,
  assignReviewAction,
  setReviewInternalNoteAction,
  getReviewEventsAction,
  assignPreReviewAction,
  setPreReviewSentimentAction,
  setPreReviewMainCauseAction,
  movePreReviewKanbanAction,
  addPreReviewActionAction,
  setPreReviewNoteAction,
  triggerPreReviewSyncAction,
} from '@/app/(team)/propria/avis/actions';

describe('Multi-Step Workflow: Propria Reviews Kanban & Incident Prevention System', () => {
  const PROPRIA_USER_ID = '11111111-2222-3333-4444-555555555555';
  const ASSISTANTE_ID = '22222222-1111-2222-3333-444444444444';
  const CEO_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const REVIEW_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const TRACKING_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockNotifyUsers.mockClear();

    mockSupabase.db.profiles = [
      { id: PROPRIA_USER_ID, full_name: 'Youssef Propria' },
      { id: ASSISTANTE_ID, full_name: 'Sarah Assistante' },
      { id: CEO_ID, full_name: 'Clovis CEO' },
    ];

    mockSupabase.db.hostaway_reviews = [
      {
        id: REVIEW_ID,
        kanban_column: 'a_traiter',
        assignee_id: null,
        internal_notes: null,
        ticket1_opened_at: null,
        ticket1_unresolved_at: null,
        ticket2_opened_at: null,
        won_at: null,
        lost_at: null,
        rating: 2,
        comment: 'Bruyant et clim en panne',
      },
    ];

    mockSupabase.db.hostaway_pre_review_tracking = [
      {
        id: TRACKING_ID,
        kanban_status: 'nouveau',
        sentiment: null,
        main_cause: null,
        assignee_id: null,
        internal_notes: null,
        completed_at: null,
        completion_reason: null,
        reservation_id: 'res-999',
      },
    ];

    mockSupabase.db.hostaway_pre_review_actions = [];
    mockSupabase.db.propria_review_events = [];
  });

  it('Step 1: Move published review to ticket1_ouvert automatically populates ticket1_opened_at and records audit event', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await moveReviewColumnAction({
      review_id: REVIEW_ID,
      column: 'ticket1_ouvert',
    });

    expect(res.ok).toBe(true);
    const review = mockSupabase.db.hostaway_reviews.find((r: any) => r.id === REVIEW_ID);
    expect(review.kanban_column).toBe('ticket1_ouvert');
    expect(review.ticket1_opened_at).toBe(new Date().toISOString().slice(0, 10));

    const events = mockSupabase.db.propria_review_events;
    expect(events.length).toBe(1);
    expect(events[0].event_type).toBe('statut');
    expect(events[0].description).toBe('Colonne → 1er ticket ouvert');
  });

  it('Step 2: Assign published review to Assistante updates assignee, logs assignment event, and notifies user', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await assignReviewAction({
      review_id: REVIEW_ID,
      assignee_id: ASSISTANTE_ID,
    });

    expect(res.ok).toBe(true);
    const review = mockSupabase.db.hostaway_reviews.find((r: any) => r.id === REVIEW_ID);
    expect(review.assignee_id).toBe(ASSISTANTE_ID);

    expect(mockNotifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: PROPRIA_USER_ID,
        userIds: [ASSISTANTE_ID],
        kind: 'assignation',
      }),
    );

    const events = mockSupabase.db.propria_review_events;
    expect(events.some((e: any) => e.event_type === 'assignation' && e.description.includes('Sarah Assistante'))).toBe(true);
  });

  it('Step 3: Escalate review to ticket1_non_resolu then ticket2_ouvert auto-stamps progress dates', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    await moveReviewColumnAction({ review_id: REVIEW_ID, column: 'ticket1_non_resolu' });
    let review = mockSupabase.db.hostaway_reviews.find((r: any) => r.id === REVIEW_ID);
    expect(review.ticket1_unresolved_at).toBe(new Date().toISOString().slice(0, 10));

    await moveReviewColumnAction({ review_id: REVIEW_ID, column: 'ticket2_ouvert' });
    review = mockSupabase.db.hostaway_reviews.find((r: any) => r.id === REVIEW_ID);
    expect(review.ticket2_opened_at).toBe(new Date().toISOString().slice(0, 10));
  });

  it('Step 4: Attach internal review note saves content and audit author without altering column', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await setReviewInternalNoteAction({
      review_id: REVIEW_ID,
      notes: 'Guest contacted on WhatsApp. Agreed to remove review if cleaning fee is refunded.',
    });

    expect(res.ok).toBe(true);
    const review = mockSupabase.db.hostaway_reviews.find((r: any) => r.id === REVIEW_ID);
    expect(review.internal_notes).toContain('cleaning fee is refunded');
    expect(review.internal_handled_by).toBe(PROPRIA_USER_ID);
  });

  it('Step 5: Successfully contest or resolve review by moving to gagne updates won_at timestamp', async () => {
    setMockUser('ceo', CEO_ID);

    const res = await moveReviewColumnAction({
      review_id: REVIEW_ID,
      column: 'gagne',
    });

    expect(res.ok).toBe(true);
    const review = mockSupabase.db.hostaway_reviews.find((r: any) => r.id === REVIEW_ID);
    expect(review.kanban_column).toBe('gagne');
    expect(review.won_at).toBe(new Date().toISOString().slice(0, 10));
  });

  it('Step 6: Pre-review risk identification: setting mauvais sentiment transitions card from nouveau to risque', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await setPreReviewSentimentAction({
      tracking_id: TRACKING_ID,
      sentiment: 'mauvais',
    });

    expect(res.ok).toBe(true);
    const tracking = mockSupabase.db.hostaway_pre_review_tracking.find((t: any) => t.id === TRACKING_ID);
    expect(tracking.sentiment).toBe('mauvais');
    expect(tracking.kanban_status).toBe('risque');
    expect(tracking.sentiment_set_by).toBe(PROPRIA_USER_ID);

    const events = mockSupabase.db.propria_review_events;
    expect(events.some((e: any) => e.event_type === 'sentiment' && e.description === 'Sentiment → mauvais')).toBe(true);
  });

  it('Step 7: Pre-review incident diagnostic: categorize main cause with valid enum value', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await setPreReviewMainCauseAction({
      tracking_id: TRACKING_ID,
      main_cause: 'climatisation',
    });

    expect(res.ok).toBe(true);
    const tracking = mockSupabase.db.hostaway_pre_review_tracking.find((t: any) => t.id === TRACKING_ID);
    expect(tracking.main_cause).toBe('climatisation');

    const events = mockSupabase.db.propria_review_events;
    expect(events.some((e: any) => e.event_type === 'cause' && e.description.includes('Climatisation'))).toBe(true);
  });

  it('Step 8: Preventive corrective action: logging compensation triggers automatic transition to action_lancee', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await addPreReviewActionAction({
      tracking_id: TRACKING_ID,
      action_type: 'compensation',
      amount: 400,
      currency: 'MAD',
      description: 'Offert un panier de fruits et 400 MAD de réduction pour la clim en panne',
    });

    expect(res.ok).toBe(true);
    const actions = mockSupabase.db.hostaway_pre_review_actions;
    expect(actions.length).toBe(1);
    expect(actions[0].amount).toBe(400);
    expect(actions[0].action_type).toBe('compensation');

    const tracking = mockSupabase.db.hostaway_pre_review_tracking.find((t: any) => t.id === TRACKING_ID);
    expect(tracking.kanban_status).toBe('action_lancee');
  });

  it('Step 9: Conclude preventive flow: manual transition to accomplie stamps completed_at and manual reason', async () => {
    setMockUser('ceo', CEO_ID);

    const res = await movePreReviewKanbanAction({
      tracking_id: TRACKING_ID,
      status: 'accomplie',
    });

    expect(res.ok).toBe(true);
    const tracking = mockSupabase.db.hostaway_pre_review_tracking.find((t: any) => t.id === TRACKING_ID);
    expect(tracking.kanban_status).toBe('accomplie');
    expect(tracking.completed_at).toBeTruthy();
    expect(tracking.completion_reason).toBe('Décision manuelle équipe');
  });

  it('Step 10: Security & Journal audit: client cannot access review actions, and team can retrieve full history', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      moveReviewColumnAction({ review_id: REVIEW_ID, column: 'perdu' }),
    ).rejects.toThrow('Permission refusée');

    await expect(
      setPreReviewSentimentAction({ tracking_id: TRACKING_ID, sentiment: 'bon' }),
    ).rejects.toThrow('Permission refusée');

    // As Propria operator, classify sentiment then retrieve full review events journal
    setMockUser('propria', PROPRIA_USER_ID);
    await setPreReviewSentimentAction({ tracking_id: TRACKING_ID, sentiment: 'mauvais' });

    const journalRes = await getReviewEventsAction({
      review_kind: 'preventif',
      review_id: TRACKING_ID,
    });

    expect(journalRes.ok).toBe(true);
    if (journalRes.ok) {
      expect(journalRes.events.length).toBe(1);
      expect(journalRes.events[0].event_type).toBe('sentiment');
    }
  });
});
