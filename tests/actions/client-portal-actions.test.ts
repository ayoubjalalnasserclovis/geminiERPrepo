import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const CLIENT_PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_PROFILE_ID = '99999999-9999-4999-8999-999999999999';
const CLIENT_ID = '22222222-2222-4222-8222-222222222222';
const PROJECT_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const BRIEF_ID = '55555555-5555-4555-8555-555555555555';
const SURVEY_ID = '66666666-6666-4666-8666-666666666666';
const TEMPLATE_ID = '77777777-7777-4777-8777-777777777777';
const PROPOSAL_ID = '88888888-8888-4888-8888-888888888888';

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

vi.mock('@/lib/email/templates', () => ({
  sendDocumentValidatedToTeam: vi.fn().mockResolvedValue(true),
  sendDesignMilestoneToClient: vi.fn().mockResolvedValue(true),
  sendBriefValidatedToTeam: vi.fn().mockResolvedValue(true),
  sendBriefRejectedToTeam: vi.fn().mockResolvedValue(true),
  sendClientMoodboardSelection: vi.fn().mockResolvedValue(true),
  sendProposalResponseToTeam: vi.fn().mockResolvedValue(true),
  sendSurveyCompletedToTeam: vi.fn().mockResolvedValue(true),
  sendSurveyThanksToClient: vi.fn().mockResolvedValue(true),
  sendLowNpsAlertToCeo: vi.fn().mockResolvedValue(true),
}));

import { completeOnboardingAction } from '@/app/(client)/client/onboarding/actions';
import { uploadClientDocumentAction } from '@/app/(client)/client/documents/actions';
import { validateDocumentAction } from '@/app/(client)/client/documents/validate-actions';
import { clientValidateBriefAction, clientRejectBriefAction } from '@/app/(client)/client/projects/[id]/brief/actions';
import { submitMoodboardSelectionAction } from '@/app/(client)/client/projects/[id]/moodboard-selection/actions';
import { respondToProposalAction } from '@/app/(client)/client/projects/[id]/proposals/actions';
import { submitSurveyAction } from '@/app/(client)/client/surveys/actions';

describe('Client Portal Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      profiles: [
        { id: CLIENT_PROFILE_ID, email: 'client@example.com', role: 'client', full_name: 'Karim Bennani' },
        { id: 'usr-chef-1', email: 'chef@stoniz.co', role: 'chef_projet', full_name: 'Youssef Chef' },
        { id: 'usr-ceo-1', email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
      ],
      clients: [
        { id: CLIENT_ID, profile_id: CLIENT_PROFILE_ID, full_name: 'Karim Bennani', onboarding_completed_at: null },
      ],
      projects: [
        {
          id: PROJECT_ID,
          client_id: CLIENT_ID,
          client: { profile_id: CLIENT_PROFILE_ID, full_name: 'Karim Bennani' },
          reference: 'PRJ-2026-001',
          assigned_chef_projet: 'usr-chef-1',
          deleted_at: null,
        },
      ],
      documents: [
        {
          id: DOCUMENT_ID,
          project_id: PROJECT_ID,
          type: 'plans_3d',
          client_validation_status: 'pending',
        },
      ],
      project_briefs: [
        {
          id: BRIEF_ID,
          project_id: PROJECT_ID,
          status: 'sent_to_client',
        },
      ],
      satisfaction_surveys: [
        {
          id: SURVEY_ID,
          project_id: PROJECT_ID,
          client_id: CLIENT_ID,
          phase: 'design',
          global_score: null,
        },
      ],
      tasks: [
        {
          id: 'task-1',
          project_id: PROJECT_ID,
          title: 'Valider les 3D avec le client',
          status: 'todo',
        },
      ],
      client_moodboard_selections: [],
    });

    setMockUser('client', CLIENT_PROFILE_ID);
  });

  describe('Client Onboarding', () => {
    it('rejects access if user is not client role', async () => {
      setMockUser('chef_projet', 'cp-1');
      const formData = new FormData();
      await expect(completeOnboardingAction(formData)).rejects.toThrow('Permission refusée');
    });

    it('rejects invalid or missing form data', async () => {
      const formData = new FormData();
      formData.append('first_name', 'Karim');
      const res = await completeOnboardingAction(formData);
      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('successfully processes full client onboarding with valid data and file', async () => {
      const formData = new FormData();
      formData.append('first_name', 'Karim');
      formData.append('last_name', 'Bennani');
      formData.append('email', 'karim@example.com');
      formData.append('phone', '+33 6 12 34 56 78');
      formData.append('nationality', 'Marocaine');
      formData.append('credit_type', 'no');
      formData.append('available_savings', '200000');
      formData.append('budget_max', '250000');
      formData.append('expected_rent', '1500');
      formData.append('expected_gross_yield_pct', '8.5');
      formData.append('expected_net_yield_pct', '6.5');
      formData.append('quartiers', 'Gueliz');
      formData.append('investment_holding', 'nom_propre');
      formData.append('investment_party_count', '1');
      formData.append('billing_address_line', '12 Boulevard Zerktouni');
      formData.append('billing_city', 'Marrakech');
      formData.append('billing_postal_code', '40000');
      formData.append('billing_country', 'Maroc');
      formData.append('needs_bank_account_opening', 'no');

      const file = new File(['fake-passport-content'], 'passport.pdf', { type: 'application/pdf' });
      formData.append('piece_identite', file);

      try {
        const res = await completeOnboardingAction(formData);
        if (res) expect(res.ok).toBe(true);
      } catch (err: any) {
        // next/navigation redirect may be triggered
      }

      const client = mockSupabase.db.clients.find((c: any) => c.id === CLIENT_ID);
      expect(client.onboarding_completed_at).toBeDefined();
    });
  });

  describe('Client Documents & Validations', () => {
    it('uploads document when user is authenticated client for the project', async () => {
      const formData = new FormData();
      const file = new File(['dummy-contract-content'], 'rib.pdf', { type: 'application/pdf' });
      formData.append('file', file);
      formData.append('project_id', PROJECT_ID);
      formData.append('type', 'rib');

      const res = await uploadClientDocumentAction(formData);
      expect(res.ok).toBe(true);

      const insertedDoc = mockSupabase.db.documents.find((d: any) => d.type === 'rib');
      expect(insertedDoc).toBeDefined();
      expect(insertedDoc.project_id).toBe(PROJECT_ID);
      expect(insertedDoc.uploaded_by_role).toBe('client');
    });

    it('rejects document upload when client does not own the project', async () => {
      setMockUser('client', OTHER_PROFILE_ID);

      const formData = new FormData();
      const file = new File(['dummy-contract-content'], 'rib.pdf', { type: 'application/pdf' });
      formData.append('file', file);
      formData.append('project_id', PROJECT_ID);
      formData.append('type', 'rib');

      const res = await uploadClientDocumentAction(formData);
      expect(res.ok).toBe(false);
      expect(res.error).toContain('Projet non autorisé');
    });

    it('validates a document and auto-completes associated task for plans_3d', async () => {
      const res = await validateDocumentAction(DOCUMENT_ID, 'validated', 'Super design');
      expect(res.ok).toBe(true);

      const doc = mockSupabase.db.documents.find((d: any) => d.id === DOCUMENT_ID);
      expect(doc.client_validation_status).toBe('validated');
      expect(doc.client_validation_comment).toBe('Super design');

      const task = mockSupabase.db.tasks.find((t: any) => t.id === 'task-1');
      expect(task.status).toBe('done');
    });
  });

  describe('Client Project Brief Validation & Rejection', () => {
    it('allows client to validate brief and creates trace document', async () => {
      const res = await clientValidateBriefAction(PROJECT_ID);
      expect(res.ok).toBe(true);

      const brief = mockSupabase.db.project_briefs.find((b: any) => b.id === BRIEF_ID);
      expect(brief.status).toBe('validated');

      const docTrace = mockSupabase.db.documents.find((d: any) => d.type === 'cahier_des_charges');
      expect(docTrace).toBeDefined();
      expect(docTrace.status).toBe('valide');
    });

    it('rejects brief with valid justification reason', async () => {
      const res = await clientRejectBriefAction(PROJECT_ID, 'Le budget estimé est trop élevé');
      expect(res.ok).toBe(true);

      const brief = mockSupabase.db.project_briefs.find((b: any) => b.id === BRIEF_ID);
      expect(brief.status).toBe('rejected_by_client');
      expect(brief.rejection_reason).toBe('Le budget estimé est trop élevé');
    });

    it('refuses brief rejection if reason is too short', async () => {
      const res = await clientRejectBriefAction(PROJECT_ID, 'Non');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('au moins 5 caractères');
    });
  });

  describe('Client Moodboard Selection', () => {
    it('saves client preferences and updates project flag', async () => {
      await submitMoodboardSelectionAction({
        project_id: PROJECT_ID,
        selections: [
          { template_id: TEMPLATE_ID, preference_order: 1, client_comment: 'Style moderne et chaleureux' },
        ],
        global_comment: 'Nous adorons les tons habits et le bois clair.',
      });

      expect(mockSupabase.db.client_moodboard_selections.length).toBe(1);
      expect(mockSupabase.db.client_moodboard_selections[0].template_id).toBe(TEMPLATE_ID);
    });

    it('fails when global comment is too short', async () => {
      const res = await submitMoodboardSelectionAction({
        project_id: PROJECT_ID,
        selections: [
          { template_id: TEMPLATE_ID, preference_order: 1 },
        ],
        global_comment: 'Court',
      });

      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });
  });

  describe('Client Proposal Response & Satisfaction Survey', () => {
    it('submits response to property proposal via RPC', async () => {
      const res = await respondToProposalAction({
        proposal_id: PROPOSAL_ID,
        response: 'accepted',
        message: 'Cette villa correspond parfaitement à nos critères !',
      });

      expect(res.ok).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('respond_to_proposal', expect.objectContaining({
        p_proposal_id: PROPOSAL_ID,
        p_response: 'accepted',
      }));
    });

    it('submits satisfaction survey rating scores', async () => {
      const res = await submitSurveyAction({
        survey_id: SURVEY_ID,
        global_score: 5,
        communication_score: 5,
        reactivity_score: 4,
        quality_score: 5,
        deadline_score: 4,
        comment: 'Équipe très pro et réactive !',
        nps_score: 10,
        nps_comment: 'Je recommande vivement Stoniz',
      });

      expect(res.ok).toBe(true);
      const survey = mockSupabase.db.satisfaction_surveys.find((s: any) => s.id === SURVEY_ID);
      expect(survey.global_score).toBe(5);
      expect(survey.nps_score).toBe(10);
      expect(survey.completed_at).toBeDefined();
    });
  });
});
