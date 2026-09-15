/**
 * Helper centralisé pour l'exclusion des projets perdus (status='perdu').
 *
 * Règle métier permanente (CEO 2026-05-30) :
 *   - Tout dashboard, KPI, agrégat, total OU tableau détail exclut par défaut
 *     les projets dont projects.status = 'perdu'.
 *   - Filtre = `status != 'perdu'` (PAS `= 'actif'` — on garde pause / termine).
 *   - Drapeau `include_lost: true` réservé aux dashboards dédiés
 *     (Cycle de vie, "Projets perdus").
 *   - Pas de suppression : exclusion en lecture / agrégation uniquement.
 *   - Source de vérité unique = `projects.status`.
 *
 * Utiliser :
 *   - `isProjectLost(project)` pour tester un seul projet
 *   - `excludeLostByProject(rows, getProject)` pour filtrer une liste de rows
 *     ayant chacun une référence vers leur projet
 *   - `applyLostFilter(query, { include_lost })` pour ajouter un .neq directement
 *     sur une query Supabase qui select depuis `projects`
 */

export const LOST_STATUS = 'perdu' as const;

export type ProjectLike = {
  status?: string | null;
  deleted_at?: string | null;
};

export type LostFilterOptions = {
  /** Si true, conserve les projets perdus (dashboards dédiés uniquement). */
  include_lost?: boolean;
};

/**
 * Vrai si le projet est perdu (ou supprimé, considéré comme "non actif business").
 * NB : deleted_at est aussi exclu — un projet soft-deleted est plus dur qu'un perdu.
 */
export function isProjectLost(project: ProjectLike | null | undefined): boolean {
  if (!project) return false;
  if (project.deleted_at != null) return true;
  return project.status === LOST_STATUS;
}

/**
 * Filtre une liste de rows qui pointent vers un projet.
 * Le getter `getProject` renvoie le projet attaché à chaque row
 * (ex : `r => r.project` quand la query a fait `.select('project:projects(status, deleted_at)')`).
 */
export function excludeLostByProject<T>(
  rows: T[] | null | undefined,
  getProject: (row: T) => ProjectLike | null | undefined,
  opts: LostFilterOptions = {},
): T[] {
  if (!rows) return [];
  if (opts.include_lost) return rows;
  return rows.filter(r => !isProjectLost(getProject(r)));
}

/**
 * Ajoute le filtre `.neq('status', 'perdu')` directement sur une query Supabase
 * qui select depuis la table `projects`. Renvoie la query pour chaînage.
 *
 * Usage :
 *   const { data } = await applyLostFilter(supabase.from('projects').select('*'));
 */
export function applyLostFilter<Q extends { neq: (col: string, val: string) => any }>(
  query: Q,
  opts: LostFilterOptions = {},
): Q {
  if (opts.include_lost) return query;
  return query.neq('status', LOST_STATUS);
}

/**
 * Pour les vues SQL ou les RPC, exposer une chaîne de filtre WHERE.
 * (Documentaire — utilisée dans les migrations comme commentaire de référence.)
 */
export const SQL_PREDICATE_NOT_LOST =
  `projects.status <> '${LOST_STATUS}' AND projects.deleted_at IS NULL`;
