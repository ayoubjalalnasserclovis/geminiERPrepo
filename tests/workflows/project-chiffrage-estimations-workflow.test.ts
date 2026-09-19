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

import {
  createEstimationAction,
  updateEstimationAction,
  setEstimationStatusAction,
  deleteEstimationAction,
  convertEstimationToLotAction,
} from '@/app/(team)/projects/[id]/achats/estimations/actions';

describe('Multi-Step Workflow: Achats Chiffrage Estimations, Conversion & Locks', () => {
  const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
  const CHEF_ID = '22222222-1111-2222-3333-444444444444';
  const ACHATS_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.achats_estimations = [];
    mockSupabase.db.achats_lots = [];
    mockSupabase.db.projects = [
      { id: PROJECT_ID, title: 'Rénovation Gueliz', phase: 'design', deleted_at: null },
    ];
  });

  it('Step 1: Role achats creates an initial purchase estimation line', async () => {
    setMockUser('achats', ACHATS_ID);

    const res = await createEstimationAction({
      project_id: PROJECT_ID,
      category: 'mobilier_salon',
      description: 'Canapé 3 places velours terracotta',
      supplier_name: 'Roche Bobois Casablanca',
      quantity: 1,
      unit_price_mad: 18000,
      prix_estime_mad: 18000,
      notes: 'Voir remise showroom 10%',
    });
    expect(res.ok).toBe(true);

    const ests = mockSupabase.db.achats_estimations;
    expect(ests.length).toBe(1);
    expect(ests[0].numero).toBe(1);
    expect(ests[0].status).toBe('estime');
    expect(ests[0].prix_estime_mad).toBe(18000);
  });

  it('Step 2: Auto-incrementing numero assigns consecutive indices', async () => {
    setMockUser('achats', ACHATS_ID);

    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      category: 'mobilier_salon',
      status: 'estime',
    });

    const res = await createEstimationAction({
      project_id: PROJECT_ID,
      category: 'luminaire',
      description: 'Suspension rotin salle à manger',
      prix_estime_mad: 3500,
    });
    expect(res.ok).toBe(true);

    const est2 = mockSupabase.db.achats_estimations.find((e: any) => e.description?.includes('Suspension'));
    expect(est2.numero).toBe(2);
  });

  it('Step 3: Update estimation fields while still in status estime', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      category: 'mobilier_salon',
      description: 'Canapé',
      prix_estime_mad: 15000,
      status: 'estime',
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await updateEstimationAction('est-1', {
      description: 'Canapé d’angle convertible',
      prix_estime_mad: 22000,
    });
    expect(res.ok).toBe(true);

    const est = mockSupabase.db.achats_estimations.find((e: any) => e.id === 'est-1');
    expect(est.description).toBe('Canapé d’angle convertible');
    expect(est.prix_estime_mad).toBe(22000);
  });

  it('Step 4: Abandon and reactivate estimation lines', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      status: 'estime',
    });

    setMockUser('achats', ACHATS_ID);

    // 1. Abandon estimation
    const res1 = await setEstimationStatusAction('est-1', 'abandonne');
    expect(res1.ok).toBe(true);
    let est = mockSupabase.db.achats_estimations.find((e: any) => e.id === 'est-1');
    expect(est.status).toBe('abandonne');

    // 2. Reactivate estimation
    const res2 = await setEstimationStatusAction('est-1', 'estime');
    expect(res2.ok).toBe(true);
    est = mockSupabase.db.achats_estimations.find((e: any) => e.id === 'est-1');
    expect(est.status).toBe('estime');
  });

  it('Step 5: Convert estimation into real purchase lot and lock source line', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      category: 'electromenager',
      description: 'Réfrigérateur encastrable Bosch',
      supplier_name: 'Comptoir Métallurgique',
      quantity: 1,
      unit_price_mad: 9500,
      prix_estime_mad: 9500,
      status: 'estime',
    });

    setMockUser('chef_projet', CHEF_ID);
    const convRes = await convertEstimationToLotAction('est-1');
    expect(convRes.ok).toBe(true);

    // Verify real lot was created
    const lots = mockSupabase.db.achats_lots;
    expect(lots.length).toBe(1);
    expect(lots[0].description).toBe('Réfrigérateur encastrable Bosch');
    expect(lots[0].budget_estimate_mad).toBe(9500);
    expect(lots[0].status).toBe('a_commander');

    // Verify source estimation is locked
    const est = mockSupabase.db.achats_estimations.find((e: any) => e.id === 'est-1');
    expect(est.status).toBe('converti');
    expect(est.converted_lot_id).toBe(lots[0].id);
    expect(est.converted_at).toBeDefined();
  });

  it('Step 6: Double conversion prevention on already converted estimation', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      status: 'converti',
      converted_lot_id: 'lot-existing',
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await convertEstimationToLotAction('est-1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Déjà convertie en lot réel');
  });

  it('Step 7: Conversion blocked on abandoned estimation line', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      status: 'abandonne',
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await convertEstimationToLotAction('est-1');
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Estimation abandonnée');
  });

  it('Step 8: Immutability lock: update/delete/status on converted estimation is strictly forbidden', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      status: 'converti',
      converted_lot_id: 'lot-existing',
    });

    setMockUser('achats', ACHATS_ID);

    // 1. Attempt update
    const upRes = await updateEstimationAction('est-1', { prix_estime_mad: 12000 });
    expect(upRes.ok).toBe(false);
    expect(upRes.error).toContain('Estimation convertie en lot réel — verrouillée');

    // 2. Attempt delete
    const delRes = await deleteEstimationAction('est-1');
    expect(delRes.ok).toBe(false);
    expect(delRes.error).toContain('Estimation convertie — verrouillée');

    // 3. Attempt status toggle
    const stRes = await setEstimationStatusAction('est-1', 'abandonne');
    expect(stRes.ok).toBe(false);
    expect(stRes.error).toContain('Estimation convertie — verrouillée');
  });

  it('Step 9: Soft-delete non-converted estimation line records deletion audit', async () => {
    mockSupabase.db.achats_estimations.push({
      id: 'est-1',
      project_id: PROJECT_ID,
      numero: 1,
      category: 'deco',
      description: 'Vase artisanal',
      prix_estime_mad: 450,
      status: 'estime',
    });

    setMockUser('chef_projet', CHEF_ID);
    const delRes = await deleteEstimationAction('est-1');
    expect(delRes.ok).toBe(true);

    const est = mockSupabase.db.achats_estimations.find((e: any) => e.id === 'est-1');
    expect(est.deleted_at).toBeDefined();
  });

  it('Step 10: Client role cannot access or mutate chiffrage estimations', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      createEstimationAction({
        project_id: PROJECT_ID,
        category: 'mobilier',
        description: 'Tentative client',
        prix_estime_mad: 1000,
      }),
    ).rejects.toThrow('Permission refusée');
  });
});
