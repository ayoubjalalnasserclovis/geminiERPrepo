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

vi.mock('@/lib/email/templates', () => ({
  sendNewProposal: vi.fn().mockResolvedValue(true),
  sendNewSelectionToClient: vi.fn().mockResolvedValue(true),
  sendFinalPropertySelected: vi.fn().mockResolvedValue(true),
  sendProposalResponseToTeam: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: vi.fn().mockResolvedValue(true),
}));

import {
  sendProposalAction,
  sendProposalsBatchAction,
  selectFinalPropertyAction,
  selectFinalPropertyOnBehalfAction,
  unselectFinalPropertyAction,
  deleteProposalAction,
} from '@/app/(team)/projects/[id]/proposals/actions';

import { respondToProposalAction } from '@/app/(client)/client/projects/[id]/proposals/actions';

describe('Multi-Step Workflow: Client Proposals Batch Selection & On-Behalf Decision', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const CHEF_USER_ID = '22222222-1111-2222-3333-444444444444';
  const CLIENT_PROFILE_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';
  const PROJECT_ID = '55555555-1111-2222-3333-444444444444';
  const PROP_A_ID = '66666666-1111-2222-3333-444444444444';
  const PROP_B_ID = '77777777-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          client_id: CLIENT_ID,
          title: 'Investissement Riad Gueliz',
          property_id: null,
          property_selected_on_behalf: false,
          property_selected_on_behalf_reason: null,
        },
      ],
      clients: [
        {
          id: CLIENT_ID,
          profile_id: CLIENT_PROFILE_ID,
          email: 'client@example.com',
          full_name: 'Sophia Benjelloun',
        },
      ],
      properties: [
        { id: PROP_A_ID, name: 'Riad Jasmine 180m2', status: 'disponible' },
        { id: PROP_B_ID, name: 'Riad Majorelle 220m2', status: 'disponible' },
      ],
      property_proposals: [],
      profiles: [
        { id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' },
        { id: CHEF_USER_ID, role: 'chef_projet', full_name: 'Chef Tariq' },
        { id: CLIENT_PROFILE_ID, role: 'client', full_name: 'Sophia Benjelloun' },
      ],
    });
    setMockUser('chef_projet', CHEF_USER_ID);
  });

  it('Step 1 -> 4: Team dispatches batch proposals -> Client reviews and accepts primary option', async () => {
    // 1. Chef de projet prepares batch of 2 properties with team recommendation note
    const batchRes = await sendProposalsBatchAction({
      project_id: PROJECT_ID,
      ordered_property_ids: [PROP_A_ID, PROP_B_ID],
      team_note: 'Excellente rentabilité locative estimée à 9.5% brut sur le bien A',
    });

    expect(batchRes.ok).toBe(true);
    expect(batchRes.sent_count).toBe(2);

    const proposals = mockSupabase.db.property_proposals;
    expect(proposals).toHaveLength(2);
    const propAProposal = proposals.find((p: any) => p.property_id === PROP_A_ID);
    expect(propAProposal).toBeDefined();
    expect(propAProposal.status).toBe('sent');

    // 2. Client logs in and accepts property A
    setMockUser('client', CLIENT_PROFILE_ID);
    const acceptRes = await respondToProposalAction({
      proposal_id: propAProposal.id,
      response: 'accepted',
      message: 'Nous confirmons notre choix pour le bien A !',
    });
    expect(acceptRes.ok).toBe(true);

    const updatedProposal = mockSupabase.db.property_proposals.find((p: any) => p.id === propAProposal.id);
    expect(updatedProposal.status).toBe('accepted');

    // 3. Team confirms final selection
    setMockUser('chef_projet', CHEF_USER_ID);
    const selectRes = await selectFinalPropertyAction({
      project_id: PROJECT_ID,
      property_id: PROP_A_ID,
    });
    expect(selectRes.ok).toBe(true);

    const project = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(project.property_id).toBe(PROP_A_ID);
    const propA = mockSupabase.db.properties.find((p: any) => p.id === PROP_A_ID);
    expect(propA.status).toBe('reserve');
  });

  it('Rejection flow: Client declines proposal with feedback -> Team releases property', async () => {
    // 1. Single proposal dispatched
    const sendRes = await sendProposalAction({
      project_id: PROJECT_ID,
      property_id: PROP_B_ID,
    });
    expect(sendRes.ok).toBe(true);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROP_B_ID);
    expect(prop.status).toBe('propose');
    const proposal = mockSupabase.db.property_proposals[0];

    // 2. Client declines
    setMockUser('client', CLIENT_PROFILE_ID);
    const declineRes = await respondToProposalAction({
      proposal_id: proposal.id,
      response: 'refused',
      refusal_reason: 'Budget travaux trop élevé par rapport à notre enveloppe.',
    });
    expect(declineRes.ok).toBe(true);

    // 3. Team deletes declined proposal -> property reverts to disponible
    setMockUser('chef_projet', CHEF_USER_ID);
    const delRes = await deleteProposalAction(proposal.id, PROJECT_ID);
    expect(delRes.ok).toBe(true);

    const propAfter = mockSupabase.db.properties.find((p: any) => p.id === PROP_B_ID);
    expect(propAfter.status).toBe('disponible');
  });

  it('On-behalf selection: Chef validates property for client with required justification', async () => {
    // Proposal exists
    mockSupabase.db.property_proposals.push({
      id: 'prop-1',
      project_id: PROJECT_ID,
      property_id: PROP_A_ID,
      status: 'sent',
    });

    // 1. Chef validates on behalf of client with valid explanation (>= 10 chars)
    const behalfRes = await selectFinalPropertyOnBehalfAction({
      project_id: PROJECT_ID,
      property_id: PROP_A_ID,
      reason: 'Validation par téléphone suite accord verbal client en déplacement',
    });
    expect(behalfRes.ok).toBe(true);

    const project = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(project.property_id).toBe(PROP_A_ID);
    expect(project.property_selected_on_behalf).toBe(true);
    expect(project.property_selected_on_behalf_reason).toContain('Validation par téléphone');
  });

  it('Guard enforcement: Reason length check and unselection rollback', async () => {
    // 1. Attempt on-behalf selection with too short reason (< 10 chars) -> BLOCKED
    const failBehalf = await selectFinalPropertyOnBehalfAction({
      project_id: PROJECT_ID,
      property_id: PROP_A_ID,
      reason: 'Accord',
    });
    expect(failBehalf.ok).toBe(false);
    expect((failBehalf as any).error).toContain('au moins 10 caractères');

    // 2. Select validly
    await selectFinalPropertyAction({
      project_id: PROJECT_ID,
      property_id: PROP_A_ID,
    });
    let project = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(project.property_id).toBe(PROP_A_ID);

    // 3. Unselect property -> resets property_id and returns property to disponible
    const unselectRes = await unselectFinalPropertyAction(PROJECT_ID);
    expect(unselectRes.ok).toBe(true);

    project = mockSupabase.db.projects.find((p: any) => p.id === PROJECT_ID);
    expect(project.property_id).toBeNull();
    const propA = mockSupabase.db.properties.find((p: any) => p.id === PROP_A_ID);
    expect(propA.status).toBe('disponible');
  });
});
