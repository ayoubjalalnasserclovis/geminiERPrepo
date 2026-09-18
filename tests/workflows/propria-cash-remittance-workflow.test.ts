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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

import {
  createCashReservationAction,
  markRecoveredAction,
  markRemittedToCeoAction,
  createDirectReservationAction,
  collectDirectReservationAction,
  createCollectTaskAction,
} from '@/app/(team)/propria/reservations-cash/actions';

describe('Multi-Step Workflow: Propria Cash Reservations -> Recovery -> CEO Remittance (BUG-034)', () => {
  const PROPRIA_USER_ID = '11111111-2222-3333-4444-555555555555';
  const CEO_USER_ID = '22222222-3333-4444-5555-666666666666';
  const UNIT_ID = '33333333-4444-5555-6666-777777777777';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Appartement 101', status: 'actif' }],
      propria_cash_reservations: [],
      propria_direct_reservations: [],
      propria_interventions: [],
    });
    setMockUser('propria', PROPRIA_USER_ID);
  });

  it('runs complete cash reservation lifecycle and enforces recovery before CEO remittance', async () => {
    // 1. Create cash reservation
    const form = new FormData();
    form.append('propria_unit_id', UNIT_ID);
    form.append('voyageur_name', 'M. Dupont');
    form.append('arrival_date', '2026-09-20');
    form.append('departure_date', '2026-09-25');
    form.append('nb_nights', '5');
    form.append('amount_mad', '3500');

    await createCashReservationAction(form);

    const reservations = mockSupabase.db.propria_cash_reservations;
    expect(reservations).toHaveLength(1);
    const resa = reservations[0];
    expect(resa.amount_mad).toBe(3500);
    expect(resa.recovered).toBeFalsy();
    expect(resa.remitted_to_ceo).toBeFalsy();

    // 2. Dispatch a field collection task
    const taskRes = await createCollectTaskAction({
      source: 'cash',
      reservation_id: resa.id,
      note: 'Récupérer le cash à l’arrivée',
    });
    expect(taskRes.ok).toBe(true);
    expect(taskRes.already).toBe(false);

    // Verify duplicate task creation is prevented
    const dupTaskRes = await createCollectTaskAction({
      source: 'cash',
      reservation_id: resa.id,
    });
    expect(dupTaskRes.ok).toBe(true);
    expect(dupTaskRes.already).toBe(true);

    // 3. Attempt to mark cash as remitted to CEO BEFORE it has been recovered -> MUST FAIL (BUG-034)
    setMockUser('ceo', CEO_USER_ID);
    await expect(markRemittedToCeoAction(resa.id)).rejects.toThrow(
      'Le cash doit d\'abord être marqué comme récupéré auprès du voyageur.',
    );

    // 4. Mark cash as recovered by field staff
    setMockUser('propria', PROPRIA_USER_ID);
    await markRecoveredAction(resa.id);

    const afterRecovery = mockSupabase.db.propria_cash_reservations.find((r: any) => r.id === resa.id);
    expect(afterRecovery.recovered).toBe(true);
    expect(afterRecovery.recovered_at).toBeDefined();

    // 5. Non-CEO role attempts to mark as remitted to CEO -> blocked by RBAC
    await expect(markRemittedToCeoAction(resa.id)).rejects.toThrow('Permission refusée');

    // 6. CEO marks cash as remitted -> SUCCESS
    setMockUser('ceo', CEO_USER_ID);
    await markRemittedToCeoAction(resa.id);

    const afterRemitted = mockSupabase.db.propria_cash_reservations.find((r: any) => r.id === resa.id);
    expect(afterRemitted.remitted_to_ceo).toBe(true);
    expect(afterRemitted.remitted_at).toBeDefined();
    expect(afterRemitted.remitted_confirmed_by).toBe(CEO_USER_ID);

    // 7. Prevent double remittance or modifying once remitted
    await expect(markRemittedToCeoAction(resa.id)).rejects.toThrow('Cette réservation a déjà été remise au CEO.');
    await expect(markRecoveredAction(resa.id)).rejects.toThrow('Impossible de modifier : le cash a déjà été remis au CEO.');
  });
});
