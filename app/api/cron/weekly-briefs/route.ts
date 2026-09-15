import { NextResponse } from 'next/server';
import { sendEmail } from '@/lib/email/send';
import { buildFinanceBrief } from '@/lib/reports/brief-finance';
import { buildProjetsBrief } from '@/lib/reports/brief-projets';
import { buildTravauxBrief } from '@/lib/reports/brief-travaux';
import { buildAchatsBrief } from '@/lib/reports/brief-achats';
import { buildSourcingBrief } from '@/lib/reports/brief-sourcing';
import { buildAnomaliesBrief } from '@/lib/reports/brief-anomalies';
import { requireCronAuth } from '@/lib/cron/auth';

/**
 * Cron principal des 6 briefs hebdomadaires — envoyé lundi 7h UTC (= 8h Maroc).
 *
 * Schedule dans vercel.json : "0 7 * * 1"
 * Sécurisé via `Authorization: Bearer ${CRON_SECRET}` (garde-fou Vercel Cron).
 *
 * Destinataire V1 : othmane@stoniz.co (hardcodé).
 * Comportement défensif : un brief en échec n'empêche pas les suivants
 * (try/catch par brief, log l'erreur, continue).
 */

const RECIPIENT = 'othmane@stoniz.co';

type BriefEntry = {
  name: string;
  template_id: string;
  build: () => Promise<{ subject: string; html: string }>;
};

const BRIEFS: BriefEntry[] = [
  { name: 'finance', template_id: 'weekly_brief_finance', build: buildFinanceBrief },
  { name: 'projets', template_id: 'weekly_brief_projets', build: buildProjetsBrief },
  { name: 'travaux', template_id: 'weekly_brief_travaux', build: buildTravauxBrief },
  { name: 'achats', template_id: 'weekly_brief_achats', build: buildAchatsBrief },
  { name: 'sourcing', template_id: 'weekly_brief_sourcing', build: buildSourcingBrief },
  { name: 'anomalies', template_id: 'weekly_brief_anomalies', build: buildAnomaliesBrief },
];

export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const weekKey = new Date().toISOString().slice(0, 10);
  const results: Array<{
    name: string;
    ok: boolean;
    subject?: string;
    error?: string;
    result?: unknown;
  }> = [];

  for (const b of BRIEFS) {
    try {
      const { subject, html } = await b.build();
      const r = await sendEmail({
        to: RECIPIENT,
        template_id: b.template_id,
        template_version: 1,
        subject,
        html,
        idempotency_key: `${b.template_id}_${weekKey}`,
      });
      results.push({ name: b.name, ok: true, subject, result: r });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron:weekly-briefs] ${b.name} failed: ${msg}`);
      results.push({ name: b.name, ok: false, error: msg });
    }
  }

  const nbOk = results.filter((r) => r.ok).length;
  return NextResponse.json({
    ok: true,
    sent: nbOk,
    total: BRIEFS.length,
    to: RECIPIENT,
    week: weekKey,
    results,
  });
}
