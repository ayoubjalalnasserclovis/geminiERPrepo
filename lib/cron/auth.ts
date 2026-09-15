import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';

/**
 * Garde-fou UNIQUE de toutes les routes cron (`app/api/cron/**`).
 *
 * Pourquoi ce helper (CEO 2026-08-29) :
 * `middleware.ts` exempte tout `/api` de l'authentification applicative.
 * La protection des crons repose donc entièrement sur chaque route, et trois
 * patterns cohabitaient :
 *   1. mot de passe de secours en dur   → `CRON_SECRET ?? 'dev-secret'`
 *      (si la variable disparaît, n'importe qui connaissant 'dev-secret'
 *       déclenche l'envoi d'emails à de vrais clients) ;
 *   2. contrôle conditionnel            → `if (CRON_SECRET && auth !== ...)`
 *      (si la variable disparaît, la condition est fausse → route PUBLIQUE) ;
 *   3. contrôle strict (le bon).
 * Ce module remplace les trois par une seule implémentation fail-closed.
 *
 * Règles :
 *  - `CRON_SECRET` absent ou vide  → 503 `cron_misconfigured` + `console.error`
 *    nommant la variable. 503 ≠ 401 pour distinguer dans les logs Vercel
 *    « mal configuré » (à corriger côté env) de « non autorisé » (intrusion).
 *  - En-tête `Authorization` différent de `Bearer <CRON_SECRET>` → 401.
 *  - AUCUN repli, quel que soit `NODE_ENV`. Pour le dev local : mettre
 *    `CRON_SECRET=...` dans `.env.local`, jamais un secret en dur ici.
 *  - Comparaison à temps constant (`timingSafeEqual`) : c'est une comparaison
 *    de secret, pas de `!==`.
 *  - Le secret n'apparaît JAMAIS dans un message d'erreur ni dans un log.
 *
 * Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>` sur chaque
 * déclenchement planifié — c'est le seul mécanisme accepté ici. Les
 * déclenchements manuels du CEO (bouton « Lancer maintenant », routes
 * `/api/reports/test-hebdo/**`) passent par `requireRole/assertRole(['ceo'])`
 * et n'empruntent pas ce chemin : ils ne sont pas affectés.
 */

export type CronAuthOutcome =
  | { ok: true }
  | { ok: false; status: 503; reason: 'cron_misconfigured' }
  | { ok: false; status: 401; reason: 'unauthorized' };

/** Comparaison à temps constant, tolérante aux longueurs différentes. */
function safeEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf-8');
  const b = Buffer.from(expected, 'utf-8');
  if (a.length !== b.length) {
    // Longueurs différentes : timingSafeEqual lèverait. On fait quand même une
    // comparaison bidon de même coût avant de refuser, pour ne pas révéler la
    // longueur du secret par le temps de réponse.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Cœur pur de la vérification — testable sans objet Request.
 * `secret` = valeur de `process.env.CRON_SECRET` (peut être undefined).
 */
export function evaluateCronAuth(
  authorizationHeader: string | null | undefined,
  secret: string | undefined,
): CronAuthOutcome {
  const raw = secret ?? '';
  // Le trim ne sert QU'A decider si la variable est vide. La comparaison se
  // fait sur la valeur BRUTE : Vercel Cron envoie `Bearer <valeur stockee>`
  // telle quelle, donc un secret enregistre avec une espace finale doit
  // continuer a passer. Comparer sur la version trimmee ferait tomber TOUS
  // les crons en 401 dans ce cas.
  if (raw.trim().length === 0) {
    return { ok: false, status: 503, reason: 'cron_misconfigured' };
  }
  if (!authorizationHeader) {
    return { ok: false, status: 401, reason: 'unauthorized' };
  }
  if (!safeEquals(authorizationHeader, `Bearer ${raw}`)) {
    return { ok: false, status: 401, reason: 'unauthorized' };
  }
  return { ok: true };
}

/**
 * Garde-fou à appeler en première ligne de chaque route cron.
 *
 * Usage :
 *   const denied = requireCronAuth(request);
 *   if (denied) return denied;
 *
 * @returns `null` si la requête est authentifiée, sinon la réponse HTTP
 *          (503 mal configuré / 401 non autorisé) à retourner telle quelle.
 */
export function requireCronAuth(request: Request): NextResponse | null {
  const authorization =
    request.headers.get('authorization') ?? request.headers.get('Authorization');
  const outcome = evaluateCronAuth(authorization, process.env.CRON_SECRET);

  if (outcome.ok) return null;

  if (outcome.reason === 'cron_misconfigured') {
    // Log explicite : c'est CE message qu'on cherche dans les logs Vercel
    // quand les crons s'arrêtent. Aucune valeur de secret n'est loggée.
    console.error(
      "[cron/auth] CRON_SECRET absente ou vide dans l'environnement — " +
        'toutes les routes cron sont refusées (503). Définir CRON_SECRET ' +
        'dans les variables Vercel (prod + preview) ou dans .env.local en dev.',
    );
    return NextResponse.json(
      { ok: false, error: 'cron_misconfigured' },
      { status: 503 },
    );
  }

  return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
}
