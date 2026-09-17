import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase } from '../helpers/mock-db';
import { findReconcileCandidates, type BankTransactionForRecon } from '@/lib/finance/bank-reconciliation';

vi.mock('server-only', () => ({}));

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

describe('Bank Reconciliation Suite (BUG-024)', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db['bank_transaction_allocations'] = [];
  });

  it('classifies pending negative debit authorization as debit and matches against travaux payments (BUG-024)', async () => {
    const paymentId = 'pay-travaux-001';
    const projectId = 'proj-001';

    mockSupabase.db['projects'] = [
      { id: projectId, reference: 'PROJ-TEST', status: 'actif', deleted_at: null },
    ];

    mockSupabase.db['travaux_lots'] = [
      { id: 'lot-001', category: 'Plomberie', artisan: { name: 'Artisan Belissama' } },
    ];

    mockSupabase.db['travaux_payments'] = [
      {
        id: paymentId,
        project_id: projectId,
        lot_id: 'lot-001',
        amount_total: 245,
        amount_paid: 0,
        paid_at: null,
        scheduled_date: '2026-06-02',
        deleted_at: null,
        lot: { id: 'lot-001', category: 'Plomberie', artisan: { name: 'Artisan Belissama' } },
        project: { reference: 'PROJ-TEST', status: 'actif', deleted_at: null, client: { full_name: 'Client Test' } },
      },
    ];

    mockSupabase.db['travaux_encaissements'] = [];
    mockSupabase.db['achats_payments'] = [];
    mockSupabase.db['achats_encaissements'] = [];
    mockSupabase.db['payments'] = [];

    // Pending debit authorization with negative debit_mad
    const pendingTx: BankTransactionForRecon = {
      id: 'tx-001',
      account_id: 'acc-001',
      operation_date: '2026-06-02',
      value_date: null,
      label: 'ACHAT PAR CARTE ARTISAN BELISSAMA (*)',
      reference: null,
      debit_mad: -245, // negative amount in Chaabi pending row
      credit_mad: null,
      category_code: 'achat_cb',
      beneficiary: 'Artisan Belissama',
    };

    const candidates = await findReconcileCandidates(pendingTx, mockSupabase as any);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].source).toBe('travaux_payment');
    expect(candidates[0].id).toBe(paymentId);
    expect(candidates[0].amount_mad).toBe(245);
  });
});
