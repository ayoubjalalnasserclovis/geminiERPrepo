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
  createConsumableAction,
  createMovementAction,
  adjustStockAction,
  archiveConsumableAction,
  patchConsumableFieldAction,
  toggleConsumableActiveAction,
} from '@/app/(team)/propria/stock/actions';

describe('Multi-Step Workflow: Propria Consumables Procurement & Stock Integrity (BUG-042)', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const PROPRIA_USER_ID = '22222222-1111-2222-3333-444444444444';
  const UNIT_ID = '33333333-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Villa Palmeraie' }],
      propria_consumables: [],
      propria_stock_movements: [],
      propria_stock_status: [],
      propria_audit_log: [],
      profiles: [
        { id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' },
        { id: PROPRIA_USER_ID, role: 'propria', full_name: 'Propria Manager' },
      ],
    });
    setMockUser('propria', PROPRIA_USER_ID);
  });

  it('Step 1 -> 4: Create article with auto-ref -> Supplier delivery entree -> Unit consumption sortie', async () => {
    // 1. Create consumable (Cuisine -> auto-ref CUI-001)
    const form = new FormData();
    form.append('name', 'Café Nespresso Pro');
    form.append('category', 'Cuisine');
    form.append('unit', 'boîte');
    form.append('unit_price_mad', '120');
    form.append('min_threshold', '10');
    form.append('default_order_qty', '20');
    form.append('supplier', 'Nespresso Maroc');
    form.append('initial_stock', '15');

    await createConsumableAction(form);

    const consumables = mockSupabase.db.propria_consumables;
    expect(consumables).toHaveLength(1);
    const item = consumables[0];
    expect(item.reference).toBe('CUI-001');
    expect(item.name).toBe('Café Nespresso Pro');
    expect(item.is_active).not.toBe(false);

    // 2. Register supplier stock delivery (entree of 30 boxes)
    const entryForm = new FormData();
    entryForm.append('consumable_id', item.id);
    entryForm.append('movement_type', 'entree');
    entryForm.append('movement_date', '2026-09-18');
    entryForm.append('quantity', '30');
    entryForm.append('unit_price_mad', '115'); // discount batch price
    entryForm.append('source_destination', 'Fournisseur direct');

    await createMovementAction(entryForm);
    expect(mockSupabase.db.propria_stock_movements).toHaveLength(1);
    const m1 = mockSupabase.db.propria_stock_movements[0];
    expect(m1.movement_type).toBe('entree');
    expect(m1.quantity).toBe(30);
    expect(m1.unit_price_mad).toBe(115);

    // 3. Register unit consumption (sortie of 4 boxes for Villa Palmeraie)
    const exitForm = new FormData();
    exitForm.append('consumable_id', item.id);
    exitForm.append('movement_type', 'sortie');
    exitForm.append('movement_date', '2026-09-19');
    exitForm.append('quantity', '4');
    exitForm.append('propria_unit_id', UNIT_ID);
    exitForm.append('notes', 'Dotation accueil VIP');

    await createMovementAction(exitForm);
    expect(mockSupabase.db.propria_stock_movements).toHaveLength(2);
    const m2 = mockSupabase.db.propria_stock_movements[1];
    expect(m2.movement_type).toBe('sortie');
    expect(m2.quantity).toBe(4);
    expect(m2.unit_price_mad).toBeNull(); // Sorties auto-derive catalog price
  });

  it('Direct stock adjustment creates corrective delta movement', async () => {
    // 1. Setup existing item with 25 current units
    const itemId = '44444444-1111-2222-3333-444444444444';
    mockSupabase.db.propria_consumables.push({
      id: itemId,
      name: 'Shampoing Bio 50ml',
      category: 'Salle de bain',
      reference: 'SDB-001',
      unit_price_mad: 15,
      is_active: true,
    });
    mockSupabase.db.propria_stock_status.push({
      id: itemId,
      current_stock: 25,
    });

    // 2. Physical inventory counts 18 units (delta -7)
    const adjRes = await adjustStockAction({
      consumable_id: itemId,
      new_stock: '18',
      notes: 'Inventaire physique mensuel',
    });
    expect(adjRes.ok).toBe(true);

    // Movement must be sortie of 7 units
    expect(mockSupabase.db.propria_stock_movements).toHaveLength(1);
    const movement = mockSupabase.db.propria_stock_movements[0];
    expect(movement.movement_type).toBe('sortie');
    expect(movement.quantity).toBe(7);
    expect(movement.notes).toBe('Inventaire physique mensuel');
  });

  it('Inline patch and toggle active updates consumable attributes', async () => {
    const itemId = '55555555-1111-2222-3333-444444444444';
    mockSupabase.db.propria_consumables.push({
      id: itemId,
      name: 'Draps Percale 160x200',
      category: 'Linge',
      min_threshold: 15,
      is_active: true,
    });

    // 1. Patch min_threshold
    const patchRes = await patchConsumableFieldAction({
      id: itemId,
      field: 'min_threshold',
      value: '25',
    });
    expect(patchRes.ok).toBe(true);
    let item = mockSupabase.db.propria_consumables.find((c: any) => c.id === itemId);
    expect(item.min_threshold).toBe(25);

    // 2. Deactivate consumable
    await toggleConsumableActiveAction(itemId, false);
    item = mockSupabase.db.propria_consumables.find((c: any) => c.id === itemId);
    expect(item.is_active).toBe(false);

    // 3. Reactivate consumable
    await toggleConsumableActiveAction(itemId, true);
    item = mockSupabase.db.propria_consumables.find((c: any) => c.id === itemId);
    expect(item.is_active).toBe(true);
  });

  it('Guard enforcement: Block movements and adjustments on archived consumables (BUG-042)', async () => {
    const itemId = '66666666-1111-2222-3333-444444444444';
    mockSupabase.db.propria_consumables.push({
      id: itemId,
      name: 'Ancien Gel Douche',
      category: 'Salle de bain',
      unit_price_mad: 10,
      is_active: true,
    });

    // 1. Archive the consumable
    const archRes = await archiveConsumableAction(itemId);
    expect(archRes.ok).toBe(true);

    const item = mockSupabase.db.propria_consumables.find((c: any) => c.id === itemId);
    expect(item.is_active).toBe(false);

    // 2. Attempt movement on archived item -> MUST THROW
    const moveForm = new FormData();
    moveForm.append('consumable_id', itemId);
    moveForm.append('movement_type', 'entree');
    moveForm.append('movement_date', '2026-09-18');
    moveForm.append('quantity', '10');

    await expect(createMovementAction(moveForm)).rejects.toThrow(
      'Cet article est archivé et ne peut plus faire l\'objet de mouvements de stock.',
    );

    // 3. Attempt direct adjustment on archived item -> MUST RETURN ERROR
    const adjRes = await adjustStockAction({
      consumable_id: itemId,
      new_stock: '10',
    });
    expect(adjRes.ok).toBe(false);
    expect((adjRes as any).error).toContain('archivé');
  });
});
