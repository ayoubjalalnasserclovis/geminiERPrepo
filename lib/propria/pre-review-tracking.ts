import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Auto-création + bascule des trackings d'avis préventifs (Kanban 2).
 *
 * Mécaniques (CEO 2026-06-10) :
 *  - À chaque sync Hostaway, pour chaque réservation `new`/`modified` dont
 *    le check-out est dans les 14 derniers jours ou aujourd'hui → créer un
 *    tracking si pas déjà créé.
 *  - Quand un avis Hostaway est syncé et qu'il pointe vers une réservation
 *    avec un tracking actif → bascule auto de kanban_status selon le couple
 *    (sentiment initial × note reçue).
 *  - Quand un tracking dépasse 14 jours sans avis → bascule selon le sentiment
 *    (mauvais → accomplie, bon → ratée, neutre → accomplie).
 */

type SB = SupabaseClient<any, 'public', any>;

const WINDOW_DAYS = 14;

export type PreReviewSyncResult = {
  created: number;
  basculee_avis_recu: number;
  basculee_expiree: number;
  errors: string[];
};

/**
 * Crée les trackings manquants pour les réservations en fenêtre.
 */
async function createMissingTrackings(supabase: SB): Promise<number> {
  const today = new Date();
  const past = new Date(today); past.setDate(past.getDate() - WINDOW_DAYS);
  const todayIso = today.toISOString().slice(0, 10);
  const pastIso = past.toISOString().slice(0, 10);

  // Charge les listings matchés pour résoudre propria_unit_id
  const { data: listings } = await supabase
    .from('hostaway_listings')
    .select('id, propria_unit_id')
    .is('deleted_at', null);
  const listingMap = new Map<string, string | null>();
  for (const l of (listings ?? []) as any[]) {
    listingMap.set(l.id, l.propria_unit_id);
  }

  // Réservations en fenêtre check-out.
  //
  // CEO 2026-06-16 : on exclut les résa directes (channel_name='direct')
  // car les voyageurs ne passent pas par une plateforme — ils ne peuvent
  // donc pas poster d'avis. Tracker ces résa polluait les KPI (taux de
  // sauvetage, taux de conversion 5/5) avec des cas qui ne sont pas
  // mesurables. Seuls les canaux OTA (Airbnb, Booking, etc.) sont gardés.
  const { data: resas } = await supabase
    .from('hostaway_reservations')
    .select('hostaway_id, hostaway_listing_db_id, departure_date, status, channel_name')
    .in('status', ['new', 'modified'])
    .neq('channel_name', 'direct')
    .gte('departure_date', pastIso)
    .lte('departure_date', todayIso)
    .is('deleted_at', null);

  if (!resas || resas.length === 0) return 0;

  // Filtre celles qui n'ont pas déjà de tracking
  const ids = resas.map((r: any) => r.hostaway_id);
  const { data: existing } = await supabase
    .from('hostaway_pre_review_tracking')
    .select('hostaway_reservation_id')
    .in('hostaway_reservation_id', ids);
  const existingSet = new Set((existing ?? []).map((e: any) => e.hostaway_reservation_id));

  const toCreate = (resas as any[])
    .filter((r) => !existingSet.has(r.hostaway_id))
    .map((r) => ({
      hostaway_reservation_id: r.hostaway_id,
      hostaway_listing_db_id: r.hostaway_listing_db_id,
      propria_unit_id: listingMap.get(r.hostaway_listing_db_id) ?? null,
      kanban_status: 'nouveau',
    }));

  if (toCreate.length === 0) return 0;
  const { error } = await supabase.from('hostaway_pre_review_tracking').insert(toCreate as any);
  if (error) throw new Error(`Create trackings : ${error.message}`);
  return toCreate.length;
}

/**
 * Bascule les trackings vers accomplie/ratée quand l'avis correspondant
 * est arrivé. Détecté via hostaway_reservation_id sur hostaway_reviews.
 */
async function basculerSurAvisRecu(supabase: SB): Promise<number> {
  // Trackings actifs (pas encore finalisés)
  const { data: trackings } = await supabase
    .from('hostaway_pre_review_tracking')
    .select('id, hostaway_reservation_id, sentiment, kanban_status')
    .not('kanban_status', 'in', '(accomplie,ratee)')
    .is('deleted_at', null);

  if (!trackings || trackings.length === 0) return 0;

  // CEO 2026-06-16 : EXCLURE les avis avec rating_normalized IS NULL.
  // Hostaway crée un "placeholder" review dès le check-in (objet avec
  // rating = null en attendant que le voyageur écrive). Sans ce filtre,
  // notre code basculait le tracking en 'ratee' avec 'Avis 0/5 reçu'
  // dès la 1ère sync, avant que le voyageur ait écrit quoi que ce soit.
  // Bug constaté chez Bilal Mahdad et Maria Clara (vraie note 5/5 mais
  // trackings figés en 'ratee').
  const resaIds = trackings.map((t: any) => t.hostaway_reservation_id);
  const { data: reviews } = await supabase
    .from('hostaway_reviews')
    .select('id, hostaway_reservation_id, rating_normalized')
    .in('hostaway_reservation_id', resaIds)
    .not('rating_normalized', 'is', null)
    .is('deleted_at', null);

  if (!reviews || reviews.length === 0) return 0;

  // Map resa_id → review
  const reviewByResa = new Map<number, any>();
  for (const r of reviews as any[]) {
    reviewByResa.set(r.hostaway_reservation_id, r);
  }

  let count = 0;
  for (const t of trackings as any[]) {
    const review = reviewByResa.get(t.hostaway_reservation_id);
    if (!review) continue;
    const rating = Number(review.rating_normalized ?? 0);

    // Logique : sentiment × note
    // Sentiment mauvais : ≥ 4.5 → accomplie, < 4.5 → ratée
    // Sentiment bon     : = 5    → accomplie, < 5    → ratée
    // Sentiment neutre  : ≥ 4    → accomplie, < 4    → ratée
    // Pas de sentiment  : ≥ 5    → accomplie, < 5    → ratée
    let newStatus: 'accomplie' | 'ratee';
    if (t.sentiment === 'mauvais') {
      newStatus = rating >= 4.5 ? 'accomplie' : 'ratee';
    } else if (t.sentiment === 'bon') {
      newStatus = rating >= 5 ? 'accomplie' : 'ratee';
    } else if (t.sentiment === 'neutre') {
      newStatus = rating >= 4 ? 'accomplie' : 'ratee';
    } else {
      newStatus = rating >= 5 ? 'accomplie' : 'ratee';
    }

    const { error } = await supabase
      .from('hostaway_pre_review_tracking')
      .update({
        kanban_status: newStatus,
        related_review_id: review.id,
        completed_at: new Date().toISOString(),
        completion_reason: `Avis ${rating}/5 reçu`,
      } as any)
      .eq('id', t.id);
    if (!error) count++;
  }
  return count;
}

/**
 * Bascule les trackings dont la fenêtre 14j est expirée sans avis posté.
 */
async function basculerSurExpiration(supabase: SB): Promise<number> {
  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - WINDOW_DAYS - 1);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  // Trackings actifs avec une résa dont le check-out est > 14j
  // On charge d'abord les trackings actifs, puis on join sur les résa
  const { data: trackings } = await supabase
    .from('hostaway_pre_review_tracking')
    .select('id, hostaway_reservation_id, sentiment')
    .not('kanban_status', 'in', '(accomplie,ratee)')
    .is('deleted_at', null);

  if (!trackings || trackings.length === 0) return 0;

  const resaIds = trackings.map((t: any) => t.hostaway_reservation_id);
  const { data: resas } = await supabase
    .from('hostaway_reservations')
    .select('hostaway_id, departure_date')
    .in('hostaway_id', resaIds);

  const resaByid = new Map<number, string>();
  for (const r of (resas ?? []) as any[]) {
    resaByid.set(r.hostaway_id, r.departure_date);
  }

  let count = 0;
  for (const t of trackings as any[]) {
    const departureDate = resaByid.get(t.hostaway_reservation_id);
    if (!departureDate) continue;
    if (departureDate > cutoffIso) continue;

    // Logique : sentiment → résultat sans avis
    // mauvais : pas d'avis = mauvais avis évité = accomplie
    // bon     : pas d'avis = 5/5 raté          = ratée
    // neutre  : pas d'avis = neutre OK         = accomplie
    // null    : pas d'avis = pas mesurable     = ratée par défaut (non traité)
    let newStatus: 'accomplie' | 'ratee';
    if (t.sentiment === 'mauvais') newStatus = 'accomplie';
    else if (t.sentiment === 'bon') newStatus = 'ratee';
    else if (t.sentiment === 'neutre') newStatus = 'accomplie';
    else newStatus = 'ratee';

    const { error } = await supabase
      .from('hostaway_pre_review_tracking')
      .update({
        kanban_status: newStatus,
        completed_at: new Date().toISOString(),
        completion_reason: 'Fenêtre 14j expirée sans avis posté',
      } as any)
      .eq('id', t.id);
    if (!error) count++;
  }
  return count;
}

export async function syncPreReviewTrackings(supabase: SB): Promise<PreReviewSyncResult> {
  const result: PreReviewSyncResult = {
    created: 0,
    basculee_avis_recu: 0,
    basculee_expiree: 0,
    errors: [],
  };
  try {
    result.created = await createMissingTrackings(supabase);
  } catch (e: any) {
    result.errors.push(`createMissingTrackings : ${e?.message ?? 'erreur'}`);
  }
  try {
    result.basculee_avis_recu = await basculerSurAvisRecu(supabase);
  } catch (e: any) {
    result.errors.push(`basculerSurAvisRecu : ${e?.message ?? 'erreur'}`);
  }
  try {
    result.basculee_expiree = await basculerSurExpiration(supabase);
  } catch (e: any) {
    result.errors.push(`basculerSurExpiration : ${e?.message ?? 'erreur'}`);
  }
  return result;
}
