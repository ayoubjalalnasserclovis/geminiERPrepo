/**
 * Calculs purs pour le pilotage du cycle de vie projet (dashboard clients).
 *
 * Canon respecté :
 *   - Aucune valeur stockée : tout est dérivé à la lecture (fonctions pures).
 *   - Les entrées arrivent déjà filtrées côté serveur (projets perdus exclus
 *     via lib/projects/lost.ts). Ce helper ne refait PAS l'exclusion des perdus.
 *   - Les projets legacy (import historique) sont exclus EN AMONT des KPI de
 *     durée par l'appelant — voir décision CEO en Partie E du référentiel.
 *
 * Spéc complète : docs/KPI-CYCLE-DE-VIE-CLIENTS-REFERENTIEL.md
 * Décisions verrouillées (CEO 2026-05-31) :
 *   - Seuils de stagnation par phase (jours) : voir PHASE_STUCK_THRESHOLDS.
 *   - Escalade rouge : au-delà de 1,5× le seuil (STUCK_RED_FACTOR).
 *   - Couleur : orange = à surveiller, rouge = retard avéré. Jamais de rouge
 *     pour une pause assumée.
 */

/** Phases du cycle de vie (enum project_phase). */
export const LIFECYCLE_PHASES = [
  'onboarding',
  'sourcing',
  'design',
  'travaux',
  'livraison',
  'mise_en_location',
  'termine',
] as const;

/**
 * Seuils de stagnation par phase, en jours (validés CEO 2026-05-31).
 * Au-delà → 🟠 ; au-delà de seuil × STUCK_RED_FACTOR → 🔴.
 * `termine` n'a pas de seuil : un projet clôturé ne "stagne" pas.
 */
export const PHASE_STUCK_THRESHOLDS: Record<string, number> = {
  onboarding: 7,
  sourcing: 30,
  design: 21,
  travaux: 90,
  livraison: 14,
  mise_en_location: 10,
};

/** Facteur d'escalade : au-delà de seuil × ce facteur, le projet passe en rouge. */
export const STUCK_RED_FACTOR = 1.5;

export type StuckLevel = 'ok' | 'orange' | 'red';

/** Nombre de jours pleins entre deux dates (≥ 0 si `to` après `from`). */
export function daysBetween(from: string | Date, to: string | Date): number {
  const t1 = (from instanceof Date ? from : new Date(from)).getTime();
  const t2 = (to instanceof Date ? to : new Date(to)).getTime();
  return Math.floor((t2 - t1) / 86_400_000);
}

/** Niveau de stagnation pour une phase et un nombre de jours déjà passés dedans. */
export function stuckLevel(phase: string, daysInPhase: number): StuckLevel {
  const seuil = PHASE_STUCK_THRESHOLDS[phase];
  if (seuil == null) return 'ok'; // phase sans seuil (ex : termine)
  if (daysInPhase > seuil * STUCK_RED_FACTOR) return 'red';
  if (daysInPhase > seuil) return 'orange';
  return 'ok';
}

export type StuckInput = {
  /** Id du projet (clé du drill-down + lien). */
  id: string;
  /** Phase courante du projet (project_phase). */
  phase: string;
  /** Entrée dans la phase courante = started_at de la ligne phase_history ouverte. */
  startedAt: string;
  /** Libellé principal pour le drill-down (nom du client). */
  label: string;
  /** Sous-libellé (référence projet). */
  sublabel?: string;
  /** Chef de projet assigné (nom), pour savoir qui relancer. */
  chef?: string | null;
};

export type StuckResult = StuckInput & { days: number; level: StuckLevel };

/**
 * Projets qui stagnent dans leur phase au-delà du seuil.
 * L'appelant ne passe ici QUE les projets actifs et non-legacy.
 * Retourne uniquement les projets en alerte (orange ou rouge), triés du plus
 * bloqué au moins bloqué.
 */
export function computeStuck(rows: StuckInput[], today: Date = new Date()): StuckResult[] {
  return rows
    .map((r) => {
      const days = daysBetween(r.startedAt, today);
      return { ...r, days, level: stuckLevel(r.phase, days) };
    })
    .filter((r) => r.level !== 'ok')
    .sort((a, b) => b.days - a.days);
}

export type PhaseDurationInput = {
  phase: string;
  /** duration_days de la ligne phase_history (colonne générée). null si phase non terminée. */
  duration_days: number | null;
};

export type PhaseDurationResult = {
  phase: string;
  /** Durée moyenne en jours, arrondie. null si aucune phase franchie. */
  avgDays: number | null;
  /** Nombre de phases franchies servant au calcul (base). */
  count: number;
};

/**
 * Durée moyenne réelle de chaque phase, sur les phases FRANCHIES
 * (duration_days renseigné). L'appelant exclut déjà les projets perdus et legacy.
 * Retourne les 6 phases opérationnelles dans l'ordre du cycle (hors `termine`).
 */
export function computePhaseAvgDurations(rows: PhaseDurationInput[]): PhaseDurationResult[] {
  return LIFECYCLE_PHASES.filter((p) => p !== 'termine').map((phase) => {
    const ds = rows
      .filter((r) => r.phase === phase && r.duration_days != null)
      .map((r) => r.duration_days as number);
    const avgDays = ds.length
      ? Math.round(ds.reduce((s, d) => s + d, 0) / ds.length)
      : null;
    return { phase, avgDays, count: ds.length };
  });
}
