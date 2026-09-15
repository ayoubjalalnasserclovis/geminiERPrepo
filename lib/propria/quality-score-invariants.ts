/**
 * Invariants du score qualité Propria (chantier 1 — CEO 2026-06-18).
 *
 * À exécuter manuellement après TOUTE modification de computeQualityScore :
 *   npx tsx --tsconfig tsconfig.test.json lib/propria/quality-score-invariants.ts
 *
 * Ou plus simple :
 *   node -e "require('tsx/cjs'); require('module')._cache['server-only']={exports:{}}; require('./lib/propria/quality-score-invariants.ts').runQualityScoreInvariants()"
 *
 * Pas branché en CI (pas de framework de test) mais sert de documentation
 * vivante. Si un cas crashe → la formule a changé → re-valider avec le CEO.
 */

// Import depuis le module pure (sans server-only) pour permettre l'exécution
// en standalone (npx tsx ...). Côté app, importe `from './quality-score'`.
import { computeQualityScore } from './quality-score-pure';

type Case = { name: string; input: Parameters<typeof computeQualityScore>[0]; expected: { score: number; tolerance?: number } };

const CASES: Case[] = [
  {
    name: 'Tout plein — note 5/5, ménage récent, check-up à jour, 0 litige, 0 préventif',
    input: { avgRating: 5, daysSinceCleaning: 3, checkupDaysLate: 0, openLitiges: 0, openNegativePreReviews: 0 },
    expected: { score: 100 },
  },
  {
    name: 'Tout vide — aucune donnée nulle part',
    input: { avgRating: null, daysSinceCleaning: null, checkupDaysLate: null, openLitiges: 0, openNegativePreReviews: 0 },
    // 0 litige + 0 préventif = 30/30 = 100 (renormalisé sur les composantes dispo)
    expected: { score: 100 },
  },
  {
    name: 'Sans avis mais reste correct',
    input: { avgRating: null, daysSinceCleaning: 5, checkupDaysLate: 0, openLitiges: 0, openNegativePreReviews: 0 },
    // 15+15+15+15 = 60 / 60 = 100
    expected: { score: 100 },
  },
  {
    name: 'Note 4/5, ménage J-10, check-up à jour, 1 litige, 0 préventif',
    input: { avgRating: 4, daysSinceCleaning: 10, checkupDaysLate: 0, openLitiges: 1, openNegativePreReviews: 0 },
    // reviews = 4/5×40 = 32
    // cleaning = 15×(1-(10-7)/23) = 15×(20/23) ≈ 13.04
    // checkup = 15
    // litiges = 15-5 = 10
    // preventifs = 15
    // total = 32 + 13.04 + 15 + 10 + 15 = 85.04 / 100 × 100 = ~85
    expected: { score: 85, tolerance: 1 },
  },
  {
    name: '3 litiges ouverts — composante litiges à 0 (clamp)',
    input: { avgRating: 5, daysSinceCleaning: 3, checkupDaysLate: 0, openLitiges: 3, openNegativePreReviews: 0 },
    // 40 + 15 + 15 + 0 + 15 = 85 / 100 = 85
    expected: { score: 85 },
  },
  {
    name: 'Ménage à J-30 (limite) — composante ménage à 0',
    input: { avgRating: 5, daysSinceCleaning: 30, checkupDaysLate: 0, openLitiges: 0, openNegativePreReviews: 0 },
    // 40 + 0 + 15 + 15 + 15 = 85 / 100 = 85
    expected: { score: 85 },
  },
  {
    name: 'Check-up en retard de 45j — composante check-up à 7.5',
    input: { avgRating: 5, daysSinceCleaning: 3, checkupDaysLate: 45, openLitiges: 0, openNegativePreReviews: 0 },
    // checkup = 15×(1-45/90) = 7.5
    // 40 + 15 + 7.5 + 15 + 15 = 92.5 → arrondi 93
    expected: { score: 93 },
  },
  {
    name: 'Renormalisation : SEULES les composantes dispo sont pondérées',
    input: { avgRating: null, daysSinceCleaning: null, checkupDaysLate: null, openLitiges: 1, openNegativePreReviews: 1 },
    // litiges = 10, preventifs = 10, poids = 30
    // (10+10) / 30 × 100 = ~67
    expected: { score: 67 },
  },
];

function assertCase(c: Case): { passed: boolean; got: number; detail: string } {
  const got = computeQualityScore(c.input);
  const tol = c.expected.tolerance ?? 0;
  const passed = Math.abs(got.score - c.expected.score) <= tol;
  return {
    passed,
    got: got.score,
    detail: `score=${got.score} reviews=${got.reviews} cleaning=${got.cleaning} checkup=${got.checkup} litiges=${got.litiges} preventifs=${got.preventifs} weight=${got.availableWeight}`,
  };
}

export function runQualityScoreInvariants(): { passed: number; failed: number; cases: Array<{ name: string; passed: boolean; got: number; expected: number; detail: string }> } {
  const results = CASES.map((c) => {
    const r = assertCase(c);
    return { name: c.name, passed: r.passed, got: r.got, expected: c.expected.score, detail: r.detail };
  });
  return {
    passed: results.filter((r) => r.passed).length,
    failed: results.filter((r) => !r.passed).length,
    cases: results,
  };
}

// Exécution directe (npx tsx ...) — affiche un résumé
if (require.main === module) {
  const out = runQualityScoreInvariants();
  for (const r of out.cases) {
    const status = r.passed ? '✓' : '✗';
    console.log(`${status} ${r.name}`);
    console.log(`   expected=${r.expected} got=${r.got}`);
    if (!r.passed) console.log(`   detail: ${r.detail}`);
  }
  console.log(`\n${out.passed} passed, ${out.failed} failed (${CASES.length} total)`);
  if (out.failed > 0) process.exit(1);
}
