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
  toggleHonorairesConfirmedAction,
  setMilestoneForecastMonthAction,
} from '@/app/(team)/finance/tresorerie/honoraires-a-percevoir/actions';
import {
  STONIZ_FEE_SCHEDULE,
  STONIZ_FEES_TOTAL,
  finalStonizFees,
  standardAmountForType,
} from '@/lib/finance/stoniz-fees';

describe('Multi-Step Workflow: Treasury Honoraires Pipeline & Milestone Forecasting', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const FINANCE_ID = '22222222-1111-2222-3333-444444444444';
  const DEV_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const PROJECT_ID = 'aaaa1111-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();

    mockSupabase.db.projects = [
      {
        id: PROJECT_ID,
        name: 'Appartement Majorelle',
        phase: 'onboarding',
        honoraires_confirmed: false,
      },
    ];

    mockSupabase.db.stoniz_fees_forecast = [];
  });

  it('Step 1: Finance user marks project honoraires as confirmed for revenue forecasting', async () => {
    setMockUser('finance', FINANCE_ID);

    const res = await toggleHonorairesConfirmedAction({
      project_id: PROJECT_ID,
      confirmed: true,
    });

    expect(res.ok).toBe(true);
    const project = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(project.honoraires_confirmed).toBe(true);
  });

  it('Step 2: Set forecast month for acompte_stoniz inserts milestone row formatted to first day of month', async () => {
    setMockUser('finance', FINANCE_ID);

    const res = await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'acompte_stoniz',
      forecast_month: '2026-06',
    });

    expect(res.ok).toBe(true);
    const forecasts = mockSupabase.db.stoniz_fees_forecast;
    expect(forecasts.length).toBe(1);
    expect(forecasts[0].milestone_type).toBe('acompte_stoniz');
    expect(forecasts[0].forecast_month).toBe('2026-06-01');
    expect(forecasts[0].updated_by).toBe(FINANCE_ID);
  });

  it('Step 3: Set forecast months for compromis and 3d presentation milestones', async () => {
    setMockUser('finance', FINANCE_ID);

    await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'honoraires_compromis',
      forecast_month: '2026-08',
    });

    await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'honoraires_3d',
      forecast_month: '2026-10',
    });

    const forecasts = mockSupabase.db.stoniz_fees_forecast;
    expect(forecasts.length).toBe(2);
    expect(forecasts.some((f: any) => f.milestone_type === 'honoraires_compromis' && f.forecast_month === '2026-08-01')).toBe(true);
    expect(forecasts.some((f: any) => f.milestone_type === 'honoraires_3d' && f.forecast_month === '2026-10-01')).toBe(true);
  });

  it('Step 4: Upsert updates existing milestone forecast without creating duplicate rows', async () => {
    mockSupabase.db.stoniz_fees_forecast = [
      {
        id: 'fc-1',
        project_id: PROJECT_ID,
        milestone_type: 'honoraires_compromis',
        forecast_month: '2026-08-01',
        deleted_at: null,
      },
    ];

    setMockUser('finance', FINANCE_ID);

    const res = await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'honoraires_compromis',
      forecast_month: '2026-09',
    });

    expect(res.ok).toBe(true);
    const rows = mockSupabase.db.stoniz_fees_forecast.filter((f: any) => f.milestone_type === 'honoraires_compromis' && !f.deleted_at);
    expect(rows.length).toBe(1);
    expect(rows[0].forecast_month).toBe('2026-09-01');
  });

  it('Step 5: Resetting forecast month (null) soft-deletes the forecast milestone', async () => {
    mockSupabase.db.stoniz_fees_forecast = [
      {
        id: 'fc-1',
        project_id: PROJECT_ID,
        milestone_type: 'honoraires_3d',
        forecast_month: '2026-10-01',
        deleted_at: null,
      },
    ];

    setMockUser('finance', FINANCE_ID);

    const res = await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'honoraires_3d',
      forecast_month: null,
    });

    expect(res.ok).toBe(true);
    const row = mockSupabase.db.stoniz_fees_forecast.find((f: any) => f.id === 'fc-1');
    expect(row.deleted_at).toBeTruthy();
  });

  it('Step 6: Standard fee schedule matches 21 000 € across all 5 milestones', () => {
    expect(STONIZ_FEES_TOTAL).toBe(21000);
    expect(STONIZ_FEE_SCHEDULE.length).toBe(5);

    expect(standardAmountForType('acompte_stoniz')).toBe(5000);
    expect(standardAmountForType('honoraires_compromis')).toBe(3800);
    expect(standardAmountForType('honoraires_3d')).toBe(3800);
    expect(standardAmountForType('honoraires_chantier')).toBe(4200);
    expect(standardAmountForType('honoraires_livraison')).toBe(4200);
  });

  it('Step 7: Commercial fee reduction computation safely discounts total fee', () => {
    expect(finalStonizFees(2000)).toBe(19000);
    expect(finalStonizFees(0)).toBe(21000);
    expect(finalStonizFees(null)).toBe(21000);
    expect(finalStonizFees(25000)).toBe(0); // Cannot be negative
  });

  it('Step 8: Toggling honoraires_confirmed back to false removes project from confirmed view', async () => {
    mockSupabase.db.projects[0].honoraires_confirmed = true;

    setMockUser('ceo', CEO_ID);

    const res = await toggleHonorairesConfirmedAction({
      project_id: PROJECT_ID,
      confirmed: false,
    });

    expect(res.ok).toBe(true);
    const project = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(project.honoraires_confirmed).toBe(false);
  });

  it('Step 9: Security: Developer and client roles cannot toggle confirmation or set forecasts', async () => {
    setMockUser('developer', DEV_ID);

    const resDev = await toggleHonorairesConfirmedAction({
      project_id: PROJECT_ID,
      confirmed: true,
    });
    expect(resDev.ok).toBe(false);
    if (!resDev.ok) {
      expect(resDev.error).toBe('Permission refusée');
    }

    setMockUser('client', CLIENT_ID);
    const resClient = await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'acompte_stoniz',
      forecast_month: '2026-07',
    });
    expect(resClient.ok).toBe(false);
  });

  it('Step 10: Validation guards: rejects invalid month format or unknown milestone types', async () => {
    setMockUser('finance', FINANCE_ID);

    // Invalid month format (month 13 or slash)
    const resMonth = await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'acompte_stoniz',
      forecast_month: '2026-13',
    });
    expect(resMonth.ok).toBe(false);

    // Unknown milestone
    const resType = await setMilestoneForecastMonthAction({
      project_id: PROJECT_ID,
      milestone_type: 'unknown_milestone' as any,
      forecast_month: '2026-06',
    });
    expect(resType.ok).toBe(false);
  });
});
