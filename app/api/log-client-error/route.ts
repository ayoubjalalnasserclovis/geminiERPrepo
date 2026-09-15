import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/auth/require';

// Endpoint utilisé par les boundaries error.tsx / global-error.tsx pour
// persister le détail d'un crash de rendu. Sans ça on n'a aucune visibilité
// côté serveur en prod (Next masque error.message et la rétention des logs
// Vercel est très courte).
//
// CEO 2026-08-17 :
//   - passage à createAdminClient : garantit l'insert même si l'appelant
//     est totalement anonyme (client Supabase browser cassé, mode privé
//     iOS) ou si un jour on active la RLS sur app_error_logs.
//   - capture user agent (ua) pour identifier iOS Safari vs Chrome vs
//     WebView Gmail (source de bugs récurrents sur le portail client).
//   - accepte sendBeacon (Content-Type application/json ou text/plain
//     selon le navigateur — on parse dans tous les cas).

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    let body: any = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* payload brut ignoré */ }
    const me = await getSessionUser().catch(() => null);
    const admin = createAdminClient();
    await admin.from('app_error_logs').insert({
      source: String(body.source ?? 'client_error_boundary').slice(0, 100),
      user_id: me?.id ?? null,
      message: String(body.message ?? '').slice(0, 1000),
      details: {
        digest: body.digest ?? null,
        name: body.name ?? null,
        stack: String(body.stack ?? '').slice(0, 4000),
      },
      payload: {
        pathname: body.pathname ?? null,
        role: me?.role ?? null,
        ua: String(body.ua ?? req.headers.get('user-agent') ?? '').slice(0, 500),
      },
    } as any);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}
