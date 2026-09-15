import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const LOT_ID = '33333333-3333-4333-8333-333333333333';
const ACHAT_LOT_ID = '44444444-4444-4444-8444-444444444444';

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

vi.mock('@/lib/finance/audit', () => ({
  logFinanceAudit: vi.fn().mockResolvedValue(true),
  computeFinanceDiff: vi.fn().mockReturnValue({}),
}));

vi.mock('@/lib/audit/deletion', () => ({
  logDeletion: vi.fn().mockResolvedValue(true),
}));

describe('Travaux and Achats Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      projects: [
        { id: PROJECT_ID, reference: 'STZ-001', travaux_budget_mad: 200000 },
      ],
      travaux_lots: [
        {
          id: LOT_ID,
          project_id: PROJECT_ID,
          numero: 1,
          category: 'Plomberie',
          artisan_name: 'Artisan Med',
          status: 'a_planifier',
          devis_artisan_mad: 15000,
        },
      ],
      achats_lots: [
        {
          id: ACHAT_LOT_ID,
          project_id: PROJECT_ID,
          numero: 1,
          category: 'Mobilier',
          supplier_name: 'Fournisseur Deco',
          status: 'a_commander',
          devis_fournisseur_mad: 25000,
        },
      ],
      documents: [],
    });
    setMockUser('chef_projet');
    vi.clearAllMocks();
  });

  describe('Travaux Lots CRUD', () => {
    it('creates a travaux lot with auto-incremented number', async () => {
      const { createLotAction } = await import('@/app/(team)/projects/[id]/travaux/actions');
      const res = await createLotAction({
        project_id: PROJECT_ID,
        category: 'Electricité',
        artisan_name: 'Artisan Elec',
        devis_artisan_mad: 20000,
      });

      expect(res.ok).toBe(true);
      const lots = mockSupabase.db.travaux_lots.filter((l) => l.project_id === PROJECT_ID);
      expect(lots.length).toBe(2);
      const newLot = lots.find((l) => l.category === 'Electricité');
      expect(newLot).toBeDefined();
      expect(newLot.numero).toBe(2);
    });

    it('updates lot details successfully', async () => {
      const { updateLotAction } = await import('@/app/(team)/projects/[id]/travaux/actions');
      const res = await updateLotAction(LOT_ID, {
        notes: 'Chantier commence lundi',
        devis_artisan_mad: 18000,
      });

      expect(res.ok).toBe(true);
      const lot = mockSupabase.db.travaux_lots.find((l) => l.id === LOT_ID);
      expect(lot.notes).toBe('Chantier commence lundi');
      expect(lot.devis_artisan_mad).toBe(18000);
    });

    it('soft deletes a travaux lot and sets deleted_at', async () => {
      const { deleteLotAction } = await import('@/app/(team)/projects/[id]/travaux/actions');
      const res = await deleteLotAction(LOT_ID);

      expect(res.ok).toBe(true);
      const lot = mockSupabase.db.travaux_lots.find((l) => l.id === LOT_ID);
      expect(lot.deleted_at).toBeDefined();
    });

    it('blocks unauthorized client from modifying lots', async () => {
      setMockUser('client');
      const { deleteLotAction } = await import('@/app/(team)/projects/[id]/travaux/actions');
      await expect(deleteLotAction(LOT_ID)).rejects.toThrow('Permission refusée');
    });
  });

  describe('Achats Lots CRUD', () => {
    it('creates an achats lot successfully', async () => {
      const { createAchatLotAction } = await import('@/app/(team)/projects/[id]/achats/actions');
      const res = await createAchatLotAction({
        project_id: PROJECT_ID,
        category: 'Luminaires',
        supplier_name: 'Fournisseur Lum',
        devis_fournisseur_mad: 12000,
      });

      expect(res.ok).toBe(true);
      const lots = mockSupabase.db.achats_lots.filter((l) => l.project_id === PROJECT_ID);
      expect(lots.length).toBe(2);
      const newLot = lots.find((l) => l.category === 'Luminaires');
      expect(newLot).toBeDefined();
      expect(newLot.numero).toBe(2);
    });

    it('updates an achats lot', async () => {
      const { updateAchatLotAction } = await import('@/app/(team)/projects/[id]/achats/actions');
      const res = await updateAchatLotAction(ACHAT_LOT_ID, {
        notes: 'Livraison prévue fin de semaine',
        devis_fournisseur_mad: 26000,
      });

      expect(res.ok).toBe(true);
      const lot = mockSupabase.db.achats_lots.find((l) => l.id === ACHAT_LOT_ID);
      expect(lot.notes).toBe('Livraison prévue fin de semaine');
      expect(lot.devis_fournisseur_mad).toBe(26000);
    });

    it('soft deletes an achats lot and logs audit', async () => {
      const { deleteAchatLotAction } = await import('@/app/(team)/projects/[id]/achats/actions');
      const res = await deleteAchatLotAction(ACHAT_LOT_ID);

      expect(res.ok).toBe(true);
      const lot = mockSupabase.db.achats_lots.find((l) => l.id === ACHAT_LOT_ID);
      expect(lot.deleted_at).toBeDefined();
    });

    it('rejects invalid inputs on creation (missing supplier_name)', async () => {
      const { createAchatLotAction } = await import('@/app/(team)/projects/[id]/achats/actions');
      const res = await createAchatLotAction({
        project_id: PROJECT_ID,
        category: 'Luminaires',
      });
      expect(res.ok).toBe(false);
      expect(res.error).toBeDefined();
    });
  });
});
