import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require';
import { sendEmail } from '@/lib/email/send';
import { buildFinanceBrief } from '@/lib/reports/brief-finance';
import { buildProjetsBrief } from '@/lib/reports/brief-projets';
import { buildTravauxBrief } from '@/lib/reports/brief-travaux';
import { buildAchatsBrief } from '@/lib/reports/brief-achats';
import { buildSourcingBrief } from '@/lib/reports/brief-sourcing';
import { buildAnomaliesBrief } from '@/lib/reports/brief-anomalies';

/**
 * One-shot : envoie les 6 briefs hebdo à othmane@stoniz.co en une visite.
 *
 * CEO 2026-08-19b : à utiliser pour tester le rendu complet des 6 mails
 * avec les data réelles avant le premier envoi automatique du lundi 8h.
 *
 * Ordre d'envoi : finance → projets → travaux → achats → sourcing → anomalies
 * Chaque brief tourne dans son propre try/catch, un échec n'interrompt pas
 * les suivants.
 */
export async function GET(request: Request) {
  try {
    await requireRole(['ceo']);
  } catch {
    return NextResponse.json({ ok: false, error: 'CEO uniquement' }, { status: 403 });
  }

  const briefs = [
    { key: 'finance',    build: buildFinanceBrief,   template: 'weekly_brief_finance' },
    { key: 'projets',    build: buildProjetsBrief,   template: 'weekly_brief_projets' },
    { key: 'travaux',    build: buildTravauxBrief,   template: 'weekly_brief_travaux' },
    { key: 'achats',     build: buildAchatsBrief,    template: 'weekly_brief_achats' },
    { key: 'sourcing',   build: buildSourcingBrief,  template: 'weekly_brief_sourcing' },
    { key: 'anomalies',  build: buildAnomaliesBrief, template: 'weekly_brief_anomalies' },
  ] as const;

  // CEO 2026-08-31 : `?preview=1` concatène les 6 briefs dans une seule page
  // navigateur au lieu d'envoyer 6 mails. Pratique pour relire après une modif.
  const url = new URL(request.url);
  const previewParam = url.searchParams.get('preview');
  if (previewParam === '1' || previewParam === 'true') {
    const parts: string[] = [];
    for (const b of briefs) {
      try {
        const { subject, html } = await b.build();
        parts.push(
          `<div style="max-width:900px;margin:0 auto;padding:24px 16px 4px;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;">
             <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#888;">Aperçu — aucun envoi</div>
             <div style="font-size:16px;font-weight:600;color:#1a1a1a;">${subject}</div>
           </div>${html}`,
        );
      } catch (e: any) {
        parts.push(
          `<div style="max-width:900px;margin:24px auto;padding:16px;border:1px solid #F0D48B;background:#FFF3CD;color:#7a5c0a;font-family:system-ui,sans-serif;">
             Brief <strong>${b.key}</strong> en échec : ${e?.message ?? 'Erreur inconnue'}
           </div>`,
        );
      }
    }
    return new NextResponse(parts.join('<hr style="margin:40px 0;border:none;border-top:2px dashed #e5e0d5;">'), {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const stamp = `${new Date().toISOString().slice(0, 10)}_${Date.now()}`;
  const results: Array<{ key: string; ok: boolean; subject?: string; error?: string }> = [];

  for (const b of briefs) {
    try {
      const { subject, html } = await b.build();
      const r = await sendEmail({
        to: 'othmane@stoniz.co',
        template_id: b.template,
        template_version: 1,
        subject,
        html,
        idempotency_key: `test_all_${b.key}_${stamp}`,
      });
      results.push({ key: b.key, ok: true, subject, ...(r as any) });
    } catch (e: any) {
      results.push({ key: b.key, ok: false, error: e?.message ?? 'Erreur inconnue' });
    }
  }

  return NextResponse.json({
    ok: true,
    to: 'othmane@stoniz.co',
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
