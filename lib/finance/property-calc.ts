import { STONIZ_FEES_TOTAL } from './stoniz-fees';

/**
 * Calculs financiers d'un bien — SOURCE DE VÉRITÉ UNIQUE (CEO 2026-06-17).
 *
 * Toutes les valeurs en EUR. Utilisé par :
 *   - /properties (liste)
 *   - /properties/[id] (fiche détail)
 *   - /properties-preview/[id] (preview client envoyée en commercial)
 *   - /client/projects/[id] (espace client)
 *
 * Doit produire EXACTEMENT le même rendement que la vue SQL
 * properties_enriched.gross_yield. Si tu modifies une formule ici,
 * pense à mettre à jour la migration SQL.
 *
 * Conventions clés (validées CEO 2026-06-17) :
 *   - estimated_rent = loyer mensuel moyen attendu, occupation DÉJÀ incluse.
 *   - taux_occupation = info affichée uniquement, pas appliqué dans les calculs.
 *   - revenu_locatif_brut_annuel : champ BDD historique IGNORÉ par le helper.
 *   - notary_fees : auto 7% du prix si null ou 0.
 *   - agency_fees : auto 3% TTC du prix si null ou 0 (= 2,5% HT + 0,5% TVA).
 *   - travaux_budget_estimate : recalculé selon la formule
 *     superficie × 425 + nb_suites × 7000 (figée, non modifiable).
 *   - prix_m2_fini = (price + travaux_budget_estimate) / superficie
 *     → uniquement le bien lui-même + ce qu'on y met dedans (sans frais d'acquisition).
 *   - cout_total_projet = prix + notaire + agence + travaux + 21k Stoniz
 *     → utilisé pour le rendement.
 */

// ─── Constantes métier (modifier ici pour propager partout) ──────────────────
export const TRAVAUX_RATE_PER_M2 = 425;        // €/m² standard travaux
export const AMEUBLEMENT_PER_SUITE = 7_000;    // € forfait par suite
export const NOTARY_RATE = 0.07;               // 7% du prix d'achat
export const AGENCY_RATE_TTC = 0.03;           // 3% TTC du prix d'achat

type PropertyInput = {
  price?: number | null;
  superficie?: number | null;
  nb_suites?: number | null;
  agency_fees?: number | null;
  notary_fees?: number | null;
  travaux_budget_estimate?: number | null;
  estimated_rent?: number | null;
  revenu_locatif_brut_annuel?: number | null; // legacy : ignoré
  taux_occupation?: number | null;             // info uniquement
  frais_fonctionnement_annuel?: number | null;
  conciergerie_annuel?: number | null;
  emprunt_mensuel?: number | null;
  impots_annuel?: number | null;
};

function n(v: number | null | undefined): number {
  return Number(v ?? 0);
}

function nonZero(v: number | null | undefined): number | undefined {
  if (v == null) return undefined;
  const num = Number(v);
  return num > 0 ? num : undefined;
}

export type PropertyKPIs = {
  // Investissement
  prix_achat: number;
  frais_notaire: number;
  frais_agence: number;
  travaux: number;                      // total = montant_travaux + montant_ameublement
  montant_travaux: number;              // superficie × 425
  montant_ameublement: number;          // nb_suites × 7000
  frais_stoniz: number;
  cout_total_projet: number;            // = prix + notaire + agence + travaux + stoniz
  prix_achat_plus_travaux: number;      // = prix + travaux (sans frais d'acquisition)
  prix_m2_fini: number | null;          // = prix_achat_plus_travaux / superficie
  prix_m2_livraison: number | null;     // alias pour compat — même valeur que prix_m2_fini

  // Revenus
  revenu_locatif_brut_annuel: number;   // = estimated_rent × 12
  taux_occupation_pct: number;          // info uniquement
  revenu_locatif_net_annuel: number;    // = brut (pas de réapplication d'occupation)

  // Charges
  frais_fonctionnement_annuel: number;
  conciergerie_annuel: number;
  emprunt_annuel: number;
  charges_total_annuel: number;

  // Rendement
  revenu_locatif_net_apres_charges: number;
  impots_annuel: number;
  revenu_net_apres_impots: number;
  cashflow_mensuel: number;
  rendement_brut_pct: number;
  rendement_net_pct: number;
};

export function calculateKPIs(p: PropertyInput): PropertyKPIs {
  const prix_achat = n(p.price);
  const superficie = n(p.superficie);
  const nb_suites = n(p.nb_suites);

  // Frais auto si null ou 0
  const frais_notaire = nonZero(p.notary_fees) ?? Math.round(prix_achat * NOTARY_RATE);
  const frais_agence = nonZero(p.agency_fees) ?? Math.round(prix_achat * AGENCY_RATE_TTC);

  // Décomposition travaux (auto-calculée, figée)
  const montant_travaux = Math.round(superficie * TRAVAUX_RATE_PER_M2);
  const montant_ameublement = Math.round(nb_suites * AMEUBLEMENT_PER_SUITE);
  // Si une valeur travaux_budget_estimate est saisie en BDD, on l'utilise.
  // Sinon on calcule depuis superficie + nb_suites.
  const travaux = p.travaux_budget_estimate != null
    ? n(p.travaux_budget_estimate)
    : montant_travaux + montant_ameublement;

  const frais_stoniz = STONIZ_FEES_TOTAL;
  const cout_total_projet = prix_achat + frais_notaire + frais_agence + travaux + frais_stoniz;

  // Prix d'achat + travaux (sans frais d'acquisition)
  const prix_achat_plus_travaux = prix_achat + travaux;

  // Prix m² fini : ce que le bien coute à mettre en service, hors frais.
  // (price + travaux) / superficie
  const prix_m2_fini = superficie > 0
    ? Math.round(prix_achat_plus_travaux / superficie)
    : null;

  // Revenus
  const revenu_locatif_brut_annuel = n(p.estimated_rent) * 12;
  const taux_occupation_pct = p.taux_occupation != null ? n(p.taux_occupation) : 75.62;
  const revenu_locatif_net_annuel = revenu_locatif_brut_annuel;

  // Charges
  const frais_fonctionnement_annuel = n(p.frais_fonctionnement_annuel);
  const conciergerie_annuel = n(p.conciergerie_annuel);
  const emprunt_annuel = n(p.emprunt_mensuel) * 12;
  const charges_total_annuel = frais_fonctionnement_annuel + conciergerie_annuel + emprunt_annuel;

  const revenu_locatif_net_apres_charges = revenu_locatif_net_annuel - charges_total_annuel;
  const impots_annuel = n(p.impots_annuel);
  const revenu_net_apres_impots = revenu_locatif_net_apres_charges - impots_annuel;
  const cashflow_mensuel = Math.round(revenu_net_apres_impots / 12);

  const rendement_brut_pct = cout_total_projet > 0
    ? Math.round((revenu_locatif_brut_annuel / cout_total_projet) * 10000) / 100
    : 0;
  const rendement_net_pct = cout_total_projet > 0
    ? Math.round((revenu_net_apres_impots / cout_total_projet) * 10000) / 100
    : 0;

  return {
    prix_achat,
    frais_notaire,
    frais_agence,
    travaux,
    montant_travaux,
    montant_ameublement,
    frais_stoniz,
    cout_total_projet,
    prix_achat_plus_travaux,
    prix_m2_fini,
    prix_m2_livraison: prix_m2_fini,      // alias backward compat
    revenu_locatif_brut_annuel,
    taux_occupation_pct,
    revenu_locatif_net_annuel,
    frais_fonctionnement_annuel,
    conciergerie_annuel,
    emprunt_annuel,
    charges_total_annuel,
    revenu_locatif_net_apres_charges,
    impots_annuel,
    revenu_net_apres_impots,
    cashflow_mensuel,
    rendement_brut_pct,
    rendement_net_pct,
  };
}
