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
  addCostParamAction,
  softDeleteCostParamAction,
} from '@/app/(team)/propria/couts/actions';
import {
  resolveParam,
  computeCleaningCost,
  type CostParamRow,
} from '@/lib/propria/cost-matrix';

describe('Multi-Step Workflow: Propria Cost Matrix & Unit Profitability Engine', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const DEV_ID = '22222222-1111-2222-3333-444444444444';
  const PROPRIA_USER_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const UNIT_VILLA_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const UNIT_STUDIO_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.propria_cost_params = [];
  });

  it('Step 1: CEO defines global standard cleaning labor cost (mo_par_menage = 120 MAD)', async () => {
    setMockUser('ceo', CEO_ID);

    const formData = new FormData();
    formData.append('param_key', 'mo_par_menage');
    formData.append('value_mad', '120');
    formData.append('effective_from', '2026-01-01');
    formData.append('comment', 'Tarif de base 2026');

    await addCostParamAction(formData);

    const params = mockSupabase.db.propria_cost_params;
    expect(params.length).toBe(1);
    expect(params[0].scope).toBe('global');
    expect(params[0].param_key).toBe('mo_par_menage');
    expect(params[0].value_mad).toBe(120);
    expect(params[0].effective_from).toBe('2026-01-01');
    expect(params[0].created_by).toBe(CEO_ID);
  });

  it('Step 2: Developer role registers auxiliary global cost parameters (linen and transport)', async () => {
    setMockUser('developer', DEV_ID);

    const fd1 = new FormData();
    fd1.append('param_key', 'linge_par_chambre');
    fd1.append('value_mad', '35');
    fd1.append('effective_from', '2026-01-01');
    await addCostParamAction(fd1);

    const fd2 = new FormData();
    fd2.append('param_key', 'transport_par_menage');
    fd2.append('value_mad', '25');
    fd2.append('effective_from', '2026-01-01');
    await addCostParamAction(fd2);

    const params = mockSupabase.db.propria_cost_params;
    expect(params.length).toBe(2);
    expect(params.some((p: any) => p.param_key === 'linge_par_chambre' && p.value_mad === 35)).toBe(true);
    expect(params.some((p: any) => p.param_key === 'transport_par_menage' && p.value_mad === 25)).toBe(true);
  });

  it('Step 3: Define unit-specific override for a luxury villa with higher labor rate', async () => {
    setMockUser('ceo', CEO_ID);

    const formData = new FormData();
    formData.append('param_key', 'mo_par_menage');
    formData.append('propria_unit_id', UNIT_VILLA_ID);
    formData.append('value_mad', '180');
    formData.append('effective_from', '2026-01-01');
    formData.append('comment', 'Villa Palmeraie grande superficie');

    await addCostParamAction(formData);

    const params = mockSupabase.db.propria_cost_params;
    const villaParam = params.find((p: any) => p.propria_unit_id === UNIT_VILLA_ID);
    expect(villaParam).toBeTruthy();
    expect(villaParam.scope).toBe('unit');
    expect(villaParam.value_mad).toBe(180);
  });

  it('Step 4: Historization test: new effective rate from June creates separate row without overwriting January', async () => {
    setMockUser('ceo', CEO_ID);

    // Initial January rate
    const fdJan = new FormData();
    fdJan.append('param_key', 'mo_par_menage');
    fdJan.append('value_mad', '120');
    fdJan.append('effective_from', '2026-01-01');
    await addCostParamAction(fdJan);

    // Mid-year re-negotiated rate from June
    const fdJun = new FormData();
    fdJun.append('param_key', 'mo_par_menage');
    fdJun.append('value_mad', '135');
    fdJun.append('effective_from', '2026-06-01');
    fdJun.append('comment', 'Revalorisation estivale prestataire');
    await addCostParamAction(fdJun);

    const params = mockSupabase.db.propria_cost_params.filter((p: any) => p.param_key === 'mo_par_menage');
    expect(params.length).toBe(2);
    expect(params.some((p: any) => p.value_mad === 120 && p.effective_from === '2026-01-01')).toBe(true);
    expect(params.some((p: any) => p.value_mad === 135 && p.effective_from === '2026-06-01')).toBe(true);
  });

  it('Step 5: resolveParam temporal resolution: selects appropriate rate based on target date', () => {
    const rows: CostParamRow[] = [
      {
        id: '2',
        scope: 'global',
        propria_unit_id: null,
        param_key: 'mo_par_menage',
        value_mad: 135,
        effective_from: '2026-06-01',
        comment: null,
        created_at: '2026-05-15T00:00:00Z',
      },
      {
        id: '1',
        scope: 'global',
        propria_unit_id: null,
        param_key: 'mo_par_menage',
        value_mad: 120,
        effective_from: '2026-01-01',
        comment: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    // March 2026 -> should resolve to 120 MAD
    const marchResolved = resolveParam(rows, 'mo_par_menage', null, '2026-03-15');
    expect(marchResolved?.value_mad).toBe(120);

    // July 2026 -> should resolve to 135 MAD
    const julyResolved = resolveParam(rows, 'mo_par_menage', null, '2026-07-10');
    expect(julyResolved?.value_mad).toBe(135);
  });

  it('Step 6: resolveParam scope priority: unit-specific override takes precedence over global parameter', () => {
    const rows: CostParamRow[] = [
      {
        id: 'villa-1',
        scope: 'unit',
        propria_unit_id: UNIT_VILLA_ID,
        param_key: 'mo_par_menage',
        value_mad: 180,
        effective_from: '2026-01-01',
        comment: null,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'global-1',
        scope: 'global',
        propria_unit_id: null,
        param_key: 'mo_par_menage',
        value_mad: 120,
        effective_from: '2026-01-01',
        comment: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    ];

    const villaResolved = resolveParam(rows, 'mo_par_menage', UNIT_VILLA_ID, '2026-03-01');
    expect(villaResolved?.value_mad).toBe(180);

    const studioResolved = resolveParam(rows, 'mo_par_menage', UNIT_STUDIO_ID, '2026-03-01');
    expect(studioResolved?.value_mad).toBe(120);
  });

  it('Step 7: computeCleaningCost calculates accurate sum with room and bathroom multipliers', () => {
    const paramLookup = (key: string) => {
      const map: Record<string, number> = {
        mo_par_menage: 120,
        linge_par_chambre: 30,
        linge_par_sdb: 15,
        amortissement_linge_par_menage: 10,
        consommables_par_menage: 20,
        transport_par_menage: 25,
        frais_gestion_par_menage: 15,
      };
      return map[key] !== undefined ? map[key] : null;
    };

    const breakdown = computeCleaningCost(
      'avec_arrivee',
      { nbChambres: 2, nbSdb: 1 },
      paramLookup as any,
    );

    // Expected:
    // MO: 120
    // Linge: (30 * 2) + (15 * 1) + 10 = 85
    // Consommables: 20
    // Transport: 25
    // Frais gestion: 15
    // Total = 120 + 85 + 20 + 25 + 15 = 265 MAD
    expect(breakdown.totalMad).toBe(265);
    expect(breakdown.isPartial).toBe(false);
  });

  it('Step 8: CEO soft-deletes cost parameter stamping deleted_at without hard deleting', async () => {
    const PARAM_ID = 'aaaa1111-2222-3333-4444-555555555555';
    mockSupabase.db.propria_cost_params = [
      {
        id: PARAM_ID,
        scope: 'global',
        param_key: 'mo_par_menage',
        value_mad: 999,
        effective_from: '2026-01-01',
        deleted_at: null,
      },
    ];

    setMockUser('ceo', CEO_ID);
    await softDeleteCostParamAction(PARAM_ID);

    const item = mockSupabase.db.propria_cost_params.find((p: any) => p.id === PARAM_ID);
    expect(item.deleted_at).toBeTruthy();
  });

  it('Step 9: Security: Developer and Propria roles cannot soft-delete cost parameter (strictly CEO)', async () => {
    const PARAM_ID = 'aaaa1111-2222-3333-4444-555555555555';
    mockSupabase.db.propria_cost_params = [
      {
        id: PARAM_ID,
        scope: 'global',
        param_key: 'mo_par_menage',
        value_mad: 120,
        effective_from: '2026-01-01',
        deleted_at: null,
      },
    ];

    setMockUser('developer', DEV_ID);
    await expect(softDeleteCostParamAction(PARAM_ID)).rejects.toThrow('Permission refusée');

    setMockUser('propria', PROPRIA_USER_ID);
    await expect(softDeleteCostParamAction(PARAM_ID)).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Input validation rejects negative values and invalid date formats', async () => {
    setMockUser('ceo', CEO_ID);

    const fdNeg = new FormData();
    fdNeg.append('param_key', 'mo_par_menage');
    fdNeg.append('value_mad', '-50');
    fdNeg.append('effective_from', '2026-01-01');
    await expect(addCostParamAction(fdNeg)).rejects.toThrow('Le coût doit être ≥ 0');

    const fdDate = new FormData();
    fdDate.append('param_key', 'mo_par_menage');
    fdDate.append('value_mad', '100');
    fdDate.append('effective_from', '01/01/2026'); // Invalid format, expected YYYY-MM-DD
    await expect(addCostParamAction(fdDate)).rejects.toThrow('Date d’effet invalide');
  });
});
