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
  createInventoryAction,
  updateInventoryItemAction,
  markCategoryAbsentAction,
  completeInventoryAction,
  addInventoryItemAction,
  deleteInventoryItemAction,
  reseedInventoryAction,
} from '@/app/(team)/propria/inventaires/actions';

describe('Multi-Step Workflow: Propria Inventaires -> Checklist -> Seeding -> Completion Lock (BUG-036)', () => {
  const PROPRIA_USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-111111111111';
  const UNIT_ID = 'aaaaaaaa-bbbb-cccc-dddd-222222222222';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Suite 404' }],
      propria_inventories: [],
      propria_inventory_items: [],
      propria_inventory_template_items: [
        { id: 'tpl-1', category: 'salon', name: 'Canapé', default_quantity: 1, is_active: true, display_order: 1 },
        { id: 'tpl-2', category: 'salon', name: 'Table basse', default_quantity: 1, is_active: true, display_order: 2 },
        { id: 'tpl-3', category: 'chambre', name: 'Lit King Size', default_quantity: 1, is_active: true, display_order: 3 },
      ],
    });
    setMockUser('propria', PROPRIA_USER_ID);
  });

  it('conducts inventory checklist, completes inventory, and blocks subsequent modifications', async () => {
    // 1. Create inventory
    const createForm = new FormData();
    createForm.append('propria_unit_id', UNIT_ID);
    createForm.append('inventory_date', '2026-09-18');
    createForm.append('type', 'entree');
    createForm.append('notes', 'État des lieux entrée nouveau locataire');

    await createInventoryAction(createForm);

    const inventories = mockSupabase.db.propria_inventories;
    expect(inventories).toHaveLength(1);
    const inv = inventories[0];
    expect(inv.type).toBe('entree');

    // 2. Verify auto-seeding occurred
    const items = mockSupabase.db.propria_inventory_items;
    expect(items).toHaveLength(3);
    const canape = items.find((i: any) => i.name === 'Canapé');
    expect(canape).toBeDefined();

    // 3. Update checklist line item
    const updateForm = new FormData();
    updateForm.append('item_id', canape.id);
    updateForm.append('inventory_id', inv.id);
    updateForm.append('quantity_found', '1');
    updateForm.append('condition', 'bon');
    updateForm.append('observations', 'Légère usure tissu');

    await updateInventoryItemAction(updateForm);

    const updatedCanape = mockSupabase.db.propria_inventory_items.find((i: any) => i.id === canape.id);
    expect(updatedCanape.condition).toBe('bon');
    expect(updatedCanape.quantity_found).toBe(1);

    // 4. Add custom item
    const addItemForm = new FormData();
    addItemForm.append('inventory_id', inv.id);
    addItemForm.append('category', 'cuisine');
    addItemForm.append('name', 'Machine Nespresso');
    addItemForm.append('quantity_expected', '1');
    addItemForm.append('quantity_found', '1');
    addItemForm.append('condition', 'neuf');

    await addInventoryItemAction(addItemForm);
    expect(mockSupabase.db.propria_inventory_items).toHaveLength(4);

    // 5. Complete inventory
    await completeInventoryAction(inv.id);

    const completedInv = mockSupabase.db.propria_inventories.find((i: any) => i.id === inv.id);
    expect(completedInv.status).toBe('termine');

    // 6. Prevent double completion
    await expect(completeInventoryAction(inv.id)).rejects.toThrow('Cet inventaire est déjà terminé.');

    // 7. Verify post-completion modification locks (BUG-036)
    // Update item -> blocked
    await expect(updateInventoryItemAction(updateForm)).rejects.toThrow(
      'Cet inventaire est déjà terminé et ne peut plus être modifié.',
    );

    // Add item -> blocked
    await expect(addInventoryItemAction(addItemForm)).rejects.toThrow(
      'Cet inventaire est déjà terminé et ne peut plus être modifié.',
    );

    // Mark category absent -> blocked
    await expect(markCategoryAbsentAction(inv.id, 'salon')).rejects.toThrow(
      'Cet inventaire est déjà terminé et ne peut plus être modifié.',
    );

    // Reseed inventory -> blocked
    await expect(reseedInventoryAction(inv.id)).rejects.toThrow(
      'Cet inventaire est déjà terminé et ne peut plus être modifié.',
    );

    // Delete item -> blocked
    await expect(deleteInventoryItemAction(canape.id, inv.id)).rejects.toThrow(
      'Cet inventaire est déjà terminé et ne peut plus être modifié.',
    );
  });
});
