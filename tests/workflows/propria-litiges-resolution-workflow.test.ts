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

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: vi.fn(),
  usePathname: vi.fn(),
}));

import {
  createLitigeAction,
  moveLitigeColumnAction,
  addLitigeItemAction,
  assignLitigeAction,
  setLitigeAircoverRefAction,
} from '@/app/(team)/propria/litiges/actions';

describe('Multi-Step Workflow: Propria Litiges -> Airbnb/AirCover Dispute -> Claims -> Resolution Dates (BUG-038)', () => {
  const PROPRIA_USER_ID = '12341234-1111-2222-3333-444444444444';
  const UNIT_ID = '56785678-1111-2222-3333-444444444444';
  const LISTING_ID = '90129012-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Penthouse Gueliz' }],
      hostaway_listings: [{ id: LISTING_ID, propria_unit_id: UNIT_ID }],
      hostaway_reservations: [
        { id: 'hres-1', hostaway_id: 998877, hostaway_listing_db_id: LISTING_ID, guest_name: 'John Doe' },
      ],
      propria_litiges: [],
      propria_litige_items: [],
      propria_litiges_actions: [],
    });
    setMockUser('propria', PROPRIA_USER_ID);
  });

  it('manages dispute progression through kanban stages, ensures date exclusivity, and locks items on resolution', async () => {
    // 1. Create a dispute for damages
    const form = new FormData();
    form.append('hostaway_reservation_id', '998877');
    form.append('type', 'degats');
    form.append('description', 'Table basse en verre brisée et rideaux déchirés');
    form.append('amount', '2800');

    const createRes = await createLitigeAction(form);
    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;

    const litiges = mockSupabase.db.propria_litiges;
    expect(litiges).toHaveLength(1);
    const litige = litiges[0];
    expect(litige.type).toBe('degats');

    // 2. Attach an AirCover reference
    const airRes = await setLitigeAircoverRefAction({
      litige_id: litige.id,
      aircover_reference: 'AC-2026-987654',
    });
    expect(airRes.ok).toBe(true);

    // 3. Move dispute to ticket_ouvert -> sets ticket_opened_at
    const moveRes1 = await moveLitigeColumnAction({
      litige_id: litige.id,
      column: 'ticket_ouvert',
    });
    expect(moveRes1.ok).toBe(true);

    let current = mockSupabase.db.propria_litiges.find((l: any) => l.id === litige.id);
    expect(current.kanban_column).toBe('ticket_ouvert');
    expect(current.ticket_opened_at).toBeDefined();

    // 4. Move dispute to appel
    const moveRes2 = await moveLitigeColumnAction({
      litige_id: litige.id,
      column: 'appel',
    });
    expect(moveRes2.ok).toBe(true);

    current = mockSupabase.db.propria_litiges.find((l: any) => l.id === litige.id);
    expect(current.call_started_at).toBeDefined();

    // 5. Add a 2nd claim line item while dispute is still open
    const itemForm = new FormData();
    itemForm.append('litige_id', litige.id);
    itemForm.append('description', 'Remplacement rideaux');
    itemForm.append('amount_claimed_mad', '800');
    itemForm.append('cost_real_mad', '750');

    const addItemRes = await addLitigeItemAction(itemForm);
    expect(addItemRes.ok).toBe(true);
    expect(mockSupabase.db.propria_litige_items).toHaveLength(2);

    // 6. Win the dispute -> column 'gagne', sets won_at, lost_at remains null
    const winRes = await moveLitigeColumnAction({
      litige_id: litige.id,
      column: 'gagne',
    });
    expect(winRes.ok).toBe(true);

    current = mockSupabase.db.propria_litiges.find((l: any) => l.id === litige.id);
    expect(current.kanban_column).toBe('gagne');
    expect(current.won_at).toBeDefined();
    expect(current.lost_at).toBeNull();

    // 7. Verify lock: cannot add new items to a won dispute (BUG-038)
    const itemAfterWinForm = new FormData();
    itemAfterWinForm.append('litige_id', litige.id);
    itemAfterWinForm.append('description', 'Frais de dossier supplémentaires');
    itemAfterWinForm.append('amount_claimed_mad', '300');

    const addAfterWinRes = await addLitigeItemAction(itemAfterWinForm);
    expect(addAfterWinRes.ok).toBe(false);
    expect((addAfterWinRes as any).error).toBe('Impossible d\'ajouter un élément à un litige déjà résolu.');

    // 8. Move dispute to 'perdu' (e.g. Airbnb overturned decision) -> won_at MUST BE CLEARED (BUG-038)
    const loseRes = await moveLitigeColumnAction({
      litige_id: litige.id,
      column: 'perdu',
    });
    expect(loseRes.ok).toBe(true);

    current = mockSupabase.db.propria_litiges.find((l: any) => l.id === litige.id);
    expect(current.kanban_column).toBe('perdu');
    expect(current.lost_at).toBeDefined();
    expect(current.won_at).toBeNull();

    // 9. Reopen dispute back to 'appel' -> BOTH won_at and lost_at MUST BE NULL (BUG-038)
    const reopenRes = await moveLitigeColumnAction({
      litige_id: litige.id,
      column: 'appel',
    });
    expect(reopenRes.ok).toBe(true);

    current = mockSupabase.db.propria_litiges.find((l: any) => l.id === litige.id);
    expect(current.kanban_column).toBe('appel');
    expect(current.won_at).toBeNull();
    expect(current.lost_at).toBeNull();
  });
});
