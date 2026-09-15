/**
 * Calculs pour le suivi achats par projet.
 * Tous les montants en MAD.
 *
 * ─── Canon de calcul (CEO 2026-06-02) — identique à travaux ────────────────
 * Référence client = LE FORFAIT VENDU (projects.achats_budget_mad).
 * C'est ce qu'on a vendu au client, point de référence unique pour tout
 * ce qui touche au client (reste à encaisser, marge, alertes).
 *
 * 6 champs sources (saisis, source de vérité), tous les autres dérivés :
 *
 *   BUDGET_VENDU_CLIENT   = projects.achats_budget_mad
 *                           (forfait vendu, saisi en haut du projet)
 *   MARGE_CIBLE_PCT       = projects.achats_marge_cible_pct
 *                           (% de marge visé, saisi en paramètre — défaut 25 %)
 *   DEVIS_PREVISIONNEL    = somme des budget_estimate_mad par lot
 *                           (pré-devis fournisseur avant signature)
 *   DEVIS_FOURNISSEURS    = somme des devis_fournisseur_mad par lot
 *                           (devis SIGNÉS avec les fournisseurs)
 *   ENCAISSE              = somme des règlements REÇUS du client
 *                           (somme des achats_encaissements.amount_mad)
 *   PAYE_FOURNISSEURS     = somme des règlements VERSÉS aux fournisseurs
 *                           (somme des achats_payments.amount_paid)
 *
 * FACTURE_CLIENT par lot est SAISIE mais SORTIE des KPI consolidés. Elle
 * reste utilisée comme repli quand BUDGET_VENDU = 0 (projet pas configuré).
 *
 * Dimension ENGAGEMENT
 *   marge_cible  = BUDGET_VENDU × (MARGE_CIBLE_PCT / 100)   (objectif visé)
 *   marge_reelle = REFERENCE_CLIENT − DEVIS_FOURNISSEURS    (marge actuelle)
 *   ecart_marge  = marge_reelle − marge_cible               (écart vs objectif)
 *
 * Dimension TRÉSORERIE
 *   reste_a_encaisser = REFERENCE_CLIENT − ENCAISSE             (dû par le client)
 *   reste_a_payer     = DEVIS_FOURNISSEURS − PAYE_FOURNISSEURS  (dû aux fournisseurs)
 *   tresorerie_a_date = ENCAISSE          − PAYE_FOURNISSEURS  (cash net en banque)
 *   reste_net_a_venir = reste_a_encaisser − reste_a_payer       (flux net futur)
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

export type AchatLotInput = {
  id: string;
  budget_estimate_mad: number | null;
  devis_fournisseur_mad: number | null;
  facture_client_mad: number | null;
  status: string;
};

export type AchatPaymentInput = {
  lot_id: string | null;
  amount_paid: number | string;
};

export type AchatEncaissementInput = {
  amount_mad: number | string;
  /** 'recu' (défaut) | 'planifie'. Seuls les 'recu' sont des encaissements réels. */
  status?: string | null;
};

function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

export type AchatsKPIs = {
  // ─── Sources ───────────────────────────────────────────────────────────
  devis_previsionnel_total: number;  // anciennement budget_estime_total
  devis_fournisseurs_total: number;
  facture_client_total: number;      // gardé pour fallback uniquement
  total_encaisse_client: number;
  total_paye_fournisseurs: number;

  // ─── Référence client active ───────────────────────────────────────────
  /**
   * ⚠️ NE PAS AFFICHER DIRECTEMENT — valeur brute du champ projet
   * `projects.achats_budget_mad`. Vaut 0 si non renseigné, ce qui crée des
   * écarts visibles entre la fiche projet et le dashboard (bug CEO 2026-06-16).
   * Utiliser `reference_client_mad` à la place.
   * Sert UNIQUEMENT à savoir si on est en mode "repli" (= 0) ou pas. @internal
   */
  budget_vendu_client: number;
  /**
   * VALEUR À AFFICHER PARTOUT comme "Budget vendu client" / "Forfait vendu".
   * Source unique de vérité (forfait projet si renseigné, sinon repli lots).
   */
  reference_client_mad: number;

  // ─── Engagement ────────────────────────────────────────────────────────
  marge_cible_mad: number;           // BUDGET_VENDU × MARGE_CIBLE_PCT / 100
  marge_cible_pct: number;           // % saisi en paramètre projet
  marge_reelle: number;              // REFERENCE_CLIENT − DEVIS_FOURNISSEURS
  marge_pct: number;                 // marge_reelle / REFERENCE_CLIENT × 100
  ecart_marge: number;               // marge_reelle − marge_cible

  // ─── Trésorerie ────────────────────────────────────────────────────────
  reste_a_encaisser_client: number;
  reste_a_payer_fournisseurs: number;
  tresorerie_a_date: number;
  reste_net_a_venir: number;

  // ─── Anomalies ─────────────────────────────────────────────────────────
  anomalie_surencaissement: boolean;
  anomalie_surpaiement: boolean;

  // ─── Compteurs ─────────────────────────────────────────────────────────
  lots_livres: number;
  lots_total: number;

  // ─── DEPRECATED — compat ascendante ────────────────────────────────────
  /** @deprecated → devis_previsionnel_total */
  budget_estime_total: number;
  /** @deprecated → marge_reelle */
  marge_brute: number;
  /** @deprecated → marge_pct */
  marge_reelle_pct: number;
  /** @deprecated → tresorerie_a_date */
  cashflow_a_date: number;
  /** @deprecated → reste_net_a_venir */
  position_nette_future: number;
};

/**
 * ⚠️ `budgetVenduClient` est OBLIGATOIRE (CEO 2026-06-16).
 * Voir explication détaillée dans travaux-calc.ts — sans budget, le calcul
 * retombe sur le repli facture-par-lot et décale les chiffres entre
 * dashboard et fiche projet.
 */
export function calculateAchatsKPIs({
  lots,
  payments,
  encaissements,
  budgetVenduClient,
  margeCiblePct = 25,
}: {
  lots: AchatLotInput[];
  payments: AchatPaymentInput[];
  encaissements: AchatEncaissementInput[];
  budgetVenduClient: number; // OBLIGATOIRE — voir JSDoc ci-dessus
  margeCiblePct?: number;
}): AchatsKPIs {
  const devis_previsionnel_total = lots.reduce((s, l) => s + n(l.budget_estimate_mad), 0);
  const devis_fournisseurs_total = lots.reduce((s, l) => s + n(l.devis_fournisseur_mad), 0);
  const facture_client_total     = lots.reduce((s, l) => s + n(l.facture_client_mad), 0);
  const total_paye_fournisseurs  = payments.reduce((s, p) => s + n(p.amount_paid), 0);
  // QA : seuls les encaissements REÇUS comptent (canon « règlements reçus »).
  // Les 'planifie' (rentrées futures programmées) ne sont PAS de l'encaissé.
  const total_encaisse_client    = encaissements
    .filter(e => (e.status ?? 'recu') === 'recu')
    .reduce((s, e) => s + n(e.amount_mad), 0);
  const budget_vendu_client      = n(budgetVenduClient);

  // Référence client : forfait si renseigné, sinon repli sur facture par lot
  const reference_client_mad =
    budget_vendu_client > 0 ? budget_vendu_client : facture_client_total;

  // Engagement
  const marge_cible_mad = reference_client_mad * (margeCiblePct / 100);
  const marge_reelle    = reference_client_mad - devis_fournisseurs_total;
  const marge_pct       = reference_client_mad > 0
    ? Math.round((marge_reelle / reference_client_mad) * 1000) / 10
    : 0;
  const ecart_marge     = marge_reelle - marge_cible_mad;

  // Trésorerie
  const reste_a_encaisser_client   = reference_client_mad - total_encaisse_client;
  const reste_a_payer_fournisseurs = devis_fournisseurs_total - total_paye_fournisseurs;
  const tresorerie_a_date          = total_encaisse_client - total_paye_fournisseurs;
  const reste_net_a_venir          = reste_a_encaisser_client - reste_a_payer_fournisseurs;

  // Anomalies
  const anomalie_surencaissement = total_encaisse_client > reference_client_mad;
  const anomalie_surpaiement     = total_paye_fournisseurs > devis_fournisseurs_total;

  const lots_livres = lots.filter(l => l.status === 'livre' || l.status === 'installe').length;
  const lots_total = lots.length;

  return {
    devis_previsionnel_total,
    devis_fournisseurs_total,
    facture_client_total,
    total_encaisse_client,
    total_paye_fournisseurs,

    budget_vendu_client,
    reference_client_mad,

    marge_cible_mad,
    marge_cible_pct: margeCiblePct,
    marge_reelle,
    marge_pct,
    ecart_marge,

    reste_a_encaisser_client,
    reste_a_payer_fournisseurs,
    tresorerie_a_date,
    reste_net_a_venir,

    anomalie_surencaissement,
    anomalie_surpaiement,

    lots_livres,
    lots_total,

    // Compat ascendante
    budget_estime_total: devis_previsionnel_total,
    marge_brute: marge_reelle,
    marge_reelle_pct: marge_pct,
    cashflow_a_date: tresorerie_a_date,
    position_nette_future: reste_net_a_venir,
  };
}

// ─── Constantes UI ──────────────────────────────────────────────────────────

export const ACHAT_CATEGORIES = [
  { value: 'mobilier_salon',         label: 'Mobilier salon' },
  { value: 'mobilier_chambre',       label: 'Mobilier chambre' },
  { value: 'mobilier_sdb',           label: 'Mobilier salle de bain' },
  { value: 'mobilier_cuisine',       label: 'Mobilier cuisine' },
  { value: 'electromenager',         label: 'Électroménager' },
  { value: 'luminaire',              label: 'Luminaires' },
  { value: 'textile_decoration',     label: 'Textile / décoration' },
  { value: 'vaisselle_arts_table',   label: 'Vaisselle / arts de la table' },
  { value: 'linge_maison',           label: 'Linge de maison' },
  { value: 'plomberie_robinetterie', label: 'Plomberie / robinetterie' },
  { value: 'sanitaires',             label: 'Sanitaires' },
  { value: 'peinture_fournitures',   label: 'Peinture (fournitures)' },
  { value: 'carrelage_marbre',       label: 'Carrelage / marbre' },
  { value: 'menuiserie_fournitures', label: 'Menuiserie (fournitures)' },
  { value: 'jardinage_exterieur',    label: 'Jardinage / extérieur' },
  { value: 'divers',                 label: 'Divers' },
] as const;

export const ACHAT_LOT_STATUSES = [
  { value: 'a_commander',  label: 'À commander' },
  { value: 'devis_recu',   label: 'Devis reçu' },
  { value: 'commande',     label: 'Commandé' },
  { value: 'en_livraison', label: 'En livraison' },
  { value: 'livre',        label: 'Livré' },
  { value: 'installe',     label: 'Installé' },
  { value: 'annule',       label: 'Annulé' },
] as const;

export function formatAchatCategory(value: string | null | undefined): string {
  if (!value) return '—';
  const found = ACHAT_CATEGORIES.find((c) => c.value === value);
  return found?.label ?? value;
}

export function formatAchatLotStatus(value: string | null | undefined): string {
  if (!value) return '—';
  const found = ACHAT_LOT_STATUSES.find((s) => s.value === value);
  return found?.label ?? value;
}
