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

import { updateTvaTreatmentAction } from '@/app/(team)/finance/tresorerie/tva/actions';
import {
  resolveTvaTreatment,
  splitTtc,
  normalizeBeneficiary,
  looksLikePerson,
  type VendorDefault,
} from '@/lib/finance/tva';

describe('Multi-Step Workflow: Treasury TVA Compliance, Auto-Learning & Tax Calculation', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const FINANCE_ID = '22222222-1111-2222-3333-444444444444';
  const DEV_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const TX_1_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const TX_2_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogFinanceAudit.mockClear();

    mockSupabase.db.bank_transactions = [
      {
        id: TX_1_ID,
        label: 'Achat fourniture Carrefour',
        beneficiary: 'CARREFOUR MARKET SARL',
        category_code: 'achat_cb',
        debit_mad: 1200,
        credit_mad: null,
        tva_treatment: 'auto',
        tva_rate: null,
      },
      {
        id: TX_2_ID,
        label: 'Virement honoraire consulting',
        beneficiary: 'SARL CONSULTING PRO',
        category_code: 'virement_emis',
        debit_mad: 5000,
        credit_mad: null,
        tva_treatment: 'auto',
        tva_rate: null,
      },
    ];

    mockSupabase.db.vendor_tva_defaults = [];
  });

  it('Step 1: Auto-resolution classifies commercial debit to corporate entity as deductible', () => {
    const res = resolveTvaTreatment({
      tva_treatment: 'auto',
      category_code: 'achat_cb',
      credit_mad: null,
      debit_mad: 1200,
      beneficiary: 'CARREFOUR MARKET SARL',
    });

    expect(res.resolved).toBe('deductible');
    expect(res.source).toBe('category');
  });

  it('Step 2: Heuristic person detection classifies debit to individual as exoneree (salary/private)', () => {
    expect(looksLikePerson('Mehdi Benjelloun')).toBe(true);
    expect(looksLikePerson('TOTAL ENERGIES STATION')).toBe(false);

    const res = resolveTvaTreatment({
      tva_treatment: 'auto',
      category_code: 'virement_emis',
      credit_mad: null,
      debit_mad: 8000,
      beneficiary: 'Mehdi Benjelloun',
    });

    expect(res.resolved).toBe('exoneree');
    expect(res.source).toBe('person');
  });

  it('Step 3: Auto-resolution classifies client payment credit as collectee', () => {
    const res = resolveTvaTreatment({
      tva_treatment: 'auto',
      category_code: 'virement_recu',
      credit_mad: 15000,
      debit_mad: null,
      beneficiary: 'Client Appartement Gueliz',
    });

    expect(res.resolved).toBe('collectee');
    expect(res.source).toBe('category');
  });

  it('Step 4: Social and tax administrations (DGI, CNSS) automatically resolve to exoneree', () => {
    const resDgi = resolveTvaTreatment({
      tva_treatment: 'auto',
      category_code: 'dgi',
      credit_mad: null,
      debit_mad: 4500,
      beneficiary: 'DIRECTION GENERALE DES IMPOTS',
    });
    expect(resDgi.resolved).toBe('exoneree');

    const resCnss = resolveTvaTreatment({
      tva_treatment: 'auto',
      category_code: 'cnss',
      credit_mad: null,
      debit_mad: 3200,
      beneficiary: 'CNSS MAROC',
    });
    expect(resCnss.resolved).toBe('exoneree');
  });

  it('Step 5: Finance user overrides transaction TVA to exoneree with audit trail', async () => {
    setMockUser('finance', FINANCE_ID);

    const res = await updateTvaTreatmentAction({
      transaction_id: TX_1_ID,
      treatment: 'exoneree',
      tva_rate: 0,
      remember_for_beneficiary: false,
    });

    expect(res.ok).toBe(true);
    const tx = mockSupabase.db.bank_transactions.find((t: any) => t.id === TX_1_ID);
    expect(tx.tva_treatment).toBe('exoneree');
    expect(tx.tva_rate).toBe(0);

    expect(mockLogFinanceAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'bank_transactions',
        recordId: TX_1_ID,
        action: 'update',
      }),
    );
  });

  it('Step 6: Auto-learning vendor default: remember_for_beneficiary saves normalized vendor rule', async () => {
    setMockUser('finance', FINANCE_ID);

    const res = await updateTvaTreatmentAction({
      transaction_id: TX_2_ID,
      treatment: 'deductible',
      tva_rate: 10, // reduced rate
      remember_for_beneficiary: true,
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.remembered).toBe(true);
    }

    const defaults = mockSupabase.db.vendor_tva_defaults;
    expect(defaults.length).toBe(1);
    expect(defaults[0].beneficiary_normalized).toBe('sarl consulting pro');
    expect(defaults[0].tva_treatment).toBe('deductible');
    expect(defaults[0].tva_rate).toBe(10);
  });

  it('Step 7: Subsequent transaction with same vendor automatically applies learned default rule', () => {
    const vendorLookup = new Map<string, VendorDefault>([
      [
        'sarl consulting pro',
        {
          beneficiary_normalized: 'sarl consulting pro',
          tva_treatment: 'deductible',
          tva_rate: 10,
        },
      ],
    ]);

    const res = resolveTvaTreatment(
      {
        tva_treatment: 'auto',
        category_code: 'virement_emis',
        credit_mad: null,
        debit_mad: 3500,
        beneficiary: '  SARL   CONSULTING PRO  ',
      },
      vendorLookup,
    );

    expect(res.resolved).toBe('deductible');
    expect(res.source).toBe('vendor');
    expect(res.rateFromVendor).toBe(10);
  });

  it('Step 8: splitTtc calculates exact HT base and TVA amounts from gross TTC amount', () => {
    // 1200 MAD TTC at standard 20%
    const split20 = splitTtc(1200, 20);
    expect(split20.ht).toBe(1000);
    expect(split20.tva).toBe(200);

    // 1100 MAD TTC at reduced 10%
    const split10 = splitTtc(1100, 10);
    expect(split10.ht).toBe(1000);
    expect(split10.tva).toBe(100);

    // Exoneree (0%)
    const split0 = splitTtc(500, 0);
    expect(split0.ht).toBe(500);
    expect(split0.tva).toBe(0);
  });

  it('Step 9: Security: Developer and client roles cannot modify TVA treatments', async () => {
    setMockUser('developer', DEV_ID);

    const resDev = await updateTvaTreatmentAction({
      transaction_id: TX_1_ID,
      treatment: 'deductible',
    });
    expect(resDev.ok).toBe(false);
    if (!resDev.ok) {
      expect(resDev.error).toBe('Permission refusée');
    }

    setMockUser('client', CLIENT_ID);
    const resClient = await updateTvaTreatmentAction({
      transaction_id: TX_1_ID,
      treatment: 'deductible',
    });
    expect(resClient.ok).toBe(false);
  });

  it('Step 10: Validation rejects invalid TVA rates (> 30%) or invalid treatment keys', async () => {
    setMockUser('finance', FINANCE_ID);

    // Rate > 30%
    const resRate = await updateTvaTreatmentAction({
      transaction_id: TX_1_ID,
      treatment: 'deductible',
      tva_rate: 45,
    });
    expect(resRate.ok).toBe(false);

    // Invalid treatment key
    const resKey = await updateTvaTreatmentAction({
      transaction_id: TX_1_ID,
      treatment: 'invalid_treatment_key',
    });
    expect(resKey.ok).toBe(false);
  });
});
