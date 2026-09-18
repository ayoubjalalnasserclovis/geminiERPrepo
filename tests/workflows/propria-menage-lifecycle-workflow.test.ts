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

vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
}));

import {
  createCleaningAction,
  startCleaningAction,
  recordCleaningProofAction,
  submitCleaningForValidationAction,
  refuseCleaningAction,
  validateCleaningAction,
  reopenCleaningAction,
  reportCleaningIncidentAction,
  acknowledgeCleaningIncidentAction,
  declineCleaningIncidentAction,
  cancelCleaningAction,
} from '@/app/(team)/propria/menage/actions';

describe('Multi-Step Workflow: Propria Menage Cleaning Lifecycle & Quality Gates', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';
  const MENAGE_USER_ID = '22222222-1111-2222-3333-444444444444';
  const UNIT_ID = '33333333-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      propria_units: [{ id: UNIT_ID, name: 'Appartement Majorelle' }],
      propria_cleanings: [],
      propria_cleaning_proofs: [],
      propria_cleaning_activity: [],
      propria_cleaning_incidents: [],
      profiles: [
        { id: CEO_USER_ID, email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
        { id: MENAGE_USER_ID, email: 'menage@stoniz.co', role: 'menage', full_name: 'Fatima Menage', is_active: true },
      ],
    });
    setMockUser('ceo', CEO_USER_ID);
  });

  it('Step 1 -> 6: Full cleaning progression from assignment to validated closure', async () => {
    // 1. Back-office schedules a cleaning
    const form = new FormData();
    form.append('scope', `unit:${UNIT_ID}`);
    form.append('occurred_at', '2026-09-18');
    form.append('urgency', 'normale');
    form.append('assigned_to_id', MENAGE_USER_ID);
    form.append('description', 'Ménage de sortie voyageurs départ 11h');

    await createCleaningAction(form);
    const cleanings = mockSupabase.db.propria_cleanings;
    expect(cleanings).toHaveLength(1);
    const cleaning = cleanings[0];
    expect(cleaning.status).toBe('a_traiter');
    expect(cleaning.assigned_to_id).toBe(MENAGE_USER_ID);

    // 2. Field cleaning staff starts cleaning
    setMockUser('menage', MENAGE_USER_ID);
    const startRes = await startCleaningAction(cleaning.id);
    expect(startRes.ok).toBe(true);

    let current = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaning.id);
    expect(current.status).toBe('en_cours');
    expect(current.started_at).toBeDefined();

    // 3. Attempting to submit without proof must fail gate
    const failSubmit = await submitCleaningForValidationAction(cleaning.id);
    expect(failSubmit.ok).toBe(false);
    expect((failSubmit as any).error).toContain('Déposez au moins une preuve');

    // 4. Staff uploads proof photo
    const proofRes = await recordCleaningProofAction({
      cleaningId: cleaning.id,
      storagePath: `cleanings/${cleaning.id}/photo-salon.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 154000,
      section: 'general',
    });
    expect(proofRes.ok).toBe(true);
    expect(mockSupabase.db.propria_cleaning_proofs).toHaveLength(1);

    // 5. Submit for validation now succeeds
    const submitRes = await submitCleaningForValidationAction(cleaning.id);
    expect(submitRes.ok).toBe(true);
    current = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaning.id);
    expect(current.status).toBe('a_valider');
    expect(current.submitted_at).toBeDefined();

    // 6. Back-office validates and closes cleaning
    setMockUser('ceo', CEO_USER_ID);
    const validateRes = await validateCleaningAction(cleaning.id);
    expect(validateRes.ok).toBe(true);
    current = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaning.id);
    expect(current.status).toBe('cloture');
    expect(current.validated_by).toBe(CEO_USER_ID);
    expect(current.closed_at).toBeDefined();
  });

  it('Refusal loop: back-office refuses cleaning with reason -> staff corrects and resubmits', async () => {
    // 1. Setup cleaning in a_valider state with proof
    const cleaningId = '44444444-1111-2222-3333-444444444444';
    mockSupabase.db.propria_cleanings.push({
      id: cleaningId,
      status: 'a_valider',
      assigned_to_id: MENAGE_USER_ID,
      created_by: CEO_USER_ID,
      refused_count: 0,
    });
    mockSupabase.db.propria_cleaning_proofs.push({
      id: 'proof-1',
      cleaning_id: cleaningId,
      storage_path: 'cleanings/test/1.jpg',
      mime_type: 'image/jpeg',
      size_bytes: 50000,
      uploaded_by: MENAGE_USER_ID,
      deleted_at: null,
    });

    // 2. Back-office inspects and refuses because towels were missing
    setMockUser('ceo', CEO_USER_ID);
    const refuseRes = await refuseCleaningAction(cleaningId, 'Serviettes de bain manquantes dans la salle de bain master');
    expect(refuseRes.ok).toBe(true);

    let cleaning = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaningId);
    expect(cleaning.status).toBe('refusee');
    expect(cleaning.refusal_reason).toContain('Serviettes');
    expect(cleaning.refused_count).toBe(1);

    // 3. Staff resumes cleaning
    setMockUser('menage', MENAGE_USER_ID);
    const startRes = await startCleaningAction(cleaningId);
    expect(startRes.ok).toBe(true);
    cleaning = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaningId);
    expect(cleaning.status).toBe('en_cours');

    // 4. Staff uploads additional proof of towels
    await recordCleaningProofAction({
      cleaningId,
      storagePath: `cleanings/${cleaningId}/photo-serviettes.jpg`,
      mimeType: 'image/jpeg',
      sizeBytes: 88000,
      section: 'checklist',
    });

    // 5. Staff resubmits
    const resubmitRes = await submitCleaningForValidationAction(cleaningId);
    expect(resubmitRes.ok).toBe(true);

    // 6. Back-office validates
    setMockUser('ceo', CEO_USER_ID);
    const valRes = await validateCleaningAction(cleaningId);
    expect(valRes.ok).toBe(true);
    cleaning = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaningId);
    expect(cleaning.status).toBe('cloture');
    expect(cleaning.refused_count).toBe(1);
  });

  it('Guard enforcement: locks closed cleanings and tests reopening mechanism (BUG-040)', async () => {
    const cleaningId = '55555555-1111-2222-3333-444444444444';
    mockSupabase.db.propria_cleanings.push({
      id: cleaningId,
      status: 'cloture',
      assigned_to_id: MENAGE_USER_ID,
      created_by: CEO_USER_ID,
      closed_at: new Date().toISOString(),
    });

    // 1. Staff attempts to restart closed cleaning -> BLOCKED
    setMockUser('menage', MENAGE_USER_ID);
    const startRes = await startCleaningAction(cleaningId);
    expect(startRes.ok).toBe(false);
    expect((startRes as any).error).toContain('clôturé ou annulé');

    // 2. Staff attempts to submit closed cleaning -> BLOCKED
    const submitRes = await submitCleaningForValidationAction(cleaningId);
    expect(submitRes.ok).toBe(false);
    expect((submitRes as any).error).toContain('clôturé ou annulé');

    // 3. Back-office reopens cleaning
    setMockUser('ceo', CEO_USER_ID);
    const reopenRes = await reopenCleaningAction(cleaningId);
    expect(reopenRes.ok).toBe(true);

    let cleaning = mockSupabase.db.propria_cleanings.find((c: any) => c.id === cleaningId);
    expect(cleaning.status).toBe('en_cours');
    expect(cleaning.closed_at).toBeNull();
  });

  it('Quality incident escalation: report incident with photo proof -> acknowledge or decline', async () => {
    const cleaningId = '66666666-1111-2222-3333-444444444444';
    mockSupabase.db.propria_cleanings.push({
      id: cleaningId,
      status: 'en_cours',
      assigned_to_id: MENAGE_USER_ID,
      created_by: CEO_USER_ID,
    });

    // 1. Staff reports incident (broken mirror) with required photo proof
    setMockUser('menage', MENAGE_USER_ID);
    const reportRes = await reportCleaningIncidentAction({
      cleaning_id: cleaningId,
      description: 'Miroir de la salle d eau fendu suite au depart du voyageur',
      severity: 'haute',
      proofs: [
        {
          storage_path: 'cleanings/incidents/mirror-broken.jpg',
          mime_type: 'image/jpeg',
          size_bytes: 120000,
        },
      ],
    });

    expect(reportRes.ok).toBe(true);
    if (!reportRes.ok) return;
    const incidentId = reportRes.id;
    expect(mockSupabase.db.propria_cleaning_incidents).toHaveLength(1);
    const incident = mockSupabase.db.propria_cleaning_incidents[0];
    expect(incident.status).toBe('reported');
    expect(incident.severity).toBe('haute');

    // 2. Back-office acknowledges the incident
    setMockUser('ceo', CEO_USER_ID);
    const ackRes = await acknowledgeCleaningIncidentAction(incidentId);
    expect(ackRes.ok).toBe(true);
    expect(mockSupabase.db.propria_cleaning_incidents[0].status).toBe('acknowledged');

    // 3. Decline incident with reason
    const declineRes = await declineCleaningIncidentAction(incidentId, 'Degat mineur deja repertorie sur precedent etat des lieux');
    expect(declineRes.ok).toBe(true);
    expect(mockSupabase.db.propria_cleaning_incidents[0].status).toBe('declined');
  });
});
