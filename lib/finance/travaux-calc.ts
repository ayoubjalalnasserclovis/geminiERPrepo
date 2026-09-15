/**
 * Calculs pour le suivi travaux par projet.
 * Tous les montants en MAD.
 *
 * ─── Canon de calcul (CEO 2026-06-02) ──────────────────────────────────────
 * Référence client = LE FORFAIT VENDU (projects.travaux_budget_mad).
 * C'est ce qu'on a vendu au client, point de référence unique pour tout
 * ce qui touche au client (reste à encaisser, marge, alertes).
 *
 * 6 champs sources (saisis, source de vérité), tous les autres dérivés :
 *
 *   BUDGET_VENDU_CLIENT  = projects.travaux_budget_mad
 *                          (forfait vendu, saisi en haut du projet)
 *   MARGE_CIBLE_PCT      = projects.travaux_marge_cible_pct
 *                          (% de marge visé, saisi en paramètre — défaut 30 %)
 *   DEVIS_PREVISIONNEL   = somme des budget_estimate_mad par lot
 *                          (anciennement "Budget estimé" — c'est en fait le
 *                          pré-devis travaux artisan avant signature)
 *   DEVIS_ARTISANS       = somme des devis_artisan_mad par lot
 *                          (devis SIGNÉS avec les artisans)
 *   ENCAISSE             = somme des règlements REÇUS du client
 *                          (somme des travaux_encaissements.amount_mad)
 *   PAYE_ARTISANS        = somme des règlements VERSÉS aux artisans
 *                          (somme des travaux_payments.amount_paid)
 *
 * FACTURE_CLIENT par lot est SAISIE mais SORTIE des KPI consolidés. Elle
 * reste utilisée comme repli quand BUDGET_VENDU = 0 (projet pas configuré).
 *
 * Dimension ENGAGEMENT
 *   marge_cible  = BUDGET_VENDU × (MARGE_CIBLE_PCT / 100)  (objectif visé)
 *   marge_reelle = REFERENCE_CLIENT − DEVIS_ARTISANS       (marge actuelle)
 *   ecart_marge  = marge_reelle − marge_cible              (écart vs objectif)
 *
 * Dimension TRÉSORERIE
 *   reste_a_encaisser = REFERENCE_CLIENT − ENCAISSE       (dû par le client)
 *   reste_a_payer     = DEVIS_ARTISANS  − PAYE_ARTISANS   (dû aux artisans)
 *   tresorerie_a_date = ENCAISSE        − PAYE_ARTISANS   (cash net en banque)
 *   reste_net_a_venir = reste_a_encaisser − reste_a_payer (flux net futur)
 *
 *   REFERENCE_CLIENT = BUDGET_VENDU si renseigné, sinon repli sur la somme
 *   des facture_client_mad par lot (rétro-compat, projet pas configuré).
 *
 * Conventions UX
 *   - reste_a_* doit être ≥ 0. Si négatif → anomalie (sur-encaissement / sur-paiement).
 *   - Rouge réservé aux pertes réelles : marge_reelle < 0, ecart_marge < 0,
 *     tresorerie_a_date < 0. Pas pour un montant restant à percevoir.
 * ──────────────────────────────────────────────────────────────────────────
 */

export type LotInput = {
  id: string;
  budget_estimate_mad: number | null;
  devis_artisan_mad: number | null;
  facture_client_mad: number | null;
  status: string;
};

export type PaymentInput = {
  lot_id: string | null;
  amount_paid: number | string;
};

export type EncaissementInput = {
  amount_mad: number | string;
  /** 'recu' (défaut) | 'planifie'. Seuls les 'recu' sont des encaissements réels. */
  status?: string | null;
};

export function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

export type TravauxKPIs = {
  // ─── Champs sources (agrégés à la lecture) ─────────────────────────────
  devis_previsionnel_total: number; // anciennement budget_estime_total
  devis_artisans_total: number;
  facture_client_total: number;    // gardé pour fallback uniquement
  total_encaisse_client: number;
  total_paye_artisans: number;

  // ─── Référence client active (forfait si renseigné, sinon repli sur facture) ──
  /**
   * ⚠️ NE PAS AFFICHER DIRECTEMENT — valeur brute du champ projet
   * `projects.travaux_budget_mad`. Vaut 0 si non renseigné, ce qui crée des
   * écarts visibles entre la fiche projet et le dashboard (bug CEO 2026-06-16).
   *
   * Utiliser à la place `reference_client_mad` qui applique le repli sur la
   * somme des facture_client par lot quand le forfait n'est pas saisi.
   *
   * Sert UNIQUEMENT à savoir si on est en mode "repli" (= 0) ou pas.
   * @internal
   */
  budget_vendu_client: number;
  /**
   * VALEUR À AFFICHER PARTOUT comme "Budget vendu client" / "Forfait vendu".
   * Source unique de vérité (forfait projet si renseigné, sinon repli lots).
   */
  reference_client_mad: number;

  // ─── Engagement (dérivés) ──────────────────────────────────────────────
  marge_cible_mad: number;          // BUDGET_VENDU × MARGE_CIBLE_PCT / 100
  marge_cible_pct: number;          // % saisi en paramètre projet (info)
  marge_reelle: number;             // REFERENCE_CLIENT − DEVIS_ARTISANS
  marge_pct: number;                // marge_reelle / REFERENCE_CLIENT × 100
  ecart_marge: number;              // marge_reelle − marge_cible

  // ─── Trésorerie (dérivés) ──────────────────────────────────────────────
  reste_a_encaisser_client: number; // REFERENCE_CLIENT − encaisse (≥ 0 attendu)
  reste_a_payer_artisans: number;   // devis_artisans − paye_artisans (≥ 0 attendu)
  tresorerie_a_date: number;        // encaisse − paye_artisans
  reste_net_a_venir: number;        // reste_a_encaisser − reste_a_payer

  // ─── Anomalies (contrôles d'intégrité) ─────────────────────────────────
  anomalie_surencaissement: boolean; // encaisse > REFERENCE_CLIENT
  anomalie_surpaiement: boolean;     // paye_artisans > devis_artisans

  // ─── Compteurs lots ────────────────────────────────────────────────────
  lots_termines: number;
  lots_total: number;

  // ─── DEPRECATED — gardés pour compatibilité ascendante ─────────────────
  /** @deprecated → devis_previsionnel_total */
  budget_estime_total: number;
  /** @deprecated → marge_reelle (le nom était trompeur, on calculait facture−devis) */
  marge_brute: number;
  /** @deprecated → tresorerie_a_date */
  cashflow_a_date: number;
  /** @deprecated → reste_net_a_venir */
  position_nette_future: number;
};

/**
 * ⚠️ `budgetVenduClient` est OBLIGATOIRE (CEO 2026-06-16).
 *
 * Historiquement il avait un défaut à 0 — résultat : un appel qui l'oubliait
 * (cas du dashboard travaux 2026-06-16) déclenchait silencieusement le repli
 * sur la facture par lot et affichait des chiffres incohérents avec la fiche
 * projet. Maintenant TypeScript exige le passage explicite.
 */
export function calculateTravauxKPIs({
  lots,
  payments,
  encaissements,
  budgetVenduClient,
  margeCiblePct = 30,
}: {
  lots: LotInput[];
  payments: PaymentInput[];
  encaissements: EncaissementInput[];
  budgetVenduClient: number; // OBLIGATOIRE — voir JSDoc ci-dessus
  margeCiblePct?: number;
}): TravauxKPIs {
  // ─── Sources ──────────────────────────────────────────────────────────
  const devis_previsionnel_total = lots.reduce((s, l) => s + n(l.budget_estimate_mad), 0);
  const devis_artisans_total     = lots.reduce((s, l) => s + n(l.devis_artisan_mad), 0);
  const facture_client_total     = lots.reduce((s, l) => s + n(l.facture_client_mad), 0);
  const total_paye_artisans      = payments.reduce((s, p) => s + n(p.amount_paid), 0);
  // QA : seuls les encaissements REÇUS comptent (canon « règlements reçus »).
  // Les 'planifie' (rentrées futures programmées) ne sont PAS de l'encaissé.
  const total_encaisse_client    = encaissements
    .filter(e => (e.status ?? 'recu') === 'recu')
    .reduce((s, e) => s + n(e.amount_mad), 0);
  const budget_vendu_client      = n(budgetVenduClient);

  // ─── Référence client active ──────────────────────────────────────────
  // Le forfait vendu est la référence si renseigné. Sinon repli sur la somme
  // des factures par lot (rétro-compat, ne casse pas les projets non configurés).
  const reference_client_mad =
    budget_vendu_client > 0 ? budget_vendu_client : facture_client_total;

  // ─── Engagement ───────────────────────────────────────────────────────
  // Marge cible = objectif commercial visé, calculé sur le forfait vendu
  const marge_cible_mad = reference_client_mad * (margeCiblePct / 100);
  // Marge réelle = ce qu'on gagne effectivement (forfait − ce qu'on doit aux artisans)
  const marge_reelle    = reference_client_mad - devis_artisans_total;
  const marge_pct       = reference_client_mad > 0
    ? Math.round((marge_reelle / reference_client_mad) * 1000) / 10
    : 0;
  const ecart_marge     = marge_reelle - marge_cible_mad;

  // ─── Trésorerie ───────────────────────────────────────────────────────
  const reste_a_encaisser_client = reference_client_mad - total_encaisse_client;
  const reste_a_payer_artisans   = devis_artisans_total - total_paye_artisans;
  const tresorerie_a_date        = total_encaisse_client - total_paye_artisans;
  const reste_net_a_venir        = reste_a_encaisser_client - reste_a_payer_artisans;

  // ─── Anomalies ────────────────────────────────────────────────────────
  const anomalie_surencaissement = total_encaisse_client > reference_client_mad;
  const anomalie_surpaiement     = total_paye_artisans   > devis_artisans_total;

  // ─── Lots ─────────────────────────────────────────────────────────────
  const lots_termines = lots.filter(l => l.status === 'termine').length;
  const lots_total = lots.length;

  return {
    devis_previsionnel_total,
    devis_artisans_total,
    facture_client_total,
    total_encaisse_client,
    total_paye_artisans,

    budget_vendu_client,
    reference_client_mad,

    marge_cible_mad,
    marge_cible_pct: margeCiblePct,
    marge_reelle,
    marge_pct,
    ecart_marge,

    reste_a_encaisser_client,
    reste_a_payer_artisans,
    tresorerie_a_date,
    reste_net_a_venir,

    anomalie_surencaissement,
    anomalie_surpaiement,

    lots_termines,
    lots_total,

    // Compat ascendante (deprecated)
    budget_estime_total: devis_previsionnel_total,
    marge_brute: marge_reelle,
    cashflow_a_date: tresorerie_a_date,
    position_nette_future: reste_net_a_venir,
  };
}

// ─── Constantes UI ──────────────────────────────────────────────────────────

export const LOT_CATEGORIES = [
  { value: 'demolition_cloisons',     label: 'Démolition / Cloisons' },
  { value: 'gros_oeuvre_maconnerie',  label: 'Gros œuvre / Maçonnerie' },
  { value: 'electricite',             label: 'Électricité' },
  { value: 'plomberie_sanitaire',     label: 'Plomberie / Sanitaire' },
  { value: 'carrelage_revetements',   label: 'Carrelage / Revêtements' },
  { value: 'menuiserie_interieure',   label: 'Menuiserie intérieure' },
  { value: 'menuiserie_aluminium',    label: 'Menuiserie aluminium' },
  { value: 'peinture',                label: 'Peinture' },
  { value: 'faux_plafond',            label: 'Faux plafond' },
  { value: 'climatisation_vmc',       label: 'Climatisation / VMC' },
  { value: 'ferronnerie',             label: 'Ferronnerie' },
  { value: 'amenagements_exterieurs', label: 'Aménagements extérieurs' },
  { value: 'cuisine',                 label: 'Cuisine' },
  { value: 'divers',                  label: 'Divers' },
] as const;

export const ARTISAN_TYPES = [
  { value: 'artisan_local',       label: 'Artisan local' },
  { value: 'entreprise_generale', label: 'Entreprise générale' },
  { value: 'sous_traitant_ext',   label: 'Sous-traitant externe' },
  { value: 'autre',               label: 'Autre' },
] as const;

export const LOT_STATUSES = [
  { value: 'a_planifier', label: 'À planifier' },
  { value: 'devis_recu',  label: 'Devis reçu' },
  { value: 'demarre',     label: 'Démarré' },
  { value: 'en_cours',    label: 'En cours' },
  { value: 'en_attente',  label: 'En attente' },
  { value: 'termine',     label: 'Terminé' },
  { value: 'annule',      label: 'Annulé' },
] as const;

export function formatLotCategory(c: string): string {
  return LOT_CATEGORIES.find(l => l.value === c)?.label ?? c;
}
export function formatArtisanType(c: string): string {
  return ARTISAN_TYPES.find(l => l.value === c)?.label ?? c;
}
export function formatLotStatus(c: string): string {
  return LOT_STATUSES.find(l => l.value === c)?.label ?? c;
}
