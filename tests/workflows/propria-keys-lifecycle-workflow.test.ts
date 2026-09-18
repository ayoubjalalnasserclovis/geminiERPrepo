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
  addKeyAction,
  moveKeyAction,
  softDeleteKeyAction,
  updateSecurityKeyAction,
} from '@/app/(team)/propria/cles/actions';

describe('Multi-Step Workflow: Propria Key Management -> Movement -> Retirement Locks (BUG-035)', () => {
  const PROPRIA_USER_ID = '11111111-aaaa-bbbb-cccc-111111111111';
  const CEO_USER_ID = '22222222-aaaa-bbbb-cccc-222222222222';
  const UNIT_ID = '33333333-aaaa-bbbb-cccc-333333333333';
  const PROPERTY_ID = '44444444-aaaa-bbbb-cccc-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, property_id: PROPERTY_ID, name: 'Unit 2B' }],
      properties: [{ id: PROPERTY_ID, name: 'Villa Palmeraie' }],
      propria_keys: [],
      propria_key_movements: [],
      propria_audit_log: [],
    });
    setMockUser('propria', PROPRIA_USER_ID);
  });

  it('runs key creation, movements, and prevents movements once soft-deleted by CEO', async () => {
    // 1. Add first key set (voyageur)
    const addForm1 = new FormData();
    addForm1.append('propria_unit_id', UNIT_ID);
    addForm1.append('property_id', PROPERTY_ID);
    addForm1.append('key_type', 'voyageur');
    addForm1.append('label', 'Clés Voyageur #1');

    const res1 = await addKeyAction(addForm1);
    expect(res1.ok).toBe(true);

    const keys = mockSupabase.db.propria_keys;
    expect(keys).toHaveLength(1);
    const key1 = keys[0];
    expect(key1.key_number).toBe(1);
    expect(key1.key_type).toBe('voyageur');

    // 2. Move key to traveler keybox
    const moveForm1 = new FormData();
    moveForm1.append('key_id', key1.id);
    moveForm1.append('property_id', PROPERTY_ID);
    moveForm1.append('to_location', 'boite_voyageur');
    moveForm1.append('reason', 'Préparation check-in');

    const moveRes1 = await moveKeyAction(moveForm1);
    expect(moveRes1.ok).toBe(true);

    const movements = mockSupabase.db.propria_key_movements;
    expect(movements).toHaveLength(1);
    expect(movements[0].to_location).toBe('boite_voyageur');

    // 3. Move key to bureau
    const moveForm2 = new FormData();
    moveForm2.append('key_id', key1.id);
    moveForm2.append('property_id', PROPERTY_ID);
    moveForm2.append('to_location', 'bureau');
    moveForm2.append('reason', 'Retour post check-out');

    const moveRes2 = await moveKeyAction(moveForm2);
    expect(moveRes2.ok).toBe(true);
    expect(mockSupabase.db.propria_key_movements).toHaveLength(2);

    // 4. Non-CEO attempts to soft-delete key -> fails
    const delForm = new FormData();
    delForm.append('key_id', key1.id);
    delForm.append('property_id', PROPERTY_ID);
    delForm.append('reason', 'Clé cassée dans la serrure');

    const delRes1 = await softDeleteKeyAction(delForm);
    expect(delRes1.ok).toBe(false);
    expect((delRes1 as any).error).toContain('Permission refusée');

    // 5. CEO soft-deletes the key
    setMockUser('ceo', CEO_USER_ID);
    const delRes2 = await softDeleteKeyAction(delForm);
    expect(delRes2.ok).toBe(true);

    const afterDel = mockSupabase.db.propria_keys.find((k: any) => k.id === key1.id);
    expect(afterDel.deleted_at).toBeDefined();

    // 6. Attempt to move the deleted key -> MUST BE REJECTED (BUG-035)
    setMockUser('propria', PROPRIA_USER_ID);
    const moveFormDeleted = new FormData();
    moveFormDeleted.append('key_id', key1.id);
    moveFormDeleted.append('property_id', PROPERTY_ID);
    moveFormDeleted.append('to_location', 'armoire_logement');

    const moveDeletedRes = await moveKeyAction(moveFormDeleted);
    expect(moveDeletedRes.ok).toBe(false);
    expect((moveDeletedRes as any).error).toBe('Jeu de clés introuvable ou retiré.');

    // Ensure movements table did not accept the orphaned movement
    expect(mockSupabase.db.propria_key_movements).toHaveLength(2);
  });
});
