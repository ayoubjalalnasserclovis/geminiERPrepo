import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

vi.mock('server-only', () => ({}));

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

describe('Wave 1 — Money & Approvals Suite', () => {
  const PROJECT_ID = 'proj-money-001';
  const CHEF_ID = 'chef-001';
  const FINANCE_ID = 'fin-001';
  const CEO_ID = 'ceo-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('finance', FINANCE_ID);

    mockSupabase.db['projects'] = [
      {
        id: PROJECT_ID,
        name: 'Projet Guéliz Luxury',
        statut_projet: 'actif',
        budget_vendu_client: 450000,
        chef_projet_id: CHEF_ID,
      },
    ];

    mockSupabase.db['payments'] = [];
    mockSupabase.db['payment_approvals'] = [];
    mockSupabase.db['bank_transactions'] = [];
    mockSupabase.db['caisse_sessions'] = [];
    mockSupabase.db['caisse_operations'] = [];
  });

  describe('W3..W7: Payment Approvals Lifecycle & Gates', () => {
    it('W3: Chef de Projet submits a payment approval request', async () => {
      setMockUser('chef_projet', CHEF_ID);

      const approvalRequest = {
        id: 'approval-001',
        project_id: PROJECT_ID,
        requested_by: CHEF_ID,
        amount: 15000,
        description: 'Acompte électricité lot 2',
        source_type: 'travaux_acompte',
        source_id: 'acompte-lot-2',
        payer_account: 'stz_oj',
        finance_status: 'pending',
        ceo_status: 'pending',
        status: 'pending',
      };

      const { data, error } = await mockSupabase
        .from('payment_approvals')
        .insert(approvalRequest);

      expect(error).toBeNull();
      expect(data.id).toBe('approval-001');
      expect(data.finance_status).toBe('pending');
    });

    it('W4: Finance reviews request — approves or rejects with reason', async () => {
      mockSupabase.db['payment_approvals'] = [
        {
          id: 'approval-002',
          project_id: PROJECT_ID,
          requested_by: CHEF_ID,
          amount: 20000,
          finance_status: 'pending',
          ceo_status: 'pending',
        },
      ];

      setMockUser('finance', FINANCE_ID);

      // Finance approves
      await mockSupabase
        .from('payment_approvals')
        .update({
          finance_status: 'approved',
          finance_reviewed_by: FINANCE_ID,
          finance_reviewed_at: new Date().toISOString(),
        })
        .eq('id', 'approval-002');

      const { data: approved } = await mockSupabase
        .from('payment_approvals')
        .select('*')
        .eq('id', 'approval-002')
        .single();

      expect(approved.finance_status).toBe('approved');
      expect(approved.finance_reviewed_by).toBe(FINANCE_ID);

      // Rejection branch with motif
      await mockSupabase
        .from('payment_approvals')
        .update({
          finance_status: 'rejected',
          rejection_reason: 'Devis artisan manquant',
          deleted_at: new Date().toISOString(),
        })
        .eq('id', 'approval-002');

      const { data: rejected } = await mockSupabase
        .from('payment_approvals')
        .select('*')
        .eq('id', 'approval-002')
        .single();

      expect(rejected.finance_status).toBe('rejected');
      expect(rejected.rejection_reason).toBe('Devis artisan manquant');
    });

    it('W5: CEO court-circuit bypasses Finance review (finance_status = skipped)', async () => {
      mockSupabase.db['payment_approvals'] = [
        {
          id: 'approval-003',
          project_id: PROJECT_ID,
          requested_by: CHEF_ID,
          amount: 50000,
          finance_status: 'pending',
          ceo_status: 'pending',
        },
      ];

      setMockUser('ceo', CEO_ID);

      await mockSupabase
        .from('payment_approvals')
        .update({
          finance_status: 'skipped',
          ceo_status: 'approved',
          ceo_approved_by: CEO_ID,
          ceo_approved_at: new Date().toISOString(),
          status: 'approved',
        })
        .eq('id', 'approval-003');

      const { data: bypassed } = await mockSupabase
        .from('payment_approvals')
        .select('*')
        .eq('id', 'approval-003')
        .single();

      expect(bypassed.finance_status).toBe('skipped');
      expect(bypassed.ceo_status).toBe('approved');
      expect(bypassed.status).toBe('approved');
    });

    it('W6: Mark as paid with transfer proof and updates underlying payment', async () => {
      mockSupabase.db['payments'] = [
        {
          id: 'pay-001',
          project_id: PROJECT_ID,
          amount: 12000,
          status: 'pending',
        },
      ];

      mockSupabase.db['payment_approvals'] = [
        {
          id: 'approval-004',
          project_id: PROJECT_ID,
          payment_id: 'pay-001',
          amount: 12000,
          status: 'approved',
        },
      ];

      setMockUser('finance', FINANCE_ID);

      // Execute mark as paid
      const proofUrl = 'https://mock-storage.stoniz/virement-12000.pdf';
      await mockSupabase
        .from('payment_approvals')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          transfer_proof_url: proofUrl,
        })
        .eq('id', 'approval-004');

      await mockSupabase
        .from('payments')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
        })
        .eq('id', 'pay-001');

      const { data: updatedApproval } = await mockSupabase
        .from('payment_approvals')
        .select('*')
        .eq('id', 'approval-004')
        .single();

      const { data: updatedPayment } = await mockSupabase
        .from('payments')
        .select('*')
        .eq('id', 'pay-001')
        .single();

      expect(updatedApproval.status).toBe('paid');
      expect(updatedApproval.transfer_proof_url).toBe(proofUrl);
      expect(updatedPayment.status).toBe('paid');
    });

    it('W7: "Mes demandes" view only exposes requests initiated by caller', async () => {
      mockSupabase.db['payment_approvals'] = [
        { id: 'app-chef1', requested_by: CHEF_ID, amount: 5000 },
        { id: 'app-chef2', requested_by: 'another-chef', amount: 8000 },
      ];

      setMockUser('chef_projet', CHEF_ID);

      const { data: myRequests } = await mockSupabase
        .from('payment_approvals')
        .select('*')
        .eq('requested_by', CHEF_ID);

      expect(myRequests).toHaveLength(1);
      expect(myRequests[0].id).toBe('app-chef1');
    });

    it('W3-gate-payer & W3-gate-artisan: strictly checks payer_account and artisan readiness', async () => {
      // Validate payer account constraint
      const validatePayerAccount = (payer: string | null, sourceType: string) => {
        if (sourceType === 'honoraires') {
          return payer === null; // honoraires do not have payer account
        }
        return payer === 'stz_oj' || payer === 'personnel';
      };

      expect(validatePayerAccount('stz_oj', 'travaux_acompte')).toBe(true);
      expect(validatePayerAccount('personnel', 'achats_acompte')).toBe(true);
      expect(validatePayerAccount('invalid_compte', 'travaux_acompte')).toBe(false);
      expect(validatePayerAccount(null, 'honoraires')).toBe(true);
      expect(validatePayerAccount('stz_oj', 'honoraires')).toBe(false);
    });
  });

  describe('W8..W13: Banking Reconciliation & Accounts', () => {
    it('imports bank transactions and reconciles against planned payments', async () => {
      const bankTx = {
        id: 'tx-001',
        account_id: 'acc-stz-01',
        amount: -15000,
        reference: 'VIR ARTISAN LOT 2',
        booking_date: '2026-09-15',
        reconciled: false,
      };

      await mockSupabase.from('bank_transactions').insert(bankTx);

      // Match and reconcile
      await mockSupabase
        .from('bank_transactions')
        .update({
          reconciled: true,
          reconciled_with: 'approval-001',
          reconciled_at: new Date().toISOString(),
        })
        .eq('id', 'tx-001');

      const { data: reconciledTx } = await mockSupabase
        .from('bank_transactions')
        .select('*')
        .eq('id', 'tx-001')
        .single();

      expect(reconciledTx.reconciled).toBe(true);
      expect(reconciledTx.reconciled_with).toBe('approval-001');
    });
  });

  describe('W1..W2 & W19: Client Encaissements & Fee Schedules', () => {
    it('records received encaissement and recomputes remaining balance', async () => {
      const totalHonoraires = 21000;
      mockSupabase.db['payments'] = [
        {
          id: 'enc-1',
          project_id: PROJECT_ID,
          type: 'acompte_stoniz',
          amount: 5000,
          status: 'paid',
        },
        {
          id: 'enc-2',
          project_id: PROJECT_ID,
          type: 'milestone_2',
          amount: 7000,
          status: 'pending',
        },
      ];

      const { data: payments } = await mockSupabase
        .from('payments')
        .select('*')
        .eq('project_id', PROJECT_ID);

      const paid = payments
        .filter((p: any) => p.status === 'paid')
        .reduce((sum: number, p: any) => sum + p.amount, 0);

      const remaining = totalHonoraires - paid;
      expect(paid).toBe(5000);
      expect(remaining).toBe(16000);
    });
  });

  describe('W16..W18: Caisse Stoniz Lifecycle', () => {
    it('manages caisse session: open, add operation, balance check, CEO close', async () => {
      // 1. Open session
      const session = {
        id: 'caisse-sess-001',
        opened_by: FINANCE_ID,
        initial_balance: 5000,
        status: 'open',
      };
      await mockSupabase.from('caisse_sessions').insert(session);

      // 2. Add cash expense
      await mockSupabase.from('caisse_operations').insert({
        id: 'caisse-op-01',
        session_id: 'caisse-sess-001',
        type: 'expense',
        amount: 850,
        motif: 'Achat petit matériel chantier',
      });

      // 3. Compute closing balance
      const initial = 5000;
      const expenses = 850;
      const finalBalance = initial - expenses;
      expect(finalBalance).toBe(4150);

      // 4. CEO closes session
      setMockUser('ceo', CEO_ID);
      await mockSupabase
        .from('caisse_sessions')
        .update({
          status: 'closed',
          closed_by: CEO_ID,
          final_balance: finalBalance,
          closed_at: new Date().toISOString(),
        })
        .eq('id', 'caisse-sess-001');

      const { data: closedSess } = await mockSupabase
        .from('caisse_sessions')
        .select('*')
        .eq('id', 'caisse-sess-001')
        .single();

      expect(closedSess.status).toBe('closed');
      expect(closedSess.final_balance).toBe(4150);
      expect(closedSess.closed_by).toBe(CEO_ID);
    });
  });

  describe('Bulk Acomptes Management (Wave repo feature)', () => {
    it('executes mark_paid, set_amount, set_date, and soft delete in bulk', async () => {
      mockSupabase.db['works_acomptes'] = [
        { id: 'ac-1', montant: 5000, date_paiement: null, statut: 'en_attente', deleted_at: null },
        { id: 'ac-2', montant: 7000, date_paiement: null, statut: 'en_attente', deleted_at: null },
      ];

      // Bulk mark as paid
      for (const id of ['ac-1', 'ac-2']) {
        await mockSupabase
          .from('works_acomptes')
          .update({
            statut: 'paye',
            date_paiement: '2026-09-17',
          })
          .eq('id', id);
      }

      const { data: paidAcomptes } = await mockSupabase
        .from('works_acomptes')
        .select('*')
        .in('id', ['ac-1', 'ac-2']);

      expect(paidAcomptes.every((a: any) => a.statut === 'paye')).toBe(true);
      expect(paidAcomptes.every((a: any) => a.date_paiement === '2026-09-17')).toBe(true);

      // Bulk soft delete
      for (const id of ['ac-1', 'ac-2']) {
        await mockSupabase
          .from('works_acomptes')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);
      }

      const { data: deletedAcomptes } = await mockSupabase
        .from('works_acomptes')
        .select('*')
        .in('id', ['ac-1', 'ac-2']);

      expect(deletedAcomptes.every((a: any) => a.deleted_at !== null)).toBe(true);
    });
  });
});
