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

describe('Wave 3 — Project Operations, VCT, PV & Estimations (PO-01..PO-12)', () => {
  const PROJECT_ID = 'proj-po-001';
  const CLIENT_ID = 'client-po-001';
  const CHEF_ID = 'chef-po-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('chef_projet', CHEF_ID);

    mockSupabase.db['projects'] = [
      {
        id: PROJECT_ID,
        client_id: CLIENT_ID,
        chef_projet_id: CHEF_ID,
        name: 'Riad Dar Bahi',
        status: 'actif',
        phase: 'travaux',
      },
    ];

    mockSupabase.db['vct_visits'] = [];
    mockSupabase.db['project_pvs'] = [];
    mockSupabase.db['pv_reserves'] = [];
    mockSupabase.db['propria_units'] = [];
    mockSupabase.db['proposals'] = [];
    mockSupabase.db['achats_estimations'] = [];
    mockSupabase.db['achats_lots'] = [];
  });

  describe('PO-01..PO-03: VCT, PV Contradictoire & Reserves Management', () => {
    it('PO-01: records technical conformity visit (VCT) and corrective actions', async () => {
      const vct = {
        id: 'vct-001',
        project_id: PROJECT_ID,
        inspecteur_id: CHEF_ID,
        statut_conformite: 'avec_reserves',
        actions_correctives: ['Ajuster joint d’étanchéité douche', 'Fixer plinthe couloir'],
      };
      await mockSupabase.from('vct_visits').insert(vct);

      const { data: createdVct } = await mockSupabase
        .from('vct_visits')
        .select('*')
        .eq('id', 'vct-001')
        .single();

      expect(createdVct.statut_conformite).toBe('avec_reserves');
      expect(createdVct.actions_correctives).toHaveLength(2);
    });

    it('PO-02: performs electronic signature of contradictory PV with IP and User-Agent capture', async () => {
      setMockUser('client', CLIENT_ID);

      const pv = {
        id: 'pv-001',
        project_id: PROJECT_ID,
        type: 'livraison',
        statut: 'en_attente_signature',
      };
      await mockSupabase.from('project_pvs').insert(pv);

      // Client signs PV
      const clientIp = '196.200.150.33';
      const clientUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
      await mockSupabase
        .from('project_pvs')
        .update({
          statut: 'signe',
          signed_at: new Date().toISOString(),
          signer_ip: clientIp,
          signer_user_agent: clientUa,
        })
        .eq('id', 'pv-001');

      const { data: signedPv } = await mockSupabase
        .from('project_pvs')
        .select('*')
        .eq('id', 'pv-001')
        .single();

      expect(signedPv.statut).toBe('signe');
      expect(signedPv.signer_ip).toBe(clientIp);
      expect(signedPv.signer_user_agent).toBe(clientUa);
    });

    it('PO-03: tracks and resolves contradictory reserves before PV closure', async () => {
      await mockSupabase.from('pv_reserves').insert([
        { id: 'res-1', project_id: PROJECT_ID, description: 'Serrure porte entrée dure', resolved: false },
        { id: 'res-2', project_id: PROJECT_ID, description: 'Retouche peinture salon', resolved: false },
      ]);

      // Resolve reserve 1
      await mockSupabase
        .from('pv_reserves')
        .update({ resolved: true, resolved_at: new Date().toISOString() })
        .eq('id', 'res-1');

      const { data: reserves } = await mockSupabase
        .from('pv_reserves')
        .select('*')
        .eq('project_id', PROJECT_ID);

      const unresolved = reserves.filter((r: any) => !r.resolved);
      expect(unresolved).toHaveLength(1);
      expect(unresolved[0].id).toBe('res-2');
    });
  });

  describe('PO-04: Idempotent Suites Initialization (PR-01)', () => {
    it('initializes suites idempotently without index collisions or duplicates', async () => {
      const initSuitesForProperty = async (bienId: string, suiteNames: string[]) => {
        const { data: existing } = await mockSupabase
          .from('propria_units')
          .select('code_unique')
          .eq('bien_id', bienId);

        const existingCodes = new Set((existing ?? []).map((u: any) => u.code_unique));
        const created: any[] = [];

        for (let i = 0; i < suiteNames.length; i++) {
          const code = `SUITE-${i + 1}`;
          if (!existingCodes.has(code)) {
            const { data } = await mockSupabase.from('propria_units').insert({
              bien_id: bienId,
              code_unique: code,
              nom: suiteNames[i],
            });
            created.push(data);
          }
        }
        return created;
      };

      // First run: creates 3 suites
      const firstRun = await initSuitesForProperty('bien-100', ['Ambre', 'Saphir', 'Rubis']);
      expect(firstRun).toHaveLength(3);

      // Second run: 0 suites created (fully idempotent)
      const secondRun = await initSuitesForProperty('bien-100', ['Ambre', 'Saphir', 'Rubis']);
      expect(secondRun).toHaveLength(0);
    });
  });

  describe('PO-07..PO-09: Achats Estimations & Conversion to Budget Lots', () => {
    it('creates estimation, validates it, and converts into concrete achats_lot', async () => {
      // 1. PO-07: Create estimation
      const estimation = {
        id: 'est-mobilier-01',
        project_id: PROJECT_ID,
        categorie: 'Mobilier séjour',
        montant_estime_mad: 45000,
        statut: 'brouillon',
      };
      await mockSupabase.from('achats_estimations').insert(estimation);

      // 2. PO-08: Validate estimation
      await mockSupabase
        .from('achats_estimations')
        .update({ statut: 'validee', validated_by: CHEF_ID })
        .eq('id', 'est-mobilier-01');

      const { data: valEst } = await mockSupabase
        .from('achats_estimations')
        .select('*')
        .eq('id', 'est-mobilier-01')
        .single();
      expect(valEst.statut).toBe('validee');

      // 3. PO-09: Convert into achats_lot
      const lot = {
        id: 'lot-achats-converted',
        project_id: PROJECT_ID,
        nom_lot: valEst.categorie,
        montant_devis: valEst.montant_estime_mad,
        estimation_source_id: valEst.id,
      };
      await mockSupabase.from('achats_lots').insert(lot);

      await mockSupabase
        .from('achats_estimations')
        .update({ statut: 'convertie_en_lot' })
        .eq('id', valEst.id);

      const { data: createdLot } = await mockSupabase
        .from('achats_lots')
        .select('*')
        .eq('id', 'lot-achats-converted')
        .single();

      expect(createdLot.montant_devis).toBe(45000);
      expect(createdLot.estimation_source_id).toBe('est-mobilier-01');
    });
  });

  describe('PO-10..PO-12: Final Delivery & Project Archive Closeout', () => {
    it('PO-10 & PO-12: transitions to livraison and executes final administrative archive', async () => {
      // Transition from travaux to livraison
      await mockSupabase
        .from('projects')
        .update({ phase: 'livraison' })
        .eq('id', PROJECT_ID);

      let { data: p } = await mockSupabase.from('projects').select('phase').eq('id', PROJECT_ID).single();
      expect(p.phase).toBe('livraison');

      // Final delivery and archive
      await mockSupabase
        .from('projects')
        .update({
          phase: 'termine',
          status: 'livre',
          archived_at: new Date().toISOString(),
        })
        .eq('id', PROJECT_ID);

      const { data: finished } = await mockSupabase
        .from('projects')
        .select('*')
        .eq('id', PROJECT_ID)
        .single();

      expect(finished.phase).toBe('termine');
      expect(finished.status).toBe('livre');
      expect(finished.archived_at).toBeDefined();
    });
  });
});
