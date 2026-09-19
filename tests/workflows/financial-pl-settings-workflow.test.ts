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

const mockLogFinanceAudit = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: (...args: any[]) => mockLogFinanceAudit(...args),
}));

import {
  updatePhaseWeightAction,
  updateTargetPayrollAction,
  setProjectOverrideAction,
  deleteProjectOverrideAction,
} from '@/app/(team)/settings/pl-config/actions';
import {
  getPhaseWeights,
  getTargetPayrolls,
  getProjectOverride,
} from '@/lib/finance/pl-settings';

describe('Multi-Step Workflow: Financial P&L Settings, Phase Weights & Target Payroll', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const FINANCE_ID = '22222222-1111-2222-3333-444444444444';
  const DEV_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const PROJECT_ID = 'aaaa1111-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogFinanceAudit.mockClear();

    mockSupabase.db.pl_phase_weights = [];
    mockSupabase.db.pl_target_payroll_monthly = [];
    mockSupabase.db.project_pl_overrides = [];
  });

  it('Step 1: CEO updates phase weight coefficient for travaux phase to 1.5', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('phase', 'travaux');
    fd.append('weight', '1.5');

    const res = await updatePhaseWeightAction(fd);
    expect(res.ok).toBe(true);

    const weights = mockSupabase.db.pl_phase_weights;
    expect(weights.length).toBe(1);
    expect(weights[0].phase).toBe('travaux');
    expect(weights[0].weight).toBe(1.5);
    expect(weights[0].updated_by).toBe(CEO_ID);
    expect(mockLogFinanceAudit).toHaveBeenCalled();
  });

  it('Step 2: Finance user updates phase weight coefficient for design phase to 1.2', async () => {
    setMockUser('finance', FINANCE_ID);

    const fd = new FormData();
    fd.append('phase', 'design');
    fd.append('weight', '1.2');

    const res = await updatePhaseWeightAction(fd);
    expect(res.ok).toBe(true);

    const weights = mockSupabase.db.pl_phase_weights;
    expect(weights.length).toBe(1);
    expect(weights[0].phase).toBe('design');
    expect(weights[0].weight).toBe(1.2);
  });

  it('Step 3: getPhaseWeights retrieves active coefficients sorted by phase', async () => {
    mockSupabase.db.pl_phase_weights = [
      { phase: 'design', weight: 1.2, updated_at: '2026-06-01T00:00:00Z', updated_by: FINANCE_ID },
      { phase: 'travaux', weight: 1.5, updated_at: '2026-06-01T00:00:00Z', updated_by: CEO_ID },
    ];

    const weights = await getPhaseWeights();
    expect(weights.length).toBe(2);
    expect(weights.find((w) => w.phase === 'travaux')?.weight).toBe(1.5);
  });

  it('Step 4: CEO sets target payroll for 2026-06 to 45,000 EUR with strategic rationale notes', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('month', '2026-06');
    fd.append('amount', '45000');
    fd.append('notes', 'Recrutement 2 conducteurs de travaux');

    const res = await updateTargetPayrollAction(fd);
    expect(res.ok).toBe(true);

    const payrolls = mockSupabase.db.pl_target_payroll_monthly;
    expect(payrolls.length).toBe(1);
    expect(payrolls[0].month).toBe('2026-06');
    expect(payrolls[0].amount_eur).toBe(45000);
    expect(payrolls[0].notes).toContain('Recrutement');
  });

  it('Step 5: getTargetPayrolls retrieves monthly payroll target history', async () => {
    mockSupabase.db.pl_target_payroll_monthly = [
      { month: '2026-06', amount_eur: 45000, notes: 'Recrutement', updated_at: '2026-06-01T00:00:00Z', updated_by: CEO_ID },
    ];

    const payrolls = await getTargetPayrolls('2026-01', '2026-12');
    expect(payrolls.length).toBe(1);
    expect(payrolls[0].amount_eur).toBe(45000);
  });

  it('Step 6: Finance user sets project-specific P&L multiplier for complex project', async () => {
    setMockUser('finance', FINANCE_ID);

    const fd = new FormData();
    fd.append('project_id', PROJECT_ID);
    fd.append('multiplier', '1.8');
    fd.append('notes', 'Riad complexe avec terrassement lourd');

    const res = await setProjectOverrideAction(fd);
    expect(res.ok).toBe(true);

    const overrides = mockSupabase.db.project_pl_overrides;
    expect(overrides.length).toBe(1);
    expect(overrides[0].project_id).toBe(PROJECT_ID);
    expect(overrides[0].weight_multiplier).toBe(1.8);
    expect(overrides[0].notes).toContain('Riad complexe');
  });

  it('Step 7: getProjectOverride retrieves project custom multiplier', async () => {
    mockSupabase.db.project_pl_overrides = [
      {
        project_id: PROJECT_ID,
        weight_multiplier: 1.8,
        notes: 'Riad complexe',
        updated_at: '2026-06-01T00:00:00Z',
        updated_by: FINANCE_ID,
      },
    ];

    const override = await getProjectOverride(PROJECT_ID);
    expect(override).toBeTruthy();
    expect(override?.weight_multiplier).toBe(1.8);
  });

  it('Step 8: CEO removes project override restoring default phase weighting', async () => {
    mockSupabase.db.project_pl_overrides = [
      {
        project_id: PROJECT_ID,
        weight_multiplier: 1.8,
        notes: 'Riad complexe',
      },
    ];

    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('project_id', PROJECT_ID);

    const res = await deleteProjectOverrideAction(fd);
    expect(res.ok).toBe(true);

    const override = await getProjectOverride(PROJECT_ID);
    expect(override).toBeNull();
  });

  it('Step 9: Security: Developer and client roles cannot modify P&L settings', async () => {
    setMockUser('developer', DEV_ID);

    const fd = new FormData();
    fd.append('phase', 'travaux');
    fd.append('weight', '2.0');

    const resDev = await updatePhaseWeightAction(fd);
    expect(resDev.ok).toBe(false);
    if (!resDev.ok) {
      expect(resDev.error).toBe('Permission refusée');
    }

    setMockUser('client', CLIENT_ID);
    const resClient = await updateTargetPayrollAction(fd);
    expect(resClient.ok).toBe(false);
  });

  it('Step 10: Validation guards: weight > 10, negative weight, or invalid month format are rejected', async () => {
    setMockUser('ceo', CEO_ID);

    // Weight > 10
    const fdHigh = new FormData();
    fdHigh.append('phase', 'travaux');
    fdHigh.append('weight', '15');
    const resHigh = await updatePhaseWeightAction(fdHigh);
    expect(resHigh.ok).toBe(false);

    // Negative weight
    const fdNeg = new FormData();
    fdNeg.append('phase', 'travaux');
    fdNeg.append('weight', '-1');
    const resNeg = await updatePhaseWeightAction(fdNeg);
    expect(resNeg.ok).toBe(false);

    // Invalid month format
    const fdMonth = new FormData();
    fdMonth.append('month', '2026/06');
    fdMonth.append('amount', '50000');
    const resMonth = await updateTargetPayrollAction(fdMonth);
    expect(resMonth.ok).toBe(false);
  });
});
