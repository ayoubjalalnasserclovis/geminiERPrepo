/**
 * Catégories visuelles de ménage — consultant U7 (chantier 3 marathon).
 * La catégorie est DÉRIVÉE en BDD (vue propria_cleanings_enriched.category) :
 *   - type Deep Cleaning            → deep_cleaning
 *   - type Poussière                → poussiere
 *   - type Ménage propriétaire      → post_proprietaire
 *   - sinon, arrivée Hostaway le même jour sur la suite ? avec_arrivee : sans_arrivee
 * Ce fichier ne contient QUE l'habillage (icône, libellé, couleurs).
 */

export type CleaningCategory =
  | 'avec_arrivee'
  | 'sans_arrivee'
  | 'post_proprietaire'
  | 'deep_cleaning'
  | 'poussiere';

export const CLEANING_CATEGORY_META: Record<
  CleaningCategory,
  { icon: string; label: string; badgeClass: string }
> = {
  avec_arrivee: {
    icon: '🛏',
    label: 'Avec arrivée',
    badgeClass: 'bg-red-50 text-red-700 border border-red-200',
  },
  sans_arrivee: {
    icon: '🏠',
    label: 'Sans arrivée',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  post_proprietaire: {
    icon: '👤',
    label: 'Post-propriétaire',
    badgeClass: 'bg-blue-50 text-blue-700 border border-blue-200',
  },
  deep_cleaning: {
    icon: '🧽',
    label: 'Deep Cleaning',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
  },
  poussiere: {
    icon: '🌬',
    label: 'Poussière',
    badgeClass: 'bg-stoniz-gray-100 text-stoniz-gray-700 border border-stoniz-gray-200',
  },
};

export function cleaningCategoryMeta(category: string | null | undefined) {
  return CLEANING_CATEGORY_META[(category ?? 'sans_arrivee') as CleaningCategory]
    ?? CLEANING_CATEGORY_META.sans_arrivee;
}
