import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const PROPERTY_ID = '11111111-1111-4111-8111-111111111111';
const UNIT_ID = '22222222-2222-4222-8222-222222222222';
const CLEANING_ID = '33333333-3333-4333-8333-333333333333';
const CHECKUP_ID = '44444444-4444-4444-8444-444444444444';
const PROPRIA_USER_ID = '55555555-5555-4555-8555-555555555555';

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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock('@/lib/propria/checkup-notify', () => ({
  notifyCheckupAssigned: vi.fn().mockResolvedValue(true),
  notifyCheckupToValidate: vi.fn().mockResolvedValue(true),
  notifyCheckupValidated: vi.fn().mockResolvedValue(true),
}));

describe('Propria Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      properties: [
        { id: PROPERTY_ID, name: 'Villa Majorelle', status: 'disponible' },
      ],
      propria_units: [
        { id: UNIT_ID, property_id: PROPERTY_ID, code: 'majorelle-1' },
      ],
      profiles: [
        { id: PROPRIA_USER_ID, email: 'propria@stoniz.co', role: 'propria', is_active: true },
      ],
      propria_cleanings: [
        {
          id: CLEANING_ID,
          property_id: PROPERTY_ID,
          propria_unit_id: UNIT_ID,
          status: 'a_traiter',
          assigned_to_id: PROPRIA_USER_ID,
          occurred_at: '2026-09-20T10:00:00Z',
        },
      ],
      propria_checkups: [],
      propria_checkup_items: [],
      propria_cleaning_activity: [],
    });
    setMockUser('propria', PROPRIA_USER_ID);
    vi.clearAllMocks();
  });

  describe('Cleanings (Ménage) Actions', () => {
    it('creates a cleaning task with scope and status a_traiter', async () => {
      const { createCleaningAction } = await import('@/app/(team)/propria/menage/actions');
      const fd = new FormData();
      fd.append('scope', `unit:${UNIT_ID}`);
      fd.append('occurred_at', '2026-09-25T14:00:00Z');
      fd.append('urgency', 'haute');

      await createCleaningAction(fd);

      const cleanings = mockSupabase.db.propria_cleanings;
      expect(cleanings.length).toBe(2);
      const created = cleanings.find((c) => c.urgency === 'haute');
      expect(created).toBeDefined();
      expect(created.status).toBe('a_traiter');
    });

    it('rejects cleaning creation when scope is omitted', async () => {
      const { createCleaningAction } = await import('@/app/(team)/propria/menage/actions');
      const fd = new FormData();
      fd.append('occurred_at', '2026-09-25T14:00:00Z');

      const res = await createCleaningAction(fd);
      expect(res.ok).toBe(false);
      expect((res as any).error).toBeDefined();
    });

    it('soft deletes a cleaning task when requested by CEO', async () => {
      setMockUser('ceo');
      const { deleteCleaningAction } = await import('@/app/(team)/propria/menage/actions');
      const res = await deleteCleaningAction(CLEANING_ID);
      expect(res.ok).toBe(true);

      const cleaning = mockSupabase.db.propria_cleanings.find((c) => c.id === CLEANING_ID);
      expect(cleaning.deleted_at).toBeDefined();
    });

    it('blocks field role propria from deleting a cleaning task', async () => {
      setMockUser('propria');
      const { deleteCleaningAction } = await import('@/app/(team)/propria/menage/actions');
      const res = await deleteCleaningAction(CLEANING_ID);
      expect(res.ok).toBe(false);
      expect((res as any).error).toContain('Permission refusée');
    });
  });

  describe('Checkups Actions', () => {
    it('creates a new checkup successfully', async () => {
      const { createCheckupAction } = await import('@/app/(team)/propria/checkups/actions');
      const fd = new FormData();
      fd.append('scope', `unit:${UNIT_ID}`);
      fd.append('due_date', '2026-09-28');
      fd.append('observations', 'Checkup complet post-séjour');

      await createCheckupAction(fd);

      const checkups = mockSupabase.db.propria_checkups;
      expect(checkups.length).toBe(1);
      expect(checkups[0].due_date).toBe('2026-09-28');
    });

    it('upserts a checklist item status and note', async () => {
      mockSupabase.db.propria_checkups.push({
        id: CHECKUP_ID,
        propria_unit_id: UNIT_ID,
        status: 'en_cours',
      });

      const { upsertCheckupItemAction } = await import('@/app/(team)/propria/checkups/actions');
      const res = await upsertCheckupItemAction({
        checkup_id: CHECKUP_ID,
        item_key: 'murs_peinture',
        status: 'probleme',
        note: 'Peinture écaillée',
      });

      expect(res.ok).toBe(true);
      const items = mockSupabase.db.propria_checkup_items;
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('probleme');
      expect(items[0].note).toBe('Peinture écaillée');
    });

    it('rejects invalid checklist item keys', async () => {
      const { upsertCheckupItemAction } = await import('@/app/(team)/propria/checkups/actions');
      const res = await upsertCheckupItemAction({
        checkup_id: CHECKUP_ID,
        item_key: 'non_existent_key',
        status: 'ok',
      });

      expect(res.ok).toBe(false);
      expect((res as any).error).toContain('Item de checklist inconnu');
    });
  });
});
