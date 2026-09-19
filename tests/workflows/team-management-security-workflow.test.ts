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

import {
  inviteTeamMemberAction,
  deactivateTeamMemberAction,
  reactivateTeamMemberAction,
  changeTeamMemberRoleAction,
} from '@/app/(team)/team/actions';

describe('Multi-Step Workflow: Team Lifecycle, Security Access & Role Delegation', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const CHEF_ID = '22222222-1111-2222-3333-444444444444';
  const FINANCE_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const MEMBER_ID = 'aaaa1111-0000-0000-0000-000000000001';

  beforeEach(() => {
    mockSupabase = createMockSupabase();

    mockSupabase.db.profiles = [
      {
        id: CEO_ID,
        email: 'clovis@stoniz.co',
        full_name: 'Clovis CEO',
        role: 'ceo',
        is_active: true,
      },
      {
        id: MEMBER_ID,
        email: 'karim@stoniz.co',
        full_name: 'Karim Alami',
        role: 'chef_projet',
        is_active: true,
        mfa_required: false,
      },
    ];

    // Mock auth admin methods
    mockSupabase.auth.admin.inviteUserByEmail = vi.fn().mockImplementation(async (email: string, options: any) => {
      const newId = 'user-' + crypto.randomUUID().slice(0, 8);
      return {
        data: {
          user: {
            id: newId,
            email,
            user_metadata: options?.data ?? {},
          },
        },
        error: null,
      };
    });

    mockSupabase.auth.admin.deleteUser = vi.fn().mockResolvedValue({ data: {}, error: null });
  });

  it('Step 1: CEO invites new collaborator with role and mandatory MFA', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('email', 'nouvel.agent@stoniz.co');
    fd.append('full_name', 'Samir Tazi');
    fd.append('role', 'sourcing');
    fd.append('mfa_required', 'on');

    await inviteTeamMemberAction(fd);

    expect(mockSupabase.auth.admin.inviteUserByEmail).toHaveBeenCalledWith(
      'nouvel.agent@stoniz.co',
      expect.objectContaining({
        data: { full_name: 'Samir Tazi', role: 'sourcing' },
      }),
    );

    const profile = mockSupabase.db.profiles.find((p: any) => p.email === 'nouvel.agent@stoniz.co');
    expect(profile).toBeTruthy();
    expect(profile.role).toBe('sourcing');
    expect(profile.mfa_required).toBe(true);
    expect(profile.is_active).toBe(true);
  });

  it('Step 2: Inviting duplicate email is safely rejected with clear error message', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('email', 'karim@stoniz.co');
    fd.append('full_name', 'Karim Duplicate');
    fd.append('role', 'chef_projet');

    await expect(inviteTeamMemberAction(fd)).rejects.toThrow('Un compte existe déjà pour karim@stoniz.co');
  });

  it('Step 3: CEO changes team member role to propria', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('profile_id', MEMBER_ID);
    fd.append('role', 'propria');

    await changeTeamMemberRoleAction(fd);

    const profile = mockSupabase.db.profiles.find((p: any) => p.id === MEMBER_ID);
    expect(profile.role).toBe('propria');
  });

  it('Step 4: CEO promotes team member to finance role', async () => {
    setMockUser('ceo', CEO_ID);

    const fd = new FormData();
    fd.append('profile_id', MEMBER_ID);
    fd.append('role', 'finance');

    await changeTeamMemberRoleAction(fd);

    const profile = mockSupabase.db.profiles.find((p: any) => p.id === MEMBER_ID);
    expect(profile.role).toBe('finance');
  });

  it('Step 5: CEO deactivates collaborator preventing subsequent platform access', async () => {
    setMockUser('ceo', CEO_ID);

    await deactivateTeamMemberAction(MEMBER_ID);

    const profile = mockSupabase.db.profiles.find((p: any) => p.id === MEMBER_ID);
    expect(profile.is_active).toBe(false);
  });

  it('Step 6: CEO reactivates previously deactivated collaborator restoring access', async () => {
    mockSupabase.db.profiles.find((p: any) => p.id === MEMBER_ID).is_active = false;

    setMockUser('ceo', CEO_ID);

    await reactivateTeamMemberAction(MEMBER_ID);

    const profile = mockSupabase.db.profiles.find((p: any) => p.id === MEMBER_ID);
    expect(profile.is_active).toBe(true);
  });

  it('Step 7: Security: Chef de projet and finance cannot invite team members', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const fd = new FormData();
    fd.append('email', 'hacker@stoniz.co');
    fd.append('full_name', 'Hacker Test');
    fd.append('role', 'developer');

    await expect(inviteTeamMemberAction(fd)).rejects.toThrow('Permission refusée');

    setMockUser('finance', FINANCE_ID);
    await expect(inviteTeamMemberAction(fd)).rejects.toThrow('Permission refusée');
  });

  it('Step 8: Security: Non-CEO cannot deactivate team members', async () => {
    setMockUser('finance', FINANCE_ID);
    await expect(deactivateTeamMemberAction(MEMBER_ID)).rejects.toThrow('Permission refusée');

    setMockUser('client', CLIENT_ID);
    await expect(deactivateTeamMemberAction(MEMBER_ID)).rejects.toThrow('Permission refusée');
  });

  it('Step 9: Security: Non-CEO cannot change user roles', async () => {
    setMockUser('chef_projet', CHEF_ID);

    const fd = new FormData();
    fd.append('profile_id', MEMBER_ID);
    fd.append('role', 'ceo');

    await expect(changeTeamMemberRoleAction(fd)).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Validation guards: malformed email or client role invitation are rejected', async () => {
    setMockUser('ceo', CEO_ID);

    // Malformed email
    const fdEmail = new FormData();
    fdEmail.append('email', 'not-an-email');
    fdEmail.append('full_name', 'Invalid Email');
    fdEmail.append('role', 'chef_projet');
    await expect(inviteTeamMemberAction(fdEmail)).rejects.toThrow();

    // Client role cannot be assigned via team invitation
    const fdClient = new FormData();
    fdClient.append('email', 'client@outside.co');
    fdClient.append('full_name', 'Client Member');
    fdClient.append('role', 'client' as any);
    await expect(inviteTeamMemberAction(fdClient)).rejects.toThrow();
  });
});
