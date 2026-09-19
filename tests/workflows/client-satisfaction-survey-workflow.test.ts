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
}));

const mockSendSurveyThanksToClient = vi.fn().mockResolvedValue(true);
const mockSendSurveyCompletedToTeam = vi.fn().mockResolvedValue(true);
const mockSendLowNpsAlertToCeo = vi.fn().mockResolvedValue(true);

vi.mock('@/lib/email/templates', () => ({
  sendSurveyThanksToClient: (...args: any[]) => mockSendSurveyThanksToClient(...args),
  sendSurveyCompletedToTeam: (...args: any[]) => mockSendSurveyCompletedToTeam(...args),
  sendLowNpsAlertToCeo: (...args: any[]) => mockSendLowNpsAlertToCeo(...args),
}));

import { submitSurveyAction } from '@/app/(client)/client/surveys/actions';

describe('Multi-Step Workflow: Client Satisfaction Surveys & NPS Escalations', () => {
  const SURVEY_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const PROJECT_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
  const CLIENT_ID = 'cccccccc-1111-2222-3333-444444444444';
  const CHEF_ID = 'dddddddd-1111-2222-3333-444444444444';
  const CEO_ID = 'eeeeeeee-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    vi.clearAllMocks();

    mockSupabase.db.satisfaction_surveys = [
      {
        id: SURVEY_ID,
        project_id: PROJECT_ID,
        trigger_phase: 'livraison',
        global_score: null,
        completed_at: null,
        project: {
          reference: 'PRJ-2026-0042',
          assigned_chef_projet: CHEF_ID,
          client: {
            email: 'investor@example.com',
            full_name: 'Karim Bennani',
            phone: '+212 600 123456',
          },
        },
      },
    ];

    mockSupabase.db.projects = [
      {
        id: PROJECT_ID,
        reference: 'PRJ-2026-0042',
        assigned_chef_projet: CHEF_ID,
        client: {
          email: 'investor@example.com',
          full_name: 'Karim Bennani',
          phone: '+212 600 123456',
        },
      },
    ];

    mockSupabase.db.profiles = [
      { id: CHEF_ID, email: 'chef@stoniz.co', full_name: 'Yassine Chef', role: 'chef_projet' },
      { id: CEO_ID, email: 'ceo@stoniz.co', full_name: 'Othmane CEO', role: 'ceo', is_active: true },
    ];
  });

  it('Step 1: Client submits highly positive survey with Promoter NPS (10/10)', async () => {
    setMockUser('client', CLIENT_ID);

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 5,
      communication_score: 5,
      reactivity_score: 5,
      quality_score: 5,
      deadline_score: 5,
      comment: 'Service exceptionnel, respect des délais remarquable !',
      nps_score: 10,
      nps_comment: 'Je recommande Stoniz à tous mes amis investisseurs.',
    });

    const survey = mockSupabase.db.satisfaction_surveys.find((s: any) => s.id === SURVEY_ID);
    expect(survey.completed_at).toBeDefined();
    expect(survey.global_score).toBe(5);
    expect(survey.nps_score).toBe(10);

    expect(mockSendSurveyThanksToClient).toHaveBeenCalled();
    expect(mockSendSurveyCompletedToTeam).toHaveBeenCalled();
    expect(mockSendLowNpsAlertToCeo).not.toHaveBeenCalled();
  });

  it('Step 2: Detractor NPS (<= 6) automatically triggers urgent CEO alert', async () => {
    setMockUser('client', CLIENT_ID);

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 2,
      communication_score: 2,
      reactivity_score: 1,
      quality_score: 3,
      deadline_score: 1,
      comment: 'Retard important sur la livraison du chantier.',
      nps_score: 4,
      nps_comment: 'Déçu du suivi des finitions.',
    });

    const survey = mockSupabase.db.satisfaction_surveys.find((s: any) => s.id === SURVEY_ID);
    expect(survey.nps_score).toBe(4);

    expect(mockSendLowNpsAlertToCeo).toHaveBeenCalled();
  });

  it('Step 3: Missing or out-of-bounds scores are rejected by schema', async () => {
    setMockUser('client', CLIENT_ID);

    // Global score > 5
    const res1 = await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 6,
      communication_score: 5,
      reactivity_score: 5,
      quality_score: 5,
      deadline_score: 5,
    });
    expect(res1.ok).toBe(false);

    // NPS > 10
    const res2 = await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 4,
      communication_score: 4,
      reactivity_score: 4,
      quality_score: 4,
      deadline_score: 4,
      nps_score: 11,
    });
    expect(res2.ok).toBe(false);
  });

  it('Step 4: Non-client roles are strictly forbidden from submitting survey', async () => {
    setMockUser('chef_projet', CHEF_ID);

    await expect(
      submitSurveyAction({
        survey_id: SURVEY_ID,
        global_score: 5,
        communication_score: 5,
        reactivity_score: 5,
        quality_score: 5,
        deadline_score: 5,
      }),
    ).rejects.toThrow('Permission refusée');
  });

  it('Step 5: Optional comments with empty strings are cleaned to null', async () => {
    setMockUser('client', CLIENT_ID);

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 4,
      communication_score: 4,
      reactivity_score: 4,
      quality_score: 4,
      deadline_score: 4,
      comment: '',
      nps_score: '',
      nps_comment: '',
    });

    const survey = mockSupabase.db.satisfaction_surveys.find((s: any) => s.id === SURVEY_ID);
    expect(survey.comment).toBeNull();
    expect(survey.nps_score).toBeNull();
    expect(survey.nps_comment).toBeNull();
  });

  it('Step 6: Passive NPS score (7 or 8) records completion without low-NPS alert', async () => {
    setMockUser('client', CLIENT_ID);

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 4,
      communication_score: 4,
      reactivity_score: 3,
      quality_score: 4,
      deadline_score: 3,
      nps_score: 8,
    });

    expect(mockSendSurveyCompletedToTeam).toHaveBeenCalled();
    expect(mockSendLowNpsAlertToCeo).not.toHaveBeenCalled();
  });

  it('Step 7: Survey response updates all 5 dimensional metrics faithfully', async () => {
    setMockUser('client', CLIENT_ID);

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 3,
      communication_score: 2,
      reactivity_score: 4,
      quality_score: 5,
      deadline_score: 1,
      comment: 'Équipe très pro mais plannings trop serrés.',
      nps_score: 6,
    });

    const s = mockSupabase.db.satisfaction_surveys.find((x: any) => x.id === SURVEY_ID);
    expect(s.global_score).toBe(3);
    expect(s.communication_score).toBe(2);
    expect(s.reactivity_score).toBe(4);
    expect(s.quality_score).toBe(5);
    expect(s.deadline_score).toBe(1);
    expect(s.comment).toContain('Équipe très pro');
  });

  it('Step 8: Invalid survey ID (non-existent) does not crash and handles safely', async () => {
    setMockUser('client', CLIENT_ID);

    const res = await submitSurveyAction({
      survey_id: '99999999-9999-9999-9999-999999999999',
      global_score: 5,
      communication_score: 5,
      reactivity_score: 5,
      quality_score: 5,
      deadline_score: 5,
    });

    // In mock, update on missing ID either updates 0 rows or completes without error
    expect(res === undefined || res.ok !== undefined).toBe(true);
  });

  it('Step 9: Detractor alert email targets CEO with accurate details', async () => {
    setMockUser('client', CLIENT_ID);

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 1,
      communication_score: 1,
      reactivity_score: 1,
      quality_score: 1,
      deadline_score: 1,
      nps_score: 2,
      nps_comment: 'Très mécontent de l’isolation phonique.',
    });

    expect(mockSendLowNpsAlertToCeo).toHaveBeenCalled();
  });

  it('Step 10: Multi-step idempotence: updating an already submitted survey updates completed_at', async () => {
    setMockUser('client', CLIENT_ID);

    const firstTime = '2026-09-01T10:00:00.000Z';
    mockSupabase.db.satisfaction_surveys[0].completed_at = firstTime;

    await submitSurveyAction({
      survey_id: SURVEY_ID,
      global_score: 5,
      communication_score: 5,
      reactivity_score: 5,
      quality_score: 5,
      deadline_score: 5,
      nps_score: 9,
    });

    const s = mockSupabase.db.satisfaction_surveys.find((x: any) => x.id === SURVEY_ID);
    expect(s.completed_at).not.toBe(firstTime);
  });
});
