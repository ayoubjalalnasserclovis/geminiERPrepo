import { describe, it, expect } from 'vitest';
import {
  calculateTravauxKPIs,
  type LotInput,
  type PaymentInput,
  type EncaissementInput,
} from '@/lib/finance/travaux-calc';

describe('Multi-Step Workflow: Project P&L, Margin Tracking & Cashflow Integrity', () => {
  it('Step 1 -> 5: Sold Budget -> Signed Lots -> Planned & Received Cash -> Margin Convergence', () => {
    // 1. Initial configuration: Sold package = 400,000 MAD, Target margin = 25% (100,000 MAD target)
    const budgetVenduClient = 400000;
    const margeCiblePct = 25;

    // 2. Negotiated and signed lots with artisans (Total signed = 280,000 MAD)
    const lots: LotInput[] = [
      { id: 'lot-gros-oeuvre', budget_estimate_mad: 160000, devis_artisan_mad: 150000, facture_client_mad: 200000, status: 'en_cours' },
      { id: 'lot-plomberie', budget_estimate_mad: 70000, devis_artisan_mad: 65000, facture_client_mad: 100000, status: 'en_cours' },
      { id: 'lot-finitions', budget_estimate_mad: 70000, devis_artisan_mad: 65000, facture_client_mad: 100000, status: 'a_planifier' },
    ];

    // 3. Client deposits: 1 received (200,000 MAD), 1 planned future (200,000 MAD)
    const encaissements: EncaissementInput[] = [
      { amount_mad: 200000, status: 'recu' },
      { amount_mad: 200000, status: 'planifie' }, // Must not inflate actual received cash
    ];

    // 4. Artisan payments executed: 100,000 MAD to gros-oeuvre
    const payments: PaymentInput[] = [
      { lot_id: 'lot-gros-oeuvre', amount_paid: 100000 },
    ];

    // 5. Compute consolidated KPIs
    const kpis = calculateTravauxKPIs({
      lots,
      payments,
      encaissements,
      budgetVenduClient,
      margeCiblePct,
    });

    // Verify Engagement metrics
    expect(kpis.reference_client_mad).toBe(400000);
    expect(kpis.devis_artisans_total).toBe(280000);
    expect(kpis.marge_cible_mad).toBe(100000); // 25% of 400k
    expect(kpis.marge_reelle).toBe(120000);    // 400k - 280k
    expect(kpis.marge_pct).toBe(30);           // 120k / 400k = 30%
    expect(kpis.ecart_marge).toBe(20000);      // 120k - 100k = +20k ahead of target

    // Verify Treasury & Cashflow metrics
    expect(kpis.total_encaisse_client).toBe(200000); // Only 'recu' counted
    expect(kpis.total_paye_artisans).toBe(100000);
    expect(kpis.tresorerie_a_date).toBe(100000);     // 200k in - 100k out
    expect(kpis.reste_a_encaisser_client).toBe(200000); // 400k - 200k
    expect(kpis.reste_a_payer_artisans).toBe(180000);   // 280k - 100k
    expect(kpis.reste_net_a_venir).toBe(20000);         // 200k in future - 180k out future

    // Ensure no integrity anomaly
    expect(kpis.anomalie_surencaissement).toBe(false);
    expect(kpis.anomalie_surpaiement).toBe(false);
  });

  it('Margin variance warning: Cost overrun on artisan quotes triggers negative ecart_marge', () => {
    const budgetVenduClient = 300000;
    const margeCiblePct = 30; // Target = 90,000 MAD

    // Artisan devis exploded to 250,000 MAD (exceeding budget)
    const lots: LotInput[] = [
      { id: 'lot-1', budget_estimate_mad: 180000, devis_artisan_mad: 250000, facture_client_mad: 300000, status: 'en_cours' },
    ];

    const kpis = calculateTravauxKPIs({
      lots,
      payments: [],
      encaissements: [],
      budgetVenduClient,
      margeCiblePct,
    });

    expect(kpis.marge_reelle).toBe(50000);   // 300k - 250k
    expect(kpis.marge_cible_mad).toBe(90000); // 30% of 300k
    expect(kpis.ecart_marge).toBe(-40000);   // -40,000 MAD deficit vs target
    expect(kpis.marge_pct).toBe(16.7);
  });

  it('Integrity controls: Flag anomalie_surpaiement and anomalie_surencaissement', () => {
    const budgetVenduClient = 100000;

    const lots: LotInput[] = [
      { id: 'lot-1', budget_estimate_mad: 50000, devis_artisan_mad: 50000, facture_client_mad: 100000, status: 'termine' },
    ];

    // Overpaid artisan (60k paid vs 50k devis)
    const payments: PaymentInput[] = [
      { lot_id: 'lot-1', amount_paid: 60000 },
    ];

    // Overcollected from client (110k received vs 100k sold)
    const encaissements: EncaissementInput[] = [
      { amount_mad: 110000, status: 'recu' },
    ];

    const kpis = calculateTravauxKPIs({
      lots,
      payments,
      encaissements,
      budgetVenduClient,
    });

    expect(kpis.anomalie_surpaiement).toBe(true);
    expect(kpis.anomalie_surencaissement).toBe(true);
  });

  it('Graceful fallback: when project forfait is 0, reference falls back to sum of lot invoices', () => {
    const lots: LotInput[] = [
      { id: 'lot-1', budget_estimate_mad: 40000, devis_artisan_mad: 35000, facture_client_mad: 60000, status: 'en_cours' },
      { id: 'lot-2', budget_estimate_mad: 40000, devis_artisan_mad: 35000, facture_client_mad: 60000, status: 'en_cours' },
    ];

    const kpis = calculateTravauxKPIs({
      lots,
      payments: [],
      encaissements: [],
      budgetVenduClient: 0, // Not configured in project header
      margeCiblePct: 20,
    });

    expect(kpis.budget_vendu_client).toBe(0);
    expect(kpis.reference_client_mad).toBe(120000); // 60k + 60k
    expect(kpis.marge_reelle).toBe(50000);          // 120k - 70k
    expect(kpis.marge_cible_mad).toBe(24000);       // 20% of 120k
    expect(kpis.ecart_marge).toBe(26000);
  });
});
