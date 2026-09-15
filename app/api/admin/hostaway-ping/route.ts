import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth/require';
import { hostawayPing, hostawayListListings } from '@/lib/hostaway/client';

/**
 * Route de diagnostic Hostaway — CEO uniquement.
 *
 * GET /api/admin/hostaway-ping
 *   → vérifie que le flow OAuth fonctionne (récupère un access_token)
 *
 * GET /api/admin/hostaway-ping?listings=1
 *   → en plus, récupère 5 listings pour valider la lecture data
 *
 * Sécurité : on bloque l'accès aux non-CEO pour éviter qu'un autre membre
 * de l'équipe tape l'API publique (donc consomme du quota Hostaway sans
 * raison) ou en déduise des infos métier.
 */
export async function GET(request: Request) {
  const user = await getSessionUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ ok: false, error: 'Non authentifié' }, { status: 401 });
  }
  if (user.role !== 'ceo' && user.role !== 'developer') {
    return NextResponse.json({ ok: false, error: 'Réservé au CEO' }, { status: 403 });
  }

  const url = new URL(request.url);
  const withListings = url.searchParams.get('listings') === '1';

  // 0. Diagnostic env vars (sans révéler les valeurs)
  const envCheck = {
    HOSTAWAY_ACCOUNT_ID: process.env.HOSTAWAY_ACCOUNT_ID
      ? `présent (longueur ${process.env.HOSTAWAY_ACCOUNT_ID.length})`
      : 'ABSENT',
    HOSTAWAY_API_KEY: process.env.HOSTAWAY_API_KEY
      ? `présent (longueur ${process.env.HOSTAWAY_API_KEY.length})`
      : 'ABSENT',
    VERCEL_ENV: process.env.VERCEL_ENV ?? 'unknown',
  };

  // 1. Test OAuth — récupère/vérifie un access_token
  const ping = await hostawayPing();
  if (!ping.ok) {
    return NextResponse.json(
      {
        ok: false,
        step: 'oauth',
        error: ping.error,
        env: envCheck,
        hint:
          envCheck.HOSTAWAY_ACCOUNT_ID === 'ABSENT' || envCheck.HOSTAWAY_API_KEY === 'ABSENT'
            ? 'Une ou plusieurs variables sont ABSENTES côté serveur. Causes : (1) pas créées dans Vercel, (2) créées mais pas pour l\'environnement Production, (3) créées mais pas de redéploiement effectué après. Force un redeploy : git commit --allow-empty -m "redeploy" && git push.'
            : 'Les variables sont présentes côté serveur mais Hostaway refuse l\'authentification. Vérifie la valeur exacte de la clé API (pas d\'espaces, pas de retour à la ligne).',
      },
      { status: 500 },
    );
  }

  // 2. Optionnel : test de lecture data
  if (withListings) {
    try {
      const listings = await hostawayListListings(5);
      const count = Array.isArray((listings as any)?.result)
        ? (listings as any).result.length
        : 0;
      return NextResponse.json({
        ok: true,
        oauth: { tokenExpiresInSec: ping.tokenExpiresInSec },
        listings: {
          count,
          // On expose un échantillon minimal pour valider que la lecture marche
          sample: ((listings as any)?.result ?? []).slice(0, 5).map((l: any) => ({
            id: l?.id,
            name: l?.name,
            address: l?.address,
            externalListingId: l?.externalListingId,
          })),
        },
      });
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          step: 'listings',
          error: e?.message ?? 'unknown',
          oauth: { tokenExpiresInSec: ping.tokenExpiresInSec },
        },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    oauth: { tokenExpiresInSec: ping.tokenExpiresInSec },
    hint: 'Ajoute ?listings=1 à l\'URL pour aussi tester la lecture des listings.',
  });
}
