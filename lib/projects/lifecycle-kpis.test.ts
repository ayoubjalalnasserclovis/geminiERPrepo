import { describe, it, expect } from 'vitest';
import {
  PHASE_STUCK_THRESHOLDS,
  STUCK_RED_FACTOR,
  stuckLevel,
  daysBetween,
  computeStuck,
  computePhaseAvgDurations,
  type StuckInput,
} from './lifecycle-kpis';

const TODAY = new Date('2026-05-31T12:00:00Z');
const daysAgo = (n: number) =>
  new Date(TODAY.getTime() - n * 86_400_000).toISOString();

describe('PHASE_STUCK_THRESHOLDS (seuils validés CEO)', () => {
  it('valeurs verrouillées 2026-05-31', () => {
    expect(PHASE_STUCK_THRESHOLDS).toEqual({
      onboarding: 7,
      sourcing: 30,
      design: 21,
      travaux: 90,
      livraison: 14,
      mise_en_location: 10,
    });
  });
  it('escalade rouge à 1,5x', () => {
    expect(STUCK_RED_FACTOR).toBe(1.5);
  });
});

describe('stuckLevel', () => {
  it('sous le seuil = ok', () => {
    expect(stuckLevel('onboarding', 5)).toBe('ok');
    expect(stuckLevel('onboarding', 7)).toBe('ok'); // pile au seuil = pas encore dépassé
  });
  it('au-delà du seuil = orange', () => {
    expect(stuckLevel('onboarding', 8)).toBe('orange');
    expect(stuckLevel('travaux', 100)).toBe('orange');
  });
  it('au-delà de 1,5x = rouge', () => {
    expect(stuckLevel('onboarding', 11)).toBe('red'); // 7 * 1.5 = 10.5
    expect(stuckLevel('travaux', 136)).toBe('red'); // 90 * 1.5 = 135
  });
  it('phase sans seuil (termine) = ok', () => {
    expect(stuckLevel('termine', 999)).toBe('ok');
  });
});

describe('daysBetween', () => {
  it('compte les jours pleins', () => {
    expect(daysBetween(daysAgo(10), TODAY)).toBe(10);
  });
});

describe('computeStuck', () => {
  const rows: StuckInput[] = [
    { id: 'a', phase: 'design', startedAt: daysAgo(5), label: 'Client A' }, // 5 < 21 → ok
    { id: 'b', phase: 'design', startedAt: daysAgo(25), label: 'Client B' }, // 25 > 21 → orange
    { id: 'c', phase: 'onboarding', startedAt: daysAgo(40), label: 'Client C' }, // 40 > 10.5 → red
    { id: 'd', phase: 'termine', startedAt: daysAgo(500), label: 'Client D' }, // pas de seuil → ok
  ];

  it('ne retourne que les projets en alerte', () => {
    const res = computeStuck(rows, TODAY);
    expect(res.map((r) => r.id)).toEqual(['c', 'b']); // triés du plus bloqué au moins
  });

  it('attribue le bon niveau et le bon nombre de jours', () => {
    const res = computeStuck(rows, TODAY);
    const c = res.find((r) => r.id === 'c')!;
    expect(c.level).toBe('red');
    expect(c.days).toBe(40);
    const b = res.find((r) => r.id === 'b')!;
    expect(b.level).toBe('orange');
  });

  it('liste vide si rien ne stagne', () => {
    expect(computeStuck([rows[0], rows[3]], TODAY)).toEqual([]);
  });
});

describe('computePhaseAvgDurations', () => {
  it('moyenne par phase, arrondie, sur les phases franchies', () => {
    const res = computePhaseAvgDurations([
      { phase: 'onboarding', duration_days: 10 },
      { phase: 'onboarding', duration_days: 20 },
      { phase: 'design', duration_days: 7 },
      { phase: 'design', duration_days: null }, // ignoré
    ]);
    const onb = res.find((r) => r.phase === 'onboarding')!;
    expect(onb.avgDays).toBe(15);
    expect(onb.count).toBe(2);
    const design = res.find((r) => r.phase === 'design')!;
    expect(design.avgDays).toBe(7);
    expect(design.count).toBe(1);
  });

  it('retourne les 6 phases opérationnelles, null si aucune donnée', () => {
    const res = computePhaseAvgDurations([]);
    expect(res).toHaveLength(6); // hors termine
    expect(res.every((r) => r.avgDays === null && r.count === 0)).toBe(true);
    expect(res.map((r) => r.phase)).not.toContain('termine');
  });
});
