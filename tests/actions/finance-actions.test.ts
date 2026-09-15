import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const PAYMENT_ID = '22222222-2222-4222-8222-222222222222';
const TRAVAUX_PAYMENT_ID = '33333333-3333-4333-8333-333333333333';
const APPROVAL_ID = '44444444-4444-4444-8444-444444444444';

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

vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/email/templates', () => ({
  sendPaymentApprovalRequested: vi.fn().mockResolvedValue(true),
  sendPaymentApprovalDecision: vi.fn().mockResolvedValue(true),
  sendPaymentMarkedPaid: vi.fn().mockResolvedValue(true),
  sendPaymentReceivedToClient: vi.fn().mockResolvedValue(true),
}));

describe('Finance & Validations Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [{ id: PROJECT_ID, reference: 'STZ-001' }],
      payments: [{ id: PAYMENT_ID, project_id: PROJECT_ID, amount: 5000, type: 'acompte_stoniz' }],
      travaux_payments: [{ id: TRAVAUX_PAYMENT_ID, project_id: PROJECT_ID, amount_paid: 12000 }],
      payment_approvals: [
        {
          id: APPROVAL_ID,
          project_id: PROJECT_ID,
          payment_id: PAYMENT_ID,
          amount: 5000,
          currency: 'EUR',
          final_status: 'pending',
          finance_status: 'pending',
        },
      ],
      profiles: [
        { id: 'usr-fin-1', email: 'fin@stoniz.co', role: 'finance', is_active: true },
      ],
    });
    setMockUser('finance');
    vi.clearAllMocks();
  });

  describe('Payment Approval Requests', () => {
    it('creates approval request for stoniz payment without payer account', async () => {
      const { requestApprovalAction } = await import('@/app/(team)/validations/actions');
      const NEW_PAYMENT_ID = '55555555-5555-4555-8555-555555555555';
      const res = await requestApprovalAction({
        source: 'payment',
        source_id: NEW_PAYMENT_ID,
        amount: 3800,
        currency: 'EUR',
        beneficiary_name: 'Stoniz SARL',
        project_id: PROJECT_ID,
      });

      expect(res.ok).toBe(true);
      const approvals = mockSupabase.db.payment_approvals;
      const created = approvals.find((a) => a.payment_id === NEW_PAYMENT_ID);
      expect(created).toBeDefined();
      expect(created.amount).toBe(3800);
    });

    it('rejects travaux payment request when payer account is missing', async () => {
      const { requestApprovalAction } = await import('@/app/(team)/validations/actions');
      const res = await requestApprovalAction({
        source: 'travaux_payment',
        source_id: TRAVAUX_PAYMENT_ID,
        amount: 15000,
        currency: 'MAD',
        beneficiary_name: 'Artisan Med',
        project_id: PROJECT_ID,
      });

      expect(res.ok).toBe(false);
      expect((res as any).error).toContain('Choix du compte payeur obligatoire');
    });

    it('prevents duplicate active approval for same payment source', async () => {
      const { requestApprovalAction } = await import('@/app/(team)/validations/actions');
      const res = await requestApprovalAction({
        source: 'payment',
        source_id: PAYMENT_ID,
        amount: 5000,
        currency: 'EUR',
        beneficiary_name: 'Stoniz',
        project_id: PROJECT_ID,
      });

      expect(res.ok).toBe(false);
      expect((res as any).error).toContain('Une demande de validation existe déjà');
    });
  });

  describe('Finance Review & Decision', () => {
    it('approves a payment approval request', async () => {
      const { financeReviewAction } = await import('@/app/(team)/validations/actions');
      const res = await financeReviewAction(APPROVAL_ID, 'approved', 'Documents conformes');
      expect(res.ok).toBe(true);

      const apprv = mockSupabase.db.payment_approvals.find((a) => a.id === APPROVAL_ID);
      expect(apprv.finance_status).toBe('approved');
    });

    it('rejects a payment approval request with notes', async () => {
      const { financeReviewAction } = await import('@/app/(team)/validations/actions');
      const res = await financeReviewAction(APPROVAL_ID, 'rejected', 'RIB manquant');
      expect(res.ok).toBe(true);

      const apprv = mockSupabase.db.payment_approvals.find((a) => a.id === APPROVAL_ID);
      expect(apprv.finance_status).toBe('rejected');
    });

    it('blocks unauthorized client from finance review', async () => {
      setMockUser('client');
      const { financeReviewAction } = await import('@/app/(team)/validations/actions');
      await expect(financeReviewAction(APPROVAL_ID, 'approved')).rejects.toThrow('Permission refusée');
    });
  });
});
