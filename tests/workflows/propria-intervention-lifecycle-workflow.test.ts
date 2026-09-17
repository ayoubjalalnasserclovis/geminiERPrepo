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

vi.mock('next/headers', () => ({
  headers: () => ({
    get: (name: string) => {
      if (name === 'x-forwarded-for') return '196.200.50.80';
      if (name === 'user-agent') return 'PropriaMobile/1.0';
      return null;
    },
  }),
}));

import {
  createInterventionAction,
  startInterventionAction,
  recordInterventionProofAction,
  submitForValidationAction,
  refuseInterventionAction,
  validateInterventionAction,
  reopenInterventionAction,
} from '@/app/(team)/propria/interventions/actions';

describe('Multi-Step Workflow: Propria Field Intervention Lifecycle -> Proof Gate -> Refusal/Validation -> Reopening', () => {
  const PROPERTY_ID = '11111111-3333-4444-5555-666666666666';
  const UNIT_ID = '22222222-3333-4444-5555-666666666666';
  const FIELD_USER_ID = '33333333-3333-4444-5555-666666666666';
  const CEO_USER_ID = '44444444-3333-4444-5555-666666666666';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      properties: [
        { id: PROPERTY_ID, name: 'Résidence Majorelle', address: 'Rue Yves Saint Laurent, Marrakech' },
      ],
      propria_units: [
        { id: UNIT_ID, property_id: PROPERTY_ID, unit_number: 'Suite Atlas' },
      ],
      profiles: [
        { id: CEO_USER_ID, email: 'ceo@stoniz.co', full_name: 'Ayoub CEO', role: 'ceo', is_active: true },
        { id: FIELD_USER_ID, email: 'terrain@stoniz.co', full_name: 'Omar Terrain', role: 'propria', is_active: true },
      ],
      propria_interventions: [],
      propria_intervention_proofs: [],
      propria_intervention_activity: [],
      notifications: [],
    });
    setMockUser('propria', FIELD_USER_ID);
  });

  it('navigates field intervention from creation to validation, enforcing proof requirement and status guards', async () => {
    // Step 1: Create an intervention assigned to terrain staff
    const fdCreate = new FormData();
    fdCreate.set('scope', `unit:${UNIT_ID}`);
    fdCreate.set('kind', 'intervention');
    fdCreate.set('description', 'Changement mitigeur douche fuite joint');
    fdCreate.set('occurred_at', '2026-09-17');
    fdCreate.set('urgency', 'haute');
    fdCreate.set('assigned_to_id', FIELD_USER_ID);

    await createInterventionAction(fdCreate);

    const interventions = mockSupabase.db.propria_interventions;
    expect(interventions).toHaveLength(1);
    const interventionId = interventions[0].id;
    expect(interventions[0].status).toBe('a_traiter');
    expect(interventions[0].property_id).toBeNull();
    expect(interventions[0].propria_unit_id).toBe(UNIT_ID);

    // Step 2: Field agent starts the intervention
    const startRes = await startInterventionAction(interventionId);
    expect(startRes.ok).toBe(true);
    expect(interventions[0].status).toBe('en_cours');
    expect(interventions[0].started_at).toBeTruthy();

    // Step 3: Attempt to submit for validation without proof (must be BLOCKED)
    const earlySubmit = await submitForValidationAction(interventionId);
    expect(earlySubmit.ok).toBe(false);
    expect((earlySubmit as any).error).toContain('Déposez au moins une preuve');
    expect(interventions[0].status).toBe('en_cours');

    // Step 4: Record intervention proof (photo of completed work)
    const proofRes = await recordInterventionProofAction({
      interventionId,
      storagePath: `${interventionId}/proof-mitigeur-repare.jpg`,
      fileType: 'image/jpeg',
      fileSize: 1024 * 500,
      caption: 'Nouveau mitigeur installé sans fuite',
    });
    expect(proofRes.ok).toBe(true);

    const proofs = mockSupabase.db.propria_intervention_proofs;
    expect(proofs).toHaveLength(1);
    expect(proofs[0].caption).toBe('Nouveau mitigeur installé sans fuite');

    // Step 5: Submit for validation (now succeeds with proof attached)
    const submitRes = await submitForValidationAction(interventionId);
    expect(submitRes.ok).toBe(true);
    expect(interventions[0].status).toBe('a_valider');
    expect(interventions[0].submitted_at).toBeTruthy();

    // Step 6: Back office reviews and refuses intervention (needs cleaner silicone joint)
    setMockUser('ceo', CEO_USER_ID);
    const refuseRes = await refuseInterventionAction(interventionId, 'Le joint silicone n’est pas lisse, à refaire proprement.');
    expect(refuseRes.ok).toBe(true);
    expect(interventions[0].status).toBe('refusee');
    expect(interventions[0].refused_count).toBe(1);
    expect(interventions[0].refusal_reason).toContain('joint silicone');

    // Step 7: Field agent restarts and re-submits
    setMockUser('propria', FIELD_USER_ID);
    await startInterventionAction(interventionId);
    expect(interventions[0].status).toBe('en_cours');

    await submitForValidationAction(interventionId);
    expect(interventions[0].status).toBe('a_valider');

    // Step 8: Back office approves and closes intervention
    setMockUser('ceo', CEO_USER_ID);
    const validateRes = await validateInterventionAction(interventionId);
    expect(validateRes.ok).toBe(true);
    expect(interventions[0].status).toBe('cloture');
    expect(interventions[0].validated_by).toBe(CEO_USER_ID);
    expect(interventions[0].closed_at).toBeTruthy();

    // Step 9: Test BUG-032 fix: Direct start on closed intervention is rejected
    setMockUser('propria', FIELD_USER_ID);
    const blockedStart = await startInterventionAction(interventionId);
    expect(blockedStart.ok).toBe(false);
    expect((blockedStart as any).error).toContain('Cette intervention est clôturée ou annulée. Utilisez la réouverture back-office si nécessaire.');

    // Step 10: Test BUG-032 fix: Direct submit on closed intervention is rejected
    const blockedSubmit = await submitForValidationAction(interventionId);
    expect(blockedSubmit.ok).toBe(false);
    expect((blockedSubmit as any).error).toContain('Cette intervention est clôturée ou annulée et ne peut pas être soumise pour validation.');

    // Step 11: Back office explicitly reopens intervention
    setMockUser('ceo', CEO_USER_ID);
    const reopenRes = await reopenInterventionAction(interventionId);
    expect(reopenRes.ok).toBe(true);
    expect(interventions[0].status).toBe('en_cours');
    expect(interventions[0].validated_by).toBeNull();
    expect(interventions[0].closed_at).toBeNull();
  });
});
