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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

import {
  createStonizPaymentAction,
  updatePaymentAction,
  updateStonizScheduleAction,
} from '@/app/(team)/projects/[id]/payments/actions';

describe('Multi-Step Workflow: Stoniz Fees Milestone Payments -> Schedule Shifts -> Payment Status Sync', () => {
  const PROJECT_ID = 'aaaaaaaa-9999-4444-8888-777777777777';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          reference: 'PRJ-2026-FEE-TEST',
          status: 'actif',
        },
      ],
      profiles: [
        { id: 'usr-ceo-1', email: 'ceo@stoniz.co', full_name: 'Ayoub CEO', role: 'ceo', is_active: true },
        { id: 'usr-finance-1', email: 'finance@stoniz.co', full_name: 'Hamza Finance', role: 'finance', is_active: true },
        { id: 'usr-chef-1', email: 'chef@stoniz.co', full_name: 'Youssef Chef', role: 'chef_projet', is_active: true },
      ],
      payments: [],
      finance_audit_log: [],
    });
    setMockUser('finance', 'usr-finance-1');
  });

  it('progresses through fee milestones, schedule updates, and payment status synchronization', async () => {
    // Step 1: Finance creates initial fee milestones
    await createStonizPaymentAction({
      project_id: PROJECT_ID,
      type: 'acompte_stoniz',
      amount_expected: 5000,
      due_at_phase: 'onboarding',
      due_date: '2026-09-01',
    });

    await createStonizPaymentAction({
      project_id: PROJECT_ID,
      type: 'honoraires_compromis',
      amount_expected: 8000,
      due_at_phase: 'sourcing',
      due_date: '2026-10-01',
    });

    const payments = mockSupabase.db.payments;
    expect(payments).toHaveLength(2);
    expect(payments[0].status).toBe('pending');
    expect(payments[1].status).toBe('pending');

    const p1Id = payments[0].id;
    const p2Id = payments[1].id;

    // Step 2: Chef de projet shifts due date to align with on-site timeline
    setMockUser('chef_projet', 'usr-chef-1');
    const shiftRes = await updateStonizScheduleAction({
      project_id: PROJECT_ID,
      items: [
        {
          payment_id: p1Id,
          amount_expected: 5000,
          due_date: '2026-09-15',
        },
      ],
    });
    expect(shiftRes.ok).toBe(true);
    expect(payments[0].due_date).toBe('2026-09-15');

    // Step 3: Chef de projet attempts to reduce amount_expected -> Ignored / guarded for non-finance
    await updateStonizScheduleAction({
      project_id: PROJECT_ID,
      items: [
        {
          payment_id: p1Id,
          amount_expected: 2000, // Should be ignored because chef_projet cannot change fee amounts
          due_date: '2026-09-20',
        },
      ],
    });
    expect(payments[0].amount_expected).toBe(5000); // Amount preserved
    expect(payments[0].due_date).toBe('2026-09-20'); // Due date updated

    // Step 4: Record partial payment (2000 / 5000 EUR)
    setMockUser('finance', 'usr-finance-1');
    const partialPayRes = await updatePaymentAction({
      payment_id: p1Id,
      amount_paid: 2000,
      paid_at: '2026-09-18',
      payment_method: 'virement',
      notes: 'Premier virement partiel reçu',
    });
    expect(partialPayRes.ok).toBe(true);

    // Verify status updated to 'partial' (BUG-033 fix)
    expect(payments[0].amount_paid).toBe(2000);
    expect(payments[0].status).toBe('partial');

    // Step 5: Record full settlement (5000 / 5000 EUR)
    const fullPayRes = await updatePaymentAction({
      payment_id: p1Id,
      amount_paid: 5000,
      paid_at: '2026-09-19',
      payment_method: 'virement',
      notes: 'Solde de l acompte reçu',
    });
    expect(fullPayRes.ok).toBe(true);

    // Verify status updated to 'paid' (BUG-033 fix)
    expect(payments[0].amount_paid).toBe(5000);
    expect(payments[0].status).toBe('paid');

    // Step 6: Guard: cannot reduce expected amount below already received amount
    const invalidAmountRes = await updatePaymentAction({
      payment_id: p1Id,
      amount_paid: 5000,
      amount_expected: 3000, // < 5000 already received
    });
    expect(invalidAmountRes.ok).toBe(false);
    expect(invalidAmountRes.error).toContain('ne peut pas être inférieur au déjà encaissé');
  });
});
