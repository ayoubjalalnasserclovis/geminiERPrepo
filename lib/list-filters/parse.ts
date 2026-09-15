/**
 * Helpers serveur pour parser les searchParams envoyés par <ListToolbar>.
 * Utilisés par /properties, /projects, /clients pour construire la requête.
 *
 * Convention :
 *   - `q` : recherche libre (string)
 *   - `<key>` : filtre single (string) ou multi (csv : "a,b,c")
 *   - `<key>_min` / `<key>_max` : range numérique
 *   - `<key>` avec valeur dans {current_month, last_3_months, last_12_months, all} : période
 *   - `sort` + `dir=asc|desc` : tri
 */

export type SP = Record<string, string | string[] | undefined>;

export function single(sp: SP, key: string): string | null {
  const v = sp[key];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ? String(v) : null;
}

export function multi(sp: SP, key: string): string[] {
  const v = sp[key];
  if (!v) return [];
  const raw = Array.isArray(v) ? v[0] : v;
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

export function range(sp: SP, key: string): { min: number | null; max: number | null } {
  const minRaw = single(sp, `${key}_min`);
  const maxRaw = single(sp, `${key}_max`);
  const min = minRaw != null && minRaw !== '' ? Number(minRaw) : null;
  const max = maxRaw != null && maxRaw !== '' ? Number(maxRaw) : null;
  return {
    min: Number.isFinite(min as number) ? (min as number) : null,
    max: Number.isFinite(max as number) ? (max as number) : null,
  };
}

export function period(sp: SP, key: string): { from: string | null; to: string | null } {
  const v = single(sp, key);
  if (!v || v === 'all') return { from: null, to: null };
  const now = new Date();
  if (v === 'current_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: from.toISOString().slice(0, 10), to: null };
  }
  if (v === 'last_3_months') {
    const from = new Date(now); from.setMonth(now.getMonth() - 3);
    return { from: from.toISOString().slice(0, 10), to: null };
  }
  if (v === 'last_12_months') {
    const from = new Date(now); from.setMonth(now.getMonth() - 12);
    return { from: from.toISOString().slice(0, 10), to: null };
  }
  return { from: null, to: null };
}

export function search(sp: SP): string {
  return (single(sp, 'q') ?? '').trim();
}

/** Échappe % et _ pour ILIKE. */
export function escapeIlike(s: string): string {
  return s.replace(/[\\%_]/g, m => '\\' + m);
}

export function sort(sp: SP, defaultField: string, defaultDir: 'asc' | 'desc' = 'desc'): {
  field: string; dir: 'asc' | 'desc';
} {
  const field = single(sp, 'sort') ?? defaultField;
  const dirRaw = single(sp, 'dir');
  const dir: 'asc' | 'desc' = dirRaw === 'asc' ? 'asc' : (dirRaw === 'desc' ? 'desc' : defaultDir);
  return { field, dir };
}
