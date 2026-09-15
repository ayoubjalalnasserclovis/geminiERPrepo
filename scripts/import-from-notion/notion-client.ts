/**
 * Wrapper Notion API en fetch natif (pas de SDK pour éviter les ruptures
 * d'API entre versions majeures).
 *
 * Documentation : https://developers.notion.com/reference/post-database-query
 * Version API utilisée : 2022-06-28 (stable, supporte databases.query).
 */

export type NotionPage = {
  id: string;
  properties: Record<string, any>;
  url: string;
  created_time: string;
  last_edited_time: string;
};

const NOTION_API_VERSION = '2022-06-28';
const NOTION_RATE_LIMIT_DELAY_MS = 400; // ~2.5 req/s, sous la limite officielle de 3 req/s

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Renvoie le token Notion depuis l'environnement. Throw si absent.
 * Pas de "client" à instancier — l'auth est passée en header sur chaque appel.
 */
export function getNotionToken(): string {
  const token = process.env.NOTION_TOKEN;
  if (!token) {
    throw new Error('NOTION_TOKEN absent — exporte-le ou ajoute-le à .env.local');
  }
  return token;
}

/**
 * Wrapper raw fetch sur l'API Notion. Pour usage interne (utiliser
 * fetchAllRows() pour les listes de pages).
 */
async function notionFetch(
  token: string,
  path: string,
  options: { method?: 'GET' | 'POST'; body?: any } = {},
): Promise<any> {
  const response = await fetch(`https://api.notion.com/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_API_VERSION,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Notion API a renvoyé du non-JSON (status ${response.status}) : ${text.slice(0, 200)}`);
  }

  if (!response.ok) {
    const code = json.code ?? json.status ?? response.status;
    const msg = json.message ?? response.statusText;
    throw new Error(`Notion API ${code} : ${msg}`);
  }

  return json;
}

/**
 * Récupère toutes les rows d'une DB Notion en gérant la pagination
 * (start_cursor) et le rate limit (delay entre requêtes).
 *
 * Optionnellement limite à `maxRows` pour les modes --limit du script.
 */
export async function fetchAllRows(
  databaseId: string,
  options: { maxRows?: number } = {},
): Promise<NotionPage[]> {
  const token = getNotionToken();
  const all: NotionPage[] = [];
  let cursor: string | undefined = undefined;
  let attempt = 0;

  while (true) {
    try {
      const body: any = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;

      const response = await notionFetch(token, `/databases/${databaseId}/query`, {
        method: 'POST',
        body,
      });

      for (const r of response.results) {
        all.push(r as NotionPage);
        if (options.maxRows && all.length >= options.maxRows) {
          return all;
        }
      }

      attempt = 0;

      if (!response.has_more) break;
      cursor = response.next_cursor;
      await sleep(NOTION_RATE_LIMIT_DELAY_MS);
    } catch (err: any) {
      attempt++;
      if (attempt > 5) {
        throw new Error(`Notion API a échoué 5 fois consécutives : ${err.message ?? err}`);
      }
      const backoff = Math.pow(2, attempt - 1) * 1000;
      console.warn(`[notion] erreur (tentative ${attempt}) : ${err.message ?? err} — retry dans ${backoff}ms`);
      await sleep(backoff);
    }
  }

  return all;
}

/**
 * Compat ancien signature : on garde `buildNotionClient()` qui retourne un
 * objet inutile (vide). Les sous-scripts qui font `const notion = buildNotionClient();`
 * n'ont rien à changer — ils passent juste l'objet à fetchAllRows() qui l'ignore.
 *
 * À supprimer une fois tous les sous-scripts migrés.
 */
export function buildNotionClient(): Record<string, never> {
  getNotionToken(); // vérifie au moins que le token existe
  return {};
}
