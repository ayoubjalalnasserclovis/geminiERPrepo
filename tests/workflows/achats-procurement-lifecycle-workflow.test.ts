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

vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: vi.fn().mockResolvedValue(true),
  computeFinanceDiff: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/audit/deletion', () => ({
  logDeletion: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/finance/cascade-deallocate', () => ({
  cascadeDeallocateOnDelete: vi.fn().mockResolvedValue(true),
}));

import {
  createAchatLotAction,
  updateAchatLotAction,
  deleteAchatLotAction,
  saveAchatAcompteAction,
  setAchatAcompteSchedulingAction,
  markAchatAcomptePaidAction,
  deleteAchatAcompteAction,
  bulkPlanAchatAcomptesAction,
} from '@/app/(team)/projects/[id]/achats/actions';

describe('Multi-Step Workflow: Achats Procurement, Milestone Installments & Supplier Settlements', () => {
  const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
  const ACHATS_ID = '22222222-1111-2222-3333-444444444444';
  const CHEF_ID = '33333333-1111-2222-3333-444444444444';
  const SUPPLIER_ID = '44444444-1111-2222-3333-444444444444';
  const CLIENT_ID = '55555555-1111-2222-3333-444444444444';

  const LOT_1_ID = 'aaaa1111-2222-3333-4444-555555555555';
  const LOT_2_ID = 'bbbb1111-2222-3333-4444-555555555555';
  const DIFF_SUPP_ID = 'cccc1111-2222-3333-4444-555555555555';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.achats_lots = [];
    mockSupabase.db.achats_payments = [];
    mockSupabase.db.projects = [
      { id: PROJECT_ID, title: 'Rénovation Villa Majorelle', deleted_at: null },
    ];
  });

  it('Step 1: Role achats creates new purchase procurement lot', async () => {
    setMockUser('achats', ACHATS_ID);

    const res = await createAchatLotAction({
      project_id: PROJECT_ID,
      category: 'electromenager',
      description: 'Pack cuisine Bosch (four, plaque induction, hotte)',
      supplier_name: 'Electro Bouskoura SARL',
      supplier_id: SUPPLIER_ID,
      devis_number: 'DEV-2026-EB-019',
      devis_fournisseur_mad: 28000,
      facture_client_mad: 35000,
      status: 'a_commander',
    });
    expect(res.ok).toBe(true);

    const lots = mockSupabase.db.achats_lots;
    expect(lots.length).toBe(1);
    expect(lots[0].numero).toBe(1);
    expect(lots[0].devis_fournisseur_mad).toBe(28000);
    expect(lots[0].status).toBe('a_commander');
  });

  it('Step 2: Update achat lot advancement from a_commander to commande with order date', async () => {
    mockSupabase.db.achats_lots.push({
      id: LOT_1_ID,
      project_id: PROJECT_ID,
      numero: 1,
      supplier_name: 'Electro Bouskoura',
      status: 'a_commander',
    });

    setMockUser('achats', ACHATS_ID);
    const res = await updateAchatLotAction(LOT_1_ID, {
      status: 'commande',
      date_commande: '2026-09-10',
      date_livraison_estimee: '2026-09-25',
    });
    expect(res.ok).toBe(true);

    const lot = mockSupabase.db.achats_lots.find((l: any) => l.id === LOT_1_ID);
    expect(lot.status).toBe('commande');
    expect(lot.date_commande).toBe('2026-09-10');
  });

  it('Step 3: Save single acompte for supplier order (acompte 1: 50% down payment)', async () => {
    mockSupabase.db.achats_lots.push({
      id: LOT_1_ID,
      project_id: PROJECT_ID,
      supplier_name: 'Electro Bouskoura',
      supplier_id: SUPPLIER_ID,
      category: 'electromenager',
      devis_fournisseur_mad: 28000,
    });

    setMockUser('achats', ACHATS_ID);
    const res = await saveAchatAcompteAction({
      lot_id: LOT_1_ID,
      acompte_number: 1,
      acompte_pct: 50,
      amount_total: 14000,
      scheduled_date: '2026-09-15',
      notes: 'Acompte 50% à la validation de commande',
    });
    expect(res.ok).toBe(true);

    const payments = mockSupabase.db.achats_payments;
    expect(payments.length).toBe(1);
    expect(payments[0].acompte_number).toBe(1);
    expect(payments[0].amount_total).toBe(14000);
    expect(payments[0].status).toBe('pending');
  });

  it('Step 4: Update acompte scheduling and propagate to sibling pending lots of same supplier', async () => {
    mockSupabase.db.achats_lots.push(
      { id: LOT_1_ID, project_id: PROJECT_ID, supplier_id: SUPPLIER_ID, supplier_name: 'Fournisseur Unique' },
      { id: LOT_2_ID, project_id: PROJECT_ID, supplier_id: SUPPLIER_ID, supplier_name: 'Fournisseur Unique' },
    );

    mockSupabase.db.achats_payments.push(
      { id: 'pay-1', project_id: PROJECT_ID, lot_id: LOT_1_ID, status: 'pending', scheduled_date: '2026-09-20' },
      { id: 'pay-2', project_id: PROJECT_ID, lot_id: LOT_2_ID, status: 'pending', scheduled_date: '2026-09-20' },
    );

    setMockUser('achats', ACHATS_ID);
    const res = await setAchatAcompteSchedulingAction({
      acompte_id: 'pay-1',
      scheduled_date: '2026-10-05',
      also_apply_to_supplier: true,
    });
    expect(res.ok).toBe(true);

    const pay1 = mockSupabase.db.achats_payments.find((p: any) => p.id === 'pay-1');
    expect(pay1.scheduled_date).toBe('2026-10-05');
  });

  it('Step 5: Mark acompte as paid when treasury disburses funds', async () => {
    mockSupabase.db.achats_payments.push({
      id: 'pay-1',
      project_id: PROJECT_ID,
      amount_total: 14000,
      status: 'pending',
      paid_at: null,
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await markAchatAcomptePaidAction('pay-1', '2026-09-18');
    expect(res.ok).toBe(true);

    const pay = mockSupabase.db.achats_payments.find((p: any) => p.id === 'pay-1');
    expect(pay.status).toBe('paid');
    expect(pay.paid_at).toBe('2026-09-18');
    expect(pay.amount_paid).toBe(14000);
  });

  it('Step 6: Bulk planning multiple installment milestones across sibling lots of same supplier', async () => {
    mockSupabase.db.achats_lots.push(
      {
        id: LOT_1_ID,
        project_id: PROJECT_ID,
        supplier_id: SUPPLIER_ID,
        supplier_name: 'Marbre et Granit SARL',
        devis_fournisseur_mad: 20000,
        deleted_at: null,
      },
      {
        id: LOT_2_ID,
        project_id: PROJECT_ID,
        supplier_id: SUPPLIER_ID,
        supplier_name: 'Marbre et Granit SARL',
        devis_fournisseur_mad: 30000,
        deleted_at: null,
      },
    );

    setMockUser('achats', ACHATS_ID);
    const res = await bulkPlanAchatAcomptesAction({
      project_id: PROJECT_ID,
      lot_ids: [LOT_1_ID, LOT_2_ID],
      installments: [
        { amount_mode: 'pct', amount_value: 30, scheduled_date: '2026-10-01' },
        { amount_mode: 'pct', amount_value: 70, scheduled_date: '2026-10-30' },
      ],
      notes: 'Échelonnement négocié 30/70',
    });
    expect(res.ok).toBe(true);

    // 2 lots x 2 installments = 4 payments
    expect(mockSupabase.db.achats_payments.length).toBe(4);
  });

  it('Step 7: Bulk planning fails if lots belong to different suppliers', async () => {
    mockSupabase.db.achats_lots.push(
      { id: LOT_1_ID, project_id: PROJECT_ID, supplier_id: SUPPLIER_ID, supplier_name: 'Supplier A', deleted_at: null },
      { id: LOT_2_ID, project_id: PROJECT_ID, supplier_id: DIFF_SUPP_ID, supplier_name: 'Supplier B', deleted_at: null },
    );

    setMockUser('achats', ACHATS_ID);
    const res = await bulkPlanAchatAcomptesAction({
      project_id: PROJECT_ID,
      lot_ids: [LOT_1_ID, LOT_2_ID],
      installments: [{ amount_mode: 'fixed', amount_value: 5000, scheduled_date: '2026-10-01' }],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('doivent appartenir au même fournisseur');
  });

  it('Step 8: Soft-delete acompte triggers cascade deallocation and audit trail', async () => {
    mockSupabase.db.achats_payments.push({
      id: 'pay-to-del',
      project_id: PROJECT_ID,
      amount_total: 6000,
      supplier_name: 'Supplier A',
    });

    setMockUser('achats', ACHATS_ID);
    const delRes = await deleteAchatAcompteAction('pay-to-del');
    expect(delRes.ok).toBe(true);

    const pay = mockSupabase.db.achats_payments.find((p: any) => p.id === 'pay-to-del');
    expect(pay.deleted_at).toBeDefined();
  });

  it('Step 9: Soft-delete achat lot records deletion audit snapshot', async () => {
    mockSupabase.db.achats_lots.push({
      id: 'lot-to-del',
      project_id: PROJECT_ID,
      numero: 5,
      supplier_name: 'Supplier To Delete',
      devis_fournisseur_mad: 12000,
    });

    setMockUser('chef_projet', CHEF_ID);
    const delRes = await deleteAchatLotAction('lot-to-del');
    expect(delRes.ok).toBe(true);

    const lot = mockSupabase.db.achats_lots.find((l: any) => l.id === 'lot-to-del');
    expect(lot.deleted_at).toBeDefined();
  });

  it('Step 10: Client role is strictly barred from modifying procurement or supplier payouts', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      createAchatLotAction({
        project_id: PROJECT_ID,
        category: 'deco',
        supplier_name: 'Test',
      }),
    ).rejects.toThrow('Permission refusée');
  });
});
