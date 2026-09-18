import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
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

vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: vi.fn().mockResolvedValue(true),
  computeFinanceDiff: vi.fn().mockReturnValue({}),
}));

import {
  addAccountAction,
  setAccountAlertThresholdAction,
  recordBalanceAction,
} from '@/app/(team)/finance/tresorerie/actions';

import {
  allocateTransactionAction,
} from '@/app/(team)/finance/tresorerie/transactions/actions';

describe('Multi-Step Workflow: Treasury Account Setup, Transaction Allocation & Reconciliation', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const FINANCE_USER_ID = '22222222-1111-2222-3333-444444444444';
  const COMPANY_ID = '33333333-1111-2222-3333-444444444444';
  const PROJECT_ID = '44444444-1111-2222-3333-444444444444';
  const TX_ID = '55555555-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      bank_companies: [
        { id: COMPANY_ID, name: 'Stoniz SARL', code: 'stoniz_sarl' },
      ],
      bank_accounts: [],
      bank_balances: [],
      bank_transactions: [
        {
          id: TX_ID,
          debit_mad: 25000,
          credit_mad: null,
          operation_date: '2026-09-18',
          beneficiary: 'Menuiserie Bois Marrakech',
          label: 'VIR VIREMENT MENUISERIE BOIS',
          deleted_at: null,
        },
      ],
      bank_transaction_allocations: [],
      projects: [
        { id: PROJECT_ID, title: 'Projet Villa Majorelle', deleted_at: null },
      ],
      travaux_lots: [],
      travaux_payments: [],
      profiles: [
        { id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' },
        { id: FINANCE_USER_ID, role: 'finance', full_name: 'DAF Stoniz' },
      ],
    });
    setMockUser('finance', FINANCE_USER_ID);
  });

  it('Step 1 -> 3: Create Bank Account -> Configure Alert Threshold -> Record Manual Balance', async () => {
    // 1. Add bank account
    const form = new FormData();
    form.append('company_id', COMPANY_ID);
    form.append('bank_code', 'cih');
    form.append('bank_label', 'CIH Bank');
    form.append('account_label', 'Compte Opérations Courantes');
    form.append('account_number', '230780001234567890123456');
    form.append('currency', 'MAD');

    await addAccountAction(form);

    const accounts = mockSupabase.db.bank_accounts;
    expect(accounts).toHaveLength(1);
    const account = accounts[0];
    expect(account.bank_label).toBe('CIH Bank');
    expect(account.currency).toBe('MAD');

    // 2. Configure alert threshold (100,000 MAD)
    const threshRes = await setAccountAlertThresholdAction(account.id, '100000');
    expect(threshRes.ok).toBe(true);

    const updatedAccount = mockSupabase.db.bank_accounts.find((a: any) => a.id === account.id);
    expect(updatedAccount.alert_threshold_mad).toBe(100000);

    // 3. Record verified statement balance
    const balForm = new FormData();
    balForm.append('account_id', account.id);
    balForm.append('balance_date', '2026-09-18');
    balForm.append('balance_amount', '450000.50');
    balForm.append('notes', 'Relevé électronique CIH validé');

    await recordBalanceAction(balForm);

    const balances = mockSupabase.db.bank_balances;
    expect(balances).toHaveLength(1);
    const bal = balances[0];
    expect(bal.balance_amount).toBe('450000.50');
    expect(bal.source).toBe('manual');
  });

  it('Transaction Allocation: allocate debit transaction to project travaux with auto-lot creation', async () => {
    const form = new FormData();
    form.append('transaction_id', TX_ID);
    form.append('project_id', PROJECT_ID);
    form.append('allocation_type', 'travaux');
    form.append('amount_mad', '25000');
    form.append('force_create', 'true');
    form.append('notes', 'Acompte fabrication portes et fenêtres');

    const allocRes = await allocateTransactionAction(form);
    expect(allocRes.ok).toBe(true);

    // Verify auto-created travaux lot
    const lots = mockSupabase.db.travaux_lots;
    expect(lots).toHaveLength(1);
    expect(lots[0].artisan_name).toBe('Menuiserie Bois Marrakech');

    // Verify created payment linked to the transaction
    const payments = mockSupabase.db.travaux_payments;
    expect(payments).toHaveLength(1);
    const pmt = payments[0];
    expect(pmt.amount_paid).toBe(25000);
    expect(pmt.status).toBe('paid');
  });

  it('Guard enforcement: block allocation amount exceeding transaction amount', async () => {
    const form = new FormData();
    form.append('transaction_id', TX_ID); // TX is 25,000 MAD
    form.append('project_id', PROJECT_ID);
    form.append('allocation_type', 'travaux');
    form.append('amount_mad', '30000'); // Exceeds by 5,000 MAD

    const allocRes = await allocateTransactionAction(form);
    expect(allocRes.ok).toBe(false);
    expect((allocRes as any).error).toContain('ne peut pas dépasser 25000.00 MAD');
  });

  it('Rapprochement flow: match bank transaction to an existing planned acompte', async () => {
    // 1. Setup existing planned acompte (pending) on project
    const lotId = '66666666-1111-2222-3333-444444444444';
    const acompteId = '77777777-1111-2222-3333-444444444444';

    mockSupabase.db.travaux_lots.push({
      id: lotId,
      project_id: PROJECT_ID,
      numero: 1,
      artisan_name: 'Menuiserie Bois Marrakech',
      status: 'en_cours',
    });

    mockSupabase.db.travaux_payments.push({
      id: acompteId,
      project_id: PROJECT_ID,
      lot_id: lotId,
      amount_total: 25000,
      amount_paid: 0,
      status: 'pending',
      scheduled_date: '2026-09-18',
    });

    // 2. Allocate transaction explicitly attaching to existing acompte
    const form = new FormData();
    form.append('transaction_id', TX_ID);
    form.append('project_id', PROJECT_ID);
    form.append('allocation_type', 'travaux');
    form.append('amount_mad', '25000');
    form.append('existing_acompte_id', acompteId);

    const allocRes = await allocateTransactionAction(form);
    expect(allocRes.ok).toBe(true);

    // Verify existing acompte was updated to paid without creating a duplicate payment
    const payments = mockSupabase.db.travaux_payments;
    expect(payments).toHaveLength(1);
    const updatedAcompte = payments[0];
    expect(updatedAcompte.id).toBe(acompteId);
    expect(updatedAcompte.status).toBe('paid');
    expect(updatedAcompte.amount_paid).toBe(25000);
  });
});
