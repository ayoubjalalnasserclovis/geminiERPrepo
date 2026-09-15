import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Auto-création des ménages depuis les réservations Hostaway (étape 5).
 *
 * Mécaniques métier validées par CEO 2026-06-10 :
 *   1) Ménage VOYAGEUR : 1 par réservation, à la date de check-out
 *   2) Ménage POUSSIÈRE : 1 par check-in si la suite a été vide ≥ 4 jours
 *      (= dernier check-out précédent il y a 4+ jours, ou jamais de check-out
 *      précédent enregistré sur cette suite)
 *
 * Idempotence garantie par l'index unique partiel sur
 * (hostaway_reservation_id, auto_source) — créer 2 fois le même ménage = no-op.
 *
 * Annulation : si une réservation passe en statut différent de new/modified
 * (cancelled, expired…), les ménages auto-créés non-démarrés sont passés en
 * statut 'annule' avec `auto_cancelled_at` pour traçabilité.
 */

const VOYAGEUR_TYPE_NAME = 'Ménage voyageur';
const POUSSIERE_TYPE_NAME = 'Poussière';
const DEEP_TYPE_NAME = 'Deep Cleaning'; // ex-« Gros ménage » (renommé marathon 2026-06-12)
const DUST_GAP_DAYS = 4; // CEO Q3 : gap ≥ 4 jours déclenche un ménage poussière
const DEEP_EVERY_STAYS_DEFAULT = 10; // fallback si propria_settings indisponible

type Result = {
  created_voyageur: number;
  created_poussiere: number;
  upgraded_deep: number;
  cancelled: number;
  skipped: number;
  errors: string[];
};

export type CleaningSync = SupabaseClient<any, 'public', any>;

/**
 * Récupère les IDs des types de ménage requis. Cache en mémoire par appel
 * (la sync passe par ici une fois).
 */
async function getCleaningTypeIds(supabase: CleaningSync): Promise<{
  voyageur: string | null;
  poussiere: string | null;
  deep: string | null;
}> {
  const { data } = await supabase
    .from('propria_cleaning_types')
    .select('id, name')
    .in('name', [VOYAGEUR_TYPE_NAME, POUSSIERE_TYPE_NAME, DEEP_TYPE_NAME]);
  const map: any = {};
  for (const t of (data ?? []) as any[]) {
    if (t.name === VOYAGEUR_TYPE_NAME) map.voyageur = t.id;
    if (t.name === POUSSIERE_TYPE_NAME) map.poussiere = t.id;
    if (t.name === DEEP_TYPE_NAME) map.deep = t.id;
  }
  return { voyageur: map.voyageur ?? null, poussiere: map.poussiere ?? null, deep: map.deep ?? null };
}

/**
 * Lit le seuil « Deep Cleaning tous les N séjours » depuis propria_settings.
 * Fallback : 10 (cadrage CEO 2026-06-12).
 */
async function getDeepCleaningThreshold(supabase: CleaningSync): Promise<number> {
  const { data } = await supabase
    .from('propria_settings')
    .select('value')
    .eq('key', 'deep_cleaning_every_stays')
    .maybeSingle();
  const n = Number((data as any)?.value);
  return Number.isFinite(n) && n > 0 ? n : DEEP_EVERY_STAYS_DEFAULT;
}

/**
 * Trouve la date du dernier check-out précédent sur une même suite
 * Hostaway (matching via hostaway_listing_db_id).
 *
 * @returns ISO date 'YYYY-MM-DD' ou null si pas de check-out précédent
 */
async function getLastDepartureForListing(
  supabase: CleaningSync,
  hostawayListingDbId: string,
  beforeDate: string,
): Promise<string | null> {
  const { data } = await supabase
    .from('hostaway_reservations')
    .select('departure_date')
    .eq('hostaway_listing_db_id', hostawayListingDbId)
    .in('status', ['new', 'modified'])
    .lt('departure_date', beforeDate)
    .is('deleted_at', null)
    .order('departure_date', { ascending: false })
    .limit(1);
  return (data?.[0] as any)?.departure_date ?? null;
}

/**
 * Compte le gap en jours entre deux dates (YYYY-MM-DD).
 */
function gapDays(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

/**
 * Crée un ménage voyageur pour une réservation, si pas déjà créé.
 * Date prévue (due_date) = jour du check-out.
 */
async function ensureGuestCleaningForReservation(input: {
  supabase: CleaningSync;
  reservation: any;
  voyageurTypeId: string;
}): Promise<'created' | 'skipped'> {
  const { supabase, reservation, voyageurTypeId } = input;
  const { id: resaUuid, hostaway_id, propria_unit_id, departure_date, hostaway_listing_db_id } = reservation;
  if (!propria_unit_id || !departure_date) return 'skipped';

  // CEO 2026-06-10 : ne JAMAIS créer un ménage dans le passé.
  // Si le check-out est déjà passé, le ménage a normalement été géré IRL —
  // on ne pollue pas le module ménage avec des items rétro-actifs.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (departure_date < todayIso) return 'skipped';

  // Vérifie qu'on a déjà un ménage pour cette résa (même annulé / supprimé :
  // on ne re-crée pas pour éviter les boucles)
  const { data: existing } = await supabase
    .from('propria_cleanings')
    .select('id')
    .eq('hostaway_reservation_id', hostaway_id)
    .eq('auto_source', 'hostaway_voyageur')
    .maybeSingle();
  if (existing) return 'skipped';

  // Récupère le property_id depuis la suite
  const { data: unit } = await supabase
    .from('propria_units')
    .select('property_id, code')
    .eq('id', propria_unit_id)
    .single();
  if (!unit) return 'skipped';

  const description = `Ménage voyageur — départ ${reservation.guest_name ?? ''}`.trim();

  const { error } = await supabase.from('propria_cleanings').insert({
    property_id: (unit as any).property_id,
    propria_unit_id,
    cleaning_type_id: voyageurTypeId,
    description,
    occurred_at: departure_date,    // Le ménage a lieu le jour du check-out
    due_date: departure_date,
    urgency: 'normale',
    status: 'a_traiter',
    hostaway_reservation_id: hostaway_id,
    auto_source: 'hostaway_voyageur',
  } as any);

  if (error) {
    // Unique constraint = quelqu'un l'a créé en parallèle, no-op silencieux
    if ((error as any).code === '23505') return 'skipped';
    throw new Error(`Voyageur cleaning : ${error.message}`);
  }
  return 'created';
}

/**
 * Crée un ménage poussière si la suite a été vide ≥ 4 jours avant l'arrivée.
 * Date prévue (due_date) = jour d'arrivée (matin) — fait avant le check-in.
 *
 * Logique gap :
 *   - Si pas de check-out précédent (1ère résa connue) → créer (sécurité)
 *   - Sinon gap = arrival_date - last_departure_date
 *   - Si gap >= 4 → créer
 */
async function ensureDustCleaningForArrival(input: {
  supabase: CleaningSync;
  reservation: any;
  poussiereTypeId: string;
}): Promise<'created' | 'skipped'> {
  const { supabase, reservation, poussiereTypeId } = input;
  const { hostaway_id, propria_unit_id, arrival_date, hostaway_listing_db_id } = reservation;
  if (!propria_unit_id || !arrival_date || !hostaway_listing_db_id) return 'skipped';

  // CEO 2026-06-10 : ne JAMAIS créer un ménage poussière dans le passé.
  const todayIso = new Date().toISOString().slice(0, 10);
  if (arrival_date < todayIso) return 'skipped';

  // Idempotence
  const { data: existing } = await supabase
    .from('propria_cleanings')
    .select('id')
    .eq('hostaway_reservation_id', hostaway_id)
    .eq('auto_source', 'hostaway_poussiere')
    .maybeSingle();
  if (existing) return 'skipped';

  // Calcul du gap
  const lastDeparture = await getLastDepartureForListing(
    supabase,
    hostaway_listing_db_id,
    arrival_date,
  );

  let shouldCreate = false;
  if (!lastDeparture) {
    // Pas de check-out précédent connu → on crée par sécurité (1er voyageur
    // côté Stoniz). CEO Q3 a validé cette reco.
    shouldCreate = true;
  } else {
    const gap = gapDays(lastDeparture, arrival_date);
    shouldCreate = gap >= DUST_GAP_DAYS;
  }

  if (!shouldCreate) return 'skipped';

  const { data: unit } = await supabase
    .from('propria_units')
    .select('property_id, code')
    .eq('id', propria_unit_id)
    .single();
  if (!unit) return 'skipped';

  const description = `Ménage poussière — suite vide ${lastDeparture ? `depuis ${lastDeparture}` : 'avant 1ère réservation'}`;

  const { error } = await supabase.from('propria_cleanings').insert({
    property_id: (unit as any).property_id,
    propria_unit_id,
    cleaning_type_id: poussiereTypeId,
    description,
    occurred_at: arrival_date,
    due_date: arrival_date,        // À faire le matin de l'arrivée
    urgency: 'normale',
    status: 'a_traiter',
    hostaway_reservation_id: hostaway_id,
    auto_source: 'hostaway_poussiere',
  } as any);

  if (error) {
    if ((error as any).code === '23505') return 'skipped';
    throw new Error(`Poussière cleaning : ${error.message}`);
  }
  return 'created';
}

/**
 * Deep Cleaning automatique — règle consultant U7 + cadrage B3 (2026-06-12) :
 * tous les N séjours (N = propria_settings.deep_cleaning_every_stays, défaut 10),
 * le ménage voyageur du séjour-seuil est UPGRADÉ en Deep Cleaning.
 *
 * « Si un Deep Cleaning tombe sur la même date qu'un ménage standard →
 * remplace le ménage standard (pas de doublon) » : c'est exactement ce que
 * fait l'upgrade — on change le TYPE du ménage existant, on n'en crée pas
 * un deuxième.
 *
 * Comptage : nb de séjours (départs Hostaway new/modified) sur la suite
 * depuis le dernier Deep Cleaning non annulé. Si jamais de DC : depuis le début.
 * Idempotent : si le ménage est déjà en type Deep Cleaning, no-op.
 * Sécurité : on ne touche jamais un ménage déjà démarré ou clôturé.
 */
async function maybeUpgradeToDeepCleaning(input: {
  supabase: CleaningSync;
  reservation: any;
  deepTypeId: string;
  threshold: number;
}): Promise<'upgraded' | 'skipped'> {
  const { supabase, reservation, deepTypeId, threshold } = input;
  const { hostaway_id, propria_unit_id, departure_date, hostaway_listing_db_id } = reservation;
  if (!propria_unit_id || !departure_date || !hostaway_listing_db_id) return 'skipped';

  // Le ménage voyageur de CE séjour (auto-créé juste avant dans la sync)
  const { data: cleaning } = await supabase
    .from('propria_cleanings')
    .select('id, cleaning_type_id, status, started_at, description')
    .eq('hostaway_reservation_id', hostaway_id)
    .eq('auto_source', 'hostaway_voyageur')
    .is('deleted_at', null)
    .maybeSingle();
  if (!cleaning) return 'skipped';
  if ((cleaning as any).cleaning_type_id === deepTypeId) return 'skipped'; // déjà DC
  if ((cleaning as any).started_at || !['a_traiter'].includes((cleaning as any).status)) return 'skipped';

  // Dernier Deep Cleaning effectif sur la suite
  const { data: lastDc } = await supabase
    .from('propria_cleanings')
    .select('occurred_at')
    .eq('propria_unit_id', propria_unit_id)
    .eq('cleaning_type_id', deepTypeId)
    .neq('status', 'annule')
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const sinceDate = (lastDc as any)?.occurred_at ?? null;

  // Nb de séjours terminés (départs) depuis le dernier DC, CE séjour inclus
  let countQuery = supabase
    .from('hostaway_reservations')
    .select('id', { count: 'exact', head: true })
    .eq('hostaway_listing_db_id', hostaway_listing_db_id)
    .in('status', ['new', 'modified'])
    .lte('departure_date', departure_date)
    .is('deleted_at', null);
  if (sinceDate) countQuery = countQuery.gt('departure_date', sinceDate);
  const { count } = await countQuery;

  if ((count ?? 0) < threshold) return 'skipped';

  const { error } = await supabase
    .from('propria_cleanings')
    .update({
      cleaning_type_id: deepTypeId,
      description: `Deep Cleaning (auto — ${count}e séjour depuis le dernier DC)`,
      urgency: 'haute',
    } as any)
    .eq('id', (cleaning as any).id)
    .eq('cleaning_type_id', (cleaning as any).cleaning_type_id); // garde anti-course
  if (error) throw new Error(`Upgrade Deep Cleaning : ${error.message}`);
  return 'upgraded';
}

/**
 * Annule automatiquement les ménages liés à des réservations qui ne sont
 * plus en `new`/`modified` (annulées, expirées…).
 *
 * Ne touche pas aux ménages déjà démarrés ou clôturés (started_at NOT NULL
 * ou status terminal).
 */
async function cancelOrphanedCleanings(supabase: CleaningSync): Promise<number> {
  // Charge les ménages auto qui sont encore actifs (a_traiter ou en_cours)
  const { data: candidates } = await supabase
    .from('propria_cleanings')
    .select('id, hostaway_reservation_id, started_at, status')
    .not('hostaway_reservation_id', 'is', null)
    .not('auto_source', 'is', null)
    .in('status', ['a_traiter', 'en_cours'])
    .is('deleted_at', null)
    .is('auto_cancelled_at', null);

  if (!candidates || candidates.length === 0) return 0;

  // Charge le statut actuel des résa liées
  const resaIds = Array.from(new Set(candidates.map((c: any) => c.hostaway_reservation_id)));
  const { data: resas } = await supabase
    .from('hostaway_reservations')
    .select('hostaway_id, status')
    .in('hostaway_id', resaIds);
  const statusMap = new Map<number, string | null>();
  for (const r of (resas ?? []) as any[]) {
    statusMap.set(r.hostaway_id, r.status);
  }

  const toCancel: string[] = [];
  for (const c of candidates as any[]) {
    const s = statusMap.get(c.hostaway_reservation_id);
    // Cas 1 : résa supprimée de Hostaway (n'existe plus dans notre miroir)
    // Cas 2 : résa toujours là mais statut ≠ new/modified → annulée
    const orphan = s === undefined || (s !== 'new' && s !== 'modified');
    if (orphan && !c.started_at) {
      toCancel.push(c.id);
    }
  }

  if (toCancel.length === 0) return 0;

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('propria_cleanings')
    .update({
      status: 'annule',
      auto_cancelled_at: now,
      closed_at: now,
      refusal_reason: 'Réservation Hostaway annulée — ménage annulé automatiquement.',
    } as any)
    .in('id', toCancel);
  if (error) throw new Error(`Auto-cancel cleanings : ${error.message}`);
  return toCancel.length;
}

/**
 * Run principal — appelé par le cron Hostaway et par la server action manuelle.
 *
 * 1. Charge les types de ménage (voyageur + poussière)
 * 2. Pour chaque résa active (new/modified) avec une suite matchée :
 *    a. Si pas déjà ménage voyageur → en créer un
 *    b. Si pas déjà ménage poussière ET gap ≥ 4j → en créer un
 * 3. Annule les ménages orphelins (résa désormais cancelled)
 */
export async function syncHostawayCleanings(supabase: CleaningSync): Promise<Result> {
  const result: Result = {
    created_voyageur: 0,
    created_poussiere: 0,
    upgraded_deep: 0,
    cancelled: 0,
    skipped: 0,
    errors: [],
  };

  const types = await getCleaningTypeIds(supabase);
  if (!types.voyageur || !types.poussiere) {
    result.errors.push(
      `Types de ménage manquants : voyageur=${!!types.voyageur} poussiere=${!!types.poussiere}`,
    );
    return result;
  }
  const deepThreshold = await getDeepCleaningThreshold(supabase);

  // Période d'analyse : on regarde les résa avec arrivée OU départ
  // dans une fenêtre de J-7 → J+90 jours, suffisant pour planifier
  const today = new Date();
  const past = new Date(today); past.setDate(past.getDate() - 7);
  const future = new Date(today); future.setDate(future.getDate() + 90);

  // BUG fix CEO 2026-06-10 : `propria_unit_id` n'est PAS sur hostaway_reservations.
  // Le matching se fait via hostaway_listing_db_id → hostaway_listings.propria_unit_id.
  // On charge donc d'abord la map listing → unit, puis on enrichit les résa en mémoire.
  const { data: listings } = await supabase
    .from('hostaway_listings')
    .select('id, propria_unit_id')
    .not('propria_unit_id', 'is', null)
    .is('deleted_at', null);
  const listingToUnit = new Map<string, string>();
  for (const l of (listings ?? []) as any[]) {
    listingToUnit.set(l.id, l.propria_unit_id);
  }

  const { data: resasRaw } = await supabase
    .from('hostaway_reservations')
    .select('id, hostaway_id, hostaway_listing_db_id, arrival_date, departure_date, guest_name, status')
    .in('status', ['new', 'modified'])
    .gte('arrival_date', past.toISOString().slice(0, 10))
    .lte('arrival_date', future.toISOString().slice(0, 10))
    .not('hostaway_listing_db_id', 'is', null)
    .is('deleted_at', null);

  // Enrichit chaque résa avec propria_unit_id depuis le listing matché
  const resas = (resasRaw ?? [])
    .map((r: any) => ({
      ...r,
      propria_unit_id: r.hostaway_listing_db_id ? listingToUnit.get(r.hostaway_listing_db_id) ?? null : null,
    }))
    .filter((r: any) => r.propria_unit_id != null);

  for (const r of resas as any[]) {
    try {
      const a = await ensureGuestCleaningForReservation({
        supabase, reservation: r, voyageurTypeId: types.voyageur,
      });
      if (a === 'created') result.created_voyageur++;
      else result.skipped++;

      // Deep Cleaning auto : upgrade du ménage voyageur au séjour-seuil
      if (types.deep) {
        const u = await maybeUpgradeToDeepCleaning({
          supabase, reservation: r, deepTypeId: types.deep, threshold: deepThreshold,
        });
        if (u === 'upgraded') result.upgraded_deep++;
      }

      const b = await ensureDustCleaningForArrival({
        supabase, reservation: r, poussiereTypeId: types.poussiere,
      });
      if (b === 'created') result.created_poussiere++;
      else result.skipped++;
    } catch (e: any) {
      result.errors.push(`Resa ${r.hostaway_id} : ${e?.message ?? 'erreur'}`);
    }
  }

  // Annulation des ménages orphelins
  try {
    result.cancelled = await cancelOrphanedCleanings(supabase);
  } catch (e: any) {
    result.errors.push(`Cancel orphans : ${e?.message ?? 'erreur'}`);
  }

  return result;
}
