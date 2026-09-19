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

const mockLogPropriaAudit = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/propria/audit', () => ({
  logPropriaAudit: (...args: any[]) => mockLogPropriaAudit(...args),
}));

import {
  setPropertyCoordinatesAction,
} from '@/app/(team)/propria/carte/actions';

describe('Multi-Step Workflow: Propria Interactive Map Geolocation & Positioning Guards', () => {
  const PROPRIA_USER_ID = '11111111-2222-3333-4444-555555555555';
  const ASSISTANTE_ID = '55555555-1111-2222-3333-444444444444';
  const CEO_ID = '22222222-1111-2222-3333-444444444444';
  const DEVELOPER_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const PROP_1_ID = 'aaaa1111-2222-3333-4444-555555555555';
  const NON_PROPRIA_PROP_ID = 'bbbb1111-2222-3333-4444-555555555555';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogPropriaAudit.mockClear();

    mockSupabase.db.properties = [
      {
        id: PROP_1_ID,
        name: 'Villa Palmeraie Marrakech',
        propria_managed_at: '2026-01-01T00:00:00.000Z',
        latitude: null,
        longitude: null,
        deleted_at: null,
      },
      {
        id: NON_PROPRIA_PROP_ID,
        name: 'Appartement Vente Seule',
        propria_managed_at: null, // NOT under Propria management
        latitude: null,
        longitude: null,
        deleted_at: null,
      },
    ];
  });

  it('Step 1: Propria operator positions property on interactive map with micro-degree rounding', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    // 31.629472391, -7.981084128 -> should round to 6 decimals
    await setPropertyCoordinatesAction(PROP_1_ID, 31.629472391, -7.981084128);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROP_1_ID);
    expect(prop.latitude).toBe(31.629472);
    expect(prop.longitude).toBe(-7.981084);

    expect(mockLogPropriaAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        table: 'properties',
        recordId: PROP_1_ID,
        actorId: PROPRIA_USER_ID,
        action: 'update',
      }),
    );
  });

  it('Step 2: Dragging marker to adjust position updates coordinates and logs previous location', async () => {
    mockSupabase.db.properties[0].latitude = 31.629472;
    mockSupabase.db.properties[0].longitude = -7.981084;

    setMockUser('propria', PROPRIA_USER_ID);
    await setPropertyCoordinatesAction(PROP_1_ID, 31.630111, -7.982222);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROP_1_ID);
    expect(prop.latitude).toBe(31.630111);
    expect(prop.longitude).toBe(-7.982222);

    expect(mockLogPropriaAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: PROP_1_ID,
        action: 'update',
        payload: {
          latitude: { from: 31.629472, to: 31.630111 },
          longitude: { from: -7.981084, to: -7.982222 },
        },
      }),
    );
  });

  it('Step 3: Assistante role can also update property map coordinates', async () => {
    setMockUser('assistante', ASSISTANTE_ID);
    await setPropertyCoordinatesAction(PROP_1_ID, 31.631, -7.983);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROP_1_ID);
    expect(prop.latitude).toBe(31.631);
    expect(prop.longitude).toBe(-7.983);
  });

  it('Step 4: CEO role can update property map coordinates', async () => {
    setMockUser('ceo', CEO_ID);
    await setPropertyCoordinatesAction(PROP_1_ID, 31.635, -7.985);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === PROP_1_ID);
    expect(prop.latitude).toBe(31.635);
    expect(prop.longitude).toBe(-7.985);
  });

  it('Step 5: Guard: Non-Propria managed property cannot have map coordinates set', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    await expect(
      setPropertyCoordinatesAction(NON_PROPRIA_PROP_ID, 33.57311, -7.58984),
    ).rejects.toThrow("Ce bien n'est pas sous gestion Propria");
  });

  it('Step 6: Soft-deleted property cannot be geolocated', async () => {
    mockSupabase.db.properties[0].deleted_at = new Date().toISOString();

    setMockUser('propria', PROPRIA_USER_ID);
    await expect(
      setPropertyCoordinatesAction(PROP_1_ID, 31.629472, -7.981084),
    ).rejects.toThrow('Bien introuvable');
  });

  it('Step 7: Latitude out-of-bounds (> 90 or < -90) throws schema validation error', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    await expect(
      setPropertyCoordinatesAction(PROP_1_ID, 95.123456, -7.981084),
    ).rejects.toThrow();
  });

  it('Step 8: Longitude out-of-bounds (> 180 or < -180) throws schema validation error', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    await expect(
      setPropertyCoordinatesAction(PROP_1_ID, 31.629472, -185.981084),
    ).rejects.toThrow();
  });

  it('Step 9: Developer role is strictly read-only on map coordinates and cannot mutate GPS', async () => {
    setMockUser('developer', DEVELOPER_ID);

    await expect(
      setPropertyCoordinatesAction(PROP_1_ID, 31.629472, -7.981084),
    ).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Client role cannot access or mutate property geolocation coordinates', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      setPropertyCoordinatesAction(PROP_1_ID, 31.629472, -7.981084),
    ).rejects.toThrow('Permission refusée');
  });
});
