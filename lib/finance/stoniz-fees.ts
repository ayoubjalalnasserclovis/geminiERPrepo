/**
 * Honoraires Stoniz — 5 paiements fixes (total 21 000 €).
 * Le calcul % du prix bien (legacy) a été retiré : les honoraires sont
 * un forfait fixe peu importe la valeur du bien.
 */
export const STONIZ_FEE_SCHEDULE = [
  { type: 'acompte_stoniz',       label: 'Acompte',                            amount: 5_000, due_at_phase: 'onboarding' },
  { type: 'honoraires_compromis', label: 'Signature compromis',                amount: 3_800, due_at_phase: 'sourcing'   },
  { type: 'honoraires_3d',        label: 'Présentation 3D & lots techniques',  amount: 3_800, due_at_phase: 'design'     },
  { type: 'honoraires_chantier',  label: 'Lancement de chantier',              amount: 4_200, due_at_phase: 'travaux'    },
  { type: 'honoraires_livraison', label: 'Livraison de chantier',              amount: 4_200, due_at_phase: 'livraison'  },
] as const;

export const STONIZ_FEES_TOTAL = STONIZ_FEE_SCHEDULE.reduce((s, m) => s + m.amount, 0);
// = 21 000 €

export function finalStonizFees(reduction: number | null | undefined = 0): number {
  return Math.max(STONIZ_FEES_TOTAL - (reduction ?? 0), 0);
}

/** Montant standard du barème pour un type d'échéance (fallback si pas de ligne). */
export function standardAmountForType(type: string): number {
  return STONIZ_FEE_SCHEDULE.find(m => m.type === type)?.amount ?? 0;
}

/**
 * Libellé d'une échéance : libellé personnalisé saisi par le CEO s'il existe,
 * sinon le libellé standard du barème, sinon le type brut.
 */
export function resolveStonizLabel(type: string, customLabel?: string | null): string {
  if (customLabel && customLabel.trim() !== '') return customLabel.trim();
  return STONIZ_FEE_SCHEDULE.find(m => m.type === type)?.label ?? type;
}

/**
 * Total honoraires d'un projet, dérivé des échéances réelles (hors type 'autre').
 * Miroir applicatif de la vue SQL project_honoraires_totals — source unique.
 */
export function sumStonizSchedule(
  payments: { type: string; amount_expected: number | string }[],
): number {
  return payments
    .filter(p => p.type !== 'autre')
    .reduce((s, p) => s + Number(p.amount_expected), 0);
}
