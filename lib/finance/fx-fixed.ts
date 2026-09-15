/**
 * Taux de change interne FIXE : 10 DH = 1 € (règle CEO 2026-05-30).
 *
 * Utilisé pour consolider en euros les montants en dirhams (travaux, achats,
 * caisses Propria) sur le cockpit et le reporting agrégé. Volontairement simple
 * et stable — ne suit pas le marché.
 *
 * Pendant ce temps, chaque transaction individuelle peut continuer de figer son
 * propre taux réel au moment de la saisie (cf. lib/fx/exchange-rate.ts) ; ce
 * module-ci ne concerne QUE la consolidation des agrégats.
 */
export const MAD_PER_EUR = 10;

/** Convertit un montant MAD en EUR au taux interne fixe (arrondi au centime). */
export function madToEur(mad: number | null | undefined): number {
  return Math.round(((mad ?? 0) / MAD_PER_EUR) * 100) / 100;
}

/** Convertit un montant EUR en MAD au taux interne fixe (arrondi au centime). */
export function eurToMad(eur: number | null | undefined): number {
  return Math.round(((eur ?? 0) * MAD_PER_EUR) * 100) / 100;
}
