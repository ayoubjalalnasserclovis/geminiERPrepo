import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const PROPRIA_USER_ID = '11111111-1111-4111-8111-111111111111';
const CEO_USER_ID = '22222222-2222-4222-8222-222222222222';
const PROPERTY_ID = '33333333-3333-4333-8333-333333333333';
const UNIT_ID = '44444444-4444-4444-8444-444444444444';
const LITIGE_ID = '55555555-5555-4555-8555-555555555555';
const INTERVENTION_ID = '66666666-6666-4666-8666-666666666666';
const WALLET_ID = '77777777-7777-4777-8777-777777777777';
const EXPENSE_ID = '88888888-8888-4888-8888-888888888888';
const TRANSFER_ID = '99999999-9999-4999-8999-999999999999';
const UPSELL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CONSUMABLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

vi.mock('@/lib/propria/notify', () => ({
  notifyUsers: vi.fn().mockResolvedValue(true),
}));

import {
  createLitigeAction,
  moveLitigeColumnAction,
  createInterventionFromLitigeAction,
} from '@/app/(team)/propria/litiges/actions';
import {
  createInterventionAction,
  startInterventionAction,
  submitForValidationAction,
  validateInterventionAction,
  refuseInterventionAction,
} from '@/app/(team)/propria/interventions/actions';
import {
  createWalletAction,
  closeWalletAction,
  validateExpenseAction,
} from '@/app/(team)/propria/caisse/actions';
import {
  createPoliceRecordAction,
  markRecordCompleteAction,
  markRecordSubmittedAction,
} from '@/app/(team)/propria/fiches-police/actions';
import {
  createConsumableAction,
  adjustStockAction,
} from '@/app/(team)/propria/stock/actions';
import {
  createTransferAction,
  setTransferStatusAction,
  markCashCollectedAction,
} from '@/app/(team)/propria/transferts/actions';
import {
  createUpsellAction,
  setUpsellStatusAction,
  setUpsellAmountAction,
} from '@/app/(team)/propria/upsell/actions';

describe('Propria Modules Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      profiles: [
        { id: PROPRIA_USER_ID, email: 'propria@stoniz.co', role: 'propria', full_name: 'Propria Agent', is_active: true },
        { id: CEO_USER_ID, email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
      ],
      properties: [
        { id: PROPERTY_ID, name: 'Villa Palmeraie', reference: 'PROP-01', status: 'disponible' },
      ],
      propria_units: [
        { id: UNIT_ID, property_id: PROPERTY_ID, unit_code: 'U1', name: 'Suite Royale', is_active: true },
      ],
      hostaway_reservations: [
        { id: 'hres-1', hostaway_id: 12345, hostaway_listing_db_id: 'hlist-1' },
      ],
      hostaway_listings: [
        { id: 'hlist-1', propria_unit_id: UNIT_ID },
      ],
      propria_litiges: [
        {
          id: LITIGE_ID,
          propria_unit_id: UNIT_ID,
          hostaway_reservation_id: 12345,
          hostaway_listing_db_id: 'hlist-1',
          type: 'degats',
          status: 'ouvrir_ticket',
          description: 'Miroir brisé dans le salon',
          deleted_at: null,
        },
      ],
      propria_litiges_actions: [],
      propria_interventions: [
        {
          id: INTERVENTION_ID,
          property_id: PROPERTY_ID,
          propria_unit_id: UNIT_ID,
          kind: 'intervention',
          status: 'a_traiter',
          urgency: 'haute',
          description: 'Fuite sous le lavabo',
          started_at: null,
          completed_at: null,
          validated_at: null,
          refused_count: 0,
        },
      ],
      propria_intervention_proofs: [
        {
          id: 'prf-1',
          intervention_id: INTERVENTION_ID,
          deleted_at: null,
        },
      ],
      propria_intervention_activity: [],
      propria_wallets: [
        {
          id: WALLET_ID,
          profile_id: PROPRIA_USER_ID,
          label: 'Caisse Terrain Marrakech',
          is_active: true,
        },
      ],
      propria_wallet_expenses: [
        {
          id: EXPENSE_ID,
          wallet_id: WALLET_ID,
          amount: 250,
          description: 'Achat ampoules et serrures',
          receipt_path: 'receipts/ticket.pdf',
          is_validated: false,
          deleted_at: null,
        },
      ],
      propria_police_records: [],
      propria_consumables: [
        {
          id: CONSUMABLE_ID,
          reference: 'HYG-001',
          name: 'Savon liquide',
          category: 'Hygiène',
          min_threshold: 5,
        },
      ],
      propria_stock_status: [
        {
          id: CONSUMABLE_ID,
          current_stock: 10,
        },
      ],
      propria_stock_movements: [],
      propria_transfers: [
        {
          id: TRANSFER_ID,
          propria_unit_id: UNIT_ID,
          travel_date: '2026-09-20',
          amount_mad: 300,
          status: 'a_faire',
          cash_collected: false,
        },
      ],
      propria_upsells: [
        {
          id: UPSELL_ID,
          propria_unit_id: UNIT_ID,
          category: 'transfert',
          amount_mad: 450,
          status: 'commande',
        },
      ],
      propria_audit_log: [],
    });

    setMockUser('propria', PROPRIA_USER_ID);
  });

  describe('Propria Litiges Actions', () => {
    it('creates a litige from hostaway reservation', async () => {
      const formData = new FormData();
      formData.append('hostaway_reservation_id', '12345');
      formData.append('type', 'degats');
      formData.append('description', 'Table basse rayée');
      formData.append('currency', 'MAD');

      const res = await createLitigeAction(formData);
      expect(res.ok).toBe(true);

      const litige = mockSupabase.db.propria_litiges.find((l: any) => l.description === 'Table basse rayée');
      expect(litige).toBeDefined();
      expect(litige.propria_unit_id).toBe(UNIT_ID);
    });

    it('moves litige column / status', async () => {
      const res = await moveLitigeColumnAction({
        litige_id: LITIGE_ID,
        column: 'ticket_ouvert',
      });
      expect(res.ok).toBe(true);

      const litige = mockSupabase.db.propria_litiges.find((l: any) => l.id === LITIGE_ID);
      expect(litige.kanban_column).toBe('ticket_ouvert');
    });

    it('creates an intervention directly from a litige', async () => {
      const res = await createInterventionFromLitigeAction({
        litige_id: LITIGE_ID,
        kind: 'intervention',
      });

      expect(res.ok).toBe(true);
      if (res.ok) {
        const intervention = mockSupabase.db.propria_interventions.find((i: any) => i.id === res.id);
        expect(intervention).toBeDefined();
        expect(intervention.property_id).toBe(PROPERTY_ID);
        expect(intervention.propria_unit_id).toBe(UNIT_ID);
        expect(intervention.description).toContain('Miroir brisé');
      }
    });
  });

  describe('Propria Interventions Actions Lifecycle', () => {
    it('creates and starts an intervention', async () => {
      const formData = new FormData();
      formData.append('scope', `unit:${UNIT_ID}`);
      formData.append('kind', 'intervention');
      formData.append('urgency', 'haute');
      formData.append('occurred_at', '2026-09-15');
      formData.append('description', 'Changer le joint du mitigeur');

      try {
        await createInterventionAction(formData);
      } catch {
        // redirect
      }

      const created = mockSupabase.db.propria_interventions.find((i: any) => i.description === 'Changer le joint du mitigeur');
      expect(created).toBeDefined();

      const startRes = await startInterventionAction(INTERVENTION_ID);
      expect(startRes.ok).toBe(true);

      const intv = mockSupabase.db.propria_interventions.find((i: any) => i.id === INTERVENTION_ID);
      expect(intv.status).toBe('en_cours');
      expect(intv.started_at).toBeDefined();
    });

    it('completes intervention and validates by manager/ceo', async () => {
      await startInterventionAction(INTERVENTION_ID);
      const submitRes = await submitForValidationAction(INTERVENTION_ID);
      expect(submitRes.ok).toBe(true);

      let intv = mockSupabase.db.propria_interventions.find((i: any) => i.id === INTERVENTION_ID);
      expect(intv.status).toBe('a_valider');

      // CEO validates
      setMockUser('ceo', CEO_USER_ID);
      const valRes = await validateInterventionAction(INTERVENTION_ID);
      expect(valRes.ok).toBe(true);

      intv = mockSupabase.db.propria_interventions.find((i: any) => i.id === INTERVENTION_ID);
      expect(intv.status).toBe('cloture');
      expect(intv.validated_at).toBeDefined();
    });

    it('refuses intervention and returns to in progress', async () => {
      setMockUser('ceo', CEO_USER_ID);
      // Set to a_valider first
      mockSupabase.db.propria_interventions.find((i: any) => i.id === INTERVENTION_ID).status = 'a_valider';

      const res = await refuseInterventionAction(INTERVENTION_ID, 'Photos de fin de travaux manquantes');
      expect(res.ok).toBe(true);

      const intv = mockSupabase.db.propria_interventions.find((i: any) => i.id === INTERVENTION_ID);
      expect(intv.status).toBe('refusee');
    });
  });

  describe('Propria Caisse Actions', () => {
    it('creates wallet and closes wallet (finance/ceo)', async () => {
      setMockUser('ceo', CEO_USER_ID);
      const formData = new FormData();
      formData.append('profile_id', PROPRIA_USER_ID);
      formData.append('label', 'Petite caisse Marrakech');

      try {
        await createWalletAction(formData);
      } catch (e) {
        // Next redirect can happen
      }

      const wallet = mockSupabase.db.propria_wallets.find((w: any) => w.label === 'Petite caisse Marrakech');
      expect(wallet).toBeDefined();

      const closeRes = await closeWalletAction(WALLET_ID);
      expect(closeRes.ok).toBe(true);
      const closedWallet = mockSupabase.db.propria_wallets.find((w: any) => w.id === WALLET_ID);
      expect(closedWallet.is_active).toBe(false);
    });

    it('validates an expense with receipt', async () => {
      setMockUser('ceo', CEO_USER_ID);
      const valRes = await validateExpenseAction(EXPENSE_ID, WALLET_ID);
      expect(valRes.ok).toBe(true);

      const exp = mockSupabase.db.propria_wallet_expenses.find((e: any) => e.id === EXPENSE_ID);
      expect(exp.is_validated).toBe(true);
    });
  });

  describe('Propria Fiches Police Actions', () => {
    it('creates and marks police record as complete then submitted', async () => {
      const createRes = await createPoliceRecordAction({
        property_id: PROPERTY_ID,
        propria_unit_id: UNIT_ID,
        head_first_name: 'Jean',
        head_last_name: 'Dupont',
        head_gender: 'M',
        head_birth_date: '1985-05-12',
        head_birth_place: 'Paris',
        head_nationality: 'Française',
        head_id_type: 'passport',
        head_id_number: '12AB34567',
        head_id_issue_country: 'France',
        head_residence_country: 'France',
        head_residence_address: '10 Rue de Rivoli, Paris',
        arrival_date_property: '2026-09-20',
        expected_departure_date: '2026-09-27',
        motif_sejour: 'tourisme',
      });

      expect(createRes.ok).toBe(true);
      if (createRes.ok) {
        const compRes = await markRecordCompleteAction(createRes.id);
        expect(compRes.ok).toBe(true);

        const subRes = await markRecordSubmittedAction(createRes.id);
        expect(subRes.ok).toBe(true);

        const record = mockSupabase.db.propria_police_records.find((r: any) => r.id === createRes.id);
        expect(record.status).toBe('submitted');
      }
    });
  });

  describe('Propria Stock & Consumables Actions', () => {
    it('creates consumable with automatic category reference', async () => {
      const formData = new FormData();
      formData.append('name', 'Serviette de bain');
      formData.append('category', 'Linge');
      formData.append('unit', 'piece');
      formData.append('unit_price_mad', '80');
      formData.append('min_threshold', '10');
      formData.append('default_order_qty', '20');
      formData.append('supplier', 'Grossiste Marrakech');
      formData.append('initial_stock', '25');

      await createConsumableAction(formData);

      const item = mockSupabase.db.propria_consumables.find((c: any) => c.name === 'Serviette de bain');
      expect(item).toBeDefined();
      expect(item.reference).toMatch(/^LIN-/);
    });

    it('adjusts stock quantity and records movement', async () => {
      const res = await adjustStockAction({
        consumable_id: CONSUMABLE_ID,
        new_stock: '15',
        notes: 'Inventaire physique trimestriel',
      });

      expect(res.ok).toBe(true);
      const movement = mockSupabase.db.propria_stock_movements.find((m: any) => m.consumable_id === CONSUMABLE_ID);
      expect(movement).toBeDefined();
      expect(movement.quantity).toBe(5);
    });
  });

  describe('Propria Transferts & Upsell Actions', () => {
    it('creates transfer and tracks cash collection', async () => {
      const formData = new FormData();
      formData.append('propria_unit_id', UNIT_ID);
      formData.append('travel_date', '2026-09-25');
      formData.append('voyageur_name', 'M. Smith');
      formData.append('amount_mad', '350');
      formData.append('driver_name', 'Rachid');

      await createTransferAction(formData);
      const transfer = mockSupabase.db.propria_transfers.find((t: any) => t.voyageur_name === 'M. Smith');
      expect(transfer).toBeDefined();

      await setTransferStatusAction(TRANSFER_ID, 'fait');
      await markCashCollectedAction(TRANSFER_ID, true);

      const updated = mockSupabase.db.propria_transfers.find((t: any) => t.id === TRANSFER_ID);
      expect(updated.status).toBe('fait');
      expect(updated.cash_collected).toBe(true);
      expect(updated.collected_at).toBeDefined();
    });

    it('creates upsell and changes its status and amount', async () => {
      const formData = new FormData();
      formData.append('propria_unit_id', UNIT_ID);
      formData.append('category', 'petit_dejeuner');
      formData.append('amount_mad', '200');
      formData.append('guest_name', 'Alice');

      await createUpsellAction(formData);
      const upsell = mockSupabase.db.propria_upsells.find((u: any) => u.guest_name === 'Alice');
      expect(upsell).toBeDefined();

      await setUpsellStatusAction(UPSELL_ID, 'livre');
      await setUpsellAmountAction(UPSELL_ID, 500);

      const updated = mockSupabase.db.propria_upsells.find((u: any) => u.id === UPSELL_ID);
      expect(updated.status).toBe('livre');
      expect(updated.amount_mad).toBe(500);
    });
  });
});
