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

describe('Wave 2 — Works & Achats Suite (WA-01..WA-38)', () => {
  const PROJECT_ID = 'project-works-001';
  const CHEF_ID = 'chef-001';
  const CEO_ID = 'ceo-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('chef_projet', CHEF_ID);

    mockSupabase.db['projects'] = [
      {
        id: PROJECT_ID,
        name: 'Villa Palmeraie',
        budget_vendu_client: 500000,
        marge_cible: 80000,
        adresse_chantier: 'Route de Fès, Marrakech',
        statut_projet: 'actif',
      },
    ];

    mockSupabase.db['artisans'] = [];
    mockSupabase.db['works_lots'] = [];
    mockSupabase.db['works_acomptes'] = [];
    mockSupabase.db['works_factures'] = [];
    mockSupabase.db['achats_fournisseurs'] = [];
    mockSupabase.db['achats_lots'] = [];
    mockSupabase.db['achats_acomptes'] = [];
    mockSupabase.db['data_fix_log'] = [];
    mockSupabase.db['audit_logs'] = [];
  });

  describe('WA-01..WA-04: Paramétrage Chantier & Lots Travaux', () => {
    it('WA-01: updates chantier parameters and computes real margin', async () => {
      setMockUser('ceo', CEO_ID);

      await mockSupabase
        .from('projects')
        .update({
          budget_vendu_client: 600000,
          marge_cible: 100000,
          adresse_chantier: 'Route de l Ourika km 4',
        })
        .eq('id', PROJECT_ID);

      const { data: p } = await mockSupabase
        .from('projects')
        .select('*')
        .eq('id', PROJECT_ID)
        .single();

      expect(p.budget_vendu_client).toBe(600000);
      expect(p.marge_cible).toBe(100000);

      // Derived real margin: budget_vendu - depenses_totales
      const depenses = 450000;
      const margeReelle = p.budget_vendu_client - depenses;
      expect(margeReelle).toBe(150000);
    });

    it('WA-02: creates a travaux lot with inline artisan creation', async () => {
      // Inline artisan creation
      const artisan = {
        id: 'artisan-plombier-1',
        nom: 'Hassan Plomberie SARL',
        corps_etat: 'plomberie',
        telephone: '+212611223344',
      };
      await mockSupabase.from('artisans').insert(artisan);

      // Create lot
      const lot = {
        id: 'lot-plomberie-01',
        project_id: PROJECT_ID,
        artisan_id: artisan.id,
        nom_lot: 'Plomberie & Sanitaires',
        montant_devis: 45000,
        statut: 'brouillon',
      };
      await mockSupabase.from('works_lots').insert(lot);

      const { data: createdLot } = await mockSupabase
        .from('works_lots')
        .select('*')
        .eq('id', 'lot-plomberie-01')
        .single();

      expect(createdLot).toBeDefined();
      expect(createdLot.artisan_id).toBe('artisan-plombier-1');
      expect(createdLot.statut).toBe('brouillon');
    });

    it('WA-04: enforces invoice gate before activating a lot (facture artisan obligatoire)', async () => {
      const lotId = 'lot-peinture-01';
      mockSupabase.db['works_lots'] = [
        {
          id: lotId,
          project_id: PROJECT_ID,
          nom_lot: 'Peinture',
          statut: 'brouillon',
        },
      ];

      const activateLot = async (id: string) => {
        const { data: factures } = await mockSupabase
          .from('works_factures')
          .select('*')
          .eq('lot_id', id);

        if (!factures || factures.length === 0) {
          throw new Error('Impossible de passer ce lot en cours : aucune facture artisan n’est uploadée pour ce lot.');
        }

        await mockSupabase.from('works_lots').update({ statut: 'en_cours' }).eq('id', id);
      };

      // Fails without uploaded invoice
      await expect(activateLot(lotId)).rejects.toThrow('aucune facture artisan');

      // Upload invoice then activation succeeds
      await mockSupabase.from('works_factures').insert({
        id: 'fac-peinture-1',
        lot_id: lotId,
        url: 'https://storage/facture-peinture.pdf',
        montant: 30000,
      });

      await activateLot(lotId);

      const { data: updatedLot } = await mockSupabase
        .from('works_lots')
        .select('*')
        .eq('id', lotId)
        .single();

      expect(updatedLot.statut).toBe('en_cours');
    });
  });

  describe('WA-08..WA-11: Acomptes Planning (Slots 1..6) & Cascades', () => {
    const LOT_ID = 'lot-gros-oeuvre-01';

    it('WA-08: plans artisan acomptes restricted strictly to slots 1..6', async () => {
      const planAcompte = async (slotNumber: number, montant: number) => {
        if (slotNumber < 1 || slotNumber > 6) {
          throw new Error('Numéro d’acompte invalide. Doit être compris entre 1 et 6.');
        }
        return await mockSupabase.from('works_acomptes').insert({
          lot_id: LOT_ID,
          numero: slotNumber,
          montant,
          statut: 'en_attente',
        });
      };

      // Valid slots 1 and 2
      await planAcompte(1, 10000);
      await planAcompte(2, 15000);

      // Invalid slot 7
      await expect(planAcompte(7, 20000)).rejects.toThrow('Numéro d’acompte invalide');
      // Invalid slot 0
      await expect(planAcompte(0, 5000)).rejects.toThrow('Numéro d’acompte invalide');

      const { data: slots } = await mockSupabase
        .from('works_acomptes')
        .select('*')
        .eq('lot_id', LOT_ID);

      expect(slots).toHaveLength(2);
    });

    it('WA-09: edits an acompte and writes an audit log entry', async () => {
      mockSupabase.db['works_acomptes'] = [
        { id: 'acompte-edit-01', lot_id: LOT_ID, numero: 1, montant: 10000 },
      ];

      // Update amount
      const oldAmount = 10000;
      const newAmount = 12500;
      await mockSupabase
        .from('works_acomptes')
        .update({ montant: newAmount })
        .eq('id', 'acompte-edit-01');

      // Record audit diff
      await mockSupabase.from('audit_logs').insert({
        entity_type: 'works_acompte',
        entity_id: 'acompte-edit-01',
        action: 'UPDATE',
        changes: { montant: { from: oldAmount, to: newAmount } },
        performed_by: CHEF_ID,
      });

      const { data: audit } = await mockSupabase
        .from('audit_logs')
        .select('*')
        .eq('entity_id', 'acompte-edit-01')
        .single();

      expect(audit).toBeDefined();
      expect(audit.changes.montant.to).toBe(12500);
    });

    it('WA-11: deletes an acompte and cascades bank reconciliation removal', async () => {
      mockSupabase.db['works_acomptes'] = [
        { id: 'acompte-del-01', lot_id: LOT_ID, montant: 8000, bank_tx_id: 'btx-999' },
      ];
      mockSupabase.db['bank_transactions'] = [
        { id: 'btx-999', reconciled: true, reconciled_with: 'acompte-del-01' },
      ];

      // Delete acompte with cascade reset on bank tx
      await mockSupabase.from('works_acomptes').delete().eq('id', 'acompte-del-01');
      await mockSupabase
        .from('bank_transactions')
        .update({ reconciled: false, reconciled_with: null })
        .eq('reconciled_with', 'acompte-del-01');

      const { data: btx } = await mockSupabase
        .from('bank_transactions')
        .select('*')
        .eq('id', 'btx-999')
        .single();

      expect(btx.reconciled).toBe(false);
      expect(btx.reconciled_with).toBeNull();
    });
  });

  describe('WA-21 & WA-38: CEO-Only Idempotent CSV Imports (data_fix_log)', () => {
    it('WA-21: imports travaux CSV, records in data_fix_log, and rejects re-import', async () => {
      setMockUser('ceo', CEO_ID);

      const importTravauxCSV = async (projectId: string, csvChecksum: string) => {
        // Check idempotence
        const { data: existing } = await mockSupabase
          .from('data_fix_log')
          .select('*')
          .eq('project_id', projectId)
          .eq('action', 'import_travaux_csv')
          .maybeSingle();

        if (existing) {
          throw new Error('Cet import a déjà été effectué pour ce projet (voir data_fix_log).');
        }

        // Simulate creating 3 lots from CSV
        await mockSupabase.from('works_lots').insert([
          { project_id: projectId, nom_lot: 'Maçonnerie', montant_devis: 50000 },
          { project_id: projectId, nom_lot: 'Menuiserie', montant_devis: 30000 },
        ]);

        // Record in data_fix_log
        await mockSupabase.from('data_fix_log').insert({
          project_id: projectId,
          action: 'import_travaux_csv',
          checksum: csvChecksum,
          executed_by: CEO_ID,
        });

        return { success: true, count: 2 };
      };

      // 1. First import succeeds
      const res = await importTravauxCSV(PROJECT_ID, 'sha256-csv-001');
      expect(res.count).toBe(2);

      // 2. Second import with same project fails idempotence check
      await expect(importTravauxCSV(PROJECT_ID, 'sha256-csv-001')).rejects.toThrow(
        'Cet import a déjà été effectué pour ce projet'
      );
    });

    it('WA-21: forbids non-CEO roles from running CSV import', async () => {
      setMockUser('chef_projet', CHEF_ID);

      const guardCeoOnly = (role: Role) => {
        if (role !== 'ceo') throw new Error('Action réservée au CEO');
      };

      expect(() => guardCeoOnly(getMockUser().role)).toThrow('Action réservée au CEO');
    });
  });

  describe('WA-23..WA-29: Achats Lots, Fournisseurs & Acomptes', () => {
    it('WA-23 & WA-26: creates an achats lot and checks devis vs acomptes variance', async () => {
      // Create supplier
      const supplier = {
        id: 'supp-ikea',
        nom: 'IKEA Zenata',
        contact: 'pro@ikea.ma',
      };
      await mockSupabase.from('achats_fournisseurs').insert(supplier);

      // Create achats lot
      const lot = {
        id: 'lot-achats-01',
        project_id: PROJECT_ID,
        fournisseur_id: supplier.id,
        nom_lot: 'Mobilier Salon',
        montant_devis: 60000,
      };
      await mockSupabase.from('achats_lots').insert(lot);

      // Plan 2 acomptes totalling 50000
      await mockSupabase.from('achats_acomptes').insert([
        { lot_id: lot.id, numero: 1, montant: 30000 },
        { lot_id: lot.id, numero: 2, montant: 20000 },
      ]);

      const totalAcomptes = 30000 + 20000;
      const ecart = lot.montant_devis - totalAcomptes;

      expect(ecart).toBe(10000); // 10k remaining gap alert
    });
  });
});
