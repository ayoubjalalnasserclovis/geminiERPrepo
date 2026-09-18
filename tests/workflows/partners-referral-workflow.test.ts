import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
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

let deletionLogs: any[] = [];
vi.mock('@/lib/audit/deletion', () => ({
  logDeletion: vi.fn().mockImplementation(async (entry: any) => {
    deletionLogs.push(entry);
    return true;
  }),
}));

import {
  createPartnerAction,
  updatePartnerAction,
  deletePartnerAction,
} from '@/app/(team)/partners/actions';

describe('Multi-Step Workflow: Partners Referral, Commission Management & Audit (BUG-044)', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const SOURCING_USER_ID = '22222222-1111-2222-3333-444444444444';

  beforeEach(() => {
    deletionLogs = [];
    mockSupabase = createMockSupabase({
      partners: [],
      profiles: [
        { id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz' },
        { id: SOURCING_USER_ID, role: 'sourcing', full_name: 'Agent Sourcing' },
      ],
    });
    setMockUser('sourcing', SOURCING_USER_ID);
  });

  it('Step 1 -> 3: Create referral partner with commission agreement -> Verify record', async () => {
    const createRes = await createPartnerAction({
      agency_name: 'Atlas Wealth Advisors',
      contact_name: 'Mehdi El Fassi',
      phone: '+212 6 61 22 33 44',
      email: 'mehdi@atlas-wealth.ma',
      status: 'actif',
      contract_signed: true,
      contract_date: '2026-09-01',
      has_whatsapp_group: true,
      notes: 'Partenaire stratégique gestion de fortune Casablanca',
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const partnerId = createRes.id;

    const partners = mockSupabase.db.partners;
    expect(partners).toHaveLength(1);
    const p = partners[0];
    expect(p.id).toBe(partnerId);
    expect(p.agency_name).toBe('Atlas Wealth Advisors');
    expect(p.contact_name).toBe('Mehdi El Fassi');
    expect(p.contract_signed).toBe(true);
  });

  it('Update partner terms: renegotiate commission rate and notes', async () => {
    const partnerId = '33333333-1111-2222-3333-444444444444';
    mockSupabase.db.partners.push({
      id: partnerId,
      agency_name: 'Atlas Wealth Advisors',
      contact_name: 'Mehdi El Fassi',
      phone: '+212 6 61 22 33 44',
      status: 'actif',
      deleted_at: null,
    });

    const updateRes = await updatePartnerAction(partnerId, {
      agency_name: 'Atlas Wealth Advisors Luxury',
      contact_name: 'Mehdi El Fassi',
      phone: '+212 6 61 22 33 44',
      status: 'actif',
      notes: 'Conditions renégociées avec bonus apporteur',
    });

    expect(updateRes.ok).toBe(true);
    const p = mockSupabase.db.partners.find((item: any) => item.id === partnerId);
    expect(p.agency_name).toBe('Atlas Wealth Advisors Luxury');
    expect(p.notes).toContain('renégociées');
  });

  it('Soft-delete partner and verify correct audit label Partenaire (BUG-044)', async () => {
    const partnerId = '44444444-1111-2222-3333-444444444444';
    mockSupabase.db.partners.push({
      id: partnerId,
      agency_name: 'Palmeraie Hunters SARL',
      contact_name: 'Sarah Lahlou',
      phone: '+212 6 65 44 33 22',
      status: 'actif',
      deleted_at: null,
    });

    setMockUser('ceo', CEO_USER_ID);
    const delRes = await deletePartnerAction(partnerId);
    expect(delRes.ok).toBe(true);

    const p = mockSupabase.db.partners.find((item: any) => item.id === partnerId);
    expect(p.deleted_at).toBeDefined();

    // Verify deletion audit log label is 'Partenaire Palmeraie Hunters SARL' and not 'Client'
    expect(deletionLogs).toHaveLength(1);
    const log = deletionLogs[0];
    expect(log.table).toBe('partners');
    expect(log.recordId).toBe(partnerId);
    expect(log.label).toBe('Partenaire Palmeraie Hunters SARL');
  });

  it('Guard enforcement: Block updates and double deletions on deleted partners (BUG-044)', async () => {
    const partnerId = '55555555-1111-2222-3333-444444444444';
    mockSupabase.db.partners.push({
      id: partnerId,
      agency_name: 'Agence Immobilière Berrada',
      contact_name: 'Tariq Berrada',
      phone: '+212 6 61 99 88 77',
      status: 'actif',
      deleted_at: '2026-09-10T12:00:00Z',
    });

    // 1. Attempt to update archived partner -> fails with archivé
    const updateRes = await updatePartnerAction(partnerId, {
      agency_name: 'Agence Immobilière Berrada',
      contact_name: 'Tariq Berrada',
      phone: '+212 6 61 99 88 77',
      status: 'actif',
      notes: 'Tente de modifier un partenaire archivé',
    });
    expect(updateRes.ok).toBe(false);
    expect((updateRes as any).error).toContain('archivé');

    // 2. Attempt to delete already deleted partner -> fails
    setMockUser('ceo', CEO_USER_ID);
    const delRes = await deletePartnerAction(partnerId);
    expect(delRes.ok).toBe(false);
    expect((delRes as any).error).toContain('déjà supprimé');
  });
});
