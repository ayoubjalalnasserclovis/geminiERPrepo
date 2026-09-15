'use server';

import { revalidatePath } from 'next/cache';
import { Resend } from 'resend';
import { assertRole } from '@/lib/auth/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';

/**
 * Page admin /admin/emails — CEO 2026-06-18.
 * 2 actions : envoyer un mail de test + relancer les emails 'queued'.
 */

/**
 * Envoie un email de test au CEO. Permet de vérifier en 1 clic que la chaîne
 * Resend + webhook + email_logs fonctionne.
 */
export async function sendTestEmailAction(toOverride?: string) {
  const user = await assertRole(['ceo', 'developer']);
  const to = (toOverride && toOverride.trim()) || user.email || 'othmane@stoniz.co';

  const r = await sendEmail({
    to,
    template_id: 'admin_healthcheck',
    subject: `[Healthcheck] Test envoi Stoniz · ${new Date().toLocaleString('fr-FR')}`,
    html: `
      <div style="font-family: system-ui; max-width: 560px; margin: 24px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="margin: 0 0 12px;">✅ Test email Stoniz</h2>
        <p style="color: #4b5563;">Si tu reçois ce mail, ta configuration Resend fonctionne :</p>
        <ul style="color: #4b5563;">
          <li>RESEND_API_KEY : actif</li>
          <li>Domaine d'envoi : ${process.env.RESEND_FROM_EMAIL ?? process.env.EMAIL_FROM ?? 'fallback'}</li>
          <li>Webhook : à vérifier dans /admin/emails (status passera à 'delivered' si OK)</li>
        </ul>
        <p style="color: #6b7280; font-size: 12px; margin-top: 24px;">Envoyé le ${new Date().toISOString()}</p>
      </div>
    `,
  });

  revalidatePath('/admin/emails');
  return { ok: true, result: r };
}

/**
 * Relance tous les emails marqués 'queued' depuis les N dernières heures.
 *
 * Stratégie : Resend direct (sans re-rendre les templates qu'on n'a pas
 * stockés en HTML). On envoie une notification générique avec le subject
 * original + un CTA vers le portail. Imparfait mais pragmatique : le client
 * reçoit AU MOINS quelque chose.
 *
 * Future : stocker le HTML rendu dans email_logs.payload.rendered_html à
 * l'envoi initial pour permettre un vrai re-render fidèle.
 */
export async function resendQueuedEmailsAction(opts?: { hours?: number; dryRun?: boolean }) {
  const user = await assertRole(['ceo']);
  const hours = opts?.hours ?? 48;
  const dryRun = opts?.dryRun ?? false;

  const admin = createAdminClient();
  const since = new Date(Date.now() - hours * 3600_000).toISOString();

  const { data: queued } = await admin
    .from('email_logs')
    .select('id, recipient_email, template_id, subject, payload, project_id')
    .eq('status', 'queued')
    .gte('status_updated_at', since)
    .order('status_updated_at', { ascending: true })
    .limit(500);

  const rows = (queued ?? []) as any[];
  if (rows.length === 0) {
    return { ok: true as const, total: 0, sent: 0, failed: 0, dryRun, msg: 'Aucun mail en attente sur cette période.' };
  }
  if (dryRun) {
    return { ok: true as const, total: rows.length, sent: 0, failed: 0, dryRun: true, msg: `${rows.length} email(s) seraient renvoyés.` };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.includes('placeholder') || !apiKey.startsWith('re_')) {
    return { ok: false as const, error: 'RESEND_API_KEY invalide ou manquante.' };
  }
  const resend = new Resend(apiKey);
  const rawFrom = process.env.RESEND_FROM_EMAIL ?? process.env.EMAIL_FROM ?? 'Stoniz <hello@stoniz.co>';
  const from = rawFrom.includes('<') ? rawFrom : `Stoniz <${rawFrom}>`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://studio.stoniz.co';

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const row of rows) {
    // HTML fallback générique reconstitué depuis subject + portail
    const cta = row.payload?.cta_url ?? `${appUrl}/client`;
    const ctaLabel = row.payload?.cta_label ?? 'Accéder à mon portail';
    const message = row.payload?.message ?? 'Vous avez une notification à consulter sur votre portail Stoniz.';
    const title = row.payload?.title ?? row.subject;
    const html = `
      <div style="font-family: system-ui; max-width: 560px; margin: 24px auto; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px;">
        <h2 style="margin: 0 0 12px;">${escapeHtml(title)}</h2>
        <p style="color: #4b5563;">${escapeHtml(String(message))}</p>
        <p style="margin: 24px 0;">
          <a href="${cta}" style="background:#0a0a0a; color:#fff; padding:10px 16px; border-radius:8px; text-decoration:none;">
            ${escapeHtml(ctaLabel)}
          </a>
        </p>
        <p style="color: #6b7280; font-size: 11px; margin-top: 24px;">
          Cet email a été relancé par votre équipe Stoniz suite à un délai d'envoi technique.
        </p>
      </div>
    `;

    try {
      const result = await resend.emails.send({
        from,
        to: row.recipient_email,
        subject: row.subject,
        html,
        replyTo: process.env.EMAIL_REPLY_TO ?? process.env.RESEND_REPLY_TO,
      });
      if (result.error) throw new Error(result.error.message);
      await admin.from('email_logs').update({
        status: 'sent',
        resend_id: result.data?.id ?? null,
        sent_at: new Date().toISOString(),
        status_updated_at: new Date().toISOString(),
        payload: { ...(row.payload ?? {}), resent_by: user.id, resent_at: new Date().toISOString() },
      }).eq('id', row.id);
      sent += 1;
    } catch (e: any) {
      failed += 1;
      const msg = e?.message ?? String(e);
      errors.push(`${row.recipient_email}: ${msg}`);
      await admin.from('email_logs').update({
        status: 'failed',
        status_updated_at: new Date().toISOString(),
        payload: { ...(row.payload ?? {}), resent_error: msg, resent_at: new Date().toISOString() },
      }).eq('id', row.id);
    }
  }

  revalidatePath('/admin/emails');
  return { ok: true as const, total: rows.length, sent, failed, dryRun: false, errors: errors.slice(0, 10) };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
