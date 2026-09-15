/**
 * Cockpit financier CEO — consolidation EUR des 3 étages.
 * Fonction pure, aucune valeur stockée (canon : dérivés jamais persistés).
 * Spéc complète : docs/KPI-FINANCIERS-REFERENTIEL.md
 *
 * ─── Conventions ────────────────────────────────────────────────────────────
 * Devise : tout en EUR. Taux fixe historisé 1 EUR = 10 MAD (canon). MAD ÷ 10.
 * Perdus : les lignes passées ici sont déjà filtrées (projets perdus exclus).
 *
 * Deux dimensions distinctes, jamais confondues (décision CEO 2026-05-31) :
 *   • TRÉSORERIE = encaissé − payé          → "combien j'ai en poche maintenant"
 *   • MARGE      = référence − devis         → "l'affaire est-elle rentable"
 *
 * ─── Référence chantier = FORFAIT VENDU (QA-BUG-020, décision CEO 2026-06-13) ─
 * Le canon travaux/achats (travaux-calc.ts, achats-calc.ts) impose : la
 * FACTURE_CLIENT par lot est saisie mais SORTIE des KPI consolidés. La référence
 * client = le forfait vendu (projects.travaux_budget_mad + achats_budget_mad),
 * avec repli sur la facture par lot quand le forfait = 0 (projet pas configuré).
 * Le cockpit consomme donc une référence et une marge cible déjà calculées par
 * projet (champ `forfaits`, construit en amont comme les dashboards travaux/achats).
 *
 * Marge : seuls les projets dont la référence est renseignée (> 0) entrent dans
 * la marge et le taux. Un projet avec devis mais sans référence sortirait une
 * marge faussement négative (faux rouge interdit par le canon UX) → exclu +
 * compté dans `projets_sans_reference`.
 * ──────────────────────────────────────────────────────────────────────────
 */

/** Taux fixe historisé : 1 EUR = 10 MAD. */
export const MAD_TO_EUR = 1 / 10;

/** Cible de taux de marge sur les chantiers (travaux + achats), en %. */
export const TAUX_MARGE_CHANTIER_CIBLE = 30;

function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}
function eur(mad: number | string | null | undefined): number {
  return n(mad) * MAD_TO_EUR;
}

/** Échéance d'honoraires Stoniz (EUR). Hors type 'autre' attendu en amont. */
export type CockpitHonoraire = {
  project_id: string;
  amount_expected: number | string | null;
  amount_paid: number | string | null;
  status: string | null;
  due_date: string | null;
  paid_at: string | null;
};

/** Lot chantier normalisé (travaux OU achats), montants MAD. */
export type CockpitLot = {
  project_id: string;
  budget_mad: number | string | null;
  devis_mad: number | string | null;
  facture_mad: number | string | null;
};

/**
 * Référence chantier par projet (forfait vendu), MAD. Calculée en amont comme
 * dans travaux-calc / achats-calc : reference = forfait si renseigné, sinon
 * repli sur la somme des factures par lot ; marge cible = reference × cible_pct
 * (30 % travaux / 25 % achats par défaut), sommée par discipline.
 */
export type CockpitForfait = {
  project_id: string;
  reference_mad: number | string | null;
  marge_cible_mad: number | string | null;
};

/** Versement à un prestataire (artisan ou fournisseur), MAD. */
export type CockpitPayment = {
  project_id: string;
  amount_total: number | string | null;
  amount_paid: number | string | null;
  scheduled_date: string | null;
  paid_at: string | null;
  status: string | null;
};

/** Règlement reçu d'un client pour les chantiers, MAD. */
export type CockpitEncaissement = {
  project_id: string;
  amount_mad: number | string | null;
  received_at: string | null;
};

export type CockpitKPIs = {
  // ─── Étage 1 — Santé cash (EUR) ─────────────────────────────────────────
  encaisse_total: number;
  paye_total: number;
  facture_total: number;
  devis_total: number;
  tresorerie: number;          // encaissé − payé
  reste_a_encaisser: number;   // référence (forfait) − encaissé
  reste_a_payer: number;       // devis − payé
  reste_net: number;           // reste_a_encaisser − reste_a_payer
  clients_en_retard: number;   // honoraires en retard (recalculé : échéance passée + non soldé)
  sorties_90j: number;         // versements prestataires dus sous 90j

  // ─── Étage 2 — Rentabilité (EUR) ────────────────────────────────────────
  marge_brute: number;            // honoraires attendus + marge chantier (forfait − devis)
  marge_chantier: number;         // référence − devis (projets avec référence)
  taux_marge_chantier: number;    // marge_chantier / référence chantier × 100
  ecart_marge: number;            // marge réelle − marge cible
  anomalies: number;              // nb projets sur-encaissés ou sur-payés
  projets_sans_reference: number; // projets avec devis mais sans référence (ni forfait ni facture)
  lots_total: number;

  // ─── Étage 3 — Croissance (EUR) ─────────────────────────────────────────
  volume_facture_total: number;   // honoraires attendus + référence chantier (forfait)
  pipeline_90j: number;           // honoraires attendus à échéance ≤ 90j

  // ─── Détail des composantes (pour les tiroirs de drill-down) ────────────
  enc_honoraires: number;
  enc_chantier: number;
  fac_honoraires: number;
  fac_chantier: number;           // référence chantier (forfait), EUR
  devis_chantier: number;
  pay_chantier: number;
};

export function computeCockpit({
  honoraires,
  lots,
  forfaits,
  payments,
  encaissements,
  today = new Date(),
  since = null,
}: {
  honoraires: CockpitHonoraire[];
  lots: CockpitLot[];
  forfaits: CockpitForfait[];
  payments: CockpitPayment[];
  encaissements: CockpitEncaissement[];
  today?: Date;
  /**
   * Date plancher pour les FLUX datés (trésorerie). Les mouvements d'argent
   * (encaissé / payé) antérieurs à `since` sont ignorés. Les soldes (restes,
   * marges) restent calculés sur la totalité des lots ouverts.
   * null = pas de filtre (tout-temps).
   */
  since?: Date | null;
}): CockpitKPIs {
  const sum = <T>(rows: T[], get: (r: T) => number): number =>
    rows.reduce((s, r) => s + get(r), 0);

  const sinceStr = since ? since.toISOString().slice(0, 10) : null;
  const inFlux = (d: string | null | undefined): boolean =>
    sinceStr == null || (d != null && String(d).slice(0, 10) >= sinceStr);

  // ─── Référence chantier par projet (forfait vendu, canon QA-BUG-020) ──────
  // Devis prestataire agrégé par projet (ce qu'on doit aux artisans/fournisseurs).
  const devisByProjectMad = new Map<string, number>();
  lots.forEach(l => devisByProjectMad.set(
    l.project_id, (devisByProjectMad.get(l.project_id) ?? 0) + n(l.devis_mad)));

  let ref_total_mad = 0;       // Σ référence (forfait) — tous projets
  let ref_f_mad = 0;           // référence des projets AVEC référence > 0
  let devis_f_mad = 0;         // devis des projets AVEC référence > 0
  let cible_f_mad = 0;         // marge cible des projets AVEC référence > 0
  let projets_sans_reference = 0;
  const refByProjectMad = new Map<string, number>();
  forfaits.forEach(f => {
    const ref = n(f.reference_mad);
    ref_total_mad += ref;
    refByProjectMad.set(f.project_id, ref);
    if (ref > 0) {
      ref_f_mad   += ref;
      devis_f_mad += devisByProjectMad.get(f.project_id) ?? 0;
      cible_f_mad += n(f.marge_cible_mad);
    } else if ((devisByProjectMad.get(f.project_id) ?? 0) > 0) {
      projets_sans_reference += 1;
    }
  });

  // ─── Soldes (tout-temps) : référence, devis, encaissé/payé cumulés ────────
  const fac_honoraires = sum(honoraires, h => n(h.amount_expected));
  const fac_chantier   = eur(ref_total_mad);                      // forfait vendu (≠ facture par lot)
  const devis_chantier = eur(sum(lots, l => n(l.devis_mad)));
  const enc_honoraires_all = sum(honoraires, h => n(h.amount_paid));
  const enc_chantier_all   = eur(sum(encaissements, e => n(e.amount_mad)));
  const pay_chantier_all   = eur(sum(payments, p => n(p.amount_paid)));

  const facture_total = fac_honoraires + fac_chantier;
  const devis_total   = devis_chantier;

  // ─── Flux datés (depuis `since`) : alimentent la trésorerie ───────────────
  const enc_honoraires = sum(honoraires.filter(h => inFlux(h.paid_at)), h => n(h.amount_paid));
  const enc_chantier   = eur(sum(encaissements.filter(e => inFlux(e.received_at)), e => n(e.amount_mad)));
  const pay_chantier   = eur(sum(payments.filter(p => inFlux(p.paid_at)), p => n(p.amount_paid)));

  const encaisse_total = enc_honoraires + enc_chantier;   // flux datés
  const paye_total     = pay_chantier;                    // flux datés

  // ─── Étage 1 — Santé cash ─────────────────────────────────────────────────
  const tresorerie        = encaisse_total - paye_total;                          // flux
  const reste_a_encaisser = facture_total - (enc_honoraires_all + enc_chantier_all); // solde
  const reste_a_payer     = devis_total - pay_chantier_all;                        // solde
  const reste_net         = reste_a_encaisser - reste_a_payer;

  // QA-BUG-023 : on RECALCULE le retard (échéance passée ET non soldé) au lieu
  // de lire h.status==='overdue' qui n'est mis à jour par aucun job (1 seul sur
  // 201 en prod → le cockpit affichait 0 € alors que 28 399 € étaient dus).
  // Cohérent avec lib/finance/overdue-payments.ts et le dashboard clients.
  const todayStrCockpit = today.toISOString().slice(0, 10);
  const clients_en_retard = sum(
    honoraires.filter(h =>
      h.due_date != null &&
      String(h.due_date).slice(0, 10) <= todayStrCockpit &&
      n(h.amount_paid) < n(h.amount_expected),
    ),
    h => n(h.amount_expected) - n(h.amount_paid),
  );

  const horizon90 = new Date(today.getTime() + 90 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const sorties_90j = eur(sum(
    payments.filter(p =>
      p.status !== 'paid' && p.scheduled_date != null && p.scheduled_date <= horizon90,
    ),
    p => n(p.amount_total) - n(p.amount_paid),
  ));

  // ─── Étage 2 — Rentabilité (projets avec référence forfait uniquement) ────
  // Canon QA-BUG-020 : marge = référence (forfait) − devis. La marge cible est
  // calculée en amont par discipline (forfait × 30 % travaux / 25 % achats).
  const marge_chantier = eur(ref_f_mad - devis_f_mad);
  const marge_brute    = fac_honoraires + marge_chantier;
  const taux_marge_chantier = ref_f_mad > 0
    ? Math.round(((ref_f_mad - devis_f_mad) / ref_f_mad) * 1000) / 10
    : 0;
  // écart = marge réelle − marge cible (= forfait − devis − forfait × cible_pct)
  const ecart_marge = marge_chantier - eur(cible_f_mad);

  const lots_total = lots.length;

  // ─── Anomalies d'intégrité (par projet) ──────────────────────────────────
  // Référence chantier = forfait (canon) : sur-encaissement = encaissé > forfait.
  type Agg = { facture: number; encaisse: number; devis: number; paye: number };
  const byProject = new Map<string, Agg>();
  const bump = (id: string, patch: Partial<Agg>) => {
    const cur = byProject.get(id) ?? { facture: 0, encaisse: 0, devis: 0, paye: 0 };
    byProject.set(id, {
      facture: cur.facture + (patch.facture ?? 0),
      encaisse: cur.encaisse + (patch.encaisse ?? 0),
      devis: cur.devis + (patch.devis ?? 0),
      paye: cur.paye + (patch.paye ?? 0),
    });
  };
  honoraires.forEach(h => bump(h.project_id, {
    facture: n(h.amount_expected), encaisse: n(h.amount_paid),
  }));
  refByProjectMad.forEach((ref, id) => bump(id, { facture: eur(ref) }));
  lots.forEach(l => bump(l.project_id, { devis: eur(l.devis_mad) }));
  encaissements.forEach(e => bump(e.project_id, { encaisse: eur(e.amount_mad) }));
  payments.forEach(p => bump(p.project_id, { paye: eur(p.amount_paid) }));

  const EPS = 0.5; // tolérance arrondi (en EUR)
  let anomalies = 0;
  byProject.forEach(a => {
    if (a.encaisse > a.facture + EPS || a.paye > a.devis + EPS) anomalies += 1;
  });

  // ─── Étage 3 — Croissance ─────────────────────────────────────────────────
  const volume_facture_total = fac_honoraires + fac_chantier;
  const pipeline_90j = sum(
    honoraires.filter(h =>
      h.status !== 'paid' && h.due_date != null && h.due_date <= horizon90,
    ),
    h => n(h.amount_expected) - n(h.amount_paid),
  );

  return {
    encaisse_total,
    paye_total,
    facture_total,
    devis_total,
    tresorerie,
    reste_a_encaisser,
    reste_a_payer,
    reste_net,
    clients_en_retard,
    sorties_90j,

    marge_brute,
    marge_chantier,
    taux_marge_chantier,
    ecart_marge,
    anomalies,
    projets_sans_reference,
    lots_total,

    volume_facture_total,
    pipeline_90j,

    enc_honoraires,
    enc_chantier,
    fac_honoraires,
    fac_chantier,
    devis_chantier,
    pay_chantier,
  };
}
