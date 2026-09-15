import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runCheckupAutomations } from '@/lib/propria/checkups-auto';
import { requireCronAuth } from '@/lib/cron/auth';

export const maxDuration = 300;

/**
 * Cron Vercel quotidien — automatisations check-up (chantier 11.b,
 * consultant U27/U28/U29). Déclenché par vercel.json à 6h UTC tous les jours.
 *
 * Sécurité : garde-fou centralisé `requireCronAuth` (lib/cron/auth.ts).
 * Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>`. Si CRON_SECRET
 * est absente, la route refuse (503) au lieu de devenir publique — aucun
 * repli, aucun mot de passe de secours.
 *
 * Chaque bloc est idempotent (dedupe décrit dans lib/propria/checkups-auto.ts)
 * → re-run le même jour = zéro création. Le bouton CEO « Lancer maintenant »
 * de /propria/checkups appelle exactement la même logique.
 *
 * Logging : résumé JSON en console + réponse HTTP (pas de table de log
 * dédiée — hostaway_sync_runs reste réservée au diagnostic Hostaway).
 */
export async function GET(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  try {
    const admin = createAdminClient();
    const summary = await runCheckupAutomations(admin as any);
    console.log('[cron/checkups-auto]', JSON.stringify(summary));
    return NextResponse.json({ ok: summary.errors.length === 0, at: new Date().toISOString(), summary });
  } catch (e: any) {
    console.error('[cron/checkups-auto] fatal', e?.message ?? e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? 'Erreur inconnue' },
      { status: 500 },
    );
  }
}
