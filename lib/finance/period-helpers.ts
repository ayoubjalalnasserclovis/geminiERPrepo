/**
 * Helpers période (presets) — unifiés Trésorerie / Réconciliation.
 *
 * CEO 2026-06-23 : créés pour fixer la divergence serveur/toolbar et étendre
 * les presets (7j, mois précédent, YTD).
 *
 * @see lib/list-filters/parse.ts — autre helper period() avec calcul subtilement
 *      différent (jour courant au lieu du 1er du mois pour 3m/12m). Refacto
 *      futur : aligner parse.ts sur ce module pour avoir une seule source.
 */

export type PeriodPreset =
  | 'last_7d'
  | 'current_month'
  | 'previous_month'
  | 'last_3_months'
  | 'ytd'
  | 'last_12_months'
  | 'all';

export const PERIOD_PRESETS: Array<{ v: PeriodPreset; label: string }> = [
  { v: 'last_7d', label: '7 jours' },
  { v: 'current_month', label: 'Ce mois' },
  { v: 'previous_month', label: 'Mois précédent' },
  { v: 'last_3_months', label: '3 mois' },
  { v: 'ytd', label: 'Année en cours' },
  { v: 'last_12_months', label: '12 mois' },
  { v: 'all', label: 'Tout' },
];

const VALID_PRESETS = new Set<string>(PERIOD_PRESETS.map((p) => p.v));

export function isPeriodPreset(v: string | null | undefined): v is PeriodPreset {
  return !!v && VALID_PRESETS.has(v);
}

/**
 * Format date `YYYY-MM-DD` en **heure locale** (pas UTC).
 *
 * Bug timezone fixé 2026-06-23 (CEO test E2E) : `toISOString()` convertit en
 * UTC, ce qui décale d'1 jour en GMT+1 (Maroc) sur les bornes de mois.
 * Ex: `new Date(2026, 5, 1)` (1er juin local) → `toISOString() = '2026-05-31T23:00:00Z'`
 * → `slice(0,10) = '2026-05-31'` ❌
 * Solution : composer manuellement depuis les getters locaux.
 */
function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Retourne `{ fromDate, toDate }` en YYYY-MM-DD pour un preset donné.
 * Les bornes sont *inclusives* (`gte` / `lte` côté SQL).
 * `null` = pas de borne.
 */
export function resolvePeriodRange(preset: PeriodPreset | string | null | undefined, now: Date = new Date()): {
  fromDate: string | null;
  toDate: string | null;
} {
  const p = isPeriodPreset(preset) ? preset : 'all';
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (p) {
    case 'last_7d': {
      const from = new Date(now);
      from.setDate(now.getDate() - 7);
      return { fromDate: ymd(from), toDate: null };
    }
    case 'current_month': {
      const from = new Date(y, m, 1);
      return { fromDate: ymd(from), toDate: null };
    }
    case 'previous_month': {
      const from = new Date(y, m - 1, 1);
      // Dernier jour du mois précédent = jour 0 du mois courant
      const to = new Date(y, m, 0);
      return { fromDate: ymd(from), toDate: ymd(to) };
    }
    case 'last_3_months': {
      const from = new Date(y, m - 3, 1);
      return { fromDate: ymd(from), toDate: null };
    }
    case 'ytd': {
      const from = new Date(y, 0, 1);
      return { fromDate: ymd(from), toDate: null };
    }
    case 'last_12_months': {
      const from = new Date(y, m - 12, 1);
      return { fromDate: ymd(from), toDate: null };
    }
    case 'all':
    default:
      return { fromDate: null, toDate: null };
  }
}
