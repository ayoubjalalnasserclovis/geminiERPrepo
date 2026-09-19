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
}));

const mockLogPropriaAudit = vi.fn().mockResolvedValue(true);
vi.mock('@/lib/propria/audit', () => ({
  logPropriaAudit: (...args: any[]) => mockLogPropriaAudit(...args),
  computeAuditDiff: (before: any, after: any) => {
    const diff: any = {};
    for (const key of Object.keys(after)) {
      if (before[key] !== after[key]) {
        diff[key] = { from: before[key], to: after[key] };
      }
    }
    return diff;
  },
}));

import { createListingMetricAction } from '@/app/(team)/propria/listings/actions';
import {
  createPropriaUnitAction,
  updatePropriaUnitAction,
  renamePropriaUnitCodeAction,
  setPropriaUnitActiveAction,
} from '@/app/(team)/propria/biens/[id]/units/actions';

describe('Multi-Step Workflow: Propria Units & OTA Listing Performance Metrics', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const PROPRIA_USER_ID = '22222222-1111-2222-3333-444444444444';
  const ASSISTANTE_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const PROPERTY_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const UNIT_ID = 'bbbb2222-0000-0000-0000-000000000002';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockLogPropriaAudit.mockClear();

    mockSupabase.db.properties = [
      {
        id: PROPERTY_ID,
        name: 'Villa Palmeraie Marrakech',
        propria_managed_at: '2026-01-01T00:00:00Z',
      },
    ];

    mockSupabase.db.propria_units = [
      {
        id: UNIT_ID,
        property_id: PROPERTY_ID,
        code: 'villa-01',
        code_locked: false,
        propria_apartment_door: 'Suite Principale',
        is_active: true,
        propria_nb_chambres: 3,
        propria_nb_sdb: 2,
      },
    ];

    mockSupabase.db.propria_listing_metrics = [];
  });

  it('Step 1: Create a new Propria unit linked to property with audit logging', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const fd = new FormData();
    fd.append('property_id', PROPERTY_ID);
    fd.append('propria_apartment_door', 'Pavillon Jardin');
    fd.append('code', 'pav-01');

    await createPropriaUnitAction(fd);

    const unit = mockSupabase.db.propria_units.find((u: any) => u.code === 'pav-01');
    expect(unit).toBeTruthy();
    expect(unit.code_locked).toBe(true);
    expect(mockLogPropriaAudit).toHaveBeenCalled();
  });

  it('Step 2: Update unit specifications (rooms and bathrooms counts)', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('property_id', PROPERTY_ID);
    fd.append('propria_apartment_door', 'Suite Principale Rénovée');
    fd.append('propria_nb_chambres', '4');
    fd.append('propria_nb_sdb', '3');

    await updatePropriaUnitAction(UNIT_ID, fd);

    const unit = mockSupabase.db.propria_units.find((u: any) => u.id === UNIT_ID);
    expect(unit.propria_apartment_door).toBe('Suite Principale Rénovée');
    expect(unit.propria_nb_chambres).toBe(4);
    expect(unit.propria_nb_sdb).toBe(3);
    expect(mockLogPropriaAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: UNIT_ID,
        action: 'update',
      }),
    );
  });

  it('Step 3: Rename unit code locks code against automated client rename overwrites', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const fd = new FormData();
    fd.append('unit_id', UNIT_ID);
    fd.append('new_code', 'villa-royale-01');

    await renamePropriaUnitCodeAction(fd);

    const unit = mockSupabase.db.propria_units.find((u: any) => u.id === UNIT_ID);
    expect(unit.code).toBe('villa-royale-01');
    expect(unit.code_locked).toBe(true);
  });

  it('Step 4: Record Airbnb monthly performance metric (rating, review count, occupancy rate)', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const fd = new FormData();
    fd.append('propria_unit_id', UNIT_ID);
    fd.append('platform', 'airbnb');
    fd.append('measured_at', '2026-06-01');
    fd.append('rating', '4.95');
    fd.append('nb_reviews', '48');
    fd.append('occupancy_rate', '87.5');
    fd.append('notes', 'Superhost maintenu, forte demande');

    await createListingMetricAction(fd);

    const metrics = mockSupabase.db.propria_listing_metrics;
    expect(metrics.length).toBe(1);
    expect(metrics[0].platform).toBe('airbnb');
    expect(metrics[0].rating).toBe(4.95);
    expect(metrics[0].nb_reviews).toBe(48);
    expect(metrics[0].occupancy_rate).toBe(87.5);
  });

  it('Step 5: Record Booking.com monthly performance metric for cross-channel tracking', async () => {
    setMockUser('assistante', ASSISTANTE_ID);

    const fd = new FormData();
    fd.append('propria_unit_id', UNIT_ID);
    fd.append('platform', 'booking');
    fd.append('measured_at', '2026-06-01');
    fd.append('rating', '4.8');
    fd.append('nb_reviews', '22');
    fd.append('occupancy_rate', '72.0');

    await createListingMetricAction(fd);

    const metrics = mockSupabase.db.propria_listing_metrics;
    expect(metrics.length).toBe(1);
    expect(metrics[0].platform).toBe('booking');
    expect(metrics[0].rating).toBe(4.8);
  });

  it('Step 6: Upsert conflict: re-submitting metric for same unit, platform, and date updates existing entry', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    const fd1 = new FormData();
    fd1.append('propria_unit_id', UNIT_ID);
    fd1.append('platform', 'airbnb');
    fd1.append('measured_at', '2026-06-01');
    fd1.append('rating', '4.90');
    fd1.append('nb_reviews', '40');
    await createListingMetricAction(fd1);

    // Later correction on review count
    const fd2 = new FormData();
    fd2.append('propria_unit_id', UNIT_ID);
    fd2.append('platform', 'airbnb');
    fd2.append('measured_at', '2026-06-01');
    fd2.append('rating', '4.92');
    fd2.append('nb_reviews', '42');
    await createListingMetricAction(fd2);

    const metrics = mockSupabase.db.propria_listing_metrics;
    expect(metrics.length).toBe(1);
    expect(metrics[0].rating).toBe(4.92);
    expect(metrics[0].nb_reviews).toBe(42);
  });

  it('Step 7: CEO deactivates unit removing it from active pickers while preserving history', async () => {
    setMockUser('ceo', CEO_ID);

    await setPropriaUnitActiveAction(UNIT_ID, false);

    const unit = mockSupabase.db.propria_units.find((u: any) => u.id === UNIT_ID);
    expect(unit.is_active).toBe(false);
  });

  it('Step 8: CEO reactivates unit restoring it to active management status', async () => {
    mockSupabase.db.propria_units[0].is_active = false;

    setMockUser('ceo', CEO_ID);
    await setPropriaUnitActiveAction(UNIT_ID, true);

    const unit = mockSupabase.db.propria_units.find((u: any) => u.id === UNIT_ID);
    expect(unit.is_active).toBe(true);
  });

  it('Step 9: Security: non-CEO cannot deactivate or activate units', async () => {
    setMockUser('propria', PROPRIA_USER_ID);
    await expect(setPropriaUnitActiveAction(UNIT_ID, false)).rejects.toThrow('Permission refusée');

    setMockUser('client', CLIENT_ID);
    await expect(setPropriaUnitActiveAction(UNIT_ID, false)).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Validation guards: rating > 5, occupancy > 100, or invalid platform are rejected', async () => {
    setMockUser('propria', PROPRIA_USER_ID);

    // Rating > 5
    const fdRating = new FormData();
    fdRating.append('propria_unit_id', UNIT_ID);
    fdRating.append('platform', 'airbnb');
    fdRating.append('measured_at', '2026-06-01');
    fdRating.append('rating', '5.8');
    await expect(createListingMetricAction(fdRating)).rejects.toThrow();

    // Occupancy > 100
    const fdOcc = new FormData();
    fdOcc.append('propria_unit_id', UNIT_ID);
    fdOcc.append('platform', 'airbnb');
    fdOcc.append('measured_at', '2026-06-01');
    fdOcc.append('occupancy_rate', '120');
    await expect(createListingMetricAction(fdOcc)).rejects.toThrow();

    // Unknown platform
    const fdPlat = new FormData();
    fdPlat.append('propria_unit_id', UNIT_ID);
    fdPlat.append('platform', 'unknown_platform');
    fdPlat.append('measured_at', '2026-06-01');
    await expect(createListingMetricAction(fdPlat)).rejects.toThrow();
  });
});
