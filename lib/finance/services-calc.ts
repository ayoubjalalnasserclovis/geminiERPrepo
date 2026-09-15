/**
 * Calculs KPI pour le pôle Services (architecte, géomètre, juriste, etc.).
 * Tous les montants en MAD.
 *
 * ─── Canon Services (CEO 2026-06-03) ──────────────────────────────────────
 * Stoniz paye ces services et c'est INCLUS dans les honoraires (pas refacturé
 * au client). Donc :
 *   - Pas de notion de "facture client" (le client paye le forfait honoraires
 *     point, ces services sont absorbés dans la marge cabinet).
 *   - Pas de notion de "encaissement client" sur ce pôle.
 *   - Le coût total des services pèse sur la marge cabinet PAR PROJET.
 *
 * 3 champs sources (saisis) :
 *   DEVIS_PREVISIONNEL = somme budget_estimate_mad par lot (estimation initiale)
 *   DEVIS_PRESTATAIRES = somme devis_prestataire_mad par lot (devis SIGNÉS)
 *   PAYE_PRESTATAIRES  = somme amount_paid des services_payments (versés)
 *
 * 1 champ optionnel (info) :
 *   FACTURE_PRESTATAIRES = somme facture_prestataire_mad par lot (facture émise
 *                          par le prestataire — souvent = devis)
 *
 * Dérivés :
 *   reste_a_payer  = DEVIS_PRESTATAIRES − PAYE_PRESTATAIRES (≥ 0 attendu)
 *   ecart_devis    = DEVIS_PRESTATAIRES − DEVIS_PREVISIONNEL (mesure du dérapage)
 *   anomalie_surpaiement = PAYE_PRESTATAIRES > DEVIS_PRESTATAIRES
 *
 * Conventions UX
 *   - Rouge réservé à une situation anormale (sur-paiement, dérapage de + 30 %)
 *   - Pas de "marge" sur services puisque c'est une charge pure
 * ──────────────────────────────────────────────────────────────────────────
 */

export type ServiceLotInput = {
  id: string;
  budget_estimate_mad: number | null;
  devis_prestataire_mad: number | null;
  facture_prestataire_mad: number | null;
  status: string;
  service_category: string;
};

export type ServicePaymentInput = {
  lot_id: string | null;
  amount_paid: number | string;
};

function n(v: number | string | null | undefined): number {
  return Number(v ?? 0);
}

export type ServicesKPIs = {
  // Sources
  devis_previsionnel_total: number;
  devis_prestataires_total: number;
  facture_prestataires_total: number;
  total_paye_prestataires: number;

  // Dérivés
  reste_a_payer_prestataires: number;  // devis − payé (≥ 0 attendu)
  ecart_devis: number;                  // devis signé − prévisionnel
  ecart_devis_pct: number;              // (%)

  // Anomalies
  anomalie_surpaiement: boolean;

  // Compteurs
  lots_total: number;
  lots_termines: number;
  lots_en_cours: number;

  // Répartition par catégorie (pour ventilation P&L)
  by_category: Array<{
    category: string;
    devis_total: number;
    paye_total: number;
    nb_lots: number;
  }>;
};

export function calculateServicesKPIs({
  lots,
  payments,
}: {
  lots: ServiceLotInput[];
  payments: ServicePaymentInput[];
}): ServicesKPIs {
  const devis_previsionnel_total  = lots.reduce((s, l) => s + n(l.budget_estimate_mad), 0);
  const devis_prestataires_total  = lots.reduce((s, l) => s + n(l.devis_prestataire_mad), 0);
  const facture_prestataires_total = lots.reduce((s, l) => s + n(l.facture_prestataire_mad), 0);
  const total_paye_prestataires   = payments.reduce((s, p) => s + n(p.amount_paid), 0);

  const reste_a_payer_prestataires = devis_prestataires_total - total_paye_prestataires;
  const ecart_devis = devis_prestataires_total - devis_previsionnel_total;
  const ecart_devis_pct = devis_previsionnel_total > 0
    ? Math.round((ecart_devis / devis_previsionnel_total) * 1000) / 10
    : 0;

  const anomalie_surpaiement = total_paye_prestataires > devis_prestataires_total + 0.01;

  const lots_total = lots.length;
  const lots_termines = lots.filter(l => l.status === 'termine').length;
  const lots_en_cours = lots.filter(l => l.status === 'en_cours' || l.status === 'devis_recu').length;

  // Répartition par catégorie
  const catMap = new Map<string, { devis_total: number; paye_total: number; nb_lots: number }>();
  for (const l of lots) {
    const cat = l.service_category || 'autre_service';
    const entry = catMap.get(cat) ?? { devis_total: 0, paye_total: 0, nb_lots: 0 };
    entry.devis_total += n(l.devis_prestataire_mad);
    entry.nb_lots++;
    catMap.set(cat, entry);
  }
  // Paye par lot
  const payeByLot = new Map<string, number>();
  for (const p of payments) {
    if (!p.lot_id) continue;
    payeByLot.set(p.lot_id, (payeByLot.get(p.lot_id) ?? 0) + n(p.amount_paid));
  }
  for (const l of lots) {
    const cat = l.service_category || 'autre_service';
    const entry = catMap.get(cat)!;
    entry.paye_total += payeByLot.get(l.id) ?? 0;
  }

  const by_category = Array.from(catMap.entries())
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.devis_total - a.devis_total);

  return {
    devis_previsionnel_total,
    devis_prestataires_total,
    facture_prestataires_total,
    total_paye_prestataires,

    reste_a_payer_prestataires,
    ecart_devis,
    ecart_devis_pct,

    anomalie_surpaiement,

    lots_total,
    lots_termines,
    lots_en_cours,

    by_category,
  };
}

// ─── Constantes UI ──────────────────────────────────────────────────────────

export const SERVICE_CATEGORIES = [
  { value: 'architecte',                label: 'Architecte' },
  { value: 'geometre',                  label: 'Géomètre / topographe' },
  { value: 'bureau_etudes',             label: "Bureau d'études techniques" },
  { value: 'juridique_notariat',        label: 'Juridique / notariat' },
  { value: 'photo_video',               label: 'Photo / vidéo' },
  { value: 'decoration_design',         label: "Décoration / design d'intérieur" },
  { value: 'marketing_communication',   label: 'Marketing / communication' },
  { value: 'conseil',                   label: 'Conseil' },
  { value: 'autre_service',             label: 'Autre service' },
] as const;

export const SERVICE_LOT_STATUSES = [
  { value: 'a_planifier', label: 'À planifier' },
  { value: 'devis_recu',  label: 'Devis reçu' },
  { value: 'en_cours',    label: 'En cours' },
  { value: 'livre',       label: 'Livré' },
  { value: 'termine',     label: 'Terminé' },
  { value: 'annule',      label: 'Annulé' },
] as const;

export const SERVICE_PAYMENT_STATUSES = [
  { value: 'planifie', label: 'Planifié' },
  { value: 'partiel',  label: 'Partiel' },
  { value: 'paye',     label: 'Payé' },
  { value: 'annule',   label: 'Annulé' },
] as const;

export function formatServiceCategory(c: string): string {
  return SERVICE_CATEGORIES.find(s => s.value === c)?.label ?? c;
}
export function formatServiceLotStatus(c: string): string {
  return SERVICE_LOT_STATUSES.find(s => s.value === c)?.label ?? c;
}
