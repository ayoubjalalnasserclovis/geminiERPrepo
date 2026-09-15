import 'server-only';
import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/require';
import { sendEmail } from '@/lib/email/send';

/**
 * Handler partagé des routes /api/reports/test-hebdo/* (CEO 2026-08-31).
 *
 * Deux modes :
 *   - par défaut          → envoie le brief par email à othmane@stoniz.co
 *   - `?preview=1`        → REND le HTML directement dans le navigateur,
 *                           sans rien envoyer ni loguer.
 *
 * Le mode aperçu existe pour relire un brief après une modif sans se spammer
 * la boîte mail (et sans consommer un envoi Resend).
 */
export async function handleBriefTestRoute(
  request: Request,
  opts: {
    build: () => Promise<{ subject: string; html: string }>;
    template_id: string;
    slug: string;
  },
) {
  try {
    await requireRole(['ceo']);
  } catch {
    return NextResponse.json({ ok: false, error: 'CEO uniquement' }, { status: 403 });
  }

  const { subject, html } = await opts.build();

  const preview = new URL(request.url).searchParams.get('preview');
  if (preview === '1' || preview === 'true') {
    // Aperçu pur lecture : aucun envoi, aucune ligne dans email_logs.
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Brief-Subject': encodeURIComponent(subject),
      },
    });
  }

  const result = await sendEmail({
    to: 'othmane@stoniz.co',
    template_id: opts.template_id,
    template_version: 1,
    subject,
    html,
    idempotency_key: `test_hebdo_${opts.slug}_${new Date().toISOString().slice(0, 10)}_${Date.now()}`,
  });
  return NextResponse.json({ ok: true, to: 'othmane@stoniz.co', subject, result });
}
