import 'server-only';

/**
 * Client Hostaway API — server-side uniquement.
 *
 * Flux OAuth2 client_credentials :
 *   1. POST /v1/accessTokens avec account_id + api_key
 *   2. Récupère un access_token (durée de vie ~24h)
 *   3. Cache en mémoire avec marge de 60s avant expiration
 *   4. Refresh automatique au prochain appel après expiration
 *   5. Retry 1x sur 401 (token révoqué côté Hostaway entretemps)
 *
 * Documentation API : https://api.hostaway.com/documentation
 *
 * IMPORTANT : ne JAMAIS exposer ce module au browser. Le token + la clé
 * doivent rester côté serveur. C'est protégé par `import 'server-only'`
 * en haut du fichier (Next.js throw si importé depuis un Client Component).
 */

const TOKEN_URL = 'https://api.hostaway.com/v1/accessTokens';
const API_BASE = 'https://api.hostaway.com/v1';

type CachedToken = { token: string; expiresAt: number };
// Cache en mémoire (process-wide). Perdu au redémarrage du serveur Vercel
// mais ré-obtenu au prochain appel en ~100-200ms — acceptable.
let cached: CachedToken | null = null;

/**
 * Récupère un access_token valide, depuis le cache ou via un appel OAuth.
 */
async function getAccessToken(): Promise<string> {
  // Cache valide avec 60s de marge ?
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const accountId = process.env.HOSTAWAY_ACCOUNT_ID;
  const apiKey = process.env.HOSTAWAY_API_KEY;
  if (!accountId || !apiKey) {
    throw new Error(
      'Credentials Hostaway manquants. Vérifie HOSTAWAY_ACCOUNT_ID et HOSTAWAY_API_KEY dans Vercel → Environment Variables.',
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: accountId,
    client_secret: apiKey,
    scope: 'general',
  });

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Hostaway OAuth failed (${res.status}) : ${text.slice(0, 300)}`,
    );
  }

  const data = await res.json();
  if (!data?.access_token) {
    throw new Error('Réponse Hostaway OAuth sans access_token');
  }

  const expiresInSec = Number(data.expires_in) || 86400; // défaut 24h
  cached = {
    token: data.access_token,
    expiresAt: Date.now() + expiresInSec * 1000,
  };
  return cached.token;
}

export type HostawayFetchOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: any;
  /** Évite la boucle infinie sur 401. Usage interne. */
  _isRetry?: boolean;
};

/**
 * Wrapper générique pour appeler n'importe quel endpoint Hostaway.
 *
 * Exemple :
 *   const { result } = await hostawayFetch('/listings', { query: { limit: 50 } });
 *   const reservation = await hostawayFetch(`/reservations/${id}`);
 */
export async function hostawayFetch<T = any>(
  endpoint: string,
  opts: HostawayFetchOptions = {},
): Promise<T> {
  const method = opts.method ?? 'GET';
  const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  const url = new URL(`${API_BASE}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== '') url.searchParams.set(k, String(v));
    }
  }

  const token = await getAccessToken();
  const res = await fetch(url.toString(), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

  // Token expiré côté Hostaway (révoqué ou désynchronisé) → invalide le
  // cache et retry une seule fois.
  if (res.status === 401 && !opts._isRetry) {
    cached = null;
    return hostawayFetch<T>(endpoint, { ...opts, _isRetry: true });
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Hostaway ${method} ${endpoint} échec (${res.status}) : ${text.slice(0, 300)}`,
    );
  }

  return (await res.json()) as T;
}

/**
 * Diagnostic minimaliste : valide que les credentials marchent.
 * Utilisé par la route /api/admin/hostaway-ping côté CEO.
 */
export async function hostawayPing(): Promise<
  | { ok: true; tokenExpiresInSec: number }
  | { ok: false; error: string }
> {
  try {
    await getAccessToken();
    const expiresInSec = cached
      ? Math.max(0, Math.round((cached.expiresAt - Date.now()) / 1000))
      : 0;
    return { ok: true, tokenExpiresInSec: expiresInSec };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'unknown' };
  }
}

/**
 * Test rapide : récupère la liste des listings Hostaway (limite 10).
 * Utile pour vérifier qu'on dépasse l'auth et qu'on lit bien des données.
 */
export async function hostawayListListings(limit = 10): Promise<any> {
  return hostawayFetch('/listings', { query: { limit } });
}

/**
 * Récupère les avis voyageurs avec pagination automatique.
 *
 * L'API Hostaway `/v1/reviews` renvoie les avis cross-canal (Airbnb, Booking,
 * Direct, VRBO…) avec rating global + category ratings.
 *
 * @param opts.sinceDate  Filtre les avis postérieurs à cette date (YYYY-MM-DD).
 *                        Par défaut : 12 mois en arrière.
 * @param opts.pageSize   Taille de page Hostaway (max 500).
 *
 * @returns Tous les avis de la période, paginés.
 */
export async function hostawayListReviews(opts: {
  sinceDate?: string;
  pageSize?: number;
} = {}): Promise<any[]> {
  const pageSize = Math.min(opts.pageSize ?? 500, 500);
  const sinceDate = opts.sinceDate; // optional

  const all: any[] = [];
  let offset = 0;
  let safety = 100; // hard stop à 50k avis (improbable mais protège contre boucle)

  while (safety-- > 0) {
    const data = await hostawayFetch<{ status: string; result?: any[] }>(
      '/reviews',
      {
        query: {
          limit: pageSize,
          offset,
          // Hostaway accepte sortOrder et filtres de date sur insertedOn/submittedAt
          sortOrder: 'submittedOnDesc',
          ...(sinceDate ? { fromDate: sinceDate } : {}),
        },
      },
    );

    const page = Array.isArray(data?.result) ? data.result : [];
    all.push(...page);

    if (page.length < pageSize) break;
    offset += pageSize;
  }

  return all;
}
