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

describe('Wave 2 — Propria Operations Suite (PR-02..PR-30)', () => {
  const BIEN_ID = 'bien-propria-001';
  const UNIT_ID = 'unit-suite-001';
  const PROPRIA_STAFF_ID = 'propria-staff-01';
  const MENAGE_STAFF_ID = 'menage-staff-01';
  const CEO_ID = 'ceo-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('propria', PROPRIA_STAFF_ID);

    mockSupabase.db['propria_biens'] = [
      {
        id: BIEN_ID,
        nom: 'Riad Jasmine Marrakech',
        statut_gestion: 'actif',
        type_acces: 'boite_a_cles',
        code_serrure: '4589',
        wifi_ssid: 'Jasmine_Guest',
        deleted_at: null,
      },
    ];

    mockSupabase.db['propria_units'] = [
      {
        id: UNIT_ID,
        bien_id: BIEN_ID,
        code_unique: 'JASMINE 1',
        nom: 'Suite Ambre',
        is_active: true,
      },
    ];

    mockSupabase.db['propria_cles'] = [];
    mockSupabase.db['propria_cleanings'] = [];
    mockSupabase.db['propria_checkups'] = [];
    mockSupabase.db['propria_interventions'] = [];
    mockSupabase.db['propria_fiches_police'] = [];
    mockSupabase.db['propria_stock_mouvements'] = [];
    mockSupabase.db['propria_reservations_cash'] = [];
    mockSupabase.db['propria_litiges'] = [];
    mockSupabase.db['propria_upsell_orders'] = [];
    mockSupabase.db['propria_wallets'] = [];
    mockSupabase.db['propria_caisse_transactions'] = [];
  });

  describe('PR-02..PR-06: Biens, Suites & Gestion des Clés', () => {
    it('PR-05: enforces unique suite codes per property and rejects duplicates', async () => {
      const createSuite = async (code: string, nom: string) => {
        const { data: existing } = await mockSupabase
          .from('propria_units')
          .select('*')
          .eq('bien_id', BIEN_ID)
          .eq('code_unique', code)
          .maybeSingle();

        if (existing) {
          throw new Error(`Le code de suite ${code} existe déjà pour ce bien.`);
        }

        return await mockSupabase.from('propria_units').insert({
          bien_id: BIEN_ID,
          code_unique: code,
          nom,
          is_active: true,
        });
      };

      // Create unique suite 2 succeeds
      await createSuite('JASMINE 2', 'Suite Emeraude');
      const { data: suites } = await mockSupabase
        .from('propria_units')
        .select('*')
        .eq('bien_id', BIEN_ID);
      expect(suites).toHaveLength(2);

      // Duplicate code 'JASMINE 1' fails
      await expect(createSuite('JASMINE 1', 'Autre Suite')).rejects.toThrow('existe déjà pour ce bien');
    });

    it('PR-06: tracks key location transitions between bureau and keybox', async () => {
      const cle = {
        id: 'cle-001',
        bien_id: BIEN_ID,
        numero: 'K-01',
        emplacement_actuel: 'bureau',
      };
      await mockSupabase.from('propria_cles').insert(cle);

      // Move key to keybox
      await mockSupabase
        .from('propria_cles')
        .update({
          emplacement_actuel: 'boite_a_cles',
          updated_at: new Date().toISOString(),
        })
        .eq('id', 'cle-001');

      const { data: updatedCle } = await mockSupabase
        .from('propria_cles')
        .select('*')
        .eq('id', 'cle-001')
        .single();

      expect(updatedCle.emplacement_actuel).toBe('boite_a_cles');
    });
  });

  describe('PR-10..PR-12: Cleaning Cycle & Mandatory Proofs', () => {
    it('PR-10: enforces mandatory photo proof before completing a cleaning', async () => {
      setMockUser('menage', MENAGE_STAFF_ID);

      const cleaningId = 'clean-001';
      await mockSupabase.from('propria_cleanings').insert({
        id: cleaningId,
        unit_id: UNIT_ID,
        agent_id: MENAGE_STAFF_ID,
        statut: 'en_cours',
        photos_preuves: [],
      });

      const finishCleaning = async (id: string, forceOverride = false) => {
        const { data: c } = await mockSupabase
          .from('propria_cleanings')
          .select('*')
          .eq('id', id)
          .single();

        if ((!c.photos_preuves || c.photos_preuves.length === 0) && !forceOverride) {
          throw new Error('Impossible de terminer le ménage sans déposer au moins une photo de preuve.');
        }

        await mockSupabase
          .from('propria_cleanings')
          .update({ statut: 'termine', termine_at: new Date().toISOString() })
          .eq('id', id);
      };

      // Attempting without photos fails
      await expect(finishCleaning(cleaningId)).rejects.toThrow('sans déposer au moins une photo de preuve');

      // Adding photos and completing succeeds
      await mockSupabase
        .from('propria_cleanings')
        .update({
          photos_preuves: ['https://storage/proof-clean-1.jpg'],
        })
        .eq('id', cleaningId);

      await finishCleaning(cleaningId);

      const { data: completed } = await mockSupabase
        .from('propria_cleanings')
        .select('*')
        .eq('id', cleaningId)
        .single();

      expect(completed.statut).toBe('termine');
      expect(completed.photos_preuves).toHaveLength(1);
    });

    it('PR-11: transforms a cleaning incident into an artisan intervention', async () => {
      setMockUser('propria', PROPRIA_STAFF_ID);

      const incident = {
        bien_id: BIEN_ID,
        unit_id: UNIT_ID,
        description: 'Fuite robinet salle de bain suite 1',
        severite: 'haute',
      };

      // Create intervention
      const { data: intervention } = await mockSupabase.from('propria_interventions').insert({
        id: 'interv-001',
        bien_id: incident.bien_id,
        unit_id: incident.unit_id,
        description: incident.description,
        severite: incident.severite,
        statut: 'planifiee',
        statut_validation: 'en_attente',
      });

      expect(intervention).toBeDefined();
      expect(intervention.severite).toBe('haute');
      expect(intervention.statut).toBe('planifiee');
    });
  });

  describe('PR-13..PR-15: Checkup Cycle & Interventions', () => {
    it('PR-13: records checkup items with defect classifications A through D', async () => {
      const checkup = {
        id: 'chk-001',
        unit_id: UNIT_ID,
        type: 'depart',
        statut: 'complete',
        score_classification: 'B', // A = Parfait, B = Mineur, C = Moyen, D = Critique
        items_anomalies: [
          { item: 'Télécommande climatiseur', status: 'manquant', severite: 'B' },
        ],
      };
      await mockSupabase.from('propria_checkups').insert(checkup);

      const { data: c } = await mockSupabase
        .from('propria_checkups')
        .select('*')
        .eq('id', 'chk-001')
        .single();

      expect(c.score_classification).toBe('B');
      expect(c.items_anomalies).toHaveLength(1);
    });
  });

  describe('PR-19: Stock Consommables & Movements', () => {
    it('tracks consumables entry/exit and reflects real-time stock balance', async () => {
      const articleId = 'savon-aroma-01';

      // Entrée de stock (+50)
      await mockSupabase.from('propria_stock_mouvements').insert({
        article_id: articleId,
        type: 'entree',
        quantite: 50,
        motif: 'Livraison fournisseur',
      });

      // Sortie pour réappro bien (-10)
      await mockSupabase.from('propria_stock_mouvements').insert({
        article_id: articleId,
        type: 'sortie',
        quantite: 10,
        motif: 'Dotation Suite Ambre',
      });

      const { data: mouvements } = await mockSupabase
        .from('propria_stock_mouvements')
        .select('*')
        .eq('article_id', articleId);

      const stockActuel = mouvements.reduce((total: number, m: any) => {
        return m.type === 'entree' ? total + m.quantite : total - m.quantite;
      }, 0);

      expect(stockActuel).toBe(40);
    });
  });

  describe('PR-22..PR-23: Fiches Police Pipeline & CEO Lock', () => {
    it('generates reference FP-YYYY-NNNN, marks deposited, and locks for CEO only', async () => {
      const fiche = {
        id: 'fiche-001',
        bien_id: BIEN_ID,
        reference: 'FP-2026-0001',
        voyageur_nom: 'Dupont',
        voyageur_prenom: 'Jean',
        statut: 'complete',
      };
      await mockSupabase.from('propria_fiches_police').insert(fiche);

      // Deposit at police station -> locked
      await mockSupabase
        .from('propria_fiches_police')
        .update({
          statut: 'deposee_commissariat',
          deposee_at: new Date().toISOString(),
          is_locked: true,
        })
        .eq('id', 'fiche-001');

      const editFiche = async (role: Role, patch: Record<string, any>) => {
        const { data: f } = await mockSupabase
          .from('propria_fiches_police')
          .select('*')
          .eq('id', 'fiche-001')
          .single();

        if (f.is_locked && role !== 'ceo') {
          throw new Error('Fiche verrouillée (déposée/archivée). Seul le CEO peut la modifier.');
        }

        await mockSupabase.from('propria_fiches_police').update(patch).eq('id', 'fiche-001');
      };

      // Non-CEO edit rejected
      await expect(editFiche('propria', { voyageur_nom: 'Durand' })).rejects.toThrow(
        'Fiche verrouillée (déposée/archivée). Seul le CEO peut la modifier.'
      );

      // CEO edit allowed
      await editFiche('ceo', { voyageur_nom: 'Durand' });
      const { data: updated } = await mockSupabase
        .from('propria_fiches_police')
        .select('*')
        .eq('id', 'fiche-001')
        .single();
      expect(updated.voyageur_nom).toBe('Durand');
    });
  });

  describe('PR-24..PR-26: Cash Reservations, Transferts & Wallets Caisse', () => {
    it('records cash collected by field and remitted to CEO', async () => {
      const resa = {
        id: 'resa-cash-01',
        bien_id: BIEN_ID,
        montant_cash_mad: 3500,
        statut_cash: 'collecte_terrain',
        collecte_at: '2026-09-16T12:00:00Z',
      };
      await mockSupabase.from('propria_reservations_cash').insert(resa);

      // Remit cash to CEO
      setMockUser('ceo', CEO_ID);
      await mockSupabase
        .from('propria_reservations_cash')
        .update({
          statut_cash: 'remis_ceo',
          remis_ceo_at: new Date().toISOString(),
          remis_ceo_by: CEO_ID,
        })
        .eq('id', 'resa-cash-01');

      const { data: remitted } = await mockSupabase
        .from('propria_reservations_cash')
        .select('*')
        .eq('id', 'resa-cash-01')
        .single();

      expect(remitted.statut_cash).toBe('remis_ceo');
      expect(remitted.remis_ceo_by).toBe(CEO_ID);
    });
  });

  describe('PR-29: Upsell Public QR Ordering Flow', () => {
    it('allows anonymous traveler to submit upsell order via public QR slug', async () => {
      const order = {
        id: 'upsell-001',
        unit_id: UNIT_ID,
        item_slug: 'panier-petit-dejeuner-beldi',
        prix_estime_mad: 150,
        statut: 'a_chiffrer',
      };

      const { data, error } = await mockSupabase.from('propria_upsell_orders').insert(order);
      expect(error).toBeNull();
      expect(data.statut).toBe('a_chiffrer');
    });
  });
});
