import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';
import { bulkManageAcomptesAction } from '@/app/(team)/projects/[id]/bulk-acomptes-actions';

vi.mock('server-only', () => ({}));
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

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

describe('Bulk Acomptes Actions Suite (BUG-025)', () => {
  const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
  const LOT_ID = '22222222-2222-2222-2222-222222222222';
  const PAYMENT_ID = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db['travaux_lots'] = [
      { id: LOT_ID, project_id: PROJECT_ID, devis_artisan_mad: 10000 },
    ];
    mockSupabase.db['travaux_payments'] = [
      {
        id: PAYMENT_ID,
        project_id: PROJECT_ID,
        lot_id: LOT_ID,
        status: 'pending',
        amount_total: 3000,
        acompte_number: 1,
        deleted_at: null,
      },
    ];
  });

  it('rejects role achats when targeting travaux module (BUG-025)', async () => {
    setMockUser('achats', 'user-achats-01');

    const res = await bulkManageAcomptesAction({
      project_id: PROJECT_ID,
      source: 'travaux',
      lot_ids: [LOT_ID],
      op: 'set_date',
      scheduled_date: '2026-08-01',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Permission refusée pour ce module');
    }
  });

  it('rejects role achats when targeting services module (BUG-025)', async () => {
    setMockUser('achats', 'user-achats-01');

    const res = await bulkManageAcomptesAction({
      project_id: PROJECT_ID,
      source: 'services',
      lot_ids: [LOT_ID],
      op: 'set_date',
      scheduled_date: '2026-08-01',
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Permission refusée pour ce module');
    }
  });

  it('allows role chef_projet to update date on travaux module', async () => {
    setMockUser('chef_projet', 'user-chef-01');

    const res = await bulkManageAcomptesAction({
      project_id: PROJECT_ID,
      source: 'travaux',
      lot_ids: [LOT_ID],
      op: 'set_date',
      scheduled_date: '2026-08-01',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.affected).toBe(1);
    }
  });
});
