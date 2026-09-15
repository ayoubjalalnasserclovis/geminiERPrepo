// ============================================================================
// Module Upsell (chantier 9 marathon, décision CEO B6).
// Constantes partagées entre la page interne /propria/upsell, la page
// publique /upsell/[slug] et les composants client. PAS de 'server-only' :
// ce fichier ne contient que des libellés et des types.
// ============================================================================

export const UPSELL_CATEGORIES = [
  'transfert',
  'petit_dejeuner',
  'activite',
  'early_checkin',
  'late_checkout',
  'autre',
] as const;

export type UpsellCategory = (typeof UPSELL_CATEGORIES)[number];

export const UPSELL_CATEGORY_LABELS: Record<UpsellCategory, string> = {
  transfert: 'Transferts',
  petit_dejeuner: 'Petit-déjeuner',
  activite: 'Activités',
  early_checkin: 'Early Check-in',
  late_checkout: 'Late Check-out',
  autre: 'Autres',
};

/** Descriptions accueillantes FR + EN court pour la page publique voyageur. */
export const UPSELL_CATEGORY_PUBLIC: Record<
  UpsellCategory,
  { emoji: string; fr: string; en: string }
> = {
  transfert: {
    emoji: '🚗',
    fr: 'Transfert aéroport ou gare — un chauffeur vous attend à votre arrivée ou vous dépose pour votre départ.',
    en: 'Airport or train station transfer.',
  },
  petit_dejeuner: {
    emoji: '🥐',
    fr: 'Petit-déjeuner marocain livré directement dans votre logement.',
    en: 'Moroccan breakfast delivered to your door.',
  },
  activite: {
    emoji: '🐪',
    fr: 'Activités et excursions : désert, quad, hammam, cours de cuisine… dites-nous ce qui vous tente.',
    en: 'Tours & activities: desert, quad, hammam, cooking class…',
  },
  early_checkin: {
    emoji: '🌅',
    fr: 'Arrivée anticipée — entrez dans votre logement avant l’heure standard (selon disponibilité).',
    en: 'Early check-in (subject to availability).',
  },
  late_checkout: {
    emoji: '🌙',
    fr: 'Départ tardif — profitez du logement plus longtemps le jour du départ (selon disponibilité).',
    en: 'Late check-out (subject to availability).',
  },
  autre: {
    emoji: '✨',
    fr: 'Autre demande — décrivez-nous votre besoin, on s’occupe du reste.',
    en: 'Anything else — just ask.',
  },
};

export const UPSELL_STATUSES = ['commande', 'confirme', 'livre', 'annule'] as const;
export type UpsellStatus = (typeof UPSELL_STATUSES)[number];

export const UPSELL_STATUS_LABELS: Record<UpsellStatus, string> = {
  commande: '📥 Commandé',
  confirme: '✓ Confirmé',
  livre: '🎉 Livré',
  annule: '✕ Annulé',
};

export const UPSELL_STATUS_BADGE: Record<UpsellStatus, string> = {
  commande: 'bg-amber-100 text-amber-800',
  confirme: 'bg-blue-100 text-blue-800',
  livre: 'bg-emerald-100 text-emerald-800',
  annule: 'bg-stoniz-gray-200 text-stoniz-gray-700',
};

/** Statuts qui comptent dans le CA upsell (dérivé, jamais stocké). */
export const UPSELL_CA_STATUSES: UpsellStatus[] = ['confirme', 'livre'];
