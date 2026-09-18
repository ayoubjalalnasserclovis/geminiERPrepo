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
  refusePropriaMandateAction,
  activatePropriaForProjectAction,
} from '@/app/(team)/propria/biens/activate/actions';

describe('Multi-Step Workflow: Propria Property Activation, Refusal & Mutual Exclusion (BUG-043)', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const PROJECT_ID = '22222222-1111-2222-3333-444444444444';
  const PROPERTY_ID = '33333333-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          reference: 'PRJ-2026-001',
          property_id: PROPERTY_ID,
          current_phase: 'livraison',
        },
      ],
      properties: [
        {
          id: PROPERTY_ID,
          name: 'Appartement Hivernage',
          propria_managed_at: null,
          propria_refused_at: null,
          propria_refused_reason: null,
        },
      ],
      propria_audit_log: [],
      profiles: [{ id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' }],
    });
    setMockUser('ceo', CEO_USER_ID);
  });

  it('Step 1 -> 4: Complete activation flow from project to Propria managed estate', async () => {
    const form = new FormData();
    form.append('project_id', PROJECT_ID);
    form.append('propria_internal_code', 'HIV-101');
    form.append('propria_owner_name', 'M. Karim Bensouda');
    form.append('propria_owner_phone', '+212600112233');
    form.append('propria_owner_email', 'karim@example.com');
    form.append('propria_capacity_voyageurs', '4');
    form.append('propria_nb_chambres', '2');
    form.append('propria_commission_rate', '20');
    form.append('propria_base_price_per_night', '1200');
    form.append('propria_mandate_start', '2026-10-01');
    form.append('propria_water_meter', 'WTR-9988');
    form.append('propria_electricity_meter', 'ELEC-4455');
    form.append('propria_syndic_to_pay', 'on');
    form.append('propria_syndic_amount', '450');

    await activatePropriaForProjectAction(form);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
    expect(prop.propria_managed_at).toBeDefined();
    expect(prop.propria_internal_code).toBe('HIV-101');
    expect(prop.propria_owner_name).toBe('M. Karim Bensouda');
    expect(prop.propria_commission_rate).toBe(20);
    expect(prop.propria_syndic_to_pay).toBe(true);
    expect(prop.propria_syndic_amount).toBe(450);
  });

  it('Refusal flow: client declines Propria mandate with documented reason', async () => {
    const form = new FormData();
    form.append('project_id', PROJECT_ID);
    form.append('reason', 'Propriétaire souhaite occuper le bien en résidence secondaire');

    await refusePropriaMandateAction(form);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
    expect(prop.propria_refused_at).toBeDefined();
    expect(prop.propria_refused_reason).toContain('résidence secondaire');
    expect(prop.propria_managed_at).toBeNull();
  });

  it('Clearing refusal on activation: client changes mind and activates (BUG-043)', async () => {
    // 1. Property was previously refused
    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
    prop.propria_refused_at = '2026-08-01T10:00:00Z';
    prop.propria_refused_reason = 'Hesitant initialement';

    // 2. Client later signs mandate -> activate
    const form = new FormData();
    form.append('project_id', PROJECT_ID);
    form.append('propria_internal_code', 'HIV-102');
    form.append('propria_commission_rate', '18');

    await activatePropriaForProjectAction(form);

    // 3. Verify refusal flags are explicitly wiped to avoid DB constraint violation
    const updated = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
    expect(updated.propria_managed_at).toBeDefined();
    expect(updated.propria_refused_at).toBeNull();
    expect(updated.propria_refused_reason).toBeNull();
  });

  it('Idempotence and conflict guard enforcement', async () => {
    // Mark property as already managed
    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
    prop.propria_managed_at = new Date().toISOString();

    // 1. Attempting to refuse an already managed property must throw
    const refuseForm = new FormData();
    refuseForm.append('project_id', PROJECT_ID);
    refuseForm.append('reason', 'Late refusal attempt');

    await expect(refusePropriaMandateAction(refuseForm)).rejects.toThrow(
      'Ce bien est déjà sous gestion Propria — refus impossible.',
    );

    // 2. Attempting to re-activate an already managed property must throw
    const actForm = new FormData();
    actForm.append('project_id', PROJECT_ID);
    actForm.append('propria_internal_code', 'HIV-DUP');

    await expect(activatePropriaForProjectAction(actForm)).rejects.toThrow(
      'Ce bien est déjà sous gestion Propria',
    );
  });
});
