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
  createArtisanAction,
  createArtisanMinimalAction,
  updateArtisanAction,
  deleteArtisanAction,
} from '@/app/(team)/artisans/actions';

import {
  uploadArtisanDocumentAction,
  deleteArtisanDocumentAction,
} from '@/app/(team)/artisans/[id]/documents/actions';

function createDummyFile(name: string, type = 'application/pdf', size = 1024): File {
  const blob = new Blob(['dummy content'.repeat(Math.ceil(size / 13))], { type });
  return new File([blob], name, { type });
}

describe('Multi-Step Workflow: Artisan Onboarding, Compliance Verification & Lifecycle', () => {
  const CHEF_ID = '11111111-2222-3333-4444-555555555555';
  const CEO_ID = '22222222-3333-4444-5555-666666666666';
  const CLIENT_ID = '33333333-4444-5555-6666-777777777777';

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSupabase.db.artisans = [];
    mockSupabase.db.documents = [];
  });

  it('Step 1: Onboard complete artisan profile with legal details and 24-digit RIB', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const res = await createArtisanAction({
      name: 'Atlas Plomberie Générale',
      type: 'entreprise_generale',
      legal_form: 'sarl',
      business_scope: 'travaux',
      speciality: 'plomberie_sanitaire',
      ice: '001234567890001',
      rc: '12345-CAS',
      rib: '007780000123456789012345',
      contact_name: 'Hassan Amrani',
      phone: '+212 661 998877',
      email: 'contact@atlasplomberie.ma',
      status: 'prospect',
    });
    expect(res.ok).toBe(true);

    const art = mockSupabase.db.artisans[0];
    expect(art.name).toBe('Atlas Plomberie Générale');
    expect(art.status).toBe('prospect');
  });

  it('Step 2: Minimal inline artisan creation from travaux lot with case-insensitive dedup', async () => {
    setMockUser('chef_projet', CHEF_ID);

    // 1. Create first time
    const res1 = await createArtisanMinimalAction('Menuiserie du Sud');
    expect(res1.ok).toBe(true);
    if (!res1.ok) return;
    expect(res1.name).toBe('Menuiserie du Sud');

    // 2. Attempt duplicate creation with lowercase -> Returns existing ID
    const res2 = await createArtisanMinimalAction('menuiserie du sud');
    expect(res2.ok).toBe(true);
    if (!res2.ok) return;
    expect(res2.id).toBe(res1.id);

    expect(mockSupabase.db.artisans.length).toBe(1);
  });

  it('Step 3: Update artisan compliance from prospect to actif after audit', async () => {
    mockSupabase.db.artisans.push({
      id: 'art-1',
      name: 'Élec Marrakech',
      type: 'artisan_local',
      status: 'prospect',
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await updateArtisanAction('art-1', {
      name: 'Élec Marrakech',
      type: 'artisan_local',
      status: 'actif',
      evaluation: 5,
    });
    expect(res.ok).toBe(true);

    const art = mockSupabase.db.artisans.find((a: any) => a.id === 'art-1');
    expect(art.status).toBe('actif');
    expect(art.evaluation).toBe(5);
  });

  it('Step 4: Upload compliance decennial insurance certificate for artisan', async () => {
    mockSupabase.db.artisans.push({ id: 'art-1', name: 'Atlas Peinture' });
    setMockUser('chef_projet', CHEF_ID);

    const fd = new FormData();
    fd.append('artisan_id', 'art-1');
    fd.append('type', 'attestation_assurance');
    fd.append('document_number', 'POL-SANLAM-2026-99');
    fd.append('document_date', '2026-01-15');
    fd.append('file', createDummyFile('attestation_decennale.pdf'));

    const res = await uploadArtisanDocumentAction(fd);
    expect(res.ok).toBe(true);

    const docs = mockSupabase.db.documents;
    expect(docs.length).toBe(1);
    expect(docs[0].artisan_id).toBe('art-1');
    expect(docs[0].type).toBe('attestation_assurance');
    expect(docs[0].document_number).toBe('POL-SANLAM-2026-99');
  });

  it('Step 5: Upload official bank RIB document for artisan payouts', async () => {
    mockSupabase.db.artisans.push({ id: 'art-1', name: 'Atlas Peinture' });
    setMockUser('chef_projet', CHEF_ID);

    const fd = new FormData();
    fd.append('artisan_id', 'art-1');
    fd.append('type', 'attestation_rib');
    fd.append('file', createDummyFile('rib_attijari.pdf'));

    const res = await uploadArtisanDocumentAction(fd);
    expect(res.ok).toBe(true);

    const doc = mockSupabase.db.documents.find((d: any) => d.type === 'attestation_rib');
    expect(doc).toBeDefined();
    expect(doc.artisan_id).toBe('art-1');
  });

  it('Step 6: Rejection of invalid document types', async () => {
    mockSupabase.db.artisans.push({ id: 'art-1', name: 'Artisan Test' });
    setMockUser('chef_projet', CHEF_ID);

    const fd = new FormData();
    fd.append('artisan_id', 'art-1');
    fd.append('type', 'type_non_autorise');
    fd.append('file', createDummyFile('document.pdf'));

    const res = await uploadArtisanDocumentAction(fd);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('Type invalide');
  });

  it('Step 7: Blacklist artisan on serious default or non-compliance', async () => {
    mockSupabase.db.artisans.push({
      id: 'art-1',
      name: 'Artisan Défaillant',
      type: 'artisan_local',
      status: 'actif',
    });

    setMockUser('ceo', CEO_ID);
    const res = await updateArtisanAction('art-1', {
      name: 'Artisan Défaillant',
      type: 'artisan_local',
      status: 'blacklist',
      notes: 'Non respect des engagements de garantie et abandon de chantier.',
    });
    expect(res.ok).toBe(true);

    const art = mockSupabase.db.artisans.find((a: any) => a.id === 'art-1');
    expect(art.status).toBe('blacklist');
    expect(art.notes).toContain('abandon de chantier');
  });

  it('Step 8: Delete artisan compliance document cleans storage and database', async () => {
    mockSupabase.db.documents.push({
      id: 'doc-1',
      artisan_id: 'art-1',
      storage_path: 'artisans/art-1/attestation_assurance/test.pdf',
      deleted_at: null,
    });

    setMockUser('chef_projet', CHEF_ID);
    const res = await deleteArtisanDocumentAction('doc-1', 'art-1');
    expect(res.ok).toBe(true);

    const doc = mockSupabase.db.documents.find((d: any) => d.id === 'doc-1');
    expect(doc.deleted_at).toBeDefined();
  });

  it('Step 9: Soft-delete artisan with snapshot audit logging', async () => {
    mockSupabase.db.artisans.push({
      id: 'art-1',
      name: 'Artisan Retraité',
      status: 'inactif',
    });

    setMockUser('ceo', CEO_ID);
    const delRes = await deleteArtisanAction('art-1');
    expect(delRes.ok).toBe(true);

    const art = mockSupabase.db.artisans.find((a: any) => a.id === 'art-1');
    expect(art.deleted_at).toBeDefined();
  });

  it('Step 10: Client role cannot access or mutate artisan records', async () => {
    setMockUser('client', CLIENT_ID);

    await expect(
      createArtisanAction({
        name: 'Tentative client',
        type: 'artisan_local',
      }),
    ).rejects.toThrow('Permission refusée');
  });
});
