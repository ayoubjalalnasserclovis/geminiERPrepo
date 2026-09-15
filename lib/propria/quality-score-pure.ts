/**
 * Fonctions pures du score qualité Propria — extraites pour permettre les
 * tests sans dépendre de `server-only` (CEO 2026-06-18 chantier 1).
 *
 * Voir lib/propria/quality-score.ts pour la documentation complète de la formule.
 */

export type QualityPeriod = '30j' | '90j' | '12m';

export const QUALITY_PERIODS: { value: QualityPeriod; label: string; days: number }[] = [
  { value: '30j', label: '30 jours', days: 30 },
  { value: '90j', label: '90 jours', days: 90 },
  { value: '12m', label: '12 mois', days: 365 },
];

export function qualityPeriodDays(period: QualityPeriod): number {
  return QUALITY_PERIODS.find((p) => p.value === period)?.days ?? 90;
}

export type Freshness = 'recent' | 'soon' | 'late' | 'none';

export type QualityScoreInput = {
  avgRating: number | null;
  daysSinceCleaning: number | null;
  checkupDaysLate: number | null;
  openLitiges: number;
  openNegativePreReviews: number;
};

export type QualityScoreBreakdown = {
  score: number;
  reviews: number | null;
  cleaning: number | null;
  checkup: number | null;
  litiges: number;
  preventifs: number;
  availableWeight: number;
};

/** Score qualité consolidé /100 — voir la formule documentée en tête de fichier. */
export function computeQualityScore(input: QualityScoreInput): QualityScoreBreakdown {
  const reviews =
    input.avgRating == null ? null : (Math.min(Math.max(input.avgRating, 0), 5) / 5) * 40;

  let cleaning: number | null = null;
  if (input.daysSinceCleaning != null) {
    cleaning =
      input.daysSinceCleaning <= 7
        ? 15
        : Math.max(0, 15 * (1 - (input.daysSinceCleaning - 7) / 23)); // 0 pt à 30 j
  }

  let checkup: number | null = null;
  if (input.checkupDaysLate != null) {
    checkup =
      input.checkupDaysLate <= 0
        ? 15
        : Math.max(0, 15 * (1 - input.checkupDaysLate / 90)); // 0 pt à 90 j de retard
  }

  const litiges = Math.max(0, 15 - 5 * input.openLitiges);
  const preventifs = Math.max(0, 15 - 5 * input.openNegativePreReviews);

  let points = litiges + preventifs;
  let weight = 30;
  if (reviews != null) { points += reviews; weight += 40; }
  if (cleaning != null) { points += cleaning; weight += 15; }
  if (checkup != null) { points += checkup; weight += 15; }

  return {
    score: Math.round((points / weight) * 100),
    reviews, cleaning, checkup, litiges, preventifs,
    availableWeight: weight,
  };
}

export function cleaningFreshness(daysSince: number | null): Freshness {
  if (daysSince == null) return 'none';
  if (daysSince < 7) return 'recent';
  if (daysSince <= 14) return 'soon';
  return 'late';
}

export function checkupFreshness(daysLate: number | null, daysUntilDue: number | null): Freshness {
  if (daysLate == null) return 'none';
  if (daysLate > 0) return 'late';
  if (daysUntilDue != null && daysUntilDue <= 14) return 'soon';
  return 'recent';
}

export function deepCleaningFreshness(
  staysSince: number | null,
  everyStays: number,
  daysSince: number | null,
): Freshness {
  if (daysSince == null) return 'none';
  if (staysSince != null) {
    if (staysSince >= everyStays) return 'late';
    if (staysSince >= Math.max(1, everyStays - 2)) return 'soon';
    return 'recent';
  }
  if (daysSince > 90) return 'late';
  if (daysSince >= 75) return 'soon';
  return 'recent';
}

export function maintenanceFreshness(
  hasAnyVisit: boolean,
  hasOverdueOpenVisit: boolean,
  daysUntilNextDue: number | null,
): Freshness {
  if (!hasAnyVisit) return 'none';
  if (hasOverdueOpenVisit) return 'late';
  if (daysUntilNextDue != null && daysUntilNextDue <= 14) return 'soon';
  return 'recent';
}
