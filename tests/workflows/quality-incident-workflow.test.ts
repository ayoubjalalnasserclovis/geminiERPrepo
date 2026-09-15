import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const CEO_ID = '11111111-1111-4111-8111-111111111111';
const PROPRIA_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const CLEANER_ID = '33333333-3333-4333-8333-333333333333';
const PROPERTY_ID = '44444444-4444-4444-8444-444444444444';
const UNIT_ID = '55555555-5555-4555-8555-555555555555';

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

vi.mock('@/lib/propria/checkup-notify', () => ({
  notifyCheckupAssigned: vi.fn().mockResolvedValue(true),
  notifyCheckupToValidate: vi.fn().mockResolvedValue(true),
  notifyCheckupValidated: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/propria/notify', () => ({
  notifyUsers: vi.fn().mockResolvedValue(true),
}));

import { createCleaningAction } from '@/app/(team)/propria/menage/actions';
import { createCheckupAction, upsertCheckupItemAction } from '@/app/(team)/propria/checkups/actions';
import {
  createLitigeAction,
  moveLitigeColumnAction,
  createInterventionFromLitigeAction,
} from '@/app/(team)/propria/litiges/actions';
import {
  startInterventionAction,
  submitForValidationAction,
  validateInterventionAction,
} from '@/app/(team)/propria/interventions/actions';

describe('Workflow E2E: Quality Incident & Resolution Loop', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      profiles: [
        { id: CEO_ID, email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
        { id: PROPRIA_AGENT_ID, email: 'propria@stoniz.co', role: 'propria', full_name: 'Propria Lead', is_active: true },
        { id: CLEANER_ID, email: 'menage@stoniz.co', role: 'menage', full_name: 'Amina Menage', is_active: true },
      ],
      properties: [
        { id: PROPERTY_ID, name: 'Riad Dar Al Andalus', reference: 'RIAD-01', status: 'disponible' },
      ],
      propria_units: [
        { id: UNIT_ID, property_id: PROPERTY_ID, unit_code: 'U1', name: 'Suite Fès', is_active: true },
      ],
      propria_cleanings: [],
      propria_checkups: [],
      propria_checkup_items: [],
      hostaway_reservations: [
        { id: 'hres-99', hostaway_id: 99001, hostaway_listing_db_id: 'hlist-99' },
      ],
      hostaway_listings: [
        { id: 'hlist-99', propria_unit_id: UNIT_ID },
      ],
      propria_litiges: [],
      propria_litiges_actions: [],
      propria_interventions: [],
      propria_intervention_proofs: [],
      propria_intervention_activity: [],
      propria_audit_log: [],
    });

    setMockUser('propria', PROPRIA_AGENT_ID);
  });

  it('orchestrates cleaning -> checkup anomaly detection -> litige -> intervention -> proof -> validation', async () => {
    // -------------------------------------------------------------------------
    // 1. Cleaning creation
    // -------------------------------------------------------------------------
    const cleaningForm = new FormData();
    cleaningForm.append('scope', `unit:${UNIT_ID}`);
    cleaningForm.append('occurred_at', '2026-09-20');
    cleaningForm.append('urgency', 'normale');
    cleaningForm.append('assigned_to_id', CLEANER_ID);

    try {
      await createCleaningAction(cleaningForm);
    } catch {
      // next redirect
    }

    const cleaning = mockSupabase.db.propria_cleanings[0];
    expect(cleaning).toBeDefined();
    expect(cleaning.propria_unit_id).toBe(UNIT_ID);

    // -------------------------------------------------------------------------
    // 2. Checkup creation
    // -------------------------------------------------------------------------
    const checkupForm = new FormData();
    checkupForm.append('scope', `unit:${UNIT_ID}`);
    checkupForm.append('due_date', '2026-09-20');
    checkupForm.append('assigned_to_id', PROPRIA_AGENT_ID);

    try {
      await createCheckupAction(checkupForm);
    } catch {
      // next redirect
    }

    const checkup = mockSupabase.db.propria_checkups[0];
    expect(checkup).toBeDefined();
    expect(checkup.propria_unit_id).toBe(UNIT_ID);

    // -------------------------------------------------------------------------
    // 3. Checkup inspector flags damaged table in checkup items
    // -------------------------------------------------------------------------
    const itemRes = await upsertCheckupItemAction({
      checkup_id: checkup.id,
      item_key: 'canape',
      status: 'probleme',
      note: 'Canapé endommagé lors du séjour voyageur',
    });
    expect(itemRes.ok).toBe(true);

    const checkupItem = mockSupabase.db.propria_checkup_items.find((i: any) => i.item_key === 'canape');
    expect(checkupItem.status).toBe('probleme');

    // -------------------------------------------------------------------------
    // 4. Create Airbnb litigation from Hostaway reservation
    // -------------------------------------------------------------------------
    const litigeForm = new FormData();
    litigeForm.append('hostaway_reservation_id', '99001');
    litigeForm.append('type', 'degats');
    litigeForm.append('description', 'Table basse endommagée par voyageur');
    litigeForm.append('currency', 'MAD');

    const litigeRes = await createLitigeAction(litigeForm);
    expect(litigeRes.ok).toBe(true);
    if (!litigeRes.ok) return;

    const litigeId = litigeRes.id;
    const litige = mockSupabase.db.propria_litiges.find((l: any) => l.id === litigeId);
    expect(litige).toBeDefined();

    // Move to ticket_ouvert
    const moveRes = await moveLitigeColumnAction({
      litige_id: litigeId,
      column: 'ticket_ouvert',
    });
    expect(moveRes.ok).toBe(true);

    // -------------------------------------------------------------------------
    // 5. Spawn maintenance intervention from litigation
    // -------------------------------------------------------------------------
    const spawnRes = await createInterventionFromLitigeAction({
      litige_id: litigeId,
      kind: 'intervention',
    });
    expect(spawnRes.ok).toBe(true);
    if (!spawnRes.ok) return;

    const interventionId = spawnRes.id;
    const intervention = mockSupabase.db.propria_interventions.find((i: any) => i.id === interventionId);
    expect(intervention).toBeDefined();
    expect(intervention.property_id).toBe(PROPERTY_ID);
    expect(intervention.propria_unit_id).toBe(UNIT_ID);

    // -------------------------------------------------------------------------
    // 6. Technician starts intervention
    // -------------------------------------------------------------------------
    const startRes = await startInterventionAction(interventionId);
    expect(startRes.ok).toBe(true);
    expect(mockSupabase.db.propria_interventions.find((i: any) => i.id === interventionId).status).toBe('en_cours');

    // -------------------------------------------------------------------------
    // 7. Add photo proof and submit for validation
    // -------------------------------------------------------------------------
    mockSupabase.db.propria_intervention_proofs.push({
      id: crypto.randomUUID(),
      intervention_id: interventionId,
      file_path: 'proofs/table_repaired.jpg',
      deleted_at: null,
    });

    const submitRes = await submitForValidationAction(interventionId);
    expect(submitRes.ok).toBe(true);
    expect(mockSupabase.db.propria_interventions.find((i: any) => i.id === interventionId).status).toBe('a_valider');

    // -------------------------------------------------------------------------
    // 8. CEO / Manager validates repair
    // -------------------------------------------------------------------------
    setMockUser('ceo', CEO_ID);
    const valRes = await validateInterventionAction(interventionId);
    expect(valRes.ok).toBe(true);
    expect(mockSupabase.db.propria_interventions.find((i: any) => i.id === interventionId).status).toBe('cloture');

    // -------------------------------------------------------------------------
    // 9. Litigation column marked as won
    // -------------------------------------------------------------------------
    const closeLitigeRes = await moveLitigeColumnAction({
      litige_id: litigeId,
      column: 'gagne',
    });
    expect(closeLitigeRes.ok).toBe(true);
    expect(mockSupabase.db.propria_litiges.find((l: any) => l.id === litigeId).kanban_column).toBe('gagne');
  });
});
