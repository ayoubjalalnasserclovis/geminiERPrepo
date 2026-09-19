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

vi.mock('@/lib/audit/deletion', () => ({
  logDeletion: vi.fn().mockResolvedValue(true),
}));

import {
  createPropertyAction,
  updatePropertyAction,
  deletePropertyAction,
} from '@/app/(team)/properties/actions';

import {
  createPropertyMediaUploadUrl,
  recordPropertyMediaAction,
  deletePropertyMediaAction,
} from '@/app/(team)/properties/[id]/media/actions';

describe('Multi-Step Workflow: Property Portfolio Management, Media Uploads & High-Res Storage', () => {
  const SOURCING_ID = '11111111-2222-3333-4444-555555555555';
  const CHEF_ID = '22222222-1111-2222-3333-444444444444';
  const CEO_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.properties = [];
    mockSupabase.db.property_media = [];
  });

  it('Step 1: Role sourcing creates a new property candidate', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await createPropertyAction({
      name: 'Appartement Racine Vue Mer',
      property_type: 'appartement',
      city: 'Casablanca',
      quartier: 'Racine',
      address: '22 Rue Franklin Roosevelt',
      surface: 120,
      bedrooms: 3,
      bathrooms: 2,
      price: 2400000,
      initial_asking_price: 2600000,
      estimated_rent: 18000,
      status: 'disponible',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const prop = mockSupabase.db.properties.find((p: any) => p.id === res.id);
    expect(prop).toBeDefined();
    expect(prop.price).toBe(2400000);
    expect(prop.sourced_by).toBe(SOURCING_ID);
  });

  it('Step 2: Update property characteristics and financial projections', async () => {
    mockSupabase.db.properties.push({
      id: 'prop-1',
      name: 'Appartement Racine',
      price: 2400000,
      status: 'disponible',
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await updatePropertyAction('prop-1', {
      name: 'Appartement Racine - Rénové',
      property_type: 'appartement',
      city: 'Casablanca',
      quartier: 'Racine',
      surface: 125,
      price: 2450000,
      estimated_rent: 19500,
      description: 'Superbe appartement avec terrasse plein sud',
      status: 'disponible',
    });
    expect(res.ok).toBe(true);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === 'prop-1');
    expect(prop.name).toBe('Appartement Racine - Rénové');
    expect(prop.estimated_rent).toBe(19500);
  });

  it('Step 3: Generate signed direct-to-storage upload URL for high-res photo', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await createPropertyMediaUploadUrl({
      propertyId: 'prop-1',
      type: 'photo',
      fileName: 'salon_principal.jpg',
      fileType: 'image/jpeg',
      fileSize: 4 * 1024 * 1024, // 4MB
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBeDefined();
    expect(res.token).toBeDefined();
  });

  it('Step 4: Register uploaded property photo record after direct storage push', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await recordPropertyMediaAction({
      propertyId: 'prop-1',
      type: 'photo',
      storagePath: 'prop-1/uuid-123.jpg',
    });
    expect(res.ok).toBe(true);

    const media = mockSupabase.db.property_media;
    expect(media.length).toBe(1);
    expect(media[0].property_id).toBe('prop-1');
    expect(media[0].type).toBe('photo');
    expect(media[0].is_cover).toBe(true);
  });

  it('Step 5: Generate signed upload URL for 4K video walkthrough (< 1GB)', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await createPropertyMediaUploadUrl({
      propertyId: 'prop-1',
      type: 'video_bien',
      fileName: 'visite_virtuelle.mp4',
      fileType: 'video/mp4',
      fileSize: 350 * 1024 * 1024, // 350 MB
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.path).toBeDefined();
  });

  it('Step 6: Oversized video (> 1GB) is rejected by storage size guard', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await createPropertyMediaUploadUrl({
      propertyId: 'prop-1',
      type: 'video_bien',
      fileName: 'raw_drone_footage.mov',
      fileType: 'video/quicktime',
      fileSize: 1.2 * 1024 * 1024 * 1024, // 1.2 GB
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('trop volumineux');
  });

  it('Step 7: Unsupported media format (e.g. .exe or .zip) is rejected', async () => {
    setMockUser('sourcing', SOURCING_ID);

    const res = await createPropertyMediaUploadUrl({
      propertyId: 'prop-1',
      type: 'photo',
      fileName: 'archive.zip',
      fileType: 'application/zip',
      fileSize: 1024,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Type non supporté');
  });

  it('Step 8: Delete property media deletes record and cleans storage', async () => {
    mockSupabase.db.property_media.push({
      id: 'media-1',
      property_id: 'prop-1',
      storage_path: 'prop-1/img.jpg',
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await deletePropertyMediaAction('media-1', 'prop-1');
    expect(res.ok).toBe(true);

    const media = mockSupabase.db.property_media.find((m: any) => m.id === 'media-1');
    expect(media).toBeUndefined();
  });

  it('Step 9: Soft-delete property with deletion snapshot audit', async () => {
    mockSupabase.db.properties.push({
      id: 'prop-1',
      name: 'Appartement Déclassé',
      price: 1500000,
    });

    setMockUser('ceo', CEO_ID);
    const delRes = await deletePropertyAction('prop-1');
    expect(delRes.ok).toBe(true);

    const prop = mockSupabase.db.properties.find((p: any) => p.id === 'prop-1');
    expect(prop.deleted_at).toBeDefined();
  });

  it('Step 10: Client role cannot create or mutate property portfolio records', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      createPropertyAction({
        name: 'Tentative client',
        property_type: 'appartement',
        price: 1000000,
      }),
    ).rejects.toThrow('Permission refusée');
  });
});
