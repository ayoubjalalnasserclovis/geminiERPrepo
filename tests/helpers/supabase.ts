import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Client Supabase dédié aux tests d'intégration.
 *
 * - Utilise la clé service_role → bypasse le RLS pour créer/nettoyer les fixtures
 *   rapidement (le test du RLS lui-même se fait avec la clé anon, cf. anonClient()).
 * - GARDE ANTI-PROD : refuse de démarrer si l'URL n'est pas locale, pour qu'aucun
 *   test ne puisse jamais écrire (ou pire, supprimer) dans la base de production.
 *   Override possible via TEST_DB_ALLOW_REMOTE=true UNIQUEMENT pour un projet
 *   cloud de test dédié.
 *
 * Ne JAMAIS importer ce module hors des tests.
 */

function isLocalUrl(url: string): boolean {
  return /(^https?:\/\/)?(127\.0\.0\.1|localhost|0\.0\.0\.0)(:\d+)?/.test(url);
}

function assertSafeTarget(url: string): void {
  const allowRemote = process.env.TEST_DB_ALLOW_REMOTE === 'true';
  if (!isLocalUrl(url) && !allowRemote) {
    throw new Error(
      `[tests] Refus de cibler une base NON locale : "${url}".\n` +
        `Les tests d'intégration doivent pointer vers Supabase local ` +
        `(npx supabase start). Si c'est volontairement un projet cloud de TEST ` +
        `dédié, pose TEST_DB_ALLOW_REMOTE=true. Ne JAMAIS pointer vers la prod.`
    );
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `[tests] Variable d'environnement manquante : ${name}. ` +
        `Copie .env.test.example en .env.test et renseigne-la ` +
        `(valeurs via "npx supabase status").`
    );
  }
  return v;
}

let _admin: SupabaseClient | null = null;

/** Client service_role (bypass RLS) pour setup + cleanup des fixtures. */
export function adminClient(): SupabaseClient {
  if (_admin) return _admin;
  const url = requireEnv('SUPABASE_TEST_URL');
  assertSafeTarget(url);
  _admin = createClient(url, requireEnv('SUPABASE_TEST_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return _admin;
}

/** Client anon (RLS actif) pour tester le comportement réel d'un utilisateur. */
export function anonClient(): SupabaseClient {
  const url = requireEnv('SUPABASE_TEST_URL');
  assertSafeTarget(url);
  return createClient(url, requireEnv('SUPABASE_TEST_ANON_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
