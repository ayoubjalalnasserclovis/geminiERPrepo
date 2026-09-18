import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const CEO_ID = '11111111-1111-4111-8111-111111111111';
const CHEF_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const CLIENT_ID = '44444444-4444-4444-8444-444444444444';
const PROPERTY_ID = '55555555-5555-4555-8555-555555555555';
const PROPOSAL_ID = '66666666-6666-4666-8666-666666666666';

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

vi.mock('@/lib/audit/deletion', () => ({
  logDeletion: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/email/templates', () => ({
  sendProposalResponseToTeam: vi.fn().mockResolvedValue(true),
  sendPhaseStart: vi.fn().mockResolvedValue(true),
  sendWelcomePortal: vi.fn().mockResolvedValue(true),
  sendProjectAssignedToChef: vi.fn().mockResolvedValue(true),
  sendProjectCompleted: vi.fn().mockResolvedValue(true),
  sendSurveyToClient: vi.fn().mockResolvedValue(true),
  sendActeAuthentiqueToClient: vi.fn().mockResolvedValue(true),
  sendPaymentApprovalRequested: vi.fn().mockResolvedValue(true),
  sendPaymentApprovalDecision: vi.fn().mockResolvedValue(true),
  sendPaymentMarkedPaid: vi.fn().mockResolvedValue(true),
  sendPaymentReceivedToClient: vi.fn().mockResolvedValue(true),
}));

import {
  createProjectAction,
  updateProjectChefAction,
  advancePhaseAction,
  revertPhaseAction,
  deleteProjectAction,
} from '@/app/(team)/projects/actions';
import { createLotAction } from '@/app/(team)/projects/[id]/travaux/actions';
import { createAchatLotAction } from '@/app/(team)/projects/[id]/achats/actions';
import { requestApprovalAction, financeReviewAction } from '@/app/(team)/validations/actions';
import { respondToProposalAction } from '@/app/(client)/client/projects/[id]/proposals/actions';
import { activatePropriaManagementAction } from '@/app/(team)/propria/biens/actions';

describe('Workflow E2E: Full Project Lifecycle', () => {
  let projectId: string;

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      profiles: [
        { id: CEO_ID, email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
        { id: CHEF_ID, email: 'chef@stoniz.co', role: 'chef_projet', full_name: 'Youssef Chef', is_active: true },
        { id: CLIENT_PROFILE_ID, email: 'client@example.com', role: 'client', full_name: 'Fatima Zahra' },
      ],
      clients: [
        { id: CLIENT_ID, profile_id: CLIENT_PROFILE_ID, full_name: 'Fatima Zahra', email: 'client@example.com' },
      ],
      projects: [],
      properties: [
        { id: PROPERTY_ID, name: 'Villa Palmeraie', reference: 'PROP-01', status: 'disponible', is_managed_propria: false },
      ],
      property_proposals: [
        { id: PROPOSAL_ID, property_id: PROPERTY_ID, status: 'sent' },
      ],
      travaux_lots: [],
      achats_lots: [],
      payment_approval_requests: [],
      payments: [],
      bank_accounts: [
        { id: 'acc-1', label: 'CFG Bank Stoniz', is_active: true },
      ],
      deletion_logs: [],
    });

    setMockUser('ceo', CEO_ID);
  });

  it('orchestrates complete project from creation through delivery and Propria activation', async () => {
    // -------------------------------------------------------------------------
    // 1. Project Creation
    // -------------------------------------------------------------------------
    const createRes = await createProjectAction({
      client_id: CLIENT_ID,
      title: 'Projet Villa Majorelle',
      budget_total: 3500000,
      target_yield_percent: 7.5,
      city: 'Marrakech',
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    projectId = createRes.id;
    expect(projectId).toBeDefined();

    let project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.phase).toBe('onboarding');

    // -------------------------------------------------------------------------
    // 2. Assign Chef de Projet
    // -------------------------------------------------------------------------
    const assignRes = await updateProjectChefAction({ project_id: projectId, chef_id: CHEF_ID });
    expect(assignRes.ok).toBe(true);
    project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.assigned_chef_projet).toBe(CHEF_ID);

    // -------------------------------------------------------------------------
    // 3. Advance to Sourcing & Client Selects Property Proposal
    // -------------------------------------------------------------------------
    setMockUser('chef_projet', CHEF_ID);
    const advSourcingRes = await advancePhaseAction({ project_id: projectId, new_phase: 'sourcing' });
    expect(advSourcingRes.ok).toBe(true);
    project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.phase).toBe('sourcing');

    // Client responds and accepts proposal
    setMockUser('client', CLIENT_PROFILE_ID);
    const propRes = await respondToProposalAction({
      proposal_id: PROPOSAL_ID,
      response: 'accepted',
      message: 'Nous confirmons notre intérêt pour cette opportunité !',
    });
    expect(propRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // 4. Advance to Design phase
    // -------------------------------------------------------------------------
    setMockUser('chef_projet', CHEF_ID);
    const advDesignRes = await advancePhaseAction({ project_id: projectId, new_phase: 'design' });
    expect(advDesignRes.ok).toBe(true);
    project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.phase).toBe('design');

    // -------------------------------------------------------------------------
    // 5. Setup Travaux & Achats lots for execution
    // -------------------------------------------------------------------------
    const lotTravauxRes = await createLotAction({
      project_id: projectId,
      category: 'plomberie',
      artisan_name: 'Artisan Plomberie Express',
      budget_estimate_mad: 45000,
    });
    expect(lotTravauxRes.ok).toBe(true);

    const lotAchatsRes = await createAchatLotAction({
      project_id: projectId,
      category: 'mobilier',
      supplier_name: 'Mobilier Marrakech',
      budget_estimate_mad: 60000,
    });
    expect(lotAchatsRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // 6. Advance to Travaux Phase
    // -------------------------------------------------------------------------
    const advTravauxRes = await advancePhaseAction({ project_id: projectId, new_phase: 'travaux' });
    expect(advTravauxRes.ok).toBe(true);
    project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.phase).toBe('travaux');

    // -------------------------------------------------------------------------
    // 7. Request and Approve Milestone Payment
    // -------------------------------------------------------------------------
    // Chef requests payment approval
    const paymentId = '77777777-7777-4777-8777-777777777777';
    mockSupabase.db.payments.push({
      id: paymentId,
      project_id: projectId,
      amount_expected: 45000,
      amount_paid: 0,
      status: 'pending',
    });

    const approvalRes = await requestApprovalAction({
      source: 'payment',
      source_id: paymentId,
      amount: 15000,
      currency: 'MAD',
      beneficiary_name: 'Artisan Plomberie',
      project_id: projectId,
    });
    expect(approvalRes.ok).toBe(true);

    const req = mockSupabase.db.payment_approvals.find((r: any) => r.payment_id === paymentId);
    expect(req).toBeDefined();
    expect(req.status).toBe('pending');

    // Finance officer / CEO approves payment
    setMockUser('ceo', CEO_ID);
    const reviewRes = await financeReviewAction(req.id, 'approved');
    expect(reviewRes.ok).toBe(true);
    expect(mockSupabase.db.payment_approvals.find((r: any) => r.id === req.id).finance_status).toBe('approved');

    // -------------------------------------------------------------------------
    // 8. Advance through Livraison to Terminé
    // -------------------------------------------------------------------------
    setMockUser('chef_projet', CHEF_ID);
    const advLivraisonRes = await advancePhaseAction({ project_id: projectId, new_phase: 'livraison' });
    expect(advLivraisonRes.ok).toBe(true);
    project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.phase).toBe('livraison');

    const advTermineRes = await advancePhaseAction({ project_id: projectId, new_phase: 'termine' });
    expect(advTermineRes.ok).toBe(true);
    project = mockSupabase.db.projects.find((p: any) => p.id === projectId);
    expect(project.phase).toBe('termine');

    // -------------------------------------------------------------------------
    // 9. Propria Rental Management Activation
    // -------------------------------------------------------------------------
    setMockUser('ceo', CEO_ID);
    await activatePropriaManagementAction(PROPERTY_ID);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
    expect(prop.propria_managed_at).toBeDefined();
  });

  it('Phase Reversion Workflow: Advance phase -> Revert step -> Verify clean rollback', async () => {
    // 1. Create project
    const createRes = await createProjectAction({
      client_id: CLIENT_ID,
      title: 'Projet Test Rollback',
      budget_total: 1000000,
      city: 'Casablanca',
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const testPrjId = createRes.id;

    // 2. Advance to sourcing then design
    setMockUser('chef_projet', CHEF_ID);
    await advancePhaseAction({ project_id: testPrjId, new_phase: 'sourcing' });
    await advancePhaseAction({ project_id: testPrjId, new_phase: 'design' });

    let prj = mockSupabase.db.projects.find((p: any) => p.id === testPrjId);
    expect(prj.phase).toBe('design');

    // 3. Revert phase back to sourcing
    const revRes = await revertPhaseAction(testPrjId);
    expect(revRes.ok).toBe(true);
    prj = mockSupabase.db.projects.find((p: any) => p.id === testPrjId);
    expect(prj.phase).toBe('sourcing');
  });

  it('Chef Reassignment and Project Soft-Deletion Workflow', async () => {
    // 1. Create project
    const createRes = await createProjectAction({
      client_id: CLIENT_ID,
      title: 'Projet Reassignment',
      budget_total: 2000000,
      city: 'Rabat',
    });
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const testPrjId = createRes.id;

    // 2. Reassign chef de projet
    const assignRes = await updateProjectChefAction({ project_id: testPrjId, chef_id: CHEF_ID });
    expect(assignRes.ok).toBe(true);

    let prj = mockSupabase.db.projects.find((p: any) => p.id === testPrjId);
    expect(prj.assigned_chef_projet).toBe(CHEF_ID);

    // 3. CEO soft-deletes project
    setMockUser('ceo', CEO_ID);
    const delRes = await deleteProjectAction(testPrjId);
    expect(delRes.ok).toBe(true);

    prj = mockSupabase.db.projects.find((p: any) => p.id === testPrjId);
    expect(prj.deleted_at).toBeDefined();
  });
});
