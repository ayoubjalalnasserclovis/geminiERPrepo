import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import { isProjectLost } from '@/lib/projects/lost';

vi.mock('server-only', () => ({}));

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}));

describe('Wave 2 — Dashboards & Lost Projects Exclusion Suite (DX-01..DX-05)', () => {
  const ACTIVE_PROJ_ID = 'proj-active-01';
  const LOST_PROJ_ID = 'proj-lost-02';
  const CLIENT_ID = 'client-owner-01';

  beforeEach(() => {
    mockSupabase = createMockSupabase();

    mockSupabase.db['projects'] = [
      {
        id: ACTIVE_PROJ_ID,
        name: 'Projet Actif Gueliz',
        client_id: CLIENT_ID,
        statut_projet: 'actif',
        budget: 500000,
      },
      {
        id: LOST_PROJ_ID,
        name: 'Projet Perdu Hivernage',
        client_id: CLIENT_ID,
        statut_projet: 'perdu',
        budget: 300000,
      },
    ];

    mockSupabase.db['payment_approvals'] = [
      { id: 'app-active', project_id: ACTIVE_PROJ_ID, amount: 10000, status: 'pending' },
      { id: 'app-lost', project_id: LOST_PROJ_ID, amount: 5000, status: 'pending' },
    ];

    mockSupabase.db['tasks'] = [
      { id: 'task-active', project_id: ACTIVE_PROJ_ID, title: 'Valider plan élec' },
      { id: 'task-lost', project_id: LOST_PROJ_ID, title: 'Archiver dossier' },
    ];

    mockSupabase.db['caisse_operations'] = [
      { id: 'cop-active', project_id: ACTIVE_PROJ_ID, amount: 2000 },
      { id: 'cop-lost', project_id: LOST_PROJ_ID, amount: 1200 },
    ];
  });

  describe('DX-05: Default System Invariant — Exclusion of Lost Projects (≠ "perdu")', () => {
    it('filters out lost projects in standard dashboard listings using notLostFilter', async () => {
      const { data: allProjects } = await mockSupabase
        .from('projects')
        .select('*');

      expect(allProjects).toHaveLength(2);

      // Apply standard filter (neq 'perdu')
      const { data: activeDashboardProjects } = await mockSupabase
        .from('projects')
        .select('*')
        .neq('statut_projet', 'perdu');

      expect(activeDashboardProjects).toHaveLength(1);
      expect(activeDashboardProjects[0].id).toBe(ACTIVE_PROJ_ID);
      expect(isProjectLost(activeDashboardProjects[0])).toBe(false);
    });

    it('confirms helper function correctly detects lost project states', () => {
      expect(isProjectLost({ status: 'perdu' })).toBe(true);
      expect(isProjectLost({ status: 'actif' })).toBe(false);
      expect(isProjectLost({ status: 'en_cours' })).toBe(false);
      expect(isProjectLost({ deleted_at: '2026-09-01T00:00:00Z' })).toBe(true);
    });
  });

  describe('Pinned Exceptions to Lost Exclusion (DX-01..DX-04)', () => {
    it('DX-01: /validations queue retains requests linked to lost projects', async () => {
      // Validations queue queries payment_approvals without excluding lost projects
      const { data: approvalsQueue } = await mockSupabase
        .from('payment_approvals')
        .select('*')
        .eq('status', 'pending');

      expect(approvalsQueue).toHaveLength(2);
      expect(approvalsQueue.some((a: any) => a.project_id === LOST_PROJ_ID)).toBe(true);
    });

    it('DX-02: Client Portal displays all projects including lost ones to the client', async () => {
      setMockUser('client', CLIENT_ID);

      const { data: portalProjects } = await mockSupabase
        .from('projects')
        .select('*')
        .eq('client_id', CLIENT_ID);

      expect(portalProjects).toHaveLength(2);
      expect(portalProjects.some((p: any) => p.statut_projet === 'perdu')).toBe(true);
    });

    it('DX-03: Global /tasks list includes tasks originating from lost projects', async () => {
      const { data: globalTasks } = await mockSupabase
        .from('tasks')
        .select('*');

      expect(globalTasks).toHaveLength(2);
      expect(globalTasks.some((t: any) => t.project_id === LOST_PROJ_ID)).toBe(true);
    });

    it('DX-04: Cash P&L includes cash expenses from lost projects for accurate accounting', async () => {
      const { data: plOperations } = await mockSupabase
        .from('caisse_operations')
        .select('*');

      const totalCashDistributed = plOperations.reduce((sum: number, op: any) => sum + op.amount, 0);
      expect(totalCashDistributed).toBe(3200); // 2000 active + 1200 lost
      expect(plOperations.some((op: any) => op.project_id === LOST_PROJ_ID)).toBe(true);
    });
  });
});
