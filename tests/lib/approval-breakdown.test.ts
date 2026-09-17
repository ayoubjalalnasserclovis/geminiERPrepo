import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase } from '../helpers/mock-db';
import { getApprovalBreakdown } from '@/lib/finance/approval-breakdown';

vi.mock('server-only', () => ({}));

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

describe('Approval Breakdown Suite (BUG-026)', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase();
  });

  it('preserves supplier_name on achats lots when payment notes are null (BUG-026 fix)', async () => {
    const lotId = 'lot-achats-001';
    const paymentId = 'pay-achats-001';

    mockSupabase.db['achats_lots'] = [
      {
        id: lotId,
        numero: 1,
        description: 'Mobilier salon haut de gamme',
        category: 'mobilier_salon',
        supplier_name: 'ROCHE BOBOIS',
        unit_price_mad: 45000,
        quantity: 1,
        budget_estimate_mad: 45000,
      },
    ];

    mockSupabase.db['achats_payments'] = [
      {
        id: paymentId,
        lot_id: lotId,
        supplier_name: null,
        currency: 'MAD',
        amount_total: 22500,
        acompte_number: 1,
        acompte_pct: 50,
        scheduled_date: '2026-07-01',
        notes: null, // Note is explicitly null
        deleted_at: null,
      },
    ];

    const result = await getApprovalBreakdown({
      id: 'appr-001',
      payment_id: null,
      travaux_payment_id: null,
      achats_payment_id: paymentId,
      payment_batch_id: null,
    });

    expect(result.source).toBe('achats');
    expect(result.lots).toHaveLength(1);
    expect(result.lots[0].supplier_name).toBe('ROCHE BOBOIS');
    expect(result.total_amount).toBe(22500);
  });
});
