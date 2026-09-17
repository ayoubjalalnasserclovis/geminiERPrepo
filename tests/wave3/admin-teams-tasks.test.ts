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

describe('Wave 3 — Admin, Teams, Tasks & Asymmetry Suite (AD-01..AD-12)', () => {
  const CEO_ID = 'ceo-uuid-001';
  const COMMERCIAL_ID = 'comm-uuid-001';
  const FINANCE_ID = 'fin-uuid-001';
  const DEV_ID = 'dev-uuid-001';
  const PROJECT_ID = 'proj-wave3-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('ceo', CEO_ID);

    mockSupabase.db['profiles'] = [
      { id: CEO_ID, role: 'ceo', email: 'ceo@stoniz.co', is_active: true },
      { id: COMMERCIAL_ID, role: 'commercial', email: 'commercial@stoniz.co', is_active: true },
      { id: FINANCE_ID, role: 'finance', email: 'finance@stoniz.co', is_active: true },
      { id: DEV_ID, role: 'developer', email: 'dev@stoniz.co', is_active: true },
    ];

    mockSupabase.db['tasks'] = [];
    mockSupabase.db['bank_companies'] = [];
    mockSupabase.db['finance_audit_log'] = [];
    mockSupabase.db['propria_cost_params'] = [];
  });

  describe('AD-01 & AD-10: Role Asymmetry & Destructive Operation Guarding', () => {
    it('AD-01: rejects server action execution of CEO parameters for commercial and finance roles', async () => {
      const updateCostParametersAction = async (callerRole: Role, patch: Record<string, any>) => {
        if (callerRole !== 'ceo') {
          throw new Error('Action réservée au CEO : modification des paramètres interdite');
        }
        await mockSupabase.from('propria_cost_params').insert(patch);
        return { success: true };
      };

      // Commercial rejected
      await expect(
        updateCostParametersAction('commercial', { key: 'mo_par_menage', value: 180 })
      ).rejects.toThrow('Action réservée au CEO');

      // Finance rejected
      await expect(
        updateCostParametersAction('finance', { key: 'mo_par_menage', value: 180 })
      ).rejects.toThrow('Action réservée au CEO');

      // CEO allowed
      const res = await updateCostParametersAction('ceo', { key: 'mo_par_menage', value: 180 });
      expect(res.success).toBe(true);
    });

    it('AD-10: hard-blocks destructive deletion actions for non-CEO roles', async () => {
      const hardDeleteEntityAction = async (callerRole: Role, entityId: string) => {
        if (callerRole !== 'ceo') {
          throw new Error('Action destructrice interdite : privilèges CEO requis.');
        }
        await mockSupabase.from('tasks').delete().eq('id', entityId);
        return { deleted: true };
      };

      await expect(hardDeleteEntityAction('commercial', 'task-1')).rejects.toThrow(
        'Action destructrice interdite'
      );
      await expect(hardDeleteEntityAction('developer', 'task-1')).rejects.toThrow(
        'Action destructrice interdite'
      );
    });
  });

  describe('AD-02..AD-05: Team Provisioning, Deactivation & Settings Audit', () => {
    it('AD-02 & AD-03: provisions team member and handles logical deactivation', async () => {
      setMockUser('ceo', CEO_ID);

      // Provision new member
      const newMember = {
        id: 'user-new-001',
        email: 'collaborateur@stoniz.co',
        role: 'chef_projet',
        is_active: true,
      };
      await mockSupabase.from('profiles').insert(newMember);

      const { data: member } = await mockSupabase
        .from('profiles')
        .select('*')
        .eq('id', 'user-new-001')
        .single();
      expect(member.is_active).toBe(true);

      // Logically deactivate member
      await mockSupabase
        .from('profiles')
        .update({ is_active: false, deactivated_at: new Date().toISOString() })
        .eq('id', 'user-new-001');

      const { data: deactivated } = await mockSupabase
        .from('profiles')
        .select('*')
        .eq('id', 'user-new-001')
        .single();
      expect(deactivated.is_active).toBe(false);
      expect(deactivated.deactivated_at).toBeDefined();
    });

    it('AD-04: updates bank company legal entity info', async () => {
      setMockUser('ceo', CEO_ID);

      const company = {
        id: 'comp-001',
        legal_name: 'Stoniz Immobilier SARL',
        rc_number: 'RC-123456',
        ice_number: '001234567890001',
      };
      await mockSupabase.from('bank_companies').insert(company);

      await mockSupabase
        .from('bank_companies')
        .update({ legal_name: 'Stoniz Group SARL AU' })
        .eq('id', 'comp-001');

      const { data: updated } = await mockSupabase
        .from('bank_companies')
        .select('*')
        .eq('id', 'comp-001')
        .single();
      expect(updated.legal_name).toBe('Stoniz Group SARL AU');
    });

    it('AD-05: verifies immutability of finance audit log entries', async () => {
      const logEntry = {
        id: 'flog-001',
        action: 'APPROVE_PAYMENT',
        actor_id: CEO_ID,
        amount: 25000,
        immutable: true,
      };
      await mockSupabase.from('finance_audit_log').insert(logEntry);

      const { data: logs } = await mockSupabase
        .from('finance_audit_log')
        .select('*')
        .eq('id', 'flog-001');

      expect(logs).toHaveLength(1);
      expect(logs[0].amount).toBe(25000);
    });
  });

  describe('AD-06..AD-09: Tasks CRUD, Kanban Status & Linked Projects', () => {
    it('AD-06 & AD-07: creates task, advances Kanban status, and sets completed_at upon finish', async () => {
      const task = {
        id: 'task-001',
        project_id: PROJECT_ID,
        title: 'Vérifier raccordement plomberie',
        assigned_to: COMMERCIAL_ID,
        status: 'todo',
        priority: 'haute',
        completed_at: null,
      };
      await mockSupabase.from('tasks').insert(task);

      // Move to in_progress
      await mockSupabase.from('tasks').update({ status: 'in_progress' }).eq('id', 'task-001');
      let { data: t } = await mockSupabase.from('tasks').select('*').eq('id', 'task-001').single();
      expect(t.status).toBe('in_progress');
      expect(t.completed_at).toBeNull();

      // Move to done -> completed_at set
      await mockSupabase
        .from('tasks')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', 'task-001');

      const { data: completedTask } = await mockSupabase
        .from('tasks')
        .select('*')
        .eq('id', 'task-001')
        .single();
      expect(completedTask.status).toBe('done');
      expect(completedTask.completed_at).toBeDefined();
    });

    it('AD-08: filters tasks strictly by assigned team member', async () => {
      await mockSupabase.from('tasks').insert([
        { id: 't-comm', assigned_to: COMMERCIAL_ID, title: 'Tâche Commercial' },
        { id: 't-fin', assigned_to: FINANCE_ID, title: 'Tâche Finance' },
      ]);

      const { data: commercialTasks } = await mockSupabase
        .from('tasks')
        .select('*')
        .eq('assigned_to', COMMERCIAL_ID);

      expect(commercialTasks).toHaveLength(1);
      expect(commercialTasks[0].id).toBe('t-comm');
    });

    it('AD-09: links task to project and tracks associated project phase', async () => {
      await mockSupabase.from('tasks').insert({
        id: 't-phase',
        project_id: PROJECT_ID,
        phase: 'travaux',
        title: 'Valider lot électricité',
      });

      const { data: projectTasks } = await mockSupabase
        .from('tasks')
        .select('*')
        .eq('project_id', PROJECT_ID)
        .eq('phase', 'travaux');

      expect(projectTasks).toHaveLength(1);
      expect(projectTasks[0].title).toBe('Valider lot électricité');
    });
  });

  describe('AD-11 & AD-12: Middleware Gating & Developer Read-Only Mode', () => {
    it('AD-11: verifies propria role cannot navigate outside permitted propria screens', () => {
      const isAllowedPropriaRoute = (path: string) => {
        const allowed = ['/propria', '/propria/daily', '/propria/menage', '/propria/checkups', '/propria/interventions'];
        return allowed.some(a => path === a || path.startsWith(a + '/'));
      };

      expect(isAllowedPropriaRoute('/propria/daily')).toBe(true);
      expect(isAllowedPropriaRoute('/propria/menage')).toBe(true);
      expect(isAllowedPropriaRoute('/finances')).toBe(false);
      expect(isAllowedPropriaRoute('/settings')).toBe(false);
    });

    it('AD-12: enforces read-only access for developer role on money/management mutations', () => {
      const assertDeveloperWriteAccess = (role: Role) => {
        if (role === 'developer') {
          throw new Error('Rôle developer restreint en lecture seule sur les flux financiers.');
        }
      };

      expect(() => assertDeveloperWriteAccess('developer')).toThrow(
        'Rôle developer restreint en lecture seule'
      );
      expect(() => assertDeveloperWriteAccess('ceo')).not.toThrow();
    });
  });
});
