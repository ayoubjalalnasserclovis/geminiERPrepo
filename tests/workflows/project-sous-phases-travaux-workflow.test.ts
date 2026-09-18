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

vi.mock('@/lib/audit/deletion', () => ({
  logDeletion: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/finance/cascade-deallocate', () => ({
  cascadeDeallocateOnDelete: vi.fn().mockResolvedValue(true),
}));

import {
  createLotAction,
  updateLotAction,
  saveAcompteAction,
  markAcomptePaidAction,
  addEncaissementAction,
  updateEncaissementAction,
  updateProjectTravauxSettingsAction,
  bulkAssignTravauxArtisanAction,
  bulkChangeTravauxStatusAction,
} from '@/app/(team)/projects/[id]/travaux/actions';

describe('Multi-Step Workflow: Project Travaux Lots, Invoice Gates & Acomptes', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const CHEF_USER_ID = '22222222-1111-2222-3333-444444444444';
  const PROJECT_ID = '33333333-1111-2222-3333-444444444444';
  const ARTISAN_ID = '44444444-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          title: 'Rénovation Riad Medina',
          travaux_budget_mad: null,
          travaux_marge_cible_pct: null,
        },
      ],
      artisans: [
        {
          id: ARTISAN_ID,
          name: 'Plomberie Moderne SARL',
          type: 'plombier',
        },
      ],
      travaux_lots: [],
      travaux_payments: [],
      travaux_encaissements: [],
      documents: [],
      profiles: [
        { id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' },
        { id: CHEF_USER_ID, role: 'chef_projet', full_name: 'Chef Tariq' },
      ],
    });
    setMockUser('chef_projet', CHEF_USER_ID);
  });

  it('Step 1 -> 5: Lot creation -> Settings config -> Installment payments -> Invoice gate pass -> Payment executed', async () => {
    // 1. Configure project works settings
    const settingsRes = await updateProjectTravauxSettingsAction(PROJECT_ID, {
      travaux_budget_mad: 500000,
      travaux_marge_cible_pct: 15,
      travaux_adresse_chantier: '12 Derb Snan, Medina Marrakech',
    });
    expect(settingsRes.ok).toBe(true);

    const prj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(prj.travaux_budget_mad).toBe(500000);
    expect(prj.travaux_marge_cible_pct).toBe(15);

    // 2. Create lot for Plomberie
    const lotRes = await createLotAction({
      project_id: PROJECT_ID,
      category: 'plomberie',
      artisan_name: 'Plomberie Moderne SARL',
      artisan_id: ARTISAN_ID,
      budget_estimate_mad: 60000,
      devis_artisan_mad: 55000,
      facture_client_mad: 70000,
      status: 'a_planifier',
    });
    expect(lotRes.ok).toBe(true);

    const lots = mockSupabase.db.travaux_lots;
    expect(lots).toHaveLength(1);
    const lot = lots[0];
    expect(lot.numero).toBe(1);
    expect(lot.status).toBe('a_planifier');

    // 3. Register Acompte 1 (30% = 16,500 MAD)
    const acompteRes = await saveAcompteAction({
      lot_id: lot.id,
      acompte_number: 1,
      acompte_pct: 30,
      amount_total: 16500,
      scheduled_date: '2026-09-25',
      notes: 'Acompte de démarrage chantier',
    });
    expect(acompteRes.ok).toBe(true);

    const payments = mockSupabase.db.travaux_payments;
    expect(payments).toHaveLength(1);
    const pmt = payments[0];
    expect(pmt.amount_total).toBe(16500);

    // 4. Upload artisan invoice document to satisfy gate
    mockSupabase.db.documents.push({
      id: 'doc-facture-1',
      lot_id: lot.id,
      type: 'facture_artisan',
      deleted_at: null,
    });

    // Advance lot to en_cours
    const updateRes = await updateLotAction(lot.id, {
      status: 'en_cours',
    });
    expect(updateRes.ok).toBe(true);
    expect(mockSupabase.db.travaux_lots[0].status).toBe('en_cours');

    // 5. Mark payment as paid
    const payRes = await markAcomptePaidAction(pmt.id, '2026-09-25');
    expect(payRes.ok).toBe(true);
    expect(mockSupabase.db.travaux_payments[0].status).toBe('paid');
    expect(mockSupabase.db.travaux_payments[0].amount_paid).toBe(16500);
  });

  it('Invoice gate enforcement: advancing status to active without invoice document MUST fail', async () => {
    // 1. Create lot in a_planifier status
    await createLotAction({
      project_id: PROJECT_ID,
      category: 'electricite',
      artisan_name: 'Artisan Elec',
      budget_estimate_mad: 40000,
      devis_artisan_mad: 38000,
      status: 'a_planifier',
    });
    const lot = mockSupabase.db.travaux_lots[0];

    // 2. Attempt to advance to en_cours without invoice document -> MUST BE REJECTED
    const failUpdate = await updateLotAction(lot.id, {
      status: 'en_cours',
    });
    expect(failUpdate.ok).toBe(false);
    expect((failUpdate as any).error).toContain('aucune facture artisan n\'est uploadée');
    expect(lot.status).toBe('a_planifier');
  });

  it('Client cash collection flow: planned deposit -> received payment', async () => {
    // 1. Register planned client deposit (150,000 MAD call for funds)
    const planRes = await addEncaissementAction({
      project_id: PROJECT_ID,
      amount_mad: 150000,
      scheduled_date: '2026-10-01',
      payment_method: 'virement',
      notes: 'Appel de fonds n°1 démarrage démolition',
    });
    expect(planRes.ok).toBe(true);

    const encaissements = mockSupabase.db.travaux_encaissements;
    expect(encaissements).toHaveLength(1);
    const enc = encaissements[0];
    expect(enc.status).toBe('planifie');
    expect(enc.received_at).toBeNull();

    // 2. Client transfers funds -> mark received
    const updateRes = await updateEncaissementAction({
      encaissement_id: enc.id,
      project_id: PROJECT_ID,
      amount_mad: 150000,
      received_at: '2026-10-01',
      payment_method: 'virement',
      notes: 'Virement reçu sur compte BMCE',
    });
    expect(updateRes.ok).toBe(true);

    const updated = mockSupabase.db.travaux_encaissements.find((e: any) => e.id === enc.id);
    expect(updated.status).toBe('recu');
    expect(updated.received_at).toBe('2026-10-01');
  });

  it('Bulk operations: batch assign artisan and bulk status update with gate check', async () => {
    // Create 2 lots
    await createLotAction({ project_id: PROJECT_ID, category: 'peinture', artisan_name: 'Inconnu', status: 'a_planifier' });
    await createLotAction({ project_id: PROJECT_ID, category: 'revetement', artisan_name: 'Inconnu', status: 'a_planifier' });

    const lots = mockSupabase.db.travaux_lots;
    expect(lots).toHaveLength(2);
    const lotIds = lots.map((l: any) => l.id);

    // 1. Bulk assign artisan
    const assignRes = await bulkAssignTravauxArtisanAction({
      lot_ids: lotIds,
      artisan_id: ARTISAN_ID,
    });
    expect(assignRes.ok).toBe(true);
    expect(lots[0].artisan_name).toBe('Plomberie Moderne SARL');
    expect(lots[1].artisan_name).toBe('Plomberie Moderne SARL');

    // 2. Bulk change status to demarre without invoices -> MUST FAIL
    const failBulk = await bulkChangeTravauxStatusAction({
      lot_ids: lotIds,
      status: 'demarre',
    });
    expect(failBulk.ok).toBe(false);
    expect((failBulk as any).error).toContain('aucune facture artisan');

    // 3. Attach invoices to both
    mockSupabase.db.documents.push(
      { id: 'doc-1', lot_id: lotIds[0], type: 'facture_artisan', deleted_at: null },
      { id: 'doc-2', lot_id: lotIds[1], type: 'facture_artisan', deleted_at: null },
    );

    // 4. Bulk change status to demarre now succeeds
    const successBulk = await bulkChangeTravauxStatusAction({
      lot_ids: lotIds,
      status: 'demarre',
    });
    expect(successBulk.ok).toBe(true);
    expect(lots[0].status).toBe('demarre');
    expect(lots[1].status).toBe('demarre');
  });
});
