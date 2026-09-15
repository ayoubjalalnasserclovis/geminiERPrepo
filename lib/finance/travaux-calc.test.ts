import { describe, it, expect } from 'vitest';
import { calculateTravauxKPIs, type LotInput } from './travaux-calc';

/**
 * SMOKE TEST — prouve que l'infra Vitest tourne et que le canon de calcul
 * travaux (validé CEO 2026-05-30) tient sur le KPI le plus sensible : la marge brute.
 *
 *   marge_brute = facture_client − devis_artisans
 *
 * On teste le COMPORTEMENT (la valeur calculée), pas l'implémentation.
 */
describe('calculateTravauxKPIs · marge brute', () => {
  it('Test Karim Zaidi · Marge positive (facture > devis)', () => {
    const lots: LotInput[] = [
      { id: 'lot-cuisine', budget_estimate_mad: 100_000, devis_artisan_mad: 60_000, facture_client_mad: 80_000, status: 'termine' },
      { id: 'lot-salle-bain', budget_estimate_mad: 50_000, devis_artisan_mad: 30_000, facture_client_mad: 40_000, status: 'en_cours' },
    ];

    const kpis = calculateTravauxKPIs({
      lots,
      payments: [{ lot_id: 'lot-cuisine', amount_paid: 50_000 }],
      encaissements: [{ amount_mad: 70_000 }],
      budgetVenduClient: 0, // teste le repli facture-par-lot
    });

    // Le KPI au cœur du smoke : marge brute = 120 000 − 90 000 = 30 000 MAD.
    expect(kpis.marge_brute).toBe(30_000);

    // Quelques dérivés pour cadrer le comportement attendu.
    expect(kpis.facture_client_total).toBe(120_000);
    expect(kpis.devis_artisans_total).toBe(90_000);
    // Canon 2026-06-02 : marge_cible = REFERENCE_CLIENT × marge_cible_pct.
    // Ici budgetVenduClient non fourni → REFERENCE = facture_client_total (120 000),
    // pct par défaut 30 % → marge_cible = 36 000. (QA-BUG-018 : assertions
    // alignées sur le canon en vigueur, l'ancienne formule budget−devis est retirée.)
    expect(kpis.marge_cible_mad).toBe(36_000);
    expect(kpis.ecart_marge).toBe(-6_000); // marge réelle 30 000 − cible 36 000
    expect(kpis.marge_pct).toBe(25); // 30 000 / 120 000
    expect(kpis.tresorerie_a_date).toBe(20_000); // encaissé 70 000 − payé 50 000
    expect(kpis.anomalie_surencaissement).toBe(false);
    expect(kpis.anomalie_surpaiement).toBe(false);
  });

  it('Test Sofia Bennani · Marge négative (devis > facture)', () => {
    const lots: LotInput[] = [
      { id: 'lot-gros-oeuvre', budget_estimate_mad: 90_000, devis_artisan_mad: 100_000, facture_client_mad: 80_000, status: 'en_cours' },
    ];

    const kpis = calculateTravauxKPIs({ lots, payments: [], encaissements: [], budgetVenduClient: 0 });

    // Devis (100 000) > facture (80 000) → perte facturée de 20 000 MAD.
    expect(kpis.marge_brute).toBe(-20_000);
  });

  it('exclut les encaissements planifiés (status=planifie) de l\'encaissé', () => {
    const kpis = calculateTravauxKPIs({
      lots: [],
      payments: [],
      budgetVenduClient: 1_000_000,
      encaissements: [
        { amount_mad: 253_900, status: 'recu' },
        { amount_mad: 126_949, status: 'planifie' }, // futur → ne compte PAS
        { amount_mad: 100_000 },                      // pas de status → 'recu' par défaut
      ],
    });
    expect(kpis.total_encaisse_client).toBe(353_900); // 253900 + 100000, PAS le planifié
    expect(kpis.reste_a_encaisser_client).toBe(646_100); // 1 000 000 − 353 900
  });

  it('Aucun lot · tout à zéro, aucune division par zéro', () => {
    const kpis = calculateTravauxKPIs({ lots: [], payments: [], encaissements: [], budgetVenduClient: 0 });
    expect(kpis.marge_brute).toBe(0);
    expect(kpis.marge_pct).toBe(0); // pas de NaN malgré facture = 0
  });
});
