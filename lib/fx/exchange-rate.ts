import 'server-only';

/**
 * Taux de change EUR ↔ MAD.
 * Décision Stoniz : taux FIXE 1 EUR = 10 MAD pour toutes les opérations comptables.
 */
export const EUR_TO_MAD_FIXED = 10;

export async function getEurMadRate(): Promise<{ rate: number; at: Date; source: string }> {
  return { rate: EUR_TO_MAD_FIXED, at: new Date(), source: 'fixe (1 EUR = 10 MAD)' };
}

export function eurToMad(eur: number | null | undefined): number {
  return Math.round(Number(eur ?? 0) * EUR_TO_MAD_FIXED);
}

export function madToEur(mad: number | null | undefined): number {
  return Math.round((Number(mad ?? 0) / EUR_TO_MAD_FIXED) * 100) / 100;
}
