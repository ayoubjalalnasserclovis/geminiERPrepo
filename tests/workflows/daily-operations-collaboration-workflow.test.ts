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

import {
  createStonizDailyNoteAction,
  toggleStonizDailyNoteResolvedAction,
  deleteStonizDailyNoteAction,
} from '@/app/(team)/daily/actions';
import {
  createDailyNoteAction as createPropriaDailyNoteAction,
  toggleDailyNoteResolvedAction as togglePropriaDailyNoteResolvedAction,
  deleteDailyNoteAction as deletePropriaDailyNoteAction,
} from '@/app/(team)/propria/daily/actions';

describe('Multi-Step Workflow: Daily Standup Operations & Multi-Entity Collaboration', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const CHEF_ID = '22222222-1111-2222-3333-444444444444';
  const SOURCING_ID = '33333333-1111-2222-3333-444444444444';
  const PROPRIA_USER_ID = '44444444-1111-2222-3333-444444444444';
  const CLIENT_ID = '55555555-1111-2222-3333-444444444444';
  const MENAGE_ID = '66666666-1111-2222-3333-444444444444';

  const STONIZ_NOTE_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const PROPRIA_NOTE_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();

    mockSupabase.db.stoniz_daily_notes = [];
    mockSupabase.db.propria_daily_notes = [];
  });

  it('Step 1: Chef de projet posts a Stoniz daily standup note for the team', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const fd = new FormData();
    fd.append('content', 'Chantier Villa Majorelle: livraison carrelage retardée, attente retour transporteur.');

    const res = await createStonizDailyNoteAction(fd);
    expect(res.ok).toBe(true);

    const notes = mockSupabase.db.stoniz_daily_notes;
    expect(notes.length).toBe(1);
    expect(notes[0].content).toContain('Chantier Villa Majorelle');
    expect(notes[0].created_by_id).toBe(CHEF_ID);
  });

  it('Step 2: Sourcing agent resolves the Stoniz daily note once vendor confirms delivery', async () => {
    mockSupabase.db.stoniz_daily_notes = [
      {
        id: STONIZ_NOTE_ID,
        content: 'Chantier Villa Majorelle: livraison carrelage',
        created_by_id: CHEF_ID,
        resolved_at: null,
        resolved_by_id: null,
        deleted_at: null,
      },
    ];

    setMockUser('sourcing', SOURCING_ID);

    const res = await toggleStonizDailyNoteResolvedAction(STONIZ_NOTE_ID, true);
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.stoniz_daily_notes.find((n: any) => n.id === STONIZ_NOTE_ID);
    expect(note.resolved_at).toBeTruthy();
    expect(note.resolved_by_id).toBe(SOURCING_ID);
  });

  it('Step 3: Chef de projet unresolves the note if additional issues arise', async () => {
    mockSupabase.db.stoniz_daily_notes = [
      {
        id: STONIZ_NOTE_ID,
        content: 'Chantier Villa Majorelle: livraison carrelage',
        resolved_at: '2026-06-01T10:00:00Z',
        resolved_by_id: SOURCING_ID,
        deleted_at: null,
      },
    ];

    setMockUser('chef_projet', CHEF_ID);

    const res = await toggleStonizDailyNoteResolvedAction(STONIZ_NOTE_ID, false);
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.stoniz_daily_notes.find((n: any) => n.id === STONIZ_NOTE_ID);
    expect(note.resolved_at).toBeNull();
    expect(note.resolved_by_id).toBeNull();
  });

  it('Step 4: Non-CEO collaborator cannot delete a Stoniz daily note (strictly CEO protected)', async () => {
    mockSupabase.db.stoniz_daily_notes = [
      { id: STONIZ_NOTE_ID, content: 'Test note', deleted_at: null },
    ];

    setMockUser('chef_projet', CHEF_ID);

    const res = await deleteStonizDailyNoteAction(STONIZ_NOTE_ID);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Seul le CEO peut supprimer.');
    }
  });

  it('Step 5: CEO soft-deletes a Stoniz daily note stamping deleted_at', async () => {
    mockSupabase.db.stoniz_daily_notes = [
      { id: STONIZ_NOTE_ID, content: 'Test note', deleted_at: null },
    ];

    setMockUser('ceo', CEO_ID);

    const res = await deleteStonizDailyNoteAction(STONIZ_NOTE_ID);
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.stoniz_daily_notes.find((n: any) => n.id === STONIZ_NOTE_ID);
    expect(note.deleted_at).toBeTruthy();
  });

  it('Step 6: Propria operator posts an operational daily note for hospitality team', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const fd = new FormData();
    fd.append('content', 'Suite Palmeraie: climatisation bruyante signalée par voyageur, intervention planifiée 16h.');

    const res = await createPropriaDailyNoteAction(fd);
    expect(res.ok).toBe(true);

    const notes = mockSupabase.db.propria_daily_notes;
    expect(notes.length).toBe(1);
    expect(notes[0].content).toContain('Suite Palmeraie');
    expect(notes[0].created_by_id).toBe(PROPRIA_USER_ID);
  });

  it('Step 7: Propria operator resolves Propria daily note post-intervention', async () => {
    mockSupabase.db.propria_daily_notes = [
      {
        id: PROPRIA_NOTE_ID,
        content: 'Suite Palmeraie clim',
        created_by_id: PROPRIA_USER_ID,
        resolved_at: null,
        resolved_by_id: null,
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    const res = await togglePropriaDailyNoteResolvedAction(PROPRIA_NOTE_ID, true);
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.propria_daily_notes.find((n: any) => n.id === PROPRIA_NOTE_ID);
    expect(note.resolved_at).toBeTruthy();
    expect(note.resolved_by_id).toBe(PROPRIA_USER_ID);
  });

  it('Step 8: CEO soft-deletes Propria daily note', async () => {
    mockSupabase.db.propria_daily_notes = [
      { id: PROPRIA_NOTE_ID, content: 'Propria note', deleted_at: null },
    ];

    setMockUser('ceo', CEO_ID);

    const res = await deletePropriaDailyNoteAction(PROPRIA_NOTE_ID);
    expect(res.ok).toBe(true);

    const note = mockSupabase.db.propria_daily_notes.find((n: any) => n.id === PROPRIA_NOTE_ID);
    expect(note.deleted_at).toBeTruthy();
  });

  it('Step 9: Security: Client and menage roles are rejected from creating or toggling notes', async () => {
    setMockUser('client', CLIENT_ID);

    const fd = new FormData();
    fd.append('content', 'Unauthorized note');

    await expect(createStonizDailyNoteAction(fd)).rejects.toThrow('Permission refusée');
    await expect(createPropriaDailyNoteAction(fd)).rejects.toThrow('Permission refusée');

    setMockUser('menage', MENAGE_ID);
    await expect(createStonizDailyNoteAction(fd)).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Validation guards: empty notes or whitespace-only content return error', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const fdEmpty = new FormData();
    fdEmpty.append('content', '   ');

    const res = await createStonizDailyNoteAction(fdEmpty);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('Note vide ou trop longue');
    }
  });
});
