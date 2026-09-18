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
  createUpsellAction,
  setUpsellStatusAction,
  setUpsellAmountAction,
} from '@/app/(team)/propria/upsell/actions';

describe('Multi-Step Workflow: Propria Upsell -> Order -> Pricing -> Delivery Locks (BUG-039)', () => {
  const PROPRIA_USER_ID = '33333333-1111-2222-3333-444444444444';
  const UNIT_ID = '44444444-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Riad Jasmine' }],
      propria_upsells: [],
    });
    setMockUser('propria', PROPRIA_USER_ID);
  });

  it('progresses upsell order from commande to livre and blocks price mutation once delivered', async () => {
    // 1. Create upsell order (e.g. transfer aeroport initially unpriced or estimated)
    const form = new FormData();
    form.append('propria_unit_id', UNIT_ID);
    form.append('guest_name', 'Mme. Sarah Bernard');
    form.append('category', 'transfert');
    form.append('description', 'Transfert aéroport Marrakech Menara -> Riad Jasmine');
    form.append('amount_mad', '0');

    await createUpsellAction(form);

    const upsells = mockSupabase.db.propria_upsells;
    expect(upsells).toHaveLength(1);
    const order = upsells[0];
    expect(order.status).toBe('commande');
    expect(order.amount_mad).toBe(0);

    // 2. Desk confirms booking and sets negotiated price (300 MAD)
    await setUpsellAmountAction(order.id, 300);

    let current = mockSupabase.db.propria_upsells.find((u: any) => u.id === order.id);
    expect(current.amount_mad).toBe(300);

    // 3. Confirm order
    await setUpsellStatusAction(order.id, 'confirme');
    current = mockSupabase.db.propria_upsells.find((u: any) => u.id === order.id);
    expect(current.status).toBe('confirme');

    // 4. Adjust price while still in confirme state (e.g. added child seat +50 MAD)
    await setUpsellAmountAction(order.id, 350);
    current = mockSupabase.db.propria_upsells.find((u: any) => u.id === order.id);
    expect(current.amount_mad).toBe(350);

    // 5. Cancel order (e.g. guest cancelled flight) -> mark 'annule'
    await setUpsellStatusAction(order.id, 'annule');
    current = mockSupabase.db.propria_upsells.find((u: any) => u.id === order.id);
    expect(current.status).toBe('annule');

    // 6. Attempt to modify amount once cancelled -> MUST FAIL (BUG-039)
    await expect(setUpsellAmountAction(order.id, 400)).rejects.toThrow(
      'Impossible de modifier le montant d\'un upsell annulé.',
    );

    // Ensure amount remained 350
    current = mockSupabase.db.propria_upsells.find((u: any) => u.id === order.id);
    expect(current.amount_mad).toBe(350);
  });
});
