import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const CEO_ID = '11111111-1111-4111-8111-111111111111';
const FINANCE_ID = '22222222-2222-4222-8222-222222222222';
const CP_ID = '33333333-3333-4333-8333-333333333333';
const PROJECT_ID = '44444444-4444-4444-8444-444444444444';
const BANK_ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const LOT_ID = '66666666-6666-4666-8666-666666666666';
const TX_ID = '77777777-7777-4777-8777-777777777777';

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

vi.mock('@/lib/email/templates', () => ({
  sendPaymentApprovalRequested: vi.fn().mockResolvedValue(true),
  sendPaymentApprovalDecision: vi.fn().mockResolvedValue(true),
  sendPaymentMarkedPaid: vi.fn().mockResolvedValue(true),
  sendPaymentReceivedToClient: vi.fn().mockResolvedValue(true),
}));

import {
  setAccountAlertThresholdAction,
  recordBalanceAction,
} from '@/app/(team)/finance/tresorerie/actions';
import { classifyRecurringAction } from '@/app/(team)/finance/synthese/classify-actions';
import {
  requestApprovalAction,
  financeReviewAction,
} from '@/app/(team)/validations/actions';
import { allocateTransactionAction } from '@/app/(team)/finance/tresorerie/transactions/actions';

describe('Workflow E2E: Finance & Treasury Reconciliation Loop', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      profiles: [
        { id: CEO_ID, email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
        { id: FINANCE_ID, email: 'finance@stoniz.co', role: 'finance', full_name: 'Finance Lead', is_active: true },
        { id: CP_ID, email: 'cp@stoniz.co', role: 'chef_projet', full_name: 'Karim CP', is_active: true },
      ],
      projects: [
        {
          id: PROJECT_ID,
          name: 'Villa Palmeraie Marrakech',
          reference: 'PROJ-VILLA-01',
          phase: 'travaux',
          chef_projet_id: CP_ID,
          deleted_at: null,
        },
      ],
      bank_accounts: [
        {
          id: BANK_ACCOUNT_ID,
          account_label: 'Compte Principal Stoniz',
          bank_label: 'Attijariwafa Bank',
          account_type: 'courant',
          currency: 'MAD',
          alert_threshold_mad: null,
          deleted_at: null,
        },
      ],
      bank_balances: [],
      recurring_payment_classifications: [],
      travaux_lots: [
        {
          id: LOT_ID,
          project_id: PROJECT_ID,
          lot_number: 1,
          label: 'Lot 1 - Gros Œuvre & Maçonnerie',
          status: 'en_cours',
          deleted_at: null,
        },
      ],
      travaux_payments: [],
      payment_approvals: [],
      bank_transactions: [
        {
          id: TX_ID,
          account_id: BANK_ACCOUNT_ID,
          operation_date: '2026-09-15',
          label: 'VIR ARTISAN HASSAN PLOMBERIE',
          beneficiary: 'Hassan Plomberie',
          debit_mad: 12000,
          credit_mad: 0,
          deleted_at: null,
        },
      ],
      bank_transaction_allocations: [],
      finance_audit_log: [],
    });

    setMockUser('finance', FINANCE_ID);
  });

  it('orchestrates threshold config -> balance recording -> recurring classification -> payment approval -> transaction allocation', async () => {
    // -------------------------------------------------------------------------
    // 1. Configure alert threshold on bank account
    // -------------------------------------------------------------------------
    const thresholdRes = await setAccountAlertThresholdAction(BANK_ACCOUNT_ID, '15000');
    expect(thresholdRes.ok).toBe(true);
    const updatedAccount = mockSupabase.db.bank_accounts.find((a: any) => a.id === BANK_ACCOUNT_ID);
    expect(updatedAccount.alert_threshold_mad).toBe(15000);

    // -------------------------------------------------------------------------
    // 2. Record manual bank balance
    // -------------------------------------------------------------------------
    const balanceForm = new FormData();
    balanceForm.append('account_id', BANK_ACCOUNT_ID);
    balanceForm.append('balance_date', '2026-09-15');
    balanceForm.append('balance_amount', '85000.50');
    balanceForm.append('notes', 'Relevé bancaire du 15 Septembre');

    await recordBalanceAction(balanceForm);

    const balanceRecord = mockSupabase.db.bank_balances[0];
    expect(balanceRecord).toBeDefined();
    expect(Number(balanceRecord.balance_amount)).toBe(85000.50);
    expect(balanceRecord.recorded_by).toBe(FINANCE_ID);

    // -------------------------------------------------------------------------
    // 3. Classify recurring telecom / utility bill
    // -------------------------------------------------------------------------
    const classifyRes = await classifyRecurringAction({
      beneficiary: 'MAROC TELECOM SA',
      type: 'abonnement',
    });
    expect(classifyRes.ok).toBe(true);

    const recurringRecord = mockSupabase.db.recurring_payment_classifications[0];
    expect(recurringRecord).toBeDefined();
    expect(recurringRecord.type).toBe('abonnement');

    // -------------------------------------------------------------------------
    // 4. Chef de Projet creates planned acompte and requests payment approval
    // -------------------------------------------------------------------------
    setMockUser('chef_projet', CP_ID);

    const plannedAcompteId = crypto.randomUUID();
    mockSupabase.db.travaux_payments.push({
      id: plannedAcompteId,
      project_id: PROJECT_ID,
      lot_id: LOT_ID,
      artisan_name: 'Hassan Plomberie',
      amount_total: 12000,
      amount_paid: 0,
      status: 'pending',
      scheduled_date: '2026-09-15',
      description: 'Acompte 1 Gros Œuvre',
      deleted_at: null,
    });

    const approvalRes = await requestApprovalAction({
      source: 'travaux_payment',
      source_id: plannedAcompteId,
      amount: 12000,
      currency: 'MAD',
      beneficiary_name: 'Hassan Plomberie',
      project_id: PROJECT_ID,
      payer_account: 'stz_oj',
    });
    expect(approvalRes.ok).toBe(true);

    const approvalRecord = mockSupabase.db.payment_approvals[0];
    expect(approvalRecord).toBeDefined();
    expect(approvalRecord.amount).toBe(12000);

    // -------------------------------------------------------------------------
    // 5. Finance reviews and approves the payment request
    // -------------------------------------------------------------------------
    setMockUser('finance', FINANCE_ID);

    const reviewRes = await financeReviewAction(
      approvalRecord.id,
      'approved',
      'Facture et état des lieux conformes, virement autorisé',
    );
    expect(reviewRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // 6. Allocate imported bank transaction to the planned payment
    // -------------------------------------------------------------------------
    const allocForm = new FormData();
    allocForm.append('transaction_id', TX_ID);
    allocForm.append('project_id', PROJECT_ID);
    allocForm.append('allocation_type', 'travaux');
    allocForm.append('amount_mad', '12000');
    allocForm.append('travaux_lot_id', LOT_ID);
    allocForm.append('existing_acompte_id', plannedAcompteId);
    allocForm.append('notes', 'Rapprochement bancaire virement Hassan Plomberie');

    const allocRes = await allocateTransactionAction(allocForm);
    expect(allocRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // 7. Verify allocation, payment status update, and audit trail
    // -------------------------------------------------------------------------
    const allocRecord = mockSupabase.db.bank_transaction_allocations[0];
    expect(allocRecord).toBeDefined();
    expect(allocRecord.transaction_id).toBe(TX_ID);
    expect(allocRecord.project_id).toBe(PROJECT_ID);
    expect(Number(allocRecord.amount_mad)).toBe(12000);

    // Travaux payment should now be updated to paid
    const updatedPayment = mockSupabase.db.travaux_payments.find((p: any) => p.id === plannedAcompteId);
    expect(updatedPayment.status).toBe('paid');
    expect(Number(updatedPayment.amount_paid)).toBe(12000);

    // Audit entries should exist
    expect(mockSupabase.db.finance_audit_log.length).toBeGreaterThan(0);
  });
});
