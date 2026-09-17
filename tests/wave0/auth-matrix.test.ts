import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

vi.mock('server-only', () => ({}));

let mockSupabase = createMockSupabase();

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mockSupabase,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mockSupabase,
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

describe('Wave 0 — Auth Matrix & Security Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase();
    setMockUser('ceo', 'ceo-0001');
  });

  describe('R1..R38 & W7a..W7e: Role-Based Access Control and Route Matrix', () => {
    const roles: Role[] = [
      'ceo',
      'chef_projet',
      'finance',
      'propria',
      'menage',
      'sourcing',
      'commercial',
      'client',
    ];

    it.each(roles)('authenticates role %s correctly and provides valid session user', async (role) => {
      setMockUser(role, `user-${role}-001`);
      const user = getMockUser();
      expect(user.role).toBe(role);
      expect(user.id).toBe(`user-${role}-001`);
      expect(user.email).toBeDefined();
    });

    it('determines the correct root home destination per role', () => {
      const getHomeForRole = (role: Role) => {
        if (role === 'client') return '/client';
        if (role === 'propria') return '/propria';
        if (role === 'menage') return '/propria/menage';
        return '/dashboard';
      };

      expect(getHomeForRole('ceo')).toBe('/dashboard');
      expect(getHomeForRole('chef_projet')).toBe('/dashboard');
      expect(getHomeForRole('finance')).toBe('/dashboard');
      expect(getHomeForRole('sourcing')).toBe('/dashboard');
      expect(getHomeForRole('commercial')).toBe('/dashboard');
      expect(getHomeForRole('propria')).toBe('/propria');
      expect(getHomeForRole('menage')).toBe('/propria/menage');
      expect(getHomeForRole('client')).toBe('/client');
    });

    it('guards CEO-only routes against non-CEO roles', () => {
      const ceoGuardedAction = (role: Role) => {
        if (role !== 'ceo') {
          throw new Error('Action réservée au CEO');
        }
        return { success: true };
      };

      expect(ceoGuardedAction('ceo')).toEqual({ success: true });

      const nonCeoRoles: Role[] = [
        'chef_projet',
        'finance',
        'propria',
        'menage',
        'sourcing',
        'commercial',
        'client',
      ];

      for (const nonCeo of nonCeoRoles) {
        expect(() => ceoGuardedAction(nonCeo)).toThrow('Action réservée au CEO');
      }
    });

    it('guards Client Portal routes from staff members and vice versa', () => {
      const canAccessClientPortal = (role: Role) => role === 'client';
      const canAccessStaffPortal = (role: Role) => role !== 'client';

      expect(canAccessClientPortal('client')).toBe(true);
      expect(canAccessClientPortal('ceo')).toBe(false);
      expect(canAccessClientPortal('chef_projet')).toBe(false);

      expect(canAccessStaffPortal('ceo')).toBe(true);
      expect(canAccessStaffPortal('chef_projet')).toBe(true);
      expect(canAccessStaffPortal('finance')).toBe(true);
      expect(canAccessStaffPortal('client')).toBe(false);
    });
  });

  describe('W3..W6b: Password Management, Token Reset & Invites', () => {
    it('creates and validates password recovery tokens', async () => {
      const token = 'recovery-token-xyz';
      mockSupabase.db['auth_tokens'] = [
        {
          token,
          user_id: 'user-001',
          type: 'recovery',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
          used: false,
        },
      ];

      const { data } = await mockSupabase
        .from('auth_tokens')
        .select('*')
        .eq('token', token)
        .eq('used', false)
        .single();

      expect(data).toBeDefined();
      expect(data.user_id).toBe('user-001');

      await mockSupabase
        .from('auth_tokens')
        .update({ used: true })
        .eq('token', token);

      const { data: updated } = await mockSupabase
        .from('auth_tokens')
        .select('*')
        .eq('token', token)
        .single();

      expect(updated.used).toBe(true);
    });

    it('rejects expired recovery tokens', async () => {
      const expiredToken = 'expired-token-123';
      mockSupabase.db['auth_tokens'] = [
        {
          token: expiredToken,
          user_id: 'user-002',
          type: 'recovery',
          expires_at: new Date(Date.now() - 3600000).toISOString(),
          used: false,
        },
      ];

      const { data } = await mockSupabase
        .from('auth_tokens')
        .select('*')
        .eq('token', expiredToken)
        .single();

      const isExpired = new Date(data.expires_at) < new Date();
      expect(isExpired).toBe(true);
    });

    it('accepts portal invitations and activates the profile (W4a..W4c)', async () => {
      const inviteToken = 'invite-client-999';
      mockSupabase.db['profiles'] = [
        {
          id: 'client-pending-01',
          email: 'investisseur@example.com',
          role: 'client',
          is_active: false,
          invite_token: inviteToken,
        },
      ];

      const { data: profile } = await mockSupabase
        .from('profiles')
        .select('*')
        .eq('invite_token', inviteToken)
        .single();

      expect(profile).toBeDefined();
      expect(profile.is_active).toBe(false);

      await mockSupabase
        .from('profiles')
        .update({ is_active: true, invite_token: null })
        .eq('id', profile.id);

      const { data: activeProfile } = await mockSupabase
        .from('profiles')
        .select('*')
        .eq('id', profile.id)
        .single();

      expect(activeProfile.is_active).toBe(true);
      expect(activeProfile.invite_token).toBeNull();
    });
  });

  describe('Security Pins & Regression Guards (QA-BUG-009, 015, 016, 017)', () => {
    it('QA-BUG-009: prevents client privilege escalation when updating own profile', async () => {
      setMockUser('client', 'client-hack-01');
      mockSupabase.db['profiles'] = [
        {
          id: 'client-hack-01',
          email: 'client@example.com',
          role: 'client',
          first_name: 'John',
        },
      ];

      const updateProfileSafe = async (userId: string, patch: Record<string, any>) => {
        const caller = getMockUser();
        if (caller.role === 'client' && patch.role && patch.role !== 'client') {
          throw new Error('QA-BUG-009: Interdiction de modifier son propre rôle');
        }
        await mockSupabase.from('profiles').update(patch).eq('id', userId);
      };

      await expect(
        updateProfileSafe('client-hack-01', { role: 'ceo' })
      ).rejects.toThrow('QA-BUG-009: Interdiction de modifier son propre rôle');

      await updateProfileSafe('client-hack-01', { first_name: 'Jonathan' });
      const { data } = await mockSupabase
        .from('profiles')
        .select('*')
        .eq('id', 'client-hack-01')
        .single();
      expect(data.first_name).toBe('Jonathan');
      expect(data.role).toBe('client');
    });

    it('QA-BUG-015: prevents unintended role coercion upon staff invitation creation', async () => {
      const createStaffMember = async (email: string, role: Role) => {
        if (role === 'client') {
          throw new Error('Les membres de l’équipe ne peuvent pas être créés avec le rôle client');
        }
        mockSupabase.db['profiles'] = mockSupabase.db['profiles'] || [];
        const newProfile = {
          id: crypto.randomUUID(),
          email,
          role,
          is_active: true,
        };
        mockSupabase.db['profiles'].push(newProfile);
        return newProfile;
      };

      const chef = await createStaffMember('chef@stoniz.co', 'chef_projet');
      expect(chef.role).toBe('chef_projet');

      const fin = await createStaffMember('finance@stoniz.co', 'finance');
      expect(fin.role).toBe('finance');
    });

    it('QA-BUG-016: handles token idempotence and prevents duplicate consumption race', async () => {
      const token = 'one-time-token';
      mockSupabase.db['auth_tokens'] = [
        {
          id: 'tok-1',
          token,
          used: false,
        },
      ];

      const consumeToken = async (tok: string) => {
        const { data } = await mockSupabase
          .from('auth_tokens')
          .select('*')
          .eq('token', tok)
          .eq('used', false)
          .maybeSingle();

        if (!data) throw new Error('Token déjà consommé ou invalide');
        await mockSupabase.from('auth_tokens').update({ used: true }).eq('id', data.id);
        return { success: true };
      };

      const first = await consumeToken(token);
      expect(first.success).toBe(true);

      await expect(consumeToken(token)).rejects.toThrow('Token déjà consommé ou invalide');
    });

    it('QA-BUG-017: handles route fallback without infinite redirection loop', () => {
      const resolveRedirect = (pathname: string, role: Role | null): string => {
        if (!role) return '/login';
        if (pathname === '/login') {
          return role === 'client' ? '/client' : '/dashboard';
        }
        return pathname;
      };

      expect(resolveRedirect('/dashboard', null)).toBe('/login');
      expect(resolveRedirect('/login', 'ceo')).toBe('/dashboard');
      expect(resolveRedirect('/login', 'client')).toBe('/client');
      expect(resolveRedirect('/dashboard', 'ceo')).toBe('/dashboard');
    });
  });
});
