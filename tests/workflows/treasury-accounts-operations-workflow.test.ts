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
  computeFinanceDiff: (before: any, after: any, keys: string[]) => {
    const diff: any = {};
    for (const k of keys) {
      if (!before || before[k] !== after[k]) {
        diff[k] = { from: before?.[k] ?? null, to: after[k] };
      }
    }
    return diff;
  },
}));

import {
  addCompanyAction,
  addAccountAction,
  setAccountAlertThresholdAction,
  recordBalanceAction,
  deactivateAccountAction,
} from '@/app/(team)/finance/tresorerie/actions';

describe('Multi-Step Workflow: Treasury Entities, Accounts & Balance Tracking', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const FINANCE_ID = '22222222-1111-2222-3333-444444444444';
  const ASSISTANTE_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const COMPANY_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const ACCOUNT_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogFinanceAudit.mockClear();

    mockSupabase.db.bank_companies = [];
    mockSupabase.db.bank_accounts = [];
    mockSupabase.db.bank_balances = [];
  });

  it('Step 1: CEO creates a corporate entity with legal name and business unit', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('code', 'stoniz_maroc');
    fd.append('name', 'Stoniz Maroc SARL');
    fd.append('legal_name', 'Stoniz Maroc SARL AU');
    fd.append('country_code', 'MA');
    fd.append('currency', 'MAD');
    fd.append('business_unit', 'stoniz');
    fd.append('notes', 'Entité principale opérations');

    await addCompanyAction(fd);

    const companies = mockSupabase.db.bank_companies;
    expect(companies.length).toBe(1);
    expect(companies[0].code).toBe('stoniz_maroc');
    expect(companies[0].business_unit).toBe('stoniz');
    expect(mockLogFinanceAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'bank_companies',
        action: 'create',
      }),
    );
  });

  it('Step 2: CEO adds a primary bank account linked to the company with RIB masking in audit', async () => {
    mockSupabase.db.bank_companies = [
      { id: COMPANY_ID, code: 'stoniz_maroc', name: 'Stoniz Maroc' },
    ];

    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('company_id', COMPANY_ID);
    fd.append('bank_code', 'ATW');
    fd.append('bank_label', 'Attijariwafa Bank');
    fd.append('account_label', 'Compte Courant Principal');
    fd.append('account_number', '123456789012345678901234');
    fd.append('currency', 'MAD');

    await addAccountAction(fd);

    const accounts = mockSupabase.db.bank_accounts;
    expect(accounts.length).toBe(1);
    expect(accounts[0].bank_code).toBe('ATW');
    expect(accounts[0].currency).toBe('MAD');

    // Audit log should truncate account number for confidentiality
    expect(mockLogFinanceAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'bank_accounts',
        action: 'create',
        payload: expect.objectContaining({
          account_number_truncated: '1234…34',
        }),
      }),
    );
  });

  it('Step 3: Finance user sets low-balance alert threshold to 50000 MAD with diff audit', async () => {
    mockSupabase.db.bank_accounts = [
      {
        id: ACCOUNT_ID,
        account_label: 'Compte Courant Principal',
        bank_label: 'Attijariwafa Bank',
        alert_threshold_mad: null,
      },
    ];

    setMockUser('finance', FINANCE_ID);

    const res = await setAccountAlertThresholdAction(ACCOUNT_ID, '50000');
    expect(res.ok).toBe(true);

    const account = mockSupabase.db.bank_accounts.find((a: any) => a.id === ACCOUNT_ID);
    expect(account.alert_threshold_mad).toBe(50000);

    expect(mockLogFinanceAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'bank_accounts',
        recordId: ACCOUNT_ID,
        action: 'status_change',
        payload: expect.objectContaining({
          alert_threshold_mad: { from: null, to: 50000 },
        }),
      }),
    );
  });

  it('Step 4: Finance user records manual bank balance snapshot of 125000 MAD', async () => {
    mockSupabase.db.bank_accounts = [
      {
        id: ACCOUNT_ID,
        account_label: 'Compte Courant Principal',
        bank_label: 'Attijariwafa Bank',
        currency: 'MAD',
        deleted_at: null,
      },
    ];

    setMockUser('finance', FINANCE_ID);

    const fd = new FormData();
    fd.append('account_id', ACCOUNT_ID);
    fd.append('balance_date', '2026-06-01');
    fd.append('balance_amount', '125000.00');
    fd.append('notes', 'Pointage relevé mensuel papier');

    await recordBalanceAction(fd);

    const balances = mockSupabase.db.bank_balances;
    expect(balances.length).toBe(1);
    expect(balances[0].balance_amount).toBe('125000.00');
    expect(balances[0].currency).toBe('MAD');
    expect(balances[0].recorded_by).toBe(FINANCE_ID);
  });

  it('Step 5: Finance user records successive balance update (142500.50 MAD) on subsequent date', async () => {
    mockSupabase.db.bank_accounts = [
      {
        id: ACCOUNT_ID,
        account_label: 'Compte Courant Principal',
        bank_label: 'Attijariwafa Bank',
        currency: 'MAD',
        deleted_at: null,
      },
    ];
    mockSupabase.db.bank_balances = [
      {
        id: 'bal-1',
        account_id: ACCOUNT_ID,
        balance_date: '2026-06-01',
        balance_amount: '125000.00',
        currency: 'MAD',
      },
    ];

    setMockUser('finance', FINANCE_ID);

    const fd = new FormData();
    fd.append('account_id', ACCOUNT_ID);
    fd.append('balance_date', '2026-06-15');
    fd.append('balance_amount', '142500.50');

    await recordBalanceAction(fd);

    const balances = mockSupabase.db.bank_balances;
    expect(balances.length).toBe(2);
    expect(balances.some((b: any) => b.balance_date === '2026-06-15' && b.balance_amount === '142500.50')).toBe(true);
  });

  it('Step 6: Setting negative or invalid alert threshold returns descriptive error without crashing', async () => {
    setMockUser('finance', FINANCE_ID);

    const resNeg = await setAccountAlertThresholdAction(ACCOUNT_ID, '-1500');
    expect(resNeg.ok).toBe(false);
    if (!resNeg.ok) {
      expect(resNeg.error).toContain('Seuil invalide');
    }

    const resText = await setAccountAlertThresholdAction(ACCOUNT_ID, 'cinquante_mille');
    expect(resText.ok).toBe(false);
  });

  it('Step 7: Recording balance on deleted account throws descriptive error', async () => {
    mockSupabase.db.bank_accounts = [
      {
        id: ACCOUNT_ID,
        account_label: 'Compte Fermé',
        currency: 'MAD',
        deleted_at: '2026-05-01T00:00:00Z',
      },
    ];

    setMockUser('finance', FINANCE_ID);

    const fd = new FormData();
    fd.append('account_id', ACCOUNT_ID);
    fd.append('balance_date', '2026-06-01');
    fd.append('balance_amount', '10000.00');

    await expect(recordBalanceAction(fd)).rejects.toThrow('Compte introuvable ou supprimé');
  });

  it('Step 8: CEO deactivates bank account stamping deleted_at soft-delete', async () => {
    mockSupabase.db.bank_accounts = [
      {
        id: ACCOUNT_ID,
        account_label: 'Compte Courant Secondaire',
        bank_label: 'Banque Populaire',
        currency: 'MAD',
        company_id: COMPANY_ID,
        deleted_at: null,
      },
    ];

    setMockUser('ceo', CEO_ID);

    await deactivateAccountAction(ACCOUNT_ID);

    const account = mockSupabase.db.bank_accounts.find((a: any) => a.id === ACCOUNT_ID);
    expect(account.deleted_at).toBeTruthy();
    expect(mockLogFinanceAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'bank_accounts',
        action: 'delete',
        recordId: ACCOUNT_ID,
      }),
    );
  });

  it('Step 9: Security: Finance and assistante roles cannot add company or deactivate account', async () => {
    setMockUser('finance', FINANCE_ID);

    const fd = new FormData();
    fd.append('code', 'test_co');
    fd.append('name', 'Test Company');
    fd.append('country_code', 'MA');
    fd.append('currency', 'MAD');
    fd.append('business_unit', 'stoniz');

    await expect(addCompanyAction(fd)).rejects.toThrow('Permission refusée');
    await expect(deactivateAccountAction(ACCOUNT_ID)).rejects.toThrow('Permission refusée');

    setMockUser('assistante', ASSISTANTE_ID);
    await expect(addCompanyAction(fd)).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Client role is strictly rejected from all treasury operations', async () => {
    setMockUser('client', CLIENT_ID);

    const res = await setAccountAlertThresholdAction(ACCOUNT_ID, '10000');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toBe('Permission refusée');
    }

    const fd = new FormData();
    fd.append('account_id', ACCOUNT_ID);
    fd.append('balance_date', '2026-06-01');
    fd.append('balance_amount', '5000');
    await expect(recordBalanceAction(fd)).rejects.toThrow('Permission refusée');
  });
});
