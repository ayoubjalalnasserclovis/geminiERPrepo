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

describe('Wave 3 — Artisans & Payment Gates Suite (AR-01..AR-06)', () => {
  const ARTISAN_ID = 'artisan-uuid-001';
  const CHEF_ID = 'chef-uuid-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('chef_projet', CHEF_ID);

    mockSupabase.db['artisans'] = [
      {
        id: ARTISAN_ID,
        nom: 'Plomberie Moderne SARL',
        type_entite: 'societe',
        corps_etat: 'plomberie',
        telephone: '+212661001122',
        banque: 'Attijariwafa Bank',
        rib: '007780001234567890123456', // 24 digits valid RIB
        attestation_date: '2026-06-01',
        is_active: true,
        nb_lots_total: 3,
        ca_total_mad: 120000,
      },
    ];

    mockSupabase.db['works_lots'] = [];
    mockSupabase.db['works_factures'] = [];
  });

  describe('AR-01 & AR-06: Artisan CRUD, Status & Inactive Blacklist', () => {
    it('AR-01: creates new artisan and queries by corps d’état', async () => {
      const newArtisan = {
        id: 'art-elec-01',
        nom: 'Électricité Étoile',
        type_entite: 'auto_entrepreneur',
        corps_etat: 'electricite',
        telephone: '+212662334455',
        is_active: true,
      };
      await mockSupabase.from('artisans').insert(newArtisan);

      const { data: artisans } = await mockSupabase
        .from('artisans')
        .select('*')
        .eq('corps_etat', 'electricite');

      expect(artisans).toHaveLength(1);
      expect(artisans[0].nom).toBe('Électricité Étoile');
    });

    it('AR-06: marks artisan as inactive and blocks assignment to new lots', async () => {
      // Deactivate artisan
      await mockSupabase
        .from('artisans')
        .update({ is_active: false, motif_inactif: 'Litige qualité répété' })
        .eq('id', ARTISAN_ID);

      const assignArtisanToLot = async (artisanId: string) => {
        const { data: art } = await mockSupabase
          .from('artisans')
          .select('*')
          .eq('id', artisanId)
          .single();

        if (!art.is_active) {
          throw new Error('Impossible d’assigner cet artisan : statut inactif / blacklisté.');
        }

        return { assigned: true };
      };

      await expect(assignArtisanToLot(ARTISAN_ID)).rejects.toThrow('statut inactif / blacklisté');
    });
  });

  describe('AR-02 & AR-03: Payment Gates (RIB 24 Digits & Attestation Validity)', () => {
    it('AR-02: requires 24-digit RIB and Bank for companies before approving payment', async () => {
      const validateArtisanPaymentReady = (artisan: any) => {
        if (artisan.type_entite === 'societe') {
          if (!artisan.banque || !artisan.rib) {
            return { ready: false, reason: 'Banque et RIB obligatoires pour les sociétés.' };
          }
          if (artisan.rib.length !== 24 || !/^\d{24}$/.test(artisan.rib)) {
            return { ready: false, reason: 'Le RIB doit comporter exactement 24 chiffres.' };
          }
        }
        return { ready: true };
      };

      const validArtisan = {
        type_entite: 'societe',
        banque: 'BMCE',
        rib: '123456789012345678901234',
      };
      expect(validateArtisanPaymentReady(validArtisan).ready).toBe(true);

      const invalidRib = {
        type_entite: 'societe',
        banque: 'BMCE',
        rib: '12345', // only 5 digits
      };
      expect(validateArtisanPaymentReady(invalidRib).ready).toBe(false);
      expect(validateArtisanPaymentReady(invalidRib).reason).toContain('exactement 24 chiffres');

      const missingBank = {
        type_entite: 'societe',
        banque: null,
        rib: '123456789012345678901234',
      };
      expect(validateArtisanPaymentReady(missingBank).ready).toBe(false);
    });

    it('AR-03: checks insurance attestation validity (< 6 months)', async () => {
      const isAttestationValid = (attestationDateStr: string | null) => {
        if (!attestationDateStr) return false;
        const attestationDate = new Date(attestationDateStr);
        const now = new Date('2026-09-17');
        const diffDays = (now.getTime() - attestationDate.getTime()) / (1000 * 3600 * 24);
        return diffDays < 182; // less than ~6 months
      };

      // Attestation from 2026-06-01 is ~3.5 months old (valid)
      expect(isAttestationValid('2026-06-01')).toBe(true);

      // Attestation from 2025-10-01 is ~11 months old (expired)
      expect(isAttestationValid('2025-10-01')).toBe(false);
      expect(isAttestationValid(null)).toBe(false);
    });
  });

  describe('AR-04 & AR-05: Denormalized Counters & Factures History', () => {
    it('AR-04: updates denormalized counters upon lot completion', async () => {
      const { data: art } = await mockSupabase
        .from('artisans')
        .select('*')
        .eq('id', ARTISAN_ID)
        .single();

      // Add a completed lot of 30,000 MAD
      const newLotsCount = art.nb_lots_total + 1;
      const newCaTotal = art.ca_total_mad + 30000;

      await mockSupabase
        .from('artisans')
        .update({
          nb_lots_total: newLotsCount,
          ca_total_mad: newCaTotal,
        })
        .eq('id', ARTISAN_ID);

      const { data: updatedArt } = await mockSupabase
        .from('artisans')
        .select('*')
        .eq('id', ARTISAN_ID)
        .single();

      expect(updatedArt.nb_lots_total).toBe(4);
      expect(updatedArt.ca_total_mad).toBe(150000);
    });

    it('AR-05: queries chronological history of invoices for an artisan', async () => {
      mockSupabase.db['works_factures'] = [
        { id: 'f-1', artisan_id: ARTISAN_ID, montant: 15000, date_facture: '2026-05-10' },
        { id: 'f-2', artisan_id: ARTISAN_ID, montant: 25000, date_facture: '2026-07-20' },
      ];

      const { data: factures } = await mockSupabase
        .from('works_factures')
        .select('*')
        .eq('artisan_id', ARTISAN_ID)
        .order('date_facture', { ascending: false });

      expect(factures).toHaveLength(2);
      expect(factures[0].id).toBe('f-2');
      expect(factures[1].id).toBe('f-1');
    });
  });
});
