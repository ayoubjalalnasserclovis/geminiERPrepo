import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

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

import {
  createCashReservationAction,
  markRecoveredAction,
  createDirectReservationAction,
  collectDirectReservationAction,
  createCollectTaskAction,
} from '@/app/(team)/propria/reservations-cash/actions';

describe('Multi-Step Workflow: Propria Cash Reservations, Direct Bookings & Field Collection', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const ASSISTANTE_ID = '22222222-1111-2222-3333-444444444444';
  const PROPRIA_USER_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const UNIT_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const CASH_RESA_ID = 'bbbb2222-0000-0000-0000-000000000002';
  const DIRECT_RESA_ID = 'cccc3333-0000-0000-0000-000000000003';

  beforeEach(() => {
    mockSupabase = createMockSupabase();

    mockSupabase.db.propria_units = [
      { id: UNIT_ID, code: 'villa-01', name: 'Suite Palmeraie' },
    ];

    mockSupabase.db.propria_cash_reservations = [];
    mockSupabase.db.propria_direct_reservations = [];
    mockSupabase.db.propria_interventions = [];
  });

  it('Step 1: Assistante creates a cash on arrival reservation', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('propria_unit_id', UNIT_ID);
    fd.append('voyageur_name', 'Jean Dupont');
    fd.append('arrival_date', '2026-06-10');
    fd.append('departure_date', '2026-06-15');
    fd.append('nb_nights', '5');
    fd.append('amount_mad', '3500');

    await createCashReservationAction(fd);

    const resas = mockSupabase.db.propria_cash_reservations;
    expect(resas.length).toBe(1);
    expect(resas[0].voyageur_name).toBe('Jean Dupont');
    expect(resas[0].amount_mad).toBe(3500);
  });

  it('Step 2: Field agent collects cash and marks reservation as recovered', async () => {
    mockSupabase.db.propria_cash_reservations = [
      {
        id: CASH_RESA_ID,
        propria_unit_id: UNIT_ID,
        amount_mad: 3500,
        recovered: false,
        remitted_to_ceo: false,
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    await markRecoveredAction(CASH_RESA_ID);

    const resa = mockSupabase.db.propria_cash_reservations.find((r: any) => r.id === CASH_RESA_ID);
    expect(resa.recovered).toBe(true);
    expect(resa.recovered_at).toBe(new Date().toISOString().slice(0, 10));
  });

  it('Step 3: Remittance lock: cannot mark recovered or mutate cash if already remitted to CEO', async () => {
    mockSupabase.db.propria_cash_reservations = [
      {
        id: CASH_RESA_ID,
        propria_unit_id: UNIT_ID,
        amount_mad: 3500,
        recovered: true,
        remitted_to_ceo: true, // Already handed over to CEO
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    await expect(markRecoveredAction(CASH_RESA_ID)).rejects.toThrow(
      'Impossible de modifier : le cash a déjà été remis au CEO.',
    );
  });

  it('Step 4: Create direct reservation outside OTA channels with total price', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('propria_unit_id', UNIT_ID);
    fd.append('guest_name', 'Sophie Martin');
    fd.append('guest_contact', '+33612345678');
    fd.append('arrival_date', '2026-07-01');
    fd.append('departure_date', '2026-07-06');
    fd.append('total_price_mad', '6000');
    fd.append('notes', 'Réservation directe via WhatsApp');

    await createDirectReservationAction(fd);

    const resas = mockSupabase.db.propria_direct_reservations;
    expect(resas.length).toBe(1);
    expect(resas[0].guest_name).toBe('Sophie Martin');
    expect(resas[0].total_price_mad).toBe(6000);
    expect(resas[0].created_by).toBe(ASSISTANTE_ID);
  });

  it('Step 5: Record partial payment deposit (3000 MAD) on direct reservation', async () => {
    mockSupabase.db.propria_direct_reservations = [
      {
        id: DIRECT_RESA_ID,
        propria_unit_id: UNIT_ID,
        total_price_mad: 6000,
        collected_mad: 0,
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    await collectDirectReservationAction(DIRECT_RESA_ID, 3000);

    const resa = mockSupabase.db.propria_direct_reservations.find((r: any) => r.id === DIRECT_RESA_ID);
    expect(resa.collected_mad).toBe(3000);
  });

  it('Step 6: Overpayment guard: attempting to collect more than remaining balance throws error', async () => {
    mockSupabase.db.propria_direct_reservations = [
      {
        id: DIRECT_RESA_ID,
        propria_unit_id: UNIT_ID,
        total_price_mad: 6000,
        collected_mad: 3000, // 3000 MAD remains
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    // Attempting to collect 3500 MAD when only 3000 MAD is due
    await expect(collectDirectReservationAction(DIRECT_RESA_ID, 3500)).rejects.toThrow(
      'Encaissement supérieur au reste dû (3000 MAD).',
    );
  });

  it('Step 7: Final payment collection: settling exact remaining balance', async () => {
    mockSupabase.db.propria_direct_reservations = [
      {
        id: DIRECT_RESA_ID,
        propria_unit_id: UNIT_ID,
        total_price_mad: 6000,
        collected_mad: 3000,
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    await collectDirectReservationAction(DIRECT_RESA_ID, 3000);

    const resa = mockSupabase.db.propria_direct_reservations.find((r: any) => r.id === DIRECT_RESA_ID);
    expect(resa.collected_mad).toBe(6000);
  });

  it('Step 8: Dispatch field collection task linked to unit and reservation reference', async () => {
    mockSupabase.db.propria_cash_reservations = [
      {
        id: CASH_RESA_ID,
        propria_unit_id: UNIT_ID,
        voyageur_name: 'Jean Dupont',
        amount_mad: 3500,
        recovered: false,
        deleted_at: null,
      },
    ];

    setMockUser('assistante', ASSISTANTE_ID);

    const res = await createCollectTaskAction({
      source: 'cash',
      reservation_id: CASH_RESA_ID,
      due_date: '2026-06-10',
      note: 'Encaisser à la remise des clés',
    });

    expect(res.ok).toBe(true);
    const tasks = mockSupabase.db.propria_interventions;
    expect(tasks.length).toBe(1);
    expect(tasks[0].kind).toBe('tache');
    expect(tasks[0].propria_unit_id).toBe(UNIT_ID);
  });

  it('Step 9: Field task deduplication: returns already: true if open task already exists', async () => {
    const REF = `CASH-${CASH_RESA_ID.slice(0, 8).toUpperCase()}`;
    mockSupabase.db.propria_cash_reservations = [
      {
        id: CASH_RESA_ID,
        propria_unit_id: UNIT_ID,
        voyageur_name: 'Jean Dupont',
        amount_mad: 3500,
        recovered: false,
        deleted_at: null,
      },
    ];
    mockSupabase.db.propria_interventions = [
      {
        id: 'task-open-1',
        kind: 'tache',
        hostaway_ref: REF,
        status: 'en_cours',
        deleted_at: null,
      },
    ];

    setMockUser('propria', PROPRIA_USER_ID);

    const res = await createCollectTaskAction({
      source: 'cash',
      reservation_id: CASH_RESA_ID,
    });

    expect(res.ok).toBe(true);
    if (res.ok && 'already' in res) {
      expect(res.already).toBe(true);
      expect(res.interventionId).toBe('task-open-1');
    }
  });

  it('Step 10: Validation guards: departure date before arrival date or invalid amounts rejected', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    // Departure before arrival
    const fdDate = new FormData();
    fdDate.append('propria_unit_id', UNIT_ID);
    fdDate.append('guest_name', 'Invalid Dates');
    fdDate.append('arrival_date', '2026-07-10');
    fdDate.append('departure_date', '2026-07-05');
    fdDate.append('total_price_mad', '2000');

    await expect(createDirectReservationAction(fdDate)).rejects.toThrow(
      'La date de départ doit être après la date d’arrivée.',
    );

    // Negative collection amount
    await expect(collectDirectReservationAction(DIRECT_RESA_ID, -500)).rejects.toThrow(
      'Montant encaissé invalide.',
    );

    // Client security rejection
    setMockUser('client', CLIENT_ID);
    await expect(markRecoveredAction(CASH_RESA_ID)).rejects.toThrow('Permission refusée');
  });
});
