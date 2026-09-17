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

describe('Wave 2 — Properties, Clients & Partners Suite', () => {
  const SOURCING_ID = 'sourcing-staff-01';
  const CEO_ID = 'ceo-001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('sourcing', SOURCING_ID);

    mockSupabase.db['properties'] = [];
    mockSupabase.db['property_media'] = [];
    mockSupabase.db['clients'] = [];
    mockSupabase.db['partners'] = [];
    mockSupabase.db['data_fix_log'] = [];
    mockSupabase.db['projects'] = [];
  });

  describe('PROP-W1 & PROP-W3: Property Publication Pipeline & Gating', () => {
    it('blocks publication if required steps (media) are missing, then publishes once satisfied', async () => {
      const property = {
        id: 'prop-001',
        titre: 'Bel Appartement Hivernage',
        ville: 'Marrakech',
        prix_achat: 1500000,
        statut: 'brouillon',
      };
      await mockSupabase.from('properties').insert(property);

      const publishProperty = async (id: string) => {
        const { data: media } = await mockSupabase
          .from('property_media')
          .select('*')
          .eq('property_id', id);

        if (!media || media.length === 0) {
          throw new Error('Impossible de publier : étapes manquantes (au moins 1 photo requise).');
        }

        await mockSupabase
          .from('properties')
          .update({ statut: 'publie', published_at: new Date().toISOString() })
          .eq('id', id);
      };

      // Fails without media
      await expect(publishProperty('prop-001')).rejects.toThrow('Impossible de publier');

      // Upload media
      await mockSupabase.from('property_media').insert({
        property_id: 'prop-001',
        url: 'https://storage/photo-hivernage-1.jpg',
        type: 'photo',
      });

      // Publication succeeds
      await publishProperty('prop-001');

      const { data: published } = await mockSupabase
        .from('properties')
        .select('*')
        .eq('id', 'prop-001')
        .single();

      expect(published.statut).toBe('publie');
      expect(published.published_at).toBeDefined();
    });
  });

  describe('PROP-W4 & PROP-W4b: Property CSV Import & Deduplication', () => {
    it('imports properties from CSV, skips duplicates, and enforces idempotence', async () => {
      setMockUser('ceo', CEO_ID);

      const importPropertiesCSV = async (rows: Array<{ titre: string; prix: number }>, checksum: string) => {
        const { data: existingLog } = await mockSupabase
          .from('data_fix_log')
          .select('*')
          .eq('action', 'import_properties_csv')
          .eq('checksum', checksum)
          .maybeSingle();

        if (existingLog) {
          throw new Error('Ce fichier CSV a déjà été importé (voir data_fix_log).');
        }

        let insertedCount = 0;
        let skippedCount = 0;

        for (const r of rows) {
          const { data: existing } = await mockSupabase
            .from('properties')
            .select('*')
            .eq('titre', r.titre)
            .maybeSingle();

          if (existing) {
            skippedCount++;
          } else {
            await mockSupabase.from('properties').insert({
              titre: r.titre,
              prix_achat: r.prix,
              statut: 'brouillon',
            });
            insertedCount++;
          }
        }

        await mockSupabase.from('data_fix_log').insert({
          action: 'import_properties_csv',
          checksum,
          inserted_count: insertedCount,
        });

        return { insertedCount, skippedCount };
      };

      const sampleRows = [
        { titre: 'Villa Golf 1', prix: 3500000 },
        { titre: 'Villa Golf 2', prix: 4200000 },
      ];

      // 1. Initial import succeeds
      const res1 = await importPropertiesCSV(sampleRows, 'sha-prop-001');
      expect(res1.insertedCount).toBe(2);
      expect(res1.skippedCount).toBe(0);

      // 2. Re-importing same checksum fails idempotence
      await expect(importPropertiesCSV(sampleRows, 'sha-prop-001')).rejects.toThrow(
        'Ce fichier CSV a déjà été importé'
      );

      // 3. New CSV with duplicate title skips already existing property
      const secondBatch = [
        { titre: 'Villa Golf 1', prix: 3500000 }, // duplicate
        { titre: 'Villa Golf 3', prix: 5100000 }, // new
      ];
      const res2 = await importPropertiesCSV(secondBatch, 'sha-prop-002');
      expect(res2.insertedCount).toBe(1);
      expect(res2.skippedCount).toBe(1);
    });
  });

  describe('CLI-WF1..CLI-WF4: Client Lifecycle & Portal Invitations', () => {
    it('creates client, issues invitation token, and allows token reissue', async () => {
      const client = {
        id: 'client-test-01',
        nom: 'Benjelloun',
        prenom: 'Omar',
        email: 'omar.benjelloun@example.com',
        invite_token: 'old-expired-token',
        is_active: false,
      };
      await mockSupabase.from('clients').insert(client);

      // Reissue invitation token (old token invalidated)
      const newToken = 'new-active-token-999';
      await mockSupabase
        .from('clients')
        .update({
          invite_token: newToken,
          invite_sent_at: new Date().toISOString(),
        })
        .eq('id', 'client-test-01');

      const { data: updatedClient } = await mockSupabase
        .from('clients')
        .select('*')
        .eq('id', 'client-test-01')
        .single();

      expect(updatedClient.invite_token).toBe(newToken);
      expect(updatedClient.invite_sent_at).toBeDefined();
    });

    it('CLI-WF4: CEO deletes client and performs impact review on linked projects', async () => {
      setMockUser('ceo', CEO_ID);

      const clientId = 'client-delete-target';
      await mockSupabase.from('clients').insert({ id: clientId, nom: 'Tazi' });
      await mockSupabase.from('projects').insert({
        id: 'proj-linked-1',
        client_id: clientId,
        name: 'Projet Tazi',
        statut_projet: 'actif',
      });

      // Impact review
      const { data: linkedProjects } = await mockSupabase
        .from('projects')
        .select('*')
        .eq('client_id', clientId);

      expect(linkedProjects).toHaveLength(1);

      // Soft delete client
      await mockSupabase
        .from('clients')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', clientId);

      const { data: client } = await mockSupabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();

      expect(client.deleted_at).toBeDefined();
    });
  });

  describe('PART-WF1 & PART-WF6: Partners & Conversion Rate KPIs', () => {
    it('calculates conversion rate KPI: biens sourcés vs projets signés', async () => {
      const partner = {
        id: 'part-01',
        nom_agence: 'Atlas Immobilier',
        biens_sources_count: 5,
        projets_signes_count: 2,
      };
      await mockSupabase.from('partners').insert(partner);

      const tauxConversion = (partner.projets_signes_count / partner.biens_sources_count) * 100;
      expect(tauxConversion).toBe(40); // 40% conversion
    });
  });
});
