/**
 * Wrapper Supabase en fetch natif sur l'API REST PostgREST.
 *
 * Pourquoi pas le SDK @supabase/supabase-js ? Le SDK initialise un client
 * Realtime au démarrage qui exige WebSocket natif (manquant sur Node 20).
 * Avec fetch direct, zéro dépendance, zéro problème d'environnement.
 *
 * Documentation PostgREST : https://postgrest.org/en/stable/api.html
 * Auth : header `apikey` + `Authorization: Bearer <key>` avec la service role.
 */

export type SupabaseAdmin = {
  url: string;
  key: string;
};

export function buildSupabaseAdmin(): SupabaseAdmin {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error('SUPABASE_URL absent dans l\'environnement.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY absent dans l\'environnement.');
  return {
    url: url.replace(/\/$/, ''), // sans slash final
    key,
  };
}

/**
 * Wrapper fetch sur l'API REST PostgREST. Pour usage interne.
 */
async function supabaseFetch(
  admin: SupabaseAdmin,
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: any;
    prefer?: string;
  } = {},
): Promise<any> {
  const response = await fetch(`${admin.url}/rest/v1${path}`, {
    method: options.method ?? 'GET',
    headers: {
      'apikey': admin.key,
      'Authorization': `Bearer ${admin.key}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer ?? 'return=representation',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    let detail = text;
    try {
      const json = JSON.parse(text);
      detail = json.message ?? json.error ?? text;
    } catch {
      // garde texte brut
    }
    throw new Error(`Supabase API ${response.status} sur ${path} : ${detail}`);
  }

  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * UPSERT idempotent sur la colonne notion_page_id.
 * Si une row avec ce notion_page_id existe déjà, elle est mise à jour.
 * Sinon, une nouvelle row est créée.
 *
 * `payload.notion_page_id` doit être fourni.
 */
export async function upsertByNotionPageId(
  admin: SupabaseAdmin,
  table: string,
  payload: Record<string, any>,
): Promise<{ id: string; created: boolean } | null> {
  if (!payload.notion_page_id) {
    throw new Error(`upsertByNotionPageId(${table}) : payload.notion_page_id requis`);
  }

  // 1. Cherche si une row existe déjà
  const existing = await supabaseFetch(
    admin,
    `/${table}?notion_page_id=eq.${encodeURIComponent(payload.notion_page_id)}&select=id&limit=1`,
  );

  if (Array.isArray(existing) && existing.length > 0) {
    const id = existing[0].id;
    // UPDATE
    await supabaseFetch(admin, `/${table}?id=eq.${id}`, {
      method: 'PATCH',
      body: payload,
    });
    return { id, created: false };
  }

  // 2. INSERT
  const inserted = await supabaseFetch(admin, `/${table}`, {
    method: 'POST',
    body: payload,
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;
  if (!row?.id) {
    console.error(`[supabase] INSERT ${table} : pas d'ID retourné`, inserted);
    return null;
  }
  return { id: row.id, created: true };
}

/**
 * Lookup l'id Supabase d'une row à partir d'un notion_page_id.
 * Utilisé pour résoudre les FK (ex : partner_id depuis un Notion partner page).
 */
export async function lookupIdByNotionPageId(
  admin: SupabaseAdmin,
  table: string,
  notionPageId: string,
): Promise<string | null> {
  const result = await supabaseFetch(
    admin,
    `/${table}?notion_page_id=eq.${encodeURIComponent(notionPageId)}&select=id&limit=1`,
  );
  if (Array.isArray(result) && result.length > 0) {
    return result[0].id;
  }
  return null;
}

/**
 * Lookup générique par n'importe quelle colonne (ex : email).
 * Pour la résilience aux contraintes UNIQUE autres que notion_page_id.
 */
export async function lookupIdByColumn(
  admin: SupabaseAdmin,
  table: string,
  column: string,
  value: string,
): Promise<string | null> {
  const result = await supabaseFetch(
    admin,
    `/${table}?${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}&select=id&limit=1`,
  );
  if (Array.isArray(result) && result.length > 0) {
    return result[0].id;
  }
  return null;
}

/**
 * Vérifie si un fichier existe déjà à un storage_path donné dans la table
 * documents. Utilisé pour skip les uploads déjà faits (idempotence).
 */
export async function documentExistsAtPath(
  admin: SupabaseAdmin,
  storagePath: string,
): Promise<boolean> {
  const result = await supabaseFetch(
    admin,
    `/documents?storage_path=eq.${encodeURIComponent(storagePath)}&select=id&limit=1`,
  );
  return Array.isArray(result) && result.length > 0;
}

/**
 * Télécharge un fichier depuis une URL Notion (signée temporaire) et
 * l'upload vers Supabase Storage au path indiqué.
 *
 * @returns true si l'upload a réussi, false si erreur (loguée)
 */
export async function uploadFileFromUrl(
  admin: SupabaseAdmin,
  bucket: string,
  storagePath: string,
  sourceUrl: string,
): Promise<{ ok: true; size: number } | { ok: false; error: string }> {
  try {
    const sourceRes = await fetch(sourceUrl);
    if (!sourceRes.ok) {
      return { ok: false, error: `download ${sourceRes.status}` };
    }
    const buffer = await sourceRes.arrayBuffer();
    const contentType = sourceRes.headers.get('content-type') ?? 'application/octet-stream';

    const uploadUrl = `${admin.url}/storage/v1/object/${bucket}/${storagePath.split('/').map(encodeURIComponent).join('/')}`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${admin.key}`,
        'apikey':        admin.key,
        'Content-Type':  contentType,
        'x-upsert':      'true',
      },
      body: new Uint8Array(buffer),
    });

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      return { ok: false, error: `upload ${uploadRes.status} : ${errText.slice(0, 200)}` };
    }
    return { ok: true, size: buffer.byteLength };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}
