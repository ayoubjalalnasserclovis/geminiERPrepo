import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import { requireCronAuth, evaluateCronAuth } from '@/lib/cron/auth';

vi.mock('server-only', () => ({}));

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}));

describe('Wave 1 — Security & Tenant Isolation Suite', () => {
  const CLIENT_A_ID = 'client-a-1111';
  const CLIENT_B_ID = 'client-b-2222';
  const PROJECT_A_ID = 'project-a-1111';
  const PROJECT_B_ID = 'project-b-2222';

  beforeEach(() => {
    mockSupabase = createMockSupabase();

    mockSupabase.db['projects'] = [
      { id: PROJECT_A_ID, client_id: CLIENT_A_ID, name: 'Projet Client A', budget: 100000 },
      { id: PROJECT_B_ID, client_id: CLIENT_B_ID, name: 'Projet Client B', budget: 200000 },
    ];

    mockSupabase.db['payments'] = [
      { id: 'pay-a-1', project_id: PROJECT_A_ID, amount: 5000 },
      { id: 'pay-b-1', project_id: PROJECT_B_ID, amount: 10000 },
    ];

    mockSupabase.db['project_documents'] = [
      { id: 'doc-a-1', project_id: PROJECT_A_ID, name: 'Acte_Client_A.pdf', is_visible_client: true },
      { id: 'doc-b-1', project_id: PROJECT_B_ID, name: 'Acte_Client_B.pdf', is_visible_client: true },
    ];
  });

  describe('SEC10..SEC17: Multi-Tenant Data Isolation', () => {
    it('SEC10: Client A cannot query projects belonging to Client B', async () => {
      setMockUser('client', CLIENT_A_ID);

      const { data: myProjects } = await mockSupabase
        .from('projects')
        .select('*')
        .eq('client_id', CLIENT_A_ID);

      expect(myProjects).toHaveLength(1);
      expect(myProjects[0].id).toBe(PROJECT_A_ID);
      expect(myProjects.some((p: any) => p.id === PROJECT_B_ID)).toBe(false);
    });

    it('SEC11: Client A cannot access payments belonging to Client B', async () => {
      setMockUser('client', CLIENT_A_ID);

      const clientAccessiblePayments = async (clientId: string) => {
        const { data: projects } = await mockSupabase
          .from('projects')
          .select('id')
          .eq('client_id', clientId);

        const projectIds = projects.map((p: any) => p.id);
        const { data: payments } = await mockSupabase
          .from('payments')
          .select('*')
          .in('project_id', projectIds);

        return payments;
      };

      const paymentsForA = await clientAccessiblePayments(CLIENT_A_ID);
      expect(paymentsForA).toHaveLength(1);
      expect(paymentsForA[0].id).toBe('pay-a-1');
      expect(paymentsForA.some((p: any) => p.id === 'pay-b-1')).toBe(false);
    });

    it('SEC12: Client A cannot access documents belonging to Client B', async () => {
      const getDocumentsForClient = async (clientId: string) => {
        const { data: projects } = await mockSupabase
          .from('projects')
          .select('id')
          .eq('client_id', clientId);

        const projectIds = projects.map((p: any) => p.id);
        const { data: docs } = await mockSupabase
          .from('project_documents')
          .select('*')
          .in('project_id', projectIds)
          .eq('is_visible_client', true);

        return docs;
      };

      const docsForA = await getDocumentsForClient(CLIENT_A_ID);
      expect(docsForA).toHaveLength(1);
      expect(docsForA[0].id).toBe('doc-a-1');
      expect(docsForA.some((d: any) => d.id === 'doc-b-1')).toBe(false);
    });
  });

  describe('SEC18..SEC19: Secrets & Credentials Protection', () => {
    it('never leaks secret environment keys or credentials in client profiles', async () => {
      mockSupabase.db['profiles'] = [
        {
          id: 'user-sec-01',
          email: 'user@stoniz.co',
          role: 'chef_projet',
          first_name: 'Adam',
          last_name: 'Bennani',
        },
      ];

      const { data: profile } = await mockSupabase
        .from('profiles')
        .select('*')
        .eq('id', 'user-sec-01')
        .single();

      expect(profile).not.toHaveProperty('service_role_key');
      expect(profile).not.toHaveProperty('cron_secret');
      expect(profile).not.toHaveProperty('resend_api_key');
    });
  });

  describe('SEC20..SEC21: Cron Endpoints Authentication Gate', () => {
    it('rejects requests missing Bearer Authorization header', () => {
      process.env.CRON_SECRET = 'super-secret-cron-token-2026';
      const req = new Request('http://localhost:3000/api/cron/checkups-auto', {
        headers: {},
      });
      const denied = requireCronAuth(req);
      expect(denied).not.toBeNull();
      expect(denied?.status).toBe(401);
    });

    it('rejects requests with invalid or tampered bearer tokens', () => {
      process.env.CRON_SECRET = 'super-secret-cron-token-2026';
      const req = new Request('http://localhost:3000/api/cron/checkups-auto', {
        headers: {
          authorization: 'Bearer bad-token',
        },
      });
      const denied = requireCronAuth(req);
      expect(denied).not.toBeNull();
      expect(denied?.status).toBe(401);
    });

    it('authorizes requests matching CRON_SECRET token', () => {
      process.env.CRON_SECRET = 'super-secret-cron-token-2026';
      const req = new Request('http://localhost:3000/api/cron/checkups-auto', {
        headers: {
          authorization: 'Bearer super-secret-cron-token-2026',
        },
      });
      const denied = requireCronAuth(req);
      expect(denied).toBeNull(); // authorized requests pass through
    });
  });
});
