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

vi.mock('@/lib/email/templates', () => ({
  sendClientMoodboardSelection: vi.fn().mockResolvedValue(true),
}));

import {
  saveMoodboardChoiceAction,
  sendMoodboardToClientAction,
  clientValidateMoodboardAction,
  clientRejectMoodboardAction,
  setMoodboardFinalAction,
  clearMoodboardFinalAction,
} from '@/app/(team)/projects/[id]/moodboard/actions';

import {
  submitMoodboardSelectionAction,
} from '@/app/(client)/client/projects/[id]/moodboard-selection/actions';

describe('Multi-Step Workflow: Moodboard Design, Client Selection & Execution Decision', () => {
  const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
  const TEMPLATE_ID_1 = '22222222-3333-4444-5555-666666666666';
  const TEMPLATE_ID_2 = '33333333-4444-5555-6666-777777777777';
  const CHEF_ID = '44444444-1111-2222-3333-444444444444';
  const CEO_ID = '55555555-1111-2222-3333-444444444444';
  const CLIENT_ID = '66666666-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.projects = [
      {
        id: PROJECT_ID,
        title: 'Villa Palmier',
        phase: 'design',
        assigned_chef_projet: CHEF_ID,
        deleted_at: null,
      },
    ];
    mockSupabase.db.project_moodboard_choices = [];
    mockSupabase.db.client_moodboard_selections = [];
  });

  it('Step 1-3: Team creates draft moodboard, updates custom inspirations, and sends to client', async () => {
    setMockUser('chef_projet', CHEF_ID);

    // 1. Save initial draft
    const res1 = await saveMoodboardChoiceAction(PROJECT_ID, {
      template_id: TEMPLATE_ID_1,
      custom_notes: 'Ambiance bohème chic avec touches de terracotta',
      custom_inspirations: 'https://example.com/img1.jpg\nhttps://example.com/img2.jpg',
    });
    expect(res1.ok).toBe(true);

    let choice = mockSupabase.db.project_moodboard_choices.find((c: any) => c.project_id === PROJECT_ID);
    expect(choice).toBeDefined();
    expect(choice.status).toBe('draft');
    expect(choice.custom_inspirations_urls.length).toBe(2);

    // 2. Send moodboard to client
    const res2 = await sendMoodboardToClientAction(PROJECT_ID);
    expect(res2.ok).toBe(true);

    choice = mockSupabase.db.project_moodboard_choices.find((c: any) => c.project_id === PROJECT_ID);
    expect(choice.status).toBe('sent_to_client');
  });

  it('Step 4-5: Client submits preferred selections with ranking and global feedback', async () => {
    setMockUser('client', CLIENT_ID);

    const selectionPayload = {
      project_id: PROJECT_ID,
      selections: [
        { template_id: TEMPLATE_ID_1, preference_order: 1, client_comment: 'Coup de cœur pour les textiles' },
        { template_id: TEMPLATE_ID_2, preference_order: 2, client_comment: 'Très belle luminosité' },
      ],
      global_comment: 'Nous adorons l’orientation générale, hâte de voir les 3D.',
    };

    await submitMoodboardSelectionAction(selectionPayload);

    const selections = mockSupabase.db.client_moodboard_selections.filter((s: any) => s.project_id === PROJECT_ID);
    expect(selections.length).toBe(2);
    expect(selections[0].preference_order).toBe(1);
    expect(selections[1].preference_order).toBe(2);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.moodboard_selection_completed_at).toBeDefined();
    expect(proj.moodboard_selection_global_comment).toContain('orientation générale');
  });

  it('Step 6: Client validates moodboard choice and locks it against non-CEO mutation', async () => {
    setMockUser('chef_projet', CHEF_ID);
    mockSupabase.db.project_moodboard_choices.push({
      id: 'choice-1',
      project_id: PROJECT_ID,
      template_id: TEMPLATE_ID_1,
      status: 'sent_to_client',
    });

    // Client validates
    setMockUser('client', CLIENT_ID);
    const valRes = await clientValidateMoodboardAction(PROJECT_ID);
    expect(valRes.ok).toBe(true);

    const choice = mockSupabase.db.project_moodboard_choices.find((c: any) => c.project_id === PROJECT_ID);
    expect(choice.status).toBe('validated');
    expect(choice.validated_by_client_at).toBeDefined();

    // Chef de projet attempts to modify validated choice -> MUST FAIL
    setMockUser('chef_projet', CHEF_ID);
    const modRes = await saveMoodboardChoiceAction(PROJECT_ID, {
      template_id: TEMPLATE_ID_2,
      custom_notes: 'Tentative de modification illégitime',
    });
    expect(modRes.ok).toBe(false);
    expect(modRes.error).toContain('déjà validé par le client');
  });

  it('Step 7: CEO override can adjust moodboard even after client validation', async () => {
    mockSupabase.db.project_moodboard_choices.push({
      id: 'choice-1',
      project_id: PROJECT_ID,
      template_id: TEMPLATE_ID_1,
      status: 'validated',
    });

    setMockUser('ceo', CEO_ID);
    const modRes = await saveMoodboardChoiceAction(PROJECT_ID, {
      template_id: TEMPLATE_ID_2,
      custom_notes: 'Ajustement validé verbalement avec le client',
    });
    expect(modRes.ok).toBe(true);

    const choice = mockSupabase.db.project_moodboard_choices.find((c: any) => c.project_id === PROJECT_ID);
    expect(choice.template_id).toBe(TEMPLATE_ID_2);
  });

  it('Step 8: Client rejection feedback loop requires minimal justification', async () => {
    mockSupabase.db.project_moodboard_choices.push({
      id: 'choice-1',
      project_id: PROJECT_ID,
      template_id: TEMPLATE_ID_1,
      status: 'sent_to_client',
    });

    setMockUser('client', CLIENT_ID);

    // Too short reason -> FAILS
    const failRes = await clientRejectMoodboardAction(PROJECT_ID, 'Non');
    expect(failRes.ok).toBe(false);
    expect(failRes.error).toContain('5 caractères min');

    // Valid feedback
    const okRes = await clientRejectMoodboardAction(PROJECT_ID, 'Les teintes sont trop sombres pour le salon');
    expect(okRes.ok).toBe(true);

    const choice = mockSupabase.db.project_moodboard_choices.find((c: any) => c.project_id === PROJECT_ID);
    expect(choice.status).toBe('rejected');
    expect(choice.rejection_reason).toContain('trop sombres');
  });

  it('Step 9: Team records final execution moodboard decision (template from catalog)', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const res = await setMoodboardFinalAction(PROJECT_ID, {
      template_id: TEMPLATE_ID_1,
      label: null,
    });
    expect(res.ok).toBe(true);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.moodboard_final_template_id).toBe(TEMPLATE_ID_1);
    expect(proj.moodboard_final_label).toBeNull();
    expect(proj.moodboard_final_decided_by).toBe(CHEF_ID);
  });

  it('Step 10: Team records final execution moodboard with custom free label', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const res = await setMoodboardFinalAction(PROJECT_ID, {
      template_id: null,
      label: 'Mix Riad Contemporain + Touches Scandinaves',
    });
    expect(res.ok).toBe(true);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.moodboard_final_template_id).toBeNull();
    expect(proj.moodboard_final_label).toBe('Mix Riad Contemporain + Touches Scandinaves');
  });

  it('Step 11: Final decision requires either template or free label', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const res = await setMoodboardFinalAction(PROJECT_ID, {
      template_id: null,
      label: '   ',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Choisis un moodboard du catalogue OU saisis un libellé libre');
  });

  it('Step 12: Clear final moodboard resets decision metadata', async () => {
    setMockUser('chef_projet', CHEF_ID);
    await setMoodboardFinalAction(PROJECT_ID, { template_id: TEMPLATE_ID_1 });

    const clearRes = await clearMoodboardFinalAction(PROJECT_ID);
    expect(clearRes.ok).toBe(true);

    const proj = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(proj.moodboard_final_template_id).toBeNull();
    expect(proj.moodboard_final_label).toBeNull();
    expect(proj.moodboard_final_decided_at).toBeNull();
  });

  it('Step 13: Client submission anti-bypass rejects unauthenticated and foreign project access', async () => {
    // Other project
    const FOREIGN_PROJECT_ID = '99999999-9999-9999-9999-999999999999';
    setMockUser('client', CLIENT_ID);

    const res = await submitMoodboardSelectionAction({
      project_id: FOREIGN_PROJECT_ID,
      selections: [{ template_id: TEMPLATE_ID_1, preference_order: 1 }],
      global_comment: 'Tentative sur un projet non autorisé.',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Projet introuvable ou accès refusé');
  });
});
