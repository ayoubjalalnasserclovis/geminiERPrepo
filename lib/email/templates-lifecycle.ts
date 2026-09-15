import 'server-only';
import { sendEmail } from './send';

/**
 * Templates email du workflow lifecycle (pause/perdu).
 *
 * Notification interne CEO : envoyée quand un chef_projet ou commercial
 * demande une mise en pause. Wrappée par le kill switch global.
 *
 * NB : on NE PASSE PAS project_id à sendEmail() pour ces emails internes.
 * Le filtre can_notify_for_project est conçu pour les emails CLIENT
 * (qui doivent respecter is_preparation, status, etc.). Les emails STAFF
 * de validation doivent partir même sur des projets en pause / préparation.
 * Seul le kill switch global s'applique.
 */

const BASE_STYLE = `font-family: -apple-system, system-ui, sans-serif; line-height: 1.6; color: #1A1A1A;`;

function wrapStaffEmail(content: string, ctaUrl?: string, ctaLabel?: string): string {
  return `<!DOCTYPE html><html><body style="background:#F5F1EB; margin:0; padding:32px;">
    <div style="max-width:560px; margin:0 auto; background:#FFFFFF; border-radius:12px; padding:32px; ${BASE_STYLE}">
      <div style="font-family: 'Playfair Display', Georgia, serif; font-size:24px; color:#1A1A1A; margin-bottom:8px;">Stoniz · Validation interne</div>
      <div style="font-size:13px; color:#6B6560; margin-bottom:16px;">Notification staff — ne pas transférer au client</div>
      <div style="height:1px; background:#E2DDD6; margin-bottom:24px;"></div>
      ${content}
      ${ctaUrl && ctaLabel ? `
        <div style="margin-top:32px;">
          <a href="${ctaUrl}" style="display:inline-block; background:#1A1A1A; color:#FFFFFF; padding:12px 24px; text-decoration:none; border-radius:6px; font-weight:500;">${ctaLabel}</a>
        </div>` : ''
      }
      <div style="height:1px; background:#E2DDD6; margin:32px 0 16px 0;"></div>
      <div style="font-size:12px; color:#6B6560;">Stoniz — Investissement immobilier au Maroc</div>
    </div>
  </body></html>`;
}

const PAUSE_REASON_LABELS: Record<string, string> = {
  financement_attendu: 'Financement attendu',
  sourcing_bloque: 'Sourcing bloqué',
  client_indisponible: 'Client indisponible',
  litige_partenaire: 'Litige partenaire',
  autre: 'Autre',
};

export async function sendCeoPauseRequestEmail(opts: {
  to: string;
  ceo_name: string;
  requester_name: string;
  project_code: string;
  client_name: string;
  reason_code: string;
  expected_resume_at: string;
  memo: string;
  validations_url: string;
}) {
  const reasonLabel = PAUSE_REASON_LABELS[opts.reason_code] ?? opts.reason_code;
  const resumeFormatted = new Date(opts.expected_resume_at).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return sendEmail({
    to: opts.to,
    template_id: 'lifecycle_pause_request_ceo',
    subject: `[Validation] Mise en pause demandée — ${opts.project_code}`,
    html: wrapStaffEmail(`
      <h2 style="font-family: 'Playfair Display', serif; font-weight:500; font-size:22px; margin-top:0;">Demande de mise en pause</h2>
      <p>Bonjour ${opts.ceo_name},</p>
      <p><strong>${opts.requester_name}</strong> demande la mise en pause du projet :</p>
      <table style="width:100%; border-collapse:collapse; background:#F5F1EB; border-radius:8px; padding:16px; margin:16px 0;">
        <tr><td style="padding:8px 16px; color:#6B6560;">Projet</td><td style="padding:8px 16px;"><strong>${opts.project_code}</strong></td></tr>
        <tr><td style="padding:8px 16px; color:#6B6560;">Client</td><td style="padding:8px 16px;">${opts.client_name}</td></tr>
        <tr><td style="padding:8px 16px; color:#6B6560;">Raison</td><td style="padding:8px 16px;">${reasonLabel}</td></tr>
        <tr><td style="padding:8px 16px; color:#6B6560;">Reprise prévue</td><td style="padding:8px 16px;">${resumeFormatted}</td></tr>
      </table>
      <p style="background:#FFFAF0; border-left:3px solid #C9A86A; padding:12px 16px; margin:16px 0; border-radius:4px;">
        <em>« ${opts.memo} »</em>
      </p>
      <p style="color:#6B6560; font-size:14px;">Tu peux valider ou rejeter cette demande en 1 clic depuis la file de validations.</p>
    `, opts.validations_url, 'Voir la file de validations'),
    payload: {
      requester_name: opts.requester_name,
      project_code: opts.project_code,
      reason_code: opts.reason_code,
    },
  });
}
