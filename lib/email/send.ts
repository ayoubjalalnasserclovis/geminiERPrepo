import 'server-only';
import { Resend } from 'resend';
import { createAdminClient } from '@/lib/supabase/admin';
import { canNotifyForProject } from '@/lib/notifications/can-notify';

/**
 * Envoie un email transactionnel via Resend ET log l'envoi dans `email_logs`.
 * Si RESEND_API_KEY est manquant, log uniquement (utile en dev).
 *
 * GARDE-FOU du mode silencieux (Vague 2 mode préparation) :
 *   - Si project_id fourni ET projet en is_preparation/legacy/non activé
 *     → aucun email ne part, statut 'skipped'.
 *
 * NOTE 2026-06-19 : le kill switch global `EMAIL_KILL_SWITCH` a été retiré
 * (décision CEO). Le garde projet suffit ; le kill switch coupait tout sans
 * alerte, trop dangereux en prod.
 *
 * Toujours fournir project_id dans les params quand le mail est lié à un projet.
 */
export type SendEmailParams = {
  to: string;
  template_id: string;
  template_version?: number;
  locale?: string;
  subject: string;
  html: string;
  text?: string;
  project_id?: string | null;
  idempotency_key?: string;
  payload?: Record<string, unknown>;
};

export async function sendEmail(params: SendEmailParams) {
  const admin = createAdminClient();

  // Idempotence : si une ligne avec la même clé existe déjà, abort.
  if (params.idempotency_key) {
    const { data: existing } = await admin
      .from('email_logs')
      .select('id, status')
      .eq('idempotency_key', params.idempotency_key)
      .maybeSingle();
    if (existing) {
      return { skipped: true, reason: 'idempotency', existing_id: existing.id };
    }
  }

  // Garde-fou : projet en mode silencieux (préparation, legacy, non activé)
  if (params.project_id) {
    const allowed = await canNotifyForProject(params.project_id);
    if (!allowed) {
      await admin.from('email_logs').insert({
        project_id: params.project_id,
        recipient_email: params.to,
        template_id: params.template_id,
        template_version: params.template_version ?? 1,
        locale: params.locale ?? 'fr-FR',
        subject: params.subject,
        payload: { ...(params.payload ?? {}), skip_reason: 'project_not_notifiable' },
        idempotency_key: params.idempotency_key ?? null,
        status: 'skipped',
        status_updated_at: new Date().toISOString(),
      });
      console.log('[email-skipped] project_not_notifiable', params.template_id, '→', params.to, 'project=', params.project_id);
      return { skipped: true, reason: 'project_not_notifiable' };
    }
  }

  let resendId: string | null = null;
  let status: 'sent' | 'failed' | 'queued' = 'queued';
  let lastError: string | null = null;

  // Utilise RESEND_API_KEY si valide (pas le placeholder)
  const apiKey = process.env.RESEND_API_KEY;
  const isApiKeyValid = !!apiKey && !apiKey.includes('placeholder') && apiKey.startsWith('re_');

  if (isApiKeyValid) {
    try {
      const resend = new Resend(apiKey);
      // Format de l'expéditeur : "Stoniz <email@stoniz.co>" si email seul fourni
      const rawFrom = process.env.RESEND_FROM_EMAIL
        ?? process.env.EMAIL_FROM
        ?? 'Stoniz <onboarding@resend.dev>';
      const from = rawFrom.includes('<') ? rawFrom : `Stoniz <${rawFrom}>`;

      const result = await resend.emails.send({
        from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        text: params.text,
        replyTo: process.env.EMAIL_REPLY_TO ?? process.env.RESEND_REPLY_TO,
      });
      if (result.error) throw new Error(result.error.message);
      resendId = result.data?.id ?? null;
      status = 'sent';
    } catch (err) {
      status = 'failed';
      lastError = err instanceof Error ? err.message : String(err);
      console.error('[resend] envoi échoué', params.template_id, '→', params.to, '|', lastError);
    }
  } else {
    // Dev mode : log uniquement
    console.log('[email-stub]', params.template_id, '→', params.to, '|', params.subject);
    status = 'queued';
  }

  // Logger en DB — sur échec on persiste l'erreur dans le payload pour que
  // /admin/emails affiche le message au lieu d'un statut vide (cf. P1 audit
  // 2026-06-19).
  const finalPayload = lastError
    ? { ...(params.payload ?? {}), error: lastError }
    : params.payload ?? null;
  await admin.from('email_logs').insert({
    project_id: params.project_id ?? null,
    recipient_email: params.to,
    template_id: params.template_id,
    template_version: params.template_version ?? 1,
    locale: params.locale ?? 'fr-FR',
    subject: params.subject,
    payload: finalPayload,
    resend_id: resendId,
    idempotency_key: params.idempotency_key ?? null,
    status,
    status_updated_at: new Date().toISOString(),
  });

  if (lastError) {
    return { ok: false, error: lastError };
  }
  return { ok: true, resend_id: resendId };
}
