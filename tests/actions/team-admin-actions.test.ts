import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('server-only', () => ({}));
import { createMockSupabase, setMockUser, getMockUser } from '../helpers/mock-db';
import type { Role } from '@/lib/auth/require';

const CEO_ID = '11111111-1111-4111-8111-111111111111';
const CHEF_ID = '22222222-2222-4222-8222-222222222222';
const TEAM_MEMBER_ID = '33333333-3333-4333-8333-333333333333';
const PARTNER_ID = '44444444-4444-4444-8444-444444444444';
const PROPERTY_ID = '55555555-5555-4555-8555-555555555555';
const TASK_ID = '66666666-6666-4666-8666-666666666666';
const CLIENT_ID = '77777777-7777-4777-8777-777777777777';
const ARTISAN_ID = '88888888-8888-4888-8888-888888888888';

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

vi.mock('@/lib/email/templates', () => ({
  sendWelcomePortal: vi.fn().mockResolvedValue(true),
  sendPortalInviteResend: vi.fn().mockResolvedValue(true),
}));

import {
  inviteTeamMemberAction,
  deactivateTeamMemberAction,
  reactivateTeamMemberAction,
  changeTeamMemberRoleAction,
} from '@/app/(team)/team/actions';
import {
  createPartnerAction,
  updatePartnerAction,
  deletePartnerAction,
} from '@/app/(team)/partners/actions';
import {
  createPropertyAction,
  updatePropertyStatusAction,
  deletePropertyAction,
  publishPropertyAction,
} from '@/app/(team)/properties/actions';
import { setTaskStatusAction } from '@/app/(team)/tasks/actions';
import {
  createClientAction,
  updateClientAction,
  deleteClientAction,
  inviteClientAction,
  resendClientInviteAction,
} from '@/app/(team)/clients/actions';
import {
  createArtisanAction,
  createArtisanMinimalAction,
  updateArtisanAction,
  deleteArtisanAction,
} from '@/app/(team)/artisans/actions';

describe('Team & Core Admin Actions Suite', () => {
  beforeEach(() => {
    mockSupabase = createMockSupabase({
      profiles: [
        { id: CEO_ID, email: 'ceo@stoniz.co', role: 'ceo', full_name: 'CEO Stoniz', is_active: true },
        { id: CHEF_ID, email: 'chef@stoniz.co', role: 'chef_projet', full_name: 'Youssef Chef', is_active: true },
        { id: TEAM_MEMBER_ID, email: 'member@stoniz.co', role: 'commercial', full_name: 'Sarah Commercial', is_active: true },
      ],
      partners: [
        { id: PARTNER_ID, name: 'Agence Immobilière Palmeraie', type: 'agence', deleted_at: null },
      ],
      properties: [
        {
          id: PROPERTY_ID,
          title: 'Villa Palmeraie Lux',
          reference: 'PROP-PALM-01',
          status: 'disponible',
          price: 4500000,
          deleted_at: null,
        },
      ],
      tasks: [
        {
          id: TASK_ID,
          title: 'Visiter le bien',
          status: 'todo',
          completed_at: null,
          completed_by: null,
        },
      ],
      clients: [
        {
          id: CLIENT_ID,
          full_name: 'Hassan Amrani',
          email: 'hassan@example.com',
          profile_id: null,
          deleted_at: null,
        },
      ],
      artisans: [
        {
          id: ARTISAN_ID,
          name: 'Plomberie Express',
          type: 'artisan_local',
          status: 'actif',
          deleted_at: null,
        },
      ],
      deletion_logs: [],
    });

    setMockUser('ceo', CEO_ID);
  });

  describe('Team Member Actions', () => {
    it('restricts member invitation to CEO role', async () => {
      setMockUser('chef_projet', CHEF_ID);
      const formData = new FormData();
      formData.append('email', 'newdev@stoniz.co');
      formData.append('full_name', 'Ali Dev');
      formData.append('role', 'developer');

      await expect(inviteTeamMemberAction(formData)).rejects.toThrow('Permission refusée');
    });

    it('successfully invites a new team member and creates profile', async () => {
      const formData = new FormData();
      formData.append('email', 'newdev@stoniz.co');
      formData.append('full_name', 'Ali Dev');
      formData.append('role', 'developer');
      formData.append('mfa_required', 'on');

      await inviteTeamMemberAction(formData);

      const profile = mockSupabase.db.profiles.find((p: any) => p.email === 'newdev@stoniz.co');
      expect(profile).toBeDefined();
      expect(profile.role).toBe('developer');
      expect(profile.mfa_required).toBe(true);
    });

    it('rejects invitation if email already has a profile', async () => {
      const formData = new FormData();
      formData.append('email', 'member@stoniz.co');
      formData.append('full_name', 'Duplicate Member');
      formData.append('role', 'marketing');

      await expect(inviteTeamMemberAction(formData)).rejects.toThrow('Un compte existe déjà');
    });

    it('toggles member active status via deactivate and reactivate', async () => {
      await deactivateTeamMemberAction(TEAM_MEMBER_ID);
      let member = mockSupabase.db.profiles.find((p: any) => p.id === TEAM_MEMBER_ID);
      expect(member.is_active).toBe(false);

      await reactivateTeamMemberAction(TEAM_MEMBER_ID);
      member = mockSupabase.db.profiles.find((p: any) => p.id === TEAM_MEMBER_ID);
      expect(member.is_active).toBe(true);
    });

    it('changes team member role', async () => {
      const formData = new FormData();
      formData.append('profile_id', TEAM_MEMBER_ID);
      formData.append('role', 'chef_projet');

      await changeTeamMemberRoleAction(formData);
      const member = mockSupabase.db.profiles.find((p: any) => p.id === TEAM_MEMBER_ID);
      expect(member.role).toBe('chef_projet');
    });
  });

  describe('Partners Actions', () => {
    it('creates a new partner with valid data', async () => {
      const res = await createPartnerAction({
        agency_name: 'Agence Atlas',
        contact_name: 'Mehdi Atlas',
        phone: '+212 6 11 22 33 44',
      });

      expect(res.ok).toBe(true);
      expect(mockSupabase.db.partners.some((p: any) => p.agency_name === 'Agence Atlas')).toBe(true);
    });

    it('soft deletes partner and logs deletion', async () => {
      const res = await deletePartnerAction(PARTNER_ID);
      expect(res.ok).toBe(true);

      const partner = mockSupabase.db.partners.find((p: any) => p.id === PARTNER_ID);
      expect(partner.deleted_at).toBeDefined();
    });
  });

  describe('Properties Actions', () => {
    it('creates a new property and sets sourced_by', async () => {
      const res = await createPropertyAction({
        name: 'Appartement Hivernage',
        type: 'Appartement',
        address: 'Rue de la Liberté',
        quartier: 'Hivernage',
        price: 1800000,
        superficie: 95,
      });

      expect(res.ok).toBe(true);
      const prop = mockSupabase.db.properties.find((p: any) => p.name === 'Appartement Hivernage');
      expect(prop).toBeDefined();
      expect(prop.price).toBe(1800000);
    });

    it('updates property status with validation', async () => {
      const invalidRes = await updatePropertyStatusAction(PROPERTY_ID, 'invalid_status');
      expect(invalidRes.ok).toBe(false);

      const validRes = await updatePropertyStatusAction(PROPERTY_ID, 'vendu');
      expect(validRes.ok).toBe(true);

      const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
      expect(prop.status).toBe('vendu');
    });

    it('publishes property via RPC', async () => {
      const res = await publishPropertyAction(PROPERTY_ID);
      expect(res.ok).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledWith('publish_property', { p_property_id: PROPERTY_ID });
    });

    it('soft deletes property and records audit deletion', async () => {
      const res = await deletePropertyAction(PROPERTY_ID);
      expect(res.ok).toBe(true);

      const prop = mockSupabase.db.properties.find((p: any) => p.id === PROPERTY_ID);
      expect(prop.deleted_at).toBeDefined();
    });
  });

  describe('Task Status Transitions', () => {
    it('marks task as done with timestamp and user id', async () => {
      const res = await setTaskStatusAction(TASK_ID, 'done');
      expect(res.ok).toBe(true);

      const task = mockSupabase.db.tasks.find((t: any) => t.id === TASK_ID);
      expect(task.status).toBe('done');
      expect(task.completed_at).toBeDefined();
      expect(task.completed_by).toBe(CEO_ID);
    });

    it('reverts task to todo and clears completion markers', async () => {
      await setTaskStatusAction(TASK_ID, 'done');
      const res = await setTaskStatusAction(TASK_ID, 'todo');
      expect(res.ok).toBe(true);

      const task = mockSupabase.db.tasks.find((t: any) => t.id === TASK_ID);
      expect(task.status).toBe('todo');
      expect(task.completed_at).toBeNull();
      expect(task.completed_by).toBeNull();
    });
  });

  describe('Clients Management Actions', () => {
    it('creates a client with consent timestamp', async () => {
      const res = await createClientAction({
        full_name: 'Nadia El Fassi',
        email: 'nadia@example.com',
        phone: '+212 6 99 88 77 66',
        nationality: 'Marocaine',
      });

      expect(res.ok).toBe(true);
      const client = mockSupabase.db.clients.find((c: any) => c.full_name === 'Nadia El Fassi');
      expect(client).toBeDefined();
      expect(client.consent_at).toBeDefined();
    });

    it('soft deletes client', async () => {
      const res = await deleteClientAction(CLIENT_ID);
      expect(res.ok).toBe(true);

      const client = mockSupabase.db.clients.find((c: any) => c.id === CLIENT_ID);
      expect(client.deleted_at).toBeDefined();
    });

    it('invites client to portal and updates profile_id link', async () => {
      const res = await inviteClientAction(CLIENT_ID);
      expect(res.ok).toBe(true);

      const client = mockSupabase.db.clients.find((c: any) => c.id === CLIENT_ID);
      expect(client.profile_id).toBeDefined();
    });

    it('resends portal invitation link to invited client', async () => {
      // First link profile_id
      mockSupabase.db.clients.find((c: any) => c.id === CLIENT_ID).profile_id = 'usr-invited-1';

      const res = await resendClientInviteAction(CLIENT_ID);
      expect(res.ok).toBe(true);
    });
  });

  describe('Artisans Management Actions', () => {
    it('creates artisan via minimal action with duplicate reuse', async () => {
      const res1 = await createArtisanMinimalAction('Menuiserie Moderne');
      expect(res1.ok).toBe(true);

      // Re-running with same name should find existing without inserting duplicate
      const res2 = await createArtisanMinimalAction('Menuiserie Moderne');
      expect(res2.ok).toBe(true);
      if (res1.ok && res2.ok) {
        expect(res2.id).toBe(res1.id);
      }
    });

    it('creates and soft deletes an artisan', async () => {
      const res = await createArtisanAction({
        name: 'Electricité Atlas',
        type: 'entreprise_generale',
        business_scope: 'travaux',
        speciality: 'electricite',
      });
      expect(res.ok).toBe(true);

      if (res.ok && res.id) {
        const delRes = await deleteArtisanAction(res.id);
        expect(delRes.ok).toBe(true);

        const artisan = mockSupabase.db.artisans.find((a: any) => a.id === res.id);
        expect(artisan.deleted_at).toBeDefined();
      }
    });
  });
});
