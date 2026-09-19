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

const mockLogFinanceAudit = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: (...args: any[]) => mockLogFinanceAudit(...args),
  computeFinanceDiff: vi.fn().mockReturnValue({}),
}));

import { updateChantierSousPhaseAction } from '@/app/(team)/projects/[id]/travaux/chantier-sous-phase-actions';
import { createLotAction, updateLotAction } from '@/app/(team)/projects/[id]/travaux/actions';

describe('Multi-Step Workflow: Project Chantier Sous-Phases & Travaux Execution Lifecycle', () => {
  const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
  const CHEF_ID = '22222222-1111-2222-3333-444444444444';
  const CEO_ID = '33333333-1111-2222-3333-444444444444';
  const SOURCING_ID = '44444444-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogFinanceAudit.mockClear();

    mockSupabase.db.projects = [
      {
        id: PROJECT_ID,
        title: 'Penthouse Marina',
        phase: 'travaux',
        chantier_sous_phase: null,
        deleted_at: null,
      },
    ];
    mockSupabase.db.travaux_lots = [];
    mockSupabase.db.documents = [];
  });

  it('Step 1: Chef de projet advances site from unassigned to gros_oeuvre with audit log', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const res = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'gros_oeuvre',
    });
    expect(res.ok).toBe(true);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.chantier_sous_phase).toBe('gros_oeuvre');

    expect(mockLogFinanceAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'projects',
        action: 'update',
        label: expect.stringContaining('Sous-phase chantier : — → gros_oeuvre'),
      }),
    );
  });

  it('Step 2: Consecutive site progress: gros_oeuvre -> second_oeuvre -> finitions', async () => {
    mockSupabase.db.projects[0].chantier_sous_phase = 'gros_oeuvre';
    setMockUser('chef_projet', CHEF_ID);

    // 1. Advance to second_oeuvre
    const res1 = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'second_oeuvre',
    });
    expect(res1.ok).toBe(true);
    let proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.chantier_sous_phase).toBe('second_oeuvre');

    // 2. Advance to finitions
    const res2 = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'finitions',
    });
    expect(res2.ok).toBe(true);
    proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.chantier_sous_phase).toBe('finitions');
  });

  it('Step 3: Final delivery transition to livre marks site ready for reception', async () => {
    mockSupabase.db.projects[0].chantier_sous_phase = 'finitions';
    setMockUser('ceo', CEO_ID);

    const res = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'livre',
    });
    expect(res.ok).toBe(true);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.chantier_sous_phase).toBe('livre');
  });

  it('Step 4: Rollback sous-phase to null allows resetting chantier advancement', async () => {
    mockSupabase.db.projects[0].chantier_sous_phase = 'gros_oeuvre';
    setMockUser('chef_projet', CHEF_ID);

    const res = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: null,
    });
    expect(res.ok).toBe(true);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.chantier_sous_phase).toBeNull();
  });

  it('Step 5: Idempotent sous-phase update does not produce redundant audit entries', async () => {
    mockSupabase.db.projects[0].chantier_sous_phase = 'second_oeuvre';
    setMockUser('chef_projet', CHEF_ID);

    const res = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'second_oeuvre',
    });
    expect(res.ok).toBe(true);

    // Same phase -> no audit log should be emitted
    expect(mockLogFinanceAudit).not.toHaveBeenCalled();
  });

  it('Step 6: Invalid sous_phase value is rejected by schema', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const res = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'phase_imaginaire',
    });
    expect(res.ok).toBe(false);
  });

  it('Step 7: Sourcing and commercial roles are unauthorized to change sous-phase', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await updateChantierSousPhaseAction({
      project_id: PROJECT_ID,
      sous_phase: 'gros_oeuvre',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Permission refusée');
  });

  it('Step 8: Travaux lot creation within gros_oeuvre phase', async () => {
    mockSupabase.db.projects[0].chantier_sous_phase = 'gros_oeuvre';
    setMockUser('chef_projet', CHEF_ID);

    const res = await createLotAction({
      project_id: PROJECT_ID,
      category: 'gros_oeuvre_maconnerie',
      description: 'Démolition cloisons et renfort IPN',
      artisan_name: 'BatiPro SARL',
      devis_artisan_mad: 35000,
      facture_client_mad: 42000,
      status: 'a_demarrer',
    });
    expect(res.ok).toBe(true);

    const lots = mockSupabase.db.travaux_lots;
    expect(lots.length).toBe(1);
    expect(lots[0].numero).toBe(1);
    expect(lots[0].status).toBe('a_demarrer');
  });

  it('Step 9: Advancing travaux lot to demarre requires attached artisan invoice (BUG-030 Gate)', async () => {
    setMockUser('chef_projet', CHEF_ID);

    mockSupabase.db.travaux_lots.push({
      id: 'lot-maconnerie',
      project_id: PROJECT_ID,
      numero: 1,
      status: 'a_demarrer',
    });

    // 1. Attempt status change without invoice -> MUST FAIL
    const failRes = await updateLotAction('lot-maconnerie', { status: 'demarre' });
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain('aucune facture artisan n\'est uploadée');

    // 2. Attach invoice document to lot
    mockSupabase.db.documents.push({
      id: 'doc-facture-1',
      lot_id: 'lot-maconnerie',
      type: 'facture_artisan',
      deleted_at: null,
    });

    // 3. Re-attempt status change -> MUST SUCCEED
    const okRes = await updateLotAction('lot-maconnerie', { status: 'demarre' });
    expect(okRes.ok).toBe(true);

    const lot = mockSupabase.db.travaux_lots.find((l: any) => l.id === 'lot-maconnerie');
    expect(lot.status).toBe('demarre');
  });

  it('Step 10: Advancing through all chantier sous-phases while completing corresponding lots', async () => {
    setMockUser('chef_projet', CHEF_ID);

    // Lot 1: Gros oeuvre
    mockSupabase.db.travaux_lots.push({
      id: 'lot-1',
      project_id: PROJECT_ID,
      numero: 1,
      status: 'a_demarrer',
    });
    mockSupabase.db.documents.push({
      id: 'doc-1',
      lot_id: 'lot-1',
      type: 'facture_artisan',
      deleted_at: null,
    });

    await updateChantierSousPhaseAction({ project_id: PROJECT_ID, sous_phase: 'gros_oeuvre' });
    await updateLotAction('lot-1', { status: 'demarre' });
    await updateLotAction('lot-1', { status: 'termine' });

    // Advance to finitions
    await updateChantierSousPhaseAction({ project_id: PROJECT_ID, sous_phase: 'finitions' });
    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.chantier_sous_phase).toBe('finitions');

    // Final delivery
    await updateChantierSousPhaseAction({ project_id: PROJECT_ID, sous_phase: 'livre' });
    expect(proj.chantier_sous_phase).toBe('livre');
  });
});
