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
      if (name === 'x-forwarded-for') return '196.200.12.34';
      if (name === 'user-agent') return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0';
      return null;
    },
  }),
}));

const sentEmails: any[] = [];
vi.mock('@/lib/email/send', () => ({
  sendEmail: vi.fn().mockImplementation(async (payload: any) => {
    sentEmails.push(payload);
    return { ok: true };
  }),
}));

import {
  createVctAction,
  updateVctItemAction,
  createCorrectiveActionAction,
  setActionStatusAction,
  convertActionToInterventionAction,
  createReceptionPvAction,
  addPvReserveAction,
  resolvePvReserveAction,
  sendPvToClientAction,
  sendPvReminderToClientAction,
  clientSignPvAction,
} from '@/app/(team)/projects/[id]/reception/actions';

describe('Multi-Step Workflow: Reception VCT -> PV -> Reserves -> E-Signature -> Satisfaction Survey', () => {
  const PROJECT_ID = '11111111-2222-3333-4444-555555555555';
  const PROPERTY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const CLIENT_ID = 'cccccccc-1111-2222-3333-444444444444';
  const ARTISAN_ID = '99999999-8888-7777-6666-555555555555';

  beforeEach(() => {
    sentEmails.length = 0;
    mockSupabase = createMockSupabase({
      projects: [
        {
          id: PROJECT_ID,
          reference: 'PRJ-2026-CASABLANCA',
          property_id: PROPERTY_ID,
          client_id: CLIENT_ID,
          phase: 'livraison',
          status: 'actif',
        },
      ],
      clients: [
        {
          id: CLIENT_ID,
          full_name: 'Karim Bennani',
          email: 'karim.bennani@client.ma',
        },
      ],
      properties: [
        {
          id: PROPERTY_ID,
          name: 'Villa Gauthier Luxury',
          address: 'Boulevard d’Anfa, Casablanca',
        },
      ],
      artisans: [
        {
          id: ARTISAN_ID,
          name: 'Hassan Peinture & Finition',
          speciality: 'peinture',
        },
      ],
      project_reception_template_items: [
        { id: 'tpl-1', category: 'Electricité', name: 'Prises et interrupteurs fonctionnels', display_order: 1, is_active: true },
        { id: 'tpl-2', category: 'Plomberie', name: 'Absence de fuite sous vasque', display_order: 2, is_active: true },
        { id: 'tpl-3', category: 'Peinture', name: 'Raccord peinture mur salon', display_order: 3, is_active: true },
      ],
      project_vct: [],
      project_vct_items: [],
      project_vct_corrective_actions: [],
      project_reception_pvs: [],
      project_reception_pv_items: [],
      project_reception_pv_reserves: [],
      propria_interventions: [],
      satisfaction_surveys: [],
    });
    setMockUser('chef_projet', 'usr-chef-1');
  });

  it('executes full end-to-end multi-step reception workflow with state guards and e-signature', async () => {
    // Step 1: Chef de projet creates VCT
    await createVctAction(PROJECT_ID);

    const vcts = mockSupabase.db.project_vct;
    expect(vcts).toHaveLength(1);
    const vctId = vcts[0].id;
    expect(vcts[0].status).toBe('draft');

    // Items pre-populated from templates
    const vctItems = mockSupabase.db.project_vct_items;
    expect(vctItems).toHaveLength(3);

    // Step 2: Inspection - Mark items OK and minor defect
    const fdItem1 = new FormData();
    fdItem1.set('item_id', vctItems[0].id);
    fdItem1.set('vct_id', vctId);
    fdItem1.set('project_id', PROJECT_ID);
    fdItem1.set('status', 'ok');
    fdItem1.set('observations', 'Toutes les prises testées 220V');
    await updateVctItemAction(fdItem1);

    const fdItem2 = new FormData();
    fdItem2.set('item_id', vctItems[1].id);
    fdItem2.set('vct_id', vctId);
    fdItem2.set('project_id', PROJECT_ID);
    fdItem2.set('status', 'ok');
    await updateVctItemAction(fdItem2);

    const fdItem3 = new FormData();
    fdItem3.set('item_id', vctItems[2].id);
    fdItem3.set('vct_id', vctId);
    fdItem3.set('project_id', PROJECT_ID);
    fdItem3.set('status', 'defaut_mineur');
    fdItem3.set('observations', 'Traces de rouleau sur angle mur');
    await updateVctItemAction(fdItem3);

    // Step 3: Create corrective action for the defect
    const fdAction = new FormData();
    fdAction.set('vct_id', vctId);
    fdAction.set('project_id', PROJECT_ID);
    fdAction.set('vct_item_id', vctItems[2].id);
    fdAction.set('description', 'Reprendre angle mur salon avec sous-couche');
    fdAction.set('artisan_id', ARTISAN_ID);
    fdAction.set('responsible_role', 'artisan');
    fdAction.set('deadline', '2026-09-25');
    await createCorrectiveActionAction(fdAction);

    const actions = mockSupabase.db.project_vct_corrective_actions;
    expect(actions).toHaveLength(1);
    const actionId = actions[0].id;
    expect(actions[0].status).toBe('open');

    // VCT status should now be 'with_actions'
    expect(vcts[0].status).toBe('with_actions');

    // Step 4: Convert corrective action to Propria intervention
    await convertActionToInterventionAction(actionId, PROJECT_ID);
    expect(actions[0].intervention_id).toBeTruthy();
    const interventions = mockSupabase.db.propria_interventions;
    expect(interventions).toHaveLength(1);
    expect(interventions[0].type_label).toBe('Reprise VCT');

    // Verify BUG-028 fix: duplicate conversion must be blocked
    await expect(convertActionToInterventionAction(actionId, PROJECT_ID))
      .rejects.toThrow('Cette action corrective a déjà été convertie en intervention.');
    expect(mockSupabase.db.propria_interventions).toHaveLength(1);

    // Step 5: Artisan marks action resolved, chef validates
    await setActionStatusAction(actionId, PROJECT_ID, 'resolved');
    expect(actions[0].status).toBe('resolved');
    expect(actions[0].resolved_at).toBeTruthy();

    await setActionStatusAction(actionId, PROJECT_ID, 'verified');
    expect(actions[0].status).toBe('verified');
    expect(actions[0].verified_at).toBeTruthy();
    expect(vcts[0].status).toBe('validated');

    // Step 6: Create Reception PV (inherits items from VCT)
    await createReceptionPvAction(PROJECT_ID);
    const pvs = mockSupabase.db.project_reception_pvs;
    expect(pvs).toHaveLength(1);
    const pvId = pvs[0].id;
    expect(pvs[0].status).toBe('draft');

    const pvItems = mockSupabase.db.project_reception_pv_items;
    expect(pvItems).toHaveLength(3);
    // VCT 'ok' items are pre-checked 'ok' in PV
    expect(pvItems.filter((i: any) => i.status === 'ok')).toHaveLength(2);
    // VCT defect item inherits observations but status is null (pending check)
    const defectPvItem = pvItems.find((i: any) => i.vct_item_id === vctItems[2].id);
    expect(defectPvItem.status).toBeNull();
    expect(defectPvItem.observations).toBe('Traces de rouleau sur angle mur');

    // Step 7: Add contradictory reserves to PV
    const fdReserve = new FormData();
    fdReserve.set('pv_id', pvId);
    fdReserve.set('project_id', PROJECT_ID);
    fdReserve.set('pv_item_id', defectPvItem.id);
    fdReserve.set('description', 'Légère retouche plinthe entrée');
    fdReserve.set('responsible_role', 'artisan');
    fdReserve.set('artisan_id', ARTISAN_ID);
    await addPvReserveAction(fdReserve);

    const reserves = mockSupabase.db.project_reception_pv_reserves;
    expect(reserves).toHaveLength(1);
    expect(reserves[0].status).toBe('open');

    // Resolve reserve
    await resolvePvReserveAction(reserves[0].id, PROJECT_ID);
    expect(reserves[0].status).toBe('resolved');

    // Step 8: Verify BUG-028 fix: Attempting to sign draft PV directly must be rejected
    setMockUser('client', CLIENT_ID);
    const fdEarlySign = new FormData();
    fdEarlySign.set('pv_id', pvId);
    fdEarlySign.set('client_full_name', 'Karim Bennani');
    fdEarlySign.set('client_satisfaction_rating', '5');

    await expect(clientSignPvAction(fdEarlySign))
      .rejects.toThrow('Le PV doit être au statut "sent_to_client" pour pouvoir être signé.');

    // Step 9: Chef de projet sends PV to client
    setMockUser('chef_projet', 'usr-chef-1');
    await sendPvToClientAction(pvId, PROJECT_ID);
    expect(pvs[0].status).toBe('sent_to_client');
    expect(pvs[0].sent_to_client_at).toBeTruthy();
    expect(sentEmails.some(e => e.template_id === 'reception_pv_ready_for_signature')).toBe(true);

    // Step 10: Client electronically signs PV with IP, User-Agent, and rating
    setMockUser('client', CLIENT_ID);
    const fdSign = new FormData();
    fdSign.set('pv_id', pvId);
    fdSign.set('client_full_name', 'Karim Bennani');
    fdSign.set('client_satisfaction_rating', '5');
    await clientSignPvAction(fdSign);

    expect(pvs[0].status).toBe('validated');
    expect(pvs[0].client_signed_at).toBeTruthy();
    expect(pvs[0].client_signed_ip).toBe('196.200.12.34');
    expect(pvs[0].client_signed_user_agent).toContain('Mozilla/5.0');
    expect(pvs[0].client_satisfaction_rating).toBe(5);

    // Verify satisfaction survey was automatically created and invitation sent
    const surveys = mockSupabase.db.satisfaction_surveys;
    expect(surveys).toHaveLength(1);
    expect(surveys[0].project_id).toBe(PROJECT_ID);
    expect(surveys[0].client_id).toBe(CLIENT_ID);
    expect(surveys[0].trigger_phase).toBe('livraison');
    expect(sentEmails.some(e => e.template_id === 'satisfaction_survey_invitation')).toBe(true);

    // Step 11: Verify BUG-028 fix: Re-signing an already validated PV is blocked
    await expect(clientSignPvAction(fdSign))
      .rejects.toThrow('Le PV doit être au statut "sent_to_client" pour pouvoir être signé.');

    // Step 12: Verify BUG-028 fix: Sending an already validated PV cannot downgrade its status
    setMockUser('chef_projet', 'usr-chef-1');
    await expect(sendPvToClientAction(pvId, PROJECT_ID))
      .rejects.toThrow('Ce PV a déjà été validé et signé par le client.');
    expect(pvs[0].status).toBe('validated');
  });
});
