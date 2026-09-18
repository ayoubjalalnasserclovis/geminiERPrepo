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

vi.mock('@/lib/email/templates', () => ({
  sendWelcomePortal: vi.fn().mockResolvedValue(true),
  sendPortalInviteResend: vi.fn().mockResolvedValue(true),
}));

import {
  createClientAction,
  inviteClientAction,
  resendClientInviteAction,
  getClientDeletionImpactAction,
  deleteClientAction,
} from '@/app/(team)/clients/actions';

import {
  inviteTeamMemberAction,
  deactivateTeamMemberAction,
  reactivateTeamMemberAction,
  changeTeamMemberRoleAction,
} from '@/app/(team)/team/actions';

describe('Multi-Step Workflow: Client Onboarding & Team Lifecycle Orchestration', () => {
  const CEO_USER_ID = '11111111-1111-2222-3333-444444444444';

  beforeEach(() => {
    mockSupabase = createMockSupabase({
      clients: [],
      profiles: [{ id: CEO_USER_ID, role: 'ceo', full_name: 'CEO Stoniz', is_active: true }],
      projects: [],
      payments: [],
    });
    setMockUser('ceo', CEO_USER_ID);
  });

  it('Step 1 -> 4: Client creation with consent -> Portal invitation -> Profile linkage', async () => {
    // 1. Create client record
    const createRes = await createClientAction({
      full_name: 'Yasmine Kabbaj',
      email: 'yasmine.kabbaj@example.com',
      phone: '+212 6 61 88 99 00',
      nationality: 'Marocaine',
      residence_country: 'Maroc',
      source: 'recommandation',
    });

    expect(createRes.ok).toBe(true);
    if (!createRes.ok) return;
    const clientId = createRes.id;

    const client = mockSupabase.db.clients.find((c: any) => c.id === clientId);
    expect(client.consent_version).toBe('v1');
    expect(client.profile_id).toBeUndefined();

    // 2. Invite client to portal
    const inviteRes = await inviteClientAction(clientId);
    expect(inviteRes.ok).toBe(true);

    // Profile ID linked from auth admin inviteUserByEmail
    expect(client.profile_id).toBe('99999999-1111-2222-3333-444444444444');

    // 3. Double invitation attempt on already invited client is rejected
    const doubleInvite = await inviteClientAction(clientId);
    expect(doubleInvite.ok).toBe(false);
    expect((doubleInvite as any).error).toContain('déjà invité');
  });

  it('Portal invite resend: Valid when user has not signed in, blocked once authenticated', async () => {
    const clientId = '22222222-1111-2222-3333-444444444444';
    mockSupabase.db.clients.push({
      id: clientId,
      full_name: 'Omar Bencherif',
      email: 'omar@example.com',
      profile_id: '99999999-1111-2222-3333-444444444444',
    });

    // 1. Resend invite before first sign in -> SUCCESS
    const resendRes = await resendClientInviteAction(clientId);
    expect(resendRes.ok).toBe(true);

    // 2. Client logs in (last_sign_in_at is set)
    mockSupabase.auth.admin.getUserById = vi.fn().mockResolvedValue({
      data: { user: { id: '99999999-1111-2222-3333-444444444444', email: 'omar@example.com', last_sign_in_at: '2026-09-18T10:00:00Z' } },
      error: null,
    });

    // 3. Resend invite after first sign in -> MUST BE REJECTED
    const blockedRes = await resendClientInviteAction(clientId);
    expect(blockedRes.ok).toBe(false);
    expect((blockedRes as any).error).toContain('déjà connecté');
  });

  it('Team member onboarding lifecycle: Invite -> Role modification -> Deactivate -> Reactivate', async () => {
    // 1. CEO invites new chef de projet
    const form = new FormData();
    form.append('email', 'new.chef@stoniz.co');
    form.append('full_name', 'Amine Chef');
    form.append('role', 'chef_projet');
    form.append('mfa_required', 'on');

    await inviteTeamMemberAction(form);

    let profile = mockSupabase.db.profiles.find((p: any) => p.email === 'new.chef@stoniz.co');
    expect(profile).toBeDefined();
    expect(profile.role).toBe('chef_projet');
    expect(profile.mfa_required).toBe(true);
    expect(profile.is_active).toBe(true);

    // 2. Change role (e.g. promoted to sourcing)
    const roleForm = new FormData();
    roleForm.append('profile_id', profile.id);
    roleForm.append('role', 'sourcing');

    await changeTeamMemberRoleAction(roleForm);
    profile = mockSupabase.db.profiles.find((p: any) => p.id === profile.id);
    expect(profile.role).toBe('sourcing');

    // 3. Deactivate team member (leaves company)
    await deactivateTeamMemberAction(profile.id);
    profile = mockSupabase.db.profiles.find((p: any) => p.id === profile.id);
    expect(profile.is_active).toBe(false);

    // 4. Reactivate team member
    await reactivateTeamMemberAction(profile.id);
    profile = mockSupabase.db.profiles.find((p: any) => p.id === profile.id);
    expect(profile.is_active).toBe(true);
  });

  it('Client deletion impact analysis and soft-deletion protection', async () => {
    const clientId = '33333333-1111-2222-3333-444444444444';
    mockSupabase.db.clients.push({
      id: clientId,
      full_name: 'Khadija Alami',
      email: 'khadija@example.com',
      deleted_at: null,
    });
    mockSupabase.db.projects.push(
      { id: 'prj-1', client_id: clientId, status: 'travaux', deleted_at: null },
      { id: 'prj-2', client_id: clientId, status: 'perdu', deleted_at: null },
    );

    // 1. Calculate deletion impact
    const impactRes = await getClientDeletionImpactAction(clientId);
    expect(impactRes.ok).toBe(true);
    if (!impactRes.ok || !('impact' in impactRes) || !impactRes.impact) return;
    expect(impactRes.impact.projects_total).toBe(2);
    expect(impactRes.impact.projects_actifs).toBe(1);

    // 2. Soft-delete client
    const delRes = await deleteClientAction(clientId);
    expect(delRes.ok).toBe(true);

    const client = mockSupabase.db.clients.find((c: any) => c.id === clientId);
    expect(client.deleted_at).toBeDefined();
  });
});
