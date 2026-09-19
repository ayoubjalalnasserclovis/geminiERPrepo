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
  TEAM_ROLES: [
    'ceo', 'developer', 'chef_projet', 'sourcing', 'commercial',
    'finance', 'marketing', 'assistante', 'achats', 'propria', 'menage',
  ],
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

const mockLogPropriaAudit = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/propria/audit', () => ({
  logPropriaAudit: (...args: any[]) => mockLogPropriaAudit(...args),
}));

vi.mock('@/lib/propria/checkup-notify', () => ({
  notifyCheckupAssigned: vi.fn().mockResolvedValue(true),
  notifyCheckupToValidate: vi.fn().mockResolvedValue(true),
  notifyCheckupValidated: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/propria/notify', () => ({
  notifyUsers: vi.fn().mockResolvedValue(true),
}));

import {
  createCheckupAction,
  startCheckupAction,
  upsertCheckupItemAction,
  cancelCheckupAction,
  reopenCheckupAction,
  deleteCheckupAction,
} from '@/app/(team)/propria/checkups/actions';
import {
  addCommentAction,
  getCommentsAction,
} from '@/app/(team)/propria/comments-actions';

describe('Multi-Step Workflow: Propria Property Checkups, Inspection Checklist & Collaboration', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const ASSISTANTE_ID = '22222222-1111-2222-3333-444444444444';
  const PROPRIA_USER_ID = '33333333-1111-2222-3333-444444444444';
  const CHEF_ID = '44444444-1111-2222-3333-444444444444';
  const CLIENT_ID = '55555555-1111-2222-3333-444444444444';

  const UNIT_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const CHECKUP_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogPropriaAudit.mockClear();

    mockSupabase.db.profiles = [
      { id: CEO_ID, full_name: 'Clovis CEO', role: 'ceo', is_active: true },
      { id: ASSISTANTE_ID, full_name: 'Sarah Assistante', role: 'assistante', is_active: true },
      { id: PROPRIA_USER_ID, full_name: 'Youssef Propria', role: 'propria', is_active: true },
      { id: CHEF_ID, full_name: 'Karim Chef', role: 'chef_projet', is_active: true },
    ];

    mockSupabase.db.propria_units = [
      { id: UNIT_ID, code: 'villa-01', name: 'Suite Palmeraie' },
    ];

    mockSupabase.db.propria_checkups = [];
    mockSupabase.db.propria_checkup_items = [];
    mockSupabase.db.propria_comments = [];
  });

  it('Step 1: Assistante schedules a new property checkup with unit scope and due date', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('scope', `unit:${UNIT_ID}`);
    fd.append('due_date', '2026-06-15');
    fd.append('assigned_to_id', PROPRIA_USER_ID);
    fd.append('observations', 'Checkup complet avant saison estivale');

    const res = await createCheckupAction(fd);
    // Since redirect is called on success, handle result
    expect(res?.ok ?? true).toBe(true);

    const checkups = mockSupabase.db.propria_checkups;
    expect(checkups.length).toBe(1);
    expect(checkups[0].propria_unit_id).toBe(UNIT_ID);
    expect(checkups[0].status).toBe('a_faire');
    expect(checkups[0].assigned_to_id).toBe(PROPRIA_USER_ID);
    expect(mockLogPropriaAudit).toHaveBeenCalled();
  });

  it('Step 2: Anti-duplicate guard: scheduling another checkup for same unit on same date is rejected', async () => {
    mockSupabase.db.propria_checkups = [
      {
        id: CHECKUP_ID,
        propria_unit_id: UNIT_ID,
        property_id: null,
        due_date: '2026-06-15',
        status: 'a_faire',
        deleted_at: null,
      },
    ];

    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('scope', `unit:${UNIT_ID}`);
    fd.append('due_date', '2026-06-15');

    const res = await createCheckupAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('déjà programmé');
    }
  });

  it('Step 3: Assignee role guard: assigning chef_projet to checkup is rejected', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('scope', `unit:${UNIT_ID}`);
    fd.append('due_date', '2026-06-20');
    fd.append('assigned_to_id', CHEF_ID); // chef_projet not allowed on checkups

    const res = await createCheckupAction(fd);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Seuls CEO, assistante ou propria');
    }
  });

  it('Step 4: Field operator starts checkup transitioning status to en_cours with started_at timestamp', async () => {
    mockSupabase.db.propria_checkups = [
      {
        id: CHECKUP_ID,
        propria_unit_id: UNIT_ID,
        status: 'a_faire',
        started_at: null,
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    const res = await startCheckupAction(CHECKUP_ID);
    expect(res.ok).toBe(true);

    const checkup = mockSupabase.db.propria_checkups.find((c: any) => c.id === CHECKUP_ID);
    expect(checkup.status).toBe('en_cours');
    expect(checkup.started_at).toBeTruthy();
  });

  it('Step 5: Operator fills checklist item status (clim_telecommande: ok)', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const res = await upsertCheckupItemAction({
      checkup_id: CHECKUP_ID,
      item_key: 'clim_telecommande',
      status: 'ok',
      note: 'Télécommande testée et fonctionnelle',
    });

    expect(res.ok).toBe(true);
    const items = mockSupabase.db.propria_checkup_items;
    expect(items.length).toBe(1);
    expect(items[0].item_key).toBe('clim_telecommande');
    expect(items[0].status).toBe('ok');
  });

  it('Step 6: Team members collaborate via internal comments on the checkup', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const addRes = await addCommentAction({
      entity_type: 'checkup',
      entity_id: CHECKUP_ID,
      body: 'Attention petite fuite sous lavabo SDB 2 à surveiller.',
    });
    expect(addRes.ok).toBe(true);

    // Retrieve comments as Assistante
    setMockUser('assistante', ASSISTANTE_ID);
    const getRes = await getCommentsAction({
      entity_type: 'checkup',
      entity_id: CHECKUP_ID,
    });

    expect(getRes.ok).toBe(true);
    if (getRes.ok) {
      expect(getRes.comments.length).toBe(1);
      expect(getRes.comments[0].body).toContain('petite fuite');
      expect(getRes.comments[0].author_name).toBe('Youssef Propria');
    }
  });

  it('Step 7: Back office reopens checkup from a_valider to en_cours resetting classifications', async () => {
    mockSupabase.db.propria_checkups = [
      {
        id: CHECKUP_ID,
        status: 'a_valider',
        submitted_at: '2026-06-15T12:00:00Z',
        final_classification: 'B',
        final_summary: 'Bon état général',
        deleted_at: null,
      },
    ];

    setMockUser('assistante', ASSISTANTE_ID);

    const res = await reopenCheckupAction(CHECKUP_ID);
    expect(res.ok).toBe(true);

    const checkup = mockSupabase.db.propria_checkups.find((c: any) => c.id === CHECKUP_ID);
    expect(checkup.status).toBe('en_cours');
    expect(checkup.submitted_at).toBeNull();
    expect(checkup.final_classification).toBeNull();
    expect(checkup.final_summary).toBeNull();
  });

  it('Step 8: Back office cancels checkup updating status to annule', async () => {
    mockSupabase.db.propria_checkups = [
      {
        id: CHECKUP_ID,
        status: 'a_faire',
        deleted_at: null,
      },
    ];

    setMockUser('assistante', ASSISTANTE_ID);

    const res = await cancelCheckupAction(CHECKUP_ID, 'Changement de locataire reporté');
    expect(res.ok).toBe(true);

    const checkup = mockSupabase.db.propria_checkups.find((c: any) => c.id === CHECKUP_ID);
    expect(checkup.status).toBe('annule');
    expect(mockLogPropriaAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: CHECKUP_ID,
        action: 'status_change',
        label: 'Annulation check-up',
      }),
    );
  });

  it('Step 9: CEO soft-deletes checkup stamping deleted_at with CEO-only audit', async () => {
    mockSupabase.db.propria_checkups = [
      {
        id: CHECKUP_ID,
        status: 'annule',
        deleted_at: null,
      },
    ];

    setMockUser('ceo', CEO_ID);

    const res = await deleteCheckupAction(CHECKUP_ID);
    expect(res.ok).toBe(true);

    const checkup = mockSupabase.db.propria_checkups.find((c: any) => c.id === CHECKUP_ID);
    expect(checkup.deleted_at).toBeTruthy();
  });

  it('Step 10: Security: Non-CEO cannot delete checkup, and client is denied access', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const resPropria = await deleteCheckupAction(CHECKUP_ID);
    expect(resPropria.ok).toBe(false);
    if (!resPropria.ok) {
      expect(resPropria.error).toBe('Permission refusée');
    }

    setMockUser('client', CLIENT_ID);
    const startRes = await startCheckupAction(CHECKUP_ID);
    expect(startRes.ok).toBe(false);
    if (!startRes.ok) {
      expect(startRes.error).toBe('Permission refusée');
    }

    await expect(getCommentsAction({ entity_type: 'checkup', entity_id: CHECKUP_ID })).rejects.toThrow('Permission refusée');
  });
});
