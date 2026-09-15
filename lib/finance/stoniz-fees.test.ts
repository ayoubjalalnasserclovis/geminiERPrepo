import { describe, it, expect } from 'vitest';
import {
  STONIZ_FEE_SCHEDULE,
  STONIZ_FEES_TOTAL,
  finalStonizFees,
  standardAmountForType,
  resolveStonizLabel,
  sumStonizSchedule,
} from './stoniz-fees';

describe('STONIZ_FEE_SCHEDULE', () => {
  it('contient exactement 5 milestones', () => {
    expect(STONIZ_FEE_SCHEDULE).toHaveLength(5);
  });

  it('total = 21 000 €', () => {
    expect(STONIZ_FEES_TOTAL).toBe(21_000);
  });

  it('décomposition correcte', () => {
    expect(STONIZ_FEE_SCHEDULE.map(m => m.amount)).toEqual([5_000, 3_800, 3_800, 4_200, 4_200]);
  });
});

describe('finalStonizFees', () => {
  it('retourne 21 000 € sans réduction', () => {
    expect(finalStonizFees()).toBe(21_000);
    expect(finalStonizFees(0)).toBe(21_000);
    expect(finalStonizFees(null)).toBe(21_000);
  });

  it('applique la réduction', () => {
    expect(finalStonizFees(1_000)).toBe(20_000);
    expect(finalStonizFees(5_000)).toBe(16_000);
  });

  it('ne peut pas devenir négatif', () => {
    expect(finalStonizFees(25_000)).toBe(0);
  });
});

describe('standardAmountForType', () => {
  it('retrouve le montant standard du barème', () => {
    expect(standardAmountForType('acompte_stoniz')).toBe(5_000);
    expect(standardAmountForType('honoraires_chantier')).toBe(4_200);
  });
  it('retourne 0 pour un type inconnu', () => {
    expect(standardAmountForType('autre')).toBe(0);
  });
});

describe('resolveStonizLabel', () => {
  it('priorise le libellé personnalisé', () => {
    expect(resolveStonizLabel('acompte_stoniz', 'Mon acompte')).toBe('Mon acompte');
  });
  it('retombe sur le libellé standard si vide', () => {
    expect(resolveStonizLabel('acompte_stoniz', '')).toBe('Acompte');
    expect(resolveStonizLabel('acompte_stoniz', null)).toBe('Acompte');
  });
});

describe('sumStonizSchedule', () => {
  it('somme les montants attendus hors type autre', () => {
    const rows = [
      { type: 'acompte_stoniz', amount_expected: 5_000 },
      { type: 'honoraires_compromis', amount_expected: 3_000 },
      { type: 'autre', amount_expected: 999 },
    ];
    expect(sumStonizSchedule(rows)).toBe(8_000);
  });
  it('reflète les montants sur-mesure', () => {
    const rows = STONIZ_FEE_SCHEDULE.map(m => ({ type: m.type, amount_expected: m.amount }));
    expect(sumStonizSchedule(rows)).toBe(STONIZ_FEES_TOTAL);
  });
});
