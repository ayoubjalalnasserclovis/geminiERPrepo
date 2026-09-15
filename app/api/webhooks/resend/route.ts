import { NextResponse, type NextRequest } from 'next/server';
import crypto from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Webhook Resend — met à jour email_logs.status quand Resend nous notifie
 * delivered/opened/bounced/complained/failed.
 *
 * Configurer dans Resend Dashboard → Webhooks → endpoint = /api/webhooks/resend
 * + signing secret = RESEND_WEBHOOK_SECRET
 */
export async function POST(request: NextRequest) {
  const body = await request.text();

  // CEO 2026-06-18 : Resend utilise Svix pour signer les webhooks.
  // Format réel : header svix-signature = "v1,base64sig v1,base64sig…",
  // signé sur "svix-id.svix-timestamp.body" avec le secret base64 du
  // préfixe "whsec_". L'ancien code faisait HMAC hex sur body brut → 401 garanti.
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const svixId = request.headers.get('svix-id') ?? '';
    const svixTimestamp = request.headers.get('svix-timestamp') ?? '';
    const svixSignature = request.headers.get('svix-signature') ?? '';
    if (!svixId || !svixTimestamp || !svixSignature) {
      return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 });
    }
    // Le secret est "whsec_<base64>" → on décode la partie après le préfixe
    const secretRaw = secret.startsWith('whsec_') ? secret.slice(6) : secret;
    const secretBytes = Buffer.from(secretRaw, 'base64');
    const signedPayload = `${svixId}.${svixTimestamp}.${body}`;
    const computed = crypto.createHmac('sha256', secretBytes).update(signedPayload).digest('base64');
    // svix-signature peut contenir plusieurs signatures séparées par espace
    const incomingSignatures = svixSignature
      .split(' ')
      .map((s) => s.split(',')[1])
      .filter(Boolean);
    if (!incomingSignatures.includes(computed)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  const event = JSON.parse(body);
  const resendId = event?.data?.email_id;
  const type = event?.type;

  if (!resendId || !type) return NextResponse.json({ ok: true });

  const STATUS_MAP: Record<string, string> = {
    'email.sent': 'sent',
    'email.delivered': 'delivered',
    'email.opened': 'opened',
    'email.bounced': 'bounced',
    'email.complained': 'complained',
    'email.failed': 'failed',
  };
  const newStatus = STATUS_MAP[type];
  if (!newStatus) return NextResponse.json({ ok: true });

  const admin = createAdminClient();
  await admin.from('email_logs').update({
    status: newStatus,
    status_updated_at: new Date().toISOString(),
  }).eq('resend_id', resendId);

  return NextResponse.json({ ok: true });
}
