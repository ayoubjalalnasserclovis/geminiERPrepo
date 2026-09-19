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

const mockSendEmail = vi.fn().mockResolvedValue({ ok: true, id: 'email-123' });
vi.mock('@/lib/email/send', () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
}));

const mockResendSend = vi.fn().mockResolvedValue({ data: { id: 'resend-abc' }, error: null });
vi.mock('resend', () => {
  return {
    Resend: vi.fn().mockImplementation(() => ({
      emails: {
        send: mockResendSend,
      },
    })),
  };
});

import {
  sendTestEmailAction,
  resendQueuedEmailsAction,
} from '@/app/(team)/admin/emails/actions';

describe('Multi-Step Workflow: Admin Email Dispatcher, Healthcheck & Resend Engine', () => {
  const CEO_ID = '11111111-2222-3333-4444-555555555555';
  const DEV_ID = '22222222-1111-2222-3333-444444444444';
  const CHEF_ID = '33333333-1111-2222-3333-444444444444';
  const CLIENT_ID = '44444444-1111-2222-3333-444444444444';

  const EMAIL_1_ID = 'aaaa1111-0000-0000-0000-000000000001';
  const EMAIL_2_ID = 'bbbb2222-0000-0000-0000-000000000002';

  const originalEnv = process.env;

  beforeEach(() => {
    mockSupabase = createMockSupabase();
    mockSendEmail.mockClear();
    mockResendSend.mockClear();
    process.env = { ...originalEnv };

    mockSupabase.db.email_logs = [
      {
        id: EMAIL_1_ID,
        recipient_email: 'client1@example.com',
        template_id: 'client_onboarding',
        subject: 'Bienvenue sur votre portail Stoniz',
        payload: { title: 'Bienvenue', message: 'Votre compte est prêt' },
        status: 'queued',
        status_updated_at: new Date().toISOString(),
      },
      {
        id: EMAIL_2_ID,
        recipient_email: 'client2@example.com',
        template_id: 'survey_invite',
        subject: 'Votre avis compte',
        payload: { title: 'Sondage', message: 'Donnez votre avis' },
        status: 'queued',
        status_updated_at: new Date().toISOString(),
      },
    ];
  });

  it('Step 1: CEO sends healthcheck test email to confirm Resend delivery pipeline', async () => {
    setMockUser('ceo', CEO_ID);

    const res = await sendTestEmailAction();
    expect(res.ok).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        template_id: 'admin_healthcheck',
        subject: expect.stringContaining('[Healthcheck] Test envoi Stoniz'),
      }),
    );
  });

  it('Step 2: Developer sends healthcheck test email to specific target address', async () => {
    setMockUser('developer', DEV_ID);

    const res = await sendTestEmailAction('developer-qa@stoniz.co');
    expect(res.ok).toBe(true);
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'developer-qa@stoniz.co',
        template_id: 'admin_healthcheck',
      }),
    );
  });

  it('Step 3: Queued email recovery: dry run preview returns pending email count without executing', async () => {
    setMockUser('ceo', CEO_ID);

    const res = await resendQueuedEmailsAction({ dryRun: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.dryRun).toBe(true);
      expect(res.total).toBe(2);
      expect(res.sent).toBe(0);
    }
    expect(mockResendSend).not.toHaveBeenCalled();
  });

  it('Step 4: Resend execution without valid RESEND_API_KEY returns configuration error', async () => {
    delete process.env.RESEND_API_KEY;
    setMockUser('ceo', CEO_ID);

    const res = await resendQueuedEmailsAction({ dryRun: false });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain('RESEND_API_KEY');
    }
  });

  it('Step 5: CEO executes resend of queued emails: transitions status to sent and records resend_id', async () => {
    process.env.RESEND_API_KEY = 're_live_valid_test_key';
    setMockUser('ceo', CEO_ID);

    const res = await resendQueuedEmailsAction({ dryRun: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.sent).toBe(2);
      expect(res.failed).toBe(0);
    }

    const email1 = mockSupabase.db.email_logs.find((e: any) => e.id === EMAIL_1_ID);
    expect(email1.status).toBe('sent');
    expect(email1.resend_id).toBe('resend-abc');
  });

  it('Step 6: Audit metadata: verify resent_by and resent_at are stamped in payload', async () => {
    process.env.RESEND_API_KEY = 're_live_valid_test_key';
    setMockUser('ceo', CEO_ID);

    await resendQueuedEmailsAction({ dryRun: false });

    const email1 = mockSupabase.db.email_logs.find((e: any) => e.id === EMAIL_1_ID);
    expect(email1.payload.resent_by).toBe(CEO_ID);
    expect(email1.payload.resent_at).toBeTruthy();
  });

  it('Step 7: Resilience on Resend error: records failed status and persists error message', async () => {
    process.env.RESEND_API_KEY = 're_live_valid_test_key';
    mockResendSend.mockRejectedValueOnce(new Error('Rate limit exceeded from provider'));
    mockResendSend.mockResolvedValueOnce({ data: { id: 'resend-ok' }, error: null });

    setMockUser('ceo', CEO_ID);

    const res = await resendQueuedEmailsAction({ dryRun: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.failed).toBe(1);
      expect(res.sent).toBe(1);
      expect(res.errors?.length).toBe(1);
    }

    const email1 = mockSupabase.db.email_logs.find((e: any) => e.id === EMAIL_1_ID);
    expect(email1.status).toBe('failed');
    expect(email1.payload.resent_error).toContain('Rate limit exceeded');
  });

  it('Step 8: Time window filtering: old queued emails exceeding hours limit are excluded', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * 3600_000).toISOString();
    mockSupabase.db.email_logs[0].status_updated_at = threeDaysAgo;

    setMockUser('ceo', CEO_ID);

    // Filter within last 24 hours
    const res = await resendQueuedEmailsAction({ hours: 24, dryRun: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.total).toBe(1); // Only EMAIL_2_ID matches
    }
  });

  it('Step 9: Security: Chef de projet and client roles cannot trigger test emails or bulk resends', async () => {
    setMockUser('chef_projet', CHEF_ID);

    await expect(sendTestEmailAction()).rejects.toThrow('Permission refusée');
    await expect(resendQueuedEmailsAction()).rejects.toThrow('Permission refusée');

    setMockUser('client', CLIENT_ID);
    await expect(sendTestEmailAction()).rejects.toThrow('Permission refusée');
  });

  it('Step 10: Empty queue notification: reports graceful message when zero pending emails exist', async () => {
    mockSupabase.db.email_logs = [];
    setMockUser('ceo', CEO_ID);

    const res = await resendQueuedEmailsAction({ dryRun: false });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.total).toBe(0);
      expect(res.msg).toContain('Aucun mail en attente');
    }
  });
});
