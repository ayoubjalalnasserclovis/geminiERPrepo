import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/send';
import { requireCronAuth } from '@/lib/cron/auth';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stoniz.co';
const STALE_DAYS = 30;

/**
 * Cron hebdo : digest des projets en pause depuis > 30 jours.
 * À planifier en vercel.json : { "path": "/api/cron/weekly-stale-pauses", "schedule": "0 9 * * 1" }
 * (tous les lundis à 9h UTC)
 *
 * Sécurisé via Authorization: Bearer ${CRON_SECRET}
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const admin = createAdminClient();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - STALE_DAYS);

  const { data: stalePauses } = await admin
    .from('projects')
    .select(`
      id, code, reference, paused_at, expected_resume_at, pause_reason_code_v,
      client:clients(full_name)
    `)
    .eq('status', 'pause')
    .lt('paused_at', cutoff.toISOString())
    .is('deleted_at', null)
    .order('paused_at', { ascending: true });

  if (!stalePauses || stalePauses.length === 0) {
    return NextResponse.json({ ok: true, count: 0, message: 'Aucune pause > 30j' });
  }

  const { data: ceos } = await admin
    .from('profiles')
    .select('email, full_name')
    .eq('role', 'ceo')
    .eq('is_active', true);

  const REASON_LABELS: Record<string, string> = {
    financement_attendu: 'Financement attendu',
    sourcing_bloque: 'Sourcing bloqué',
    client_indisponible: 'Client indisponible',
    litige_partenaire: 'Litige partenaire',
    autre: 'Autre',
  };

  const rows = (stalePauses as any[]).map(p => {
    const days = Math.floor((Date.now() - new Date(p.paused_at).getTime()) / 86400000);
    const reason = REASON_LABELS[p.pause_reason_code_v] ?? p.pause_reason_code_v ?? '—';
    const expected = p.expected_resume_at
      ? new Date(p.expected_resume_at).toLocaleDateString('fr-FR')
      : '—';
    return `
      <tr style="border-bottom:1px solid #E2DDD6;">
        <td style="padding:8px 12px;">
          <a href="${APP_URL}/projects/${p.id}" style="color:#1A1A1A; text-decoration:underline;">${p.client?.full_name ?? '—'}</a>
          <div style="font-size:11px; color:#6B6560;">${p.code ?? p.reference}</div>
        </td>
        <td style="padding:8px 12px; font-size:13px;">${reason}</td>
        <td style="padding:8px 12px; font-size:13px; color:#B6552B;">${days} jours</td>
        <td style="padding:8px 12px; font-size:13px;">${expected}</td>
      </tr>`;
  }).join('');

  const html = `<!DOCTYPE html><html><body style="background:#F5F1EB; margin:0; padding:32px; font-family: -apple-system, system-ui, sans-serif; line-height:1.6; color:#1A1A1A;">
    <div style="max-width:680px; margin:0 auto; background:#FFFFFF; border-radius:12px; padding:32px;">
      <div style="font-family: Georgia, serif; font-size:24px; color:#1A1A1A; margin-bottom:8px;">Stoniz · Digest hebdo</div>
      <div style="font-size:13px; color:#6B6560; margin-bottom:24px;">Projets en pause depuis plus de ${STALE_DAYS} jours</div>
      <p>Voici les <strong>${stalePauses.length}</strong> projets qui méritent un coup de fil ou un point décision cette semaine :</p>
      <table style="width:100%; border-collapse:collapse; margin-top:16px;">
        <thead>
          <tr style="background:#F5F1EB;">
            <th style="text-align:left; padding:8px 12px; font-size:11px; color:#6B6560; text-transform:uppercase;">Client</th>
            <th style="text-align:left; padding:8px 12px; font-size:11px; color:#6B6560; text-transform:uppercase;">Raison</th>
            <th style="text-align:left; padding:8px 12px; font-size:11px; color:#6B6560; text-transform:uppercase;">En pause depuis</th>
            <th style="text-align:left; padding:8px 12px; font-size:11px; color:#6B6560; text-transform:uppercase;">Reprise prévue</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:24px;">
        <a href="${APP_URL}/projects?status=pause" style="display:inline-block; background:#1A1A1A; color:#FFFFFF; padding:12px 24px; text-decoration:none; border-radius:6px;">Voir tous les projets en pause</a>
      </div>
      <div style="font-size:12px; color:#6B6560; margin-top:32px;">Tu reçois ce digest tous les lundis matin. Pour l'arrêter, contacte le dev.</div>
    </div>
  </body></html>`;

  const results: any[] = [];
  for (const ceo of (ceos ?? [])) {
    const weekKey = new Date().toISOString().slice(0, 10);
    const r = await sendEmail({
      to: ceo.email,
      template_id: 'weekly_stale_pauses_digest',
      subject: `[Digest] ${stalePauses.length} projet(s) en pause > ${STALE_DAYS}j`,
      html,
      payload: { count: stalePauses.length },
      idempotency_key: `weekly-stale-pauses-${ceo.email}-${weekKey}`,
    });
    results.push({ ceo: ceo.email, ...r });
  }

  return NextResponse.json({
    ok: true,
    count: stalePauses.length,
    emails: results,
  });
}
