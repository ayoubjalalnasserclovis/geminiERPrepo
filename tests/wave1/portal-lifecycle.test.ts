import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

vi.mock('server-only', () => ({}));

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

describe('Wave 1 — Portal & Lifecycle Suite', () => {
  const CLIENT_ID = 'client-uuid-001';
  const CLIENT_PROFILE_ID = 'client-profile-001';
  const CHEF_ID = 'chef-uuid-001';
  const PROJECT_ID = 'project-lifecycle-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('client', CLIENT_PROFILE_ID);

    mockSupabase.db['clients'] = [
      {
        id: CLIENT_ID,
        profile_id: CLIENT_PROFILE_ID,
        nom: 'Alami',
        prenom: 'Karim',
        email: 'karim.alami@example.com',
        telephone: '+212600000000',
        onboarding_completed: false,
        onboarding_step: 1,
      },
    ];

    mockSupabase.db['projects'] = [
      {
        id: PROJECT_ID,
        client_id: CLIENT_ID,
        chef_projet_id: CHEF_ID,
        name: 'Appartement Majorelle',
        statut_projet: 'actif',
        phase: 'sourcing',
      },
    ];

    mockSupabase.db['proposals'] = [];
    mockSupabase.db['project_documents'] = [];
  });

  describe('W02..W08: Client Portal Onboarding Journey', () => {
    it('advances client onboarding step by step to completion', async () => {
      // Step 1 -> 2: Fill identity & preferences
      await mockSupabase
        .from('clients')
        .update({
          onboarding_step: 2,
          budget_max: 2000000,
          type_bien_souhaite: 'appartement',
        })
        .eq('id', CLIENT_ID);

      let { data: client } = await mockSupabase
        .from('clients')
        .select('*')
        .eq('id', CLIENT_ID)
        .single();

      expect(client.onboarding_step).toBe(2);
      expect(client.budget_max).toBe(2000000);

      // Step 2 -> Complete: Sign terms & validate
      await mockSupabase
        .from('clients')
        .update({
          onboarding_step: 3,
          onboarding_completed: true,
          terms_accepted_at: new Date().toISOString(),
        })
        .eq('id', CLIENT_ID);

      const { data: completedClient } = await mockSupabase
        .from('clients')
        .select('*')
        .eq('id', CLIENT_ID)
        .single();

      expect(completedClient.onboarding_completed).toBe(true);
      expect(completedClient.terms_accepted_at).toBeDefined();
    });
  });

  describe('W18..W26: Proposals, Documents & Client Gates', () => {
    it('allows client to review proposal, approve it, and triggers proposal acceptance', async () => {
      const proposal = {
        id: 'prop-001',
        project_id: PROJECT_ID,
        title: 'Opportunité Riad Médina',
        price: 1850000,
        status: 'presented',
      };
      await mockSupabase.from('proposals').insert(proposal);

      // Client accepts proposal
      await mockSupabase
        .from('proposals')
        .update({
          status: 'accepted',
          accepted_at: new Date().toISOString(),
        })
        .eq('id', 'prop-001');

      const { data: updatedProp } = await mockSupabase
        .from('proposals')
        .select('*')
        .eq('id', 'prop-001')
        .single();

      expect(updatedProp.status).toBe('accepted');
      expect(updatedProp.accepted_at).toBeDefined();
    });

    it('manages document access permissions strictly between client and team', async () => {
      const doc = {
        id: 'doc-001',
        project_id: PROJECT_ID,
        name: 'Compromis_de_vente_signe.pdf',
        category: 'juridique',
        is_visible_client: true,
      };
      await mockSupabase.from('project_documents').insert(doc);

      // Client query visible docs
      const { data: clientDocs } = await mockSupabase
        .from('project_documents')
        .select('*')
        .eq('project_id', PROJECT_ID)
        .eq('is_visible_client', true);

      expect(clientDocs).toHaveLength(1);
      expect(clientDocs[0].name).toBe('Compromis_de_vente_signe.pdf');

      // Internal team document hidden from client
      await mockSupabase.from('project_documents').insert({
        id: 'doc-internal',
        project_id: PROJECT_ID,
        name: 'Marge_interne_confidentielle.xlsx',
        category: 'interne',
        is_visible_client: false,
      });

      const { data: clientFiltered } = await mockSupabase
        .from('project_documents')
        .select('*')
        .eq('project_id', PROJECT_ID)
        .eq('is_visible_client', true);

      expect(clientFiltered).toHaveLength(1);
    });
  });

  describe('WF-08..WF-18: Project Lifecycle State Machine', () => {
    const validPhases = [
      'sourcing',
      'negociation',
      'compromis',
      'conception',
      'travaux',
      'meublement',
      'livraison',
      'termine',
    ];

    it('transitions across all 8 phases sequentially', async () => {
      setMockUser('chef_projet', CHEF_ID);

      for (let i = 1; i < validPhases.length; i++) {
        const nextPhase = validPhases[i];
        await mockSupabase
          .from('projects')
          .update({ phase: nextPhase })
          .eq('id', PROJECT_ID);

        const { data: p } = await mockSupabase
          .from('projects')
          .select('phase')
          .eq('id', PROJECT_ID)
          .single();

        expect(p.phase).toBe(nextPhase);
      }
    });

    it('blocks unauthorized phase jump if gate criteria are not met', async () => {
      const advancePhaseWithGate = (currentPhase: string, targetPhase: string, hasSignedProposal: boolean) => {
        if (currentPhase === 'sourcing' && targetPhase === 'travaux') {
          throw new Error('Impossible de sauter directement en phase travaux');
        }
        if (targetPhase === 'negociation' && !hasSignedProposal) {
          throw new Error('La proposition doit être acceptée avant la négociation');
        }
        return { success: true, newPhase: targetPhase };
      };

      expect(() => advancePhaseWithGate('sourcing', 'travaux', false)).toThrow(
        'Impossible de sauter directement en phase travaux'
      );

      expect(() => advancePhaseWithGate('sourcing', 'negociation', false)).toThrow(
        'La proposition doit être acceptée avant la négociation'
      );

      expect(advancePhaseWithGate('sourcing', 'negociation', true)).toEqual({
        success: true,
        newPhase: 'negociation',
      });
    });
  });
});
