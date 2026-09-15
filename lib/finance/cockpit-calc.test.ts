import { describe, it, expect } from 'vitest';
import { computeCockpit } from './cockpit-calc';

/**
 * QA-BUG-023 — clients_en_retard doit être RECALCULÉ (échéance passée + non soldé),
 * jamais lu depuis payments.status='overdue' (non maintenu en prod).
 */
describe('computeCockpit · clients_en_retard (QA-BUG-023)', () => {
  const today = new Date('2026-06-13');
  const base = { lots: [], forfaits: [], payments: [], encaissements: [] };

  it('compte une échéance dépassée ET non soldée même si status ≠ overdue', () => {
    const k = computeCockpit({
      ...base,
      honoraires: [
        { project_id: 'p1', amount_expected: 4200, amount_paid: 2400, status: 'partial', due_date: '2026-05-30', paid_at: null },
      ],
      today,
    });
    expect(k.clients_en_retard).toBe(1800); // 4200 − 2400
  });

  it('ignore une échéance future et une échéance soldée', () => {
    const k = computeCockpit({
      ...base,
      honoraires: [
        { project_id: 'p1', amount_expected: 5000, amount_paid: 0, status: 'pending', due_date: '2026-12-31', paid_at: null }, // future
        { project_id: 'p2', amount_expected: 3800, amount_paid: 3800, status: 'paid', due_date: '2026-01-01', paid_at: '2026-01-02' }, // soldée
      ],
      today,
    });
    expect(k.clients_en_retard).toBe(0);
  });

  it('ne se fie PAS au status overdue stocké si le montant est soldé', () => {
    const k = computeCockpit({
      ...base,
      honoraires: [
        { project_id: 'p1', amount_expected: 5000, amount_paid: 5000, status: 'overdue', due_date: '2026-05-01', paid_at: '2026-05-02' },
      ],
      today,
    });
    expect(k.clients_en_retard).toBe(0);
  });
});

/**
 * QA-BUG-020 — la base chantier du cockpit = FORFAIT VENDU (reference_mad), pas
 * la facture par lot. Marge = référence − devis ; écart = marge réelle − marge
 * cible. Les projets sans référence (ni forfait ni facture) sont exclus de la
 * marge et comptés à part (faux rouge interdit par le canon UX).
 */
describe('computeCockpit · base chantier = forfait vendu (QA-BUG-020)', () => {
  const today = new Date('2026-06-13');
  const base = { honoraires: [], payments: [], encaissements: [] };

  it('base le facturé chantier sur le forfait, pas sur la facture par lot', () => {
    const k = computeCockpit({
      ...base,
      // facture par lot volontairement absurde (5 MAD) → doit être ignorée
      lots: [{ project_id: 'p1', budget_mad: 0, devis_mad: 70000, facture_mad: 5 }],
      forfaits: [{ project_id: 'p1', reference_mad: 100000, marge_cible_mad: 30000 }],
      today,
    });
    expect(k.fac_chantier).toBe(10000);              // 100000 / 10 (forfait, PAS 0.5)
    expect(k.devis_chantier).toBe(7000);             // 70000 / 10
    expect(k.marge_chantier).toBe(3000);             // (100000 − 70000) / 10
    expect(k.taux_marge_chantier).toBe(30);          // 30000 / 100000
    expect(k.ecart_marge).toBe(0);                   // marge 3000 − cible 3000
    expect(k.projets_sans_reference).toBe(0);
    expect(k.volume_facture_total).toBe(10000);      // honoraires 0 + forfait
  });

  it('exclut de la marge un projet sans référence (ni forfait ni facture) et le compte', () => {
    const k = computeCockpit({
      ...base,
      lots: [
        { project_id: 'p1', budget_mad: 0, devis_mad: 80000, facture_mad: 0 }, // a un forfait
        { project_id: 'p2', budget_mad: 0, devis_mad: 50000, facture_mad: 0 }, // sans référence
      ],
      forfaits: [
        { project_id: 'p1', reference_mad: 120000, marge_cible_mad: 36000 },
        { project_id: 'p2', reference_mad: 0, marge_cible_mad: 0 },
      ],
      today,
    });
    // p2 (devis sans référence) ne pèse PAS sur la marge
    expect(k.marge_chantier).toBe(4000);             // (120000 − 80000) / 10
    expect(k.taux_marge_chantier).toBe(33.3);        // 40000 / 120000
    expect(k.projets_sans_reference).toBe(1);        // p2
    expect(k.fac_chantier).toBe(12000);              // seul p1 a une référence
  });
});
