/**
 * Types partagés Vue Carte Propria (CHANTIER 10).
 * Tout est sérialisable : calculé server-side dans la page, passé en props
 * au composant client Leaflet. Aucun dérivé stocké en BDD.
 */

export type CarteLot = {
  unitId: string;
  code: string;
  /** CA du mois en cours (prorata nuits, devise telle quelle Hostaway). */
  caMonth: number;
  /** CA 12 derniers mois glissants (prorata nuits). */
  ca12m: number;
  currency: string | null;
  /** Note moyenne /5 (hostaway_reviews.rating_normalized). */
  avgRating: number | null;
  nbReviews: number;
  /** Taux d'occupation 30 derniers jours, en % entier (nuits occupées / 30). */
  occupancy30: number;
  nbResas12m: number;
  /** Date (ISO) du dernier ménage clôturé (propria_cleanings status='cloture'). */
  lastCleaning: string | null;
  occupiedToday: boolean;
  /** Le lot a au moins un listing Hostaway matché. */
  hasListing: boolean;
};

export type CartePropertyAgg = {
  caMonth: number;
  ca12m: number;
  currency: string | null;
  avgRating: number | null;
  nbReviews: number;
  occupancy30: number;
  nbResas12m: number;
  lastCleaning: string | null;
  occupiedToday: boolean;
};

export type CarteProperty = {
  id: string;
  name: string;
  /** propria_internal_code — affiché sur la pastille du marqueur. */
  code: string | null;
  quartier: string | null;
  lat: number | null;
  lng: number | null;
  lots: CarteLot[];
  agg: CartePropertyAgg;
};
