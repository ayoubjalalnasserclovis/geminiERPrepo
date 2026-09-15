import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const CHEF_ID = '33333333-3333-4333-8333-333333333333';

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

vi.mock('@/lib/email/templates', () => ({
  sendWelcomePortal: vi.fn().mockResolvedValue(true),
  sendProjectAssignedToChef: vi.fn().mockResolvedValue(true),
  sendPhaseStart: vi.fn().mockResolvedValue(true),
  sendProjectCompleted: vi.fn().mockResolvedValue(true),
  sendSurveyToClient: vi.fn().mockResolvedValue(true),
  sendActeAuthentiqueToClient: vi.fn().mockResolvedValue(true),
}));

describe('Projects Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          code: 'stz-001',
          reference: 'STZ-001',
          current_phase: 'sourcing',
          assigned_chef_projet: null,
          client_id: CLIENT_ID,
        },
      ],
      clients: [
        {
          id: CLIENT_ID,
          full_name: 'Jean Dupont',
          email: 'jean@example.com',
          profile_id: null,
        },
      ],
      profiles: [
        {
          id: CHEF_ID,
          full_name: 'Chef Alice',
          email: 'alice@stoniz.co',
          role: 'chef_projet',
        },
      ],
    });
    setMockUser('ceo');
    vi.clearAllMocks();
  });

  describe('createProjectAction', () => {
    it('rejects invalid inputs when required fields are missing', async () => {
      const { createProjectAction } = await import('@/app/(team)/projects/actions');
      const res = await createProjectAction({});
      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });

    it('creates project successfully with default stoniz fees', async () => {
      const { createProjectAction } = await import('@/app/(team)/projects/actions');
      const res = await createProjectAction({
        client_id: CLIENT_ID,
        travaux_budget: 150000,
      });
      expect(res.ok).toBe(true);
      expect((res as any).id).toBeDefined();

      const inserted = mockSupabase.db.projects.find((p) => p.id === (res as any).id);
      expect(inserted).toBeDefined();
      expect(inserted.stoniz_fees_acquisition).toBe(8800);
      expect(inserted.stoniz_fees_travaux).toBe(12200);
    });

    it('blocks unauthorized client role from creating a project', async () => {
      setMockUser('client');
      const { createProjectAction } = await import('@/app/(team)/projects/actions');
      await expect(
        createProjectAction({
          client_id: CLIENT_ID,
        })
      ).rejects.toThrow('Permission refusée');
    });
  });

  describe('updateProjectChefAction', () => {
    it('returns error when project does not exist', async () => {
      const { updateProjectChefAction } = await import('@/app/(team)/projects/actions');
      const res = await updateProjectChefAction({ project_id: '00000000-0000-4000-8000-000000000000', chef_id: CHEF_ID });
      expect(res.ok).toBe(false);
      expect(res.error).toBe('Projet introuvable');
    });

    it('assigns chef and updates project record', async () => {
      const { updateProjectChefAction } = await import('@/app/(team)/projects/actions');
      const res = await updateProjectChefAction({ project_id: PROJECT_ID, chef_id: CHEF_ID });
      expect(res.ok).toBe(true);

      const proj = mockSupabase.db.projects.find((p) => p.id === PROJECT_ID);
      expect(proj.assigned_chef_projet).toBe(CHEF_ID);
    });

    it('returns unchanged if chef is already assigned to same id', async () => {
      mockSupabase.db.projects[0].assigned_chef_projet = CHEF_ID;
      const { updateProjectChefAction } = await import('@/app/(team)/projects/actions');
      const res = await updateProjectChefAction({ project_id: PROJECT_ID, chef_id: CHEF_ID });
      expect(res.ok).toBe(true);
      expect((res as any).unchanged).toBe(true);
    });
  });

  describe('advancePhaseAction', () => {
    it('validates phase name and rejects invalid phase', async () => {
      const { advancePhaseAction } = await import('@/app/(team)/projects/actions');
      const res = await advancePhaseAction({ project_id: PROJECT_ID, new_phase: 'invalid_phase' });
      expect(res.ok).toBe(false);
    });

    it('executes advance_project_phase RPC and triggers notifications', async () => {
      const { advancePhaseAction } = await import('@/app/(team)/projects/actions');
      const res = await advancePhaseAction({ project_id: PROJECT_ID, new_phase: 'design' });
      expect(res.ok).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('advance_project_phase', {
        p_project_id: PROJECT_ID,
        p_new_phase: 'design',
      });
    });

    it('rejects unauthorized roles from advancing phase', async () => {
      setMockUser('client');
      const { advancePhaseAction } = await import('@/app/(team)/projects/actions');
      await expect(
        advancePhaseAction({ project_id: PROJECT_ID, new_phase: 'design' })
      ).rejects.toThrow('Permission refusée');
    });
  });
});
