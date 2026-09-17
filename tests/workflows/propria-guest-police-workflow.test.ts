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

const sentEmails: any[] = [];
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockImplementation(async (payload: any) => {
    sentEmails.push(payload);
    return { ok: true };
  }),
}));

vi.mock('@/lib/propria/police-records-pdf', () => ({
  renderFichePolicePdf: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 Mock PDF')),
}));

vi.mock('@/lib/propria/police-records-xlsx', () => ({
  renderRecapWeeklyXlsx: vi.fn().mockResolvedValue(Buffer.from('Mock XLSX')),
}));

import {
  createPoliceRecordAction,
  updatePoliceRecordAction,
  markRecordCompleteAction,
  markRecordSubmittedAction,
  markRecordArchivedAction,
  deletePoliceRecordAction,
  downloadPoliceRecordPdfAction,
} from '@/app/(team)/propria/fiches-police/actions';

describe('Multi-Step Workflow: Propria Guest Check-in -> Police Record -> Commissariat Submission -> Archive', () => {
  const PROPERTY_ID = 'aaaaaaaa-1111-2222-3333-444444444444';
  const UNIT_ID = 'bbbbbbbb-1111-2222-3333-444444444444';
  const RESERVATION_ID = 'cccccccc-1111-2222-3333-444444444444';
  const LISTING_ID = 'dddddddd-1111-2222-3333-444444444444';

  beforeEach(() => {
    sentEmails.length = 0;
    mockSupabase = createMockSupabase({
      properties: [
        {
          id: PROPERTY_ID,
          name: 'Résidence Palmier',
          address: 'Rue Palmier, Casablanca',
        },
      ],
      propria_units: [
        {
          id: UNIT_ID,
          property_id: PROPERTY_ID,
          unit_number: 'Appartement 4B',
        },
      ],
      hostaway_listings: [
        {
          id: LISTING_ID,
          propria_unit_id: UNIT_ID,
        },
      ],
      hostaway_reservations: [
        {
          id: RESERVATION_ID,
          hostaway_listing_db_id: LISTING_ID,
          guest_name: 'Jean Dupont',
          number_of_guests: 2,
          arrival_date: '2026-09-20',
          departure_date: '2026-09-25',
          deleted_at: null,
        },
      ],
      profiles: [
        {
          id: 'usr-ceo-1',
          email: 'ceo@stoniz.co',
          full_name: 'Ayoub CEO',
          role: 'ceo',
          is_active: true,
        },
        {
          id: 'usr-propria-1',
          email: 'terrain@stoniz.co',
          full_name: 'Amine Propria',
          role: 'propria',
          is_active: true,
        },
      ],
      propria_police_records: [],
      propria_audit_log: [],
      notifications: [],
    });
    setMockUser('propria', 'usr-propria-1');
  });

  it('executes guest booking to commissariat submission and checks completeness constraints', async () => {
    // Step 1: Create draft from Hostaway reservation
    const createRes = await createPoliceRecordAction({
      reservation_source: 'hostaway',
      reservation_source_id: RESERVATION_ID,
      data_source: 'hostaway_portal',
      // Partial details from initial booking
      head_last_name: 'Dupont',
      head_first_name: 'Jean',
      arrival_date_property: '2026-09-20',
      expected_departure_date: '2026-09-25',
    });

    expect(createRes.ok).toBe(true);
    const recordId = (createRes as any).id;
    const records = mockSupabase.db.propria_police_records;
    expect(records).toHaveLength(1);
    expect(records[0].status).toBe('draft');
    expect(records[0].head_last_name).toBe('Dupont');
    expect(records[0].head_first_name).toBe('Jean');
    expect(records[0].property_id).toBe(PROPERTY_ID);
    expect(records[0].propria_unit_id).toBe(UNIT_ID);

    // Step 2: Attempt to mark complete while required fields (CIN/passport, birth, nationality) are missing
    const earlyComplete = await markRecordCompleteAction(recordId);
    expect(earlyComplete.ok).toBe(false);
    expect((earlyComplete as any).error).toContain('Champs manquants');

    // Step 3: Attempt to submit draft directly to commissariat (must be blocked)
    const earlySubmit = await markRecordSubmittedAction(recordId);
    expect(earlySubmit.ok).toBe(false);
    expect((earlySubmit as any).error).toBe('La fiche doit être complète avant le dépôt.');

    // Step 4: Terrain staff collects guest passport details during check-in
    const updateRes = await updatePoliceRecordAction(recordId, {
      head_last_name: 'Dupont',
      head_first_name: 'Jean',
      head_gender: 'M',
      head_birth_date: '1988-05-14',
      head_birth_place: 'Paris, France',
      head_nationality: 'Française',
      head_profession: 'Consultant',
      head_id_type: 'passport',
      head_id_number: '21AB98765',
      head_id_issue_country: 'France',
      head_residence_country: 'France',
      head_residence_address: '15 rue de Rivoli, Paris',
      arrival_date_property: '2026-09-20',
      expected_departure_date: '2026-09-25',
      motif_sejour: 'tourisme',
      accompanying_persons: [
        {
          first_name: 'Sophie',
          last_name: 'Dupont',
          birth_date: '1990-08-22',
          nationality: 'Française',
          id_type: 'passport',
          id_number: '21AB98766',
          relation: 'conjoint',
        },
      ],
    });
    expect(updateRes.ok).toBe(true);

    // With all mandatory fields filled, status should automatically or via markRecordCompleteAction become 'complete'
    const completeRes = await markRecordCompleteAction(recordId);
    expect(completeRes.ok).toBe(true);
    expect(records[0].status).toBe('complete');

    // Step 5: Test BUG-029 fix: If someone edits a complete record and clears a mandatory field,
    // it must downgrade status to 'draft' and prevent commissariat submission
    const downgradeRes = await updatePoliceRecordAction(recordId, {
      head_birth_place: '', // Cleared mandatory field
    });
    expect(downgradeRes.ok).toBe(true);
    expect(records[0].status).toBe('draft');

    // Submitting must be blocked again
    const blockedSubmit = await markRecordSubmittedAction(recordId);
    expect(blockedSubmit.ok).toBe(false);
    expect((blockedSubmit as any).error).toBe('La fiche doit être complète avant le dépôt.');

    // Re-fill the missing field
    await updatePoliceRecordAction(recordId, {
      head_birth_place: 'Paris, France',
    });
    await markRecordCompleteAction(recordId);
    expect(records[0].status).toBe('complete');

    // Step 6: Submit to commissariat
    const submitRes = await markRecordSubmittedAction(recordId);
    expect(submitRes.ok).toBe(true);
    expect(records[0].status).toBe('submitted');
    expect(records[0].submitted_at).toBeTruthy();
    expect(records[0].submitted_by).toBe('usr-propria-1');

    // Verify CEO notification email was sent
    expect(sentEmails.some(e => e.template_id === 'fiche_police_submitted')).toBe(true);

    // Step 7: Verify locked state - Non-CEO cannot edit or delete submitted record
    const lockedEdit = await updatePoliceRecordAction(recordId, {
      notes: 'Tentative modification terrain après dépôt',
    });
    expect(lockedEdit.ok).toBe(false);
    expect((lockedEdit as any).error).toContain('Fiche verrouillée');

    // Step 8: PDF Download
    const pdfRes = await downloadPoliceRecordPdfAction(recordId);
    expect(pdfRes.ok).toBe(true);
    expect((pdfRes as any).pdfBase64).toBeTruthy();
    expect((pdfRes as any).filename).toContain('fiche-police-FP-');

    // Step 9: CEO archives record
    setMockUser('ceo', 'usr-ceo-1');
    const archiveRes = await markRecordArchivedAction(recordId);
    expect(archiveRes.ok).toBe(true);
    expect(records[0].status).toBe('archived');

    // Step 10: CEO soft-deletes record
    const deleteRes = await deletePoliceRecordAction(recordId);
    expect(deleteRes.ok).toBe(true);
    expect(records[0].deleted_at).toBeTruthy();
  });
});
