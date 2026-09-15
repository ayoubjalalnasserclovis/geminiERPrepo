'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { hostawayFetch, hostawayListReviews } from '@/lib/hostaway/client';
import { syncHostawayCleanings } from '@/lib/propria/cleanings-auto';

/**
 * Sync complète des listings Hostaway → table hostaway_listings.
 * Pull tout d'un coup (limite 500 par appel, suffisant pour ~40 listings).
 * Idempotent : upsert sur hostaway_id (PK fonctionnelle).
 *
 * CEO + developer uniquement (consomme du quota API Hostaway).
 */
export async function syncHostawayListingsAction() {
  await assertRole(['ceo', 'developer']);
  const supabase = createClient();

  // Pull Hostaway (limit 500 = bien au-delà des 40 listings de Stoniz)
  let response: any;
  try {
    response = await hostawayFetch('/listings', { query: { limit: 500 } });
  } catch (e: any) {
    return { ok: false as const, error: `Hostaway API : ${e?.message ?? 'erreur'}` };
  }

  const listings = Array.isArray(response?.result) ? response.result : [];
  if (listings.length === 0) {
    return { ok: false as const, error: 'Aucun listing retourné par Hostaway (réponse vide).' };
  }

  // Upsert chaque listing par hostaway_id
  let created = 0;
  let updated = 0;
  for (const l of listings) {
    if (!l?.id) continue;
    // On vérifie si on a déjà ce listing pour distinguer create / update dans la réponse
    const { data: existing } = await supabase
      .from('hostaway_listings')
      .select('id, propria_unit_id')
      .eq('hostaway_id', l.id)
      .maybeSingle();

    const payload: any = {
      hostaway_id: l.id,
      name: l.name ?? null,
      address: l.address ?? null,
      external_listing_id: l.externalListingId ?? null,
      is_active: l.status !== 'inactive',
      raw_data: l,
      last_synced_at: new Date().toISOString(),
    };

    if (existing) {
      // On préserve le matching propria_unit_id existant
      const { error } = await supabase
        .from('hostaway_listings')
        .update(payload)
        .eq('id', existing.id);
      if (!error) updated++;
    } else {
      const { error } = await supabase
        .from('hostaway_listings')
        .insert(payload as any);
      if (!error) created++;
    }
  }

  revalidatePath('/propria/integrations/hostaway');
  return {
    ok: true as const,
    total: listings.length,
    created,
    updated,
  };
}

// ─── Matching ────────────────────────────────────────────────────────────

const matchSchema = z.object({
  hostaway_listing_id: z.string().uuid(),
  propria_unit_id: z.string().uuid(),
});

/** Lie un listing Hostaway à une propria_units Stoniz. */
export async function matchHostawayListingAction(input: unknown) {
  const user = await assertRole(['ceo', 'developer', 'assistante']);
  const parsed = matchSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase
    .from('hostaway_listings')
    .update({
      propria_unit_id: parsed.data.propria_unit_id,
      matched_by: user.id,
      matched_at: new Date().toISOString(),
    } as any)
    .eq('id', parsed.data.hostaway_listing_id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/propria/integrations/hostaway');
  return { ok: true as const };
}

// ─── Sync des réservations ──────────────────────────────────────────────

/**
 * Pull les réservations Hostaway et upsert dans hostaway_reservations.
 *
 * Stratégie :
 *   • Période : arrivalStartDate = aujourd'hui - 7 jours (pour rattraper
 *     d'éventuels check-outs récents). Pas de date max → on tire toutes
 *     les résa futures.
 *   • Pagination : Hostaway plafonne à 500 résa/appel. On boucle avec
 *     offset jusqu'à recevoir < 500 résultats.
 *   • Idempotent : upsert par hostaway_id (PK fonctionnelle).
 *   • Lookup du hostaway_listing_db_id : on récupère TOUS les listings DB
 *     en une seule query au début pour éviter N+1 queries.
 *
 * CEO + developer uniquement (consomme du quota API Hostaway).
 */
export async function syncHostawayReservationsAction() {
  const user = await assertRole(['ceo', 'developer']);
  const supabase = createClient();

  // CEO 2026-06-12 : log de la sync forcée dans hostaway_sync_runs pour
  // que la page diagnostic puisse afficher l'historique complet.
  const startedAt = Date.now();
  const { data: runRow } = await supabase
    .from('hostaway_sync_runs')
    .insert({
      trigger: 'manual_daily',
      triggered_by: user.id,
      status: 'running',
      summary: {},
    } as any)
    .select('id')
    .single();
  const runId = (runRow as any)?.id ?? null;

  // Date de départ : aujourd'hui - 7 jours
  // CEO 2026-06-10 : fenêtre élargie de 7 jours à 12 mois pour alimenter
  // l'historique de la page Performance (occupation + revenus mensuels).
  // La sync est idempotente (upsert par hostaway_id) donc relancer chaque
  // heure sur 12 mois ne crée pas de doublons.
  const from = new Date();
  from.setMonth(from.getMonth() - 12);
  const arrivalStartDate = from.toISOString().slice(0, 10);

  // Récupère la map hostaway_listing_id → hostaway_listings.id (DB)
  const { data: listingsDB } = await supabase
    .from('hostaway_listings')
    .select('id, hostaway_id')
    .is('deleted_at', null);
  const listingIdMap = new Map<number, string>();
  for (const l of (listingsDB ?? []) as any[]) {
    listingIdMap.set(Number(l.hostaway_id), l.id);
  }

  // Pull avec pagination
  let allReservations: any[] = [];
  let offset = 0;
  const PAGE_SIZE = 500;
  while (true) {
    let response: any;
    try {
      response = await hostawayFetch('/reservations', {
        query: {
          arrivalStartDate,
          limit: PAGE_SIZE,
          offset,
          // Hostaway tri par dernière mise à jour décroissante par défaut.
          // On veut par date d'arrivée croissante pour la cohérence.
          sortOrder: 'arrivalDate',
        },
      });
    } catch (e: any) {
      return { ok: false as const, error: `Hostaway API : ${e?.message ?? 'erreur'}` };
    }
    const page = Array.isArray(response?.result) ? response.result : [];
    if (page.length === 0) break;
    allReservations = allReservations.concat(page);
    if (page.length < PAGE_SIZE) break; // dernière page
    offset += PAGE_SIZE;
    // Garde-fou : on ne fait pas plus de 10 pages (=5000 résa), au-delà
    // c'est suspect et il faut paginer côté UI.
    if (offset >= 5000) break;
  }

  if (allReservations.length === 0) {
    if (runId) {
      await supabase
        .from('hostaway_sync_runs')
        .update({
          ended_at: new Date().toISOString(),
          status: 'ok',
          duration_ms: Date.now() - startedAt,
          summary: { reservations: { synced: 0, errors: 0 } },
        } as any)
        .eq('id', runId);
    }
    return { ok: true as const, total: 0, created: 0, updated: 0, info: 'Aucune réservation à synchroniser.' };
  }

  // Upsert chaque réservation
  let created = 0;
  let updated = 0;
  for (const r of allReservations) {
    if (!r?.id || !r?.listingMapId || !r?.arrivalDate || !r?.departureDate) continue;

    const payload: any = {
      hostaway_id: r.id,
      hostaway_listing_id: r.listingMapId,
      hostaway_listing_db_id: listingIdMap.get(Number(r.listingMapId)) ?? null,
      guest_name: r.guestName ?? null,
      guest_email: r.guestEmail ?? null,
      guest_phone: r.phone ?? null,
      number_of_guests: r.numberOfGuests ?? null,
      arrival_date: r.arrivalDate,
      departure_date: r.departureDate,
      check_in_time: r.checkInTime ? String(r.checkInTime) : null,
      check_out_time: r.checkOutTime ? String(r.checkOutTime) : null,
      nights: r.nights ?? null,
      status: r.status ?? null,
      channel_id: r.channelId ?? null,
      channel_name: r.channelName ?? null,
      total_price: r.totalPrice ?? null,
      currency: r.currency ?? null,
      guest_note: r.guestNote ?? null,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('hostaway_reservations')
      .select('id')
      .eq('hostaway_id', r.id)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('hostaway_reservations')
        .update(payload)
        .eq('id', (existing as any).id);
      if (!error) updated++;
    } else {
      const { error } = await supabase
        .from('hostaway_reservations')
        .insert(payload as any);
      if (!error) created++;
    }
  }

  revalidatePath('/propria/reservations');
  revalidatePath('/propria/integrations/hostaway/reservations');
  revalidatePath('/propria/performance');
  revalidatePath('/propria/daily');

  // Clôture du log de sync (CEO 2026-06-12)
  if (runId) {
    await supabase
      .from('hostaway_sync_runs')
      .update({
        ended_at: new Date().toISOString(),
        status: 'ok',
        duration_ms: Date.now() - startedAt,
        summary: {
          reservations: { synced: created + updated, created, updated, total: allReservations.length, errors: 0 },
        },
      } as any)
      .eq('id', runId);
  }

  return {
    ok: true as const,
    total: allReservations.length,
    created,
    updated,
  };
}

// ─── Sync avis voyageurs (CEO 2026-06-10) ────────────────────────────
//
// L'API Hostaway `/v1/reviews` renvoie les avis cross-canal. On normalise
// le rating sur 5 (Airbnb 1-5, Booking 1-10) puis on upsert.
//
// Particularité métier : si un avis qu'on avait précédemment N'EST PLUS
// retourné par la sync, on pose `removed_at = now()`. C'est utile pour
// suivre les contestations Airbnb/Booking où un avis négatif est retiré.

/**
 * Hostaway harmonise TOUTES les notes sur 10 quel que soit le canal source
 * (vérifié 2026-06-10 : 1221 avis Airbnb tous remontés sur 10).
 * On divise donc TOUJOURS par 2 quand la note brute > 5.
 */
function normalizeRating(raw: number | null): number | null {
  if (raw == null) return null;
  if (raw > 5) return Math.round((raw / 2) * 10) / 10;
  return Math.round(raw * 10) / 10;
}

/**
 * Hostaway ne renvoie pas `channelName` dans /v1/reviews mais expose un
 * `channelId` numérique. Mapping officiel (les + courants chez Stoniz).
 */
const CHANNEL_ID_MAP: Record<number, string> = {
  2000: 'Direct',
  2002: 'Airbnb',
  2005: 'Booking.com',
  2007: 'Expedia',
  2010: 'VRBO',
  2013: 'Airbnb',
  2018: 'Airbnb',
  2021: 'TripAdvisor',
};
function resolveChannelName(raw: any): string | null {
  if (raw?.channelName) return raw.channelName;
  if (raw?.channel) return raw.channel;
  const cid = raw?.channelId != null ? Number(raw.channelId) : null;
  if (cid && CHANNEL_ID_MAP[cid]) return CHANNEL_ID_MAP[cid];
  if (cid) return `Canal ${cid}`;
  return null;
}

export async function syncHostawayReviewsAction() {
  await assertRole(['ceo', 'developer']);
  const supabase = createClient();

  // Pull 12 derniers mois (cf cadrage CEO Q4)
  const since = new Date();
  since.setMonth(since.getMonth() - 12);
  const sinceDate = since.toISOString().slice(0, 10);

  let reviews: any[];
  try {
    reviews = await hostawayListReviews({ sinceDate });
  } catch (e: any) {
    return { ok: false as const, error: `Hostaway API : ${e?.message ?? 'erreur'}` };
  }

  if (reviews.length === 0) {
    return { ok: true as const, total: 0, created: 0, updated: 0, removed: 0, info: 'Aucun avis retourné par Hostaway.' };
  }

  // Charge les listings + units pour matcher en mémoire
  const { data: listings } = await supabase
    .from('hostaway_listings')
    .select('id, hostaway_id, propria_unit_id')
    .is('deleted_at', null);
  const listingMap = new Map<number, { id: string; propria_unit_id: string | null }>();
  for (const l of listings ?? []) {
    listingMap.set((l as any).hostaway_id, { id: (l as any).id, propria_unit_id: (l as any).propria_unit_id });
  }

  // Filtre : on garde uniquement les avis voyageur → hôte
  const guestReviews = reviews.filter((r: any) => {
    const t = (r.type ?? '').toLowerCase();
    return t === 'guest-to-host' || t === '' || t === 'guesttohost';
  });

  const syncedHostawayIds = new Set<number>();
  let created = 0;
  let updated = 0;

  for (const r of guestReviews) {
    const hostawayId = r.id;
    if (!hostawayId) continue;
    syncedHostawayIds.add(hostawayId);

    const listing = listingMap.get(r.listingMapId ?? r.listingId);
    const channel = resolveChannelName(r);
    const rawRating = r.rating != null ? Number(r.rating) : null;
    const ratingNormalized = normalizeRating(rawRating);

    const submittedAt = r.submittedAt ?? r.insertedOn ?? new Date().toISOString();
    const responseDate = r.hostReviewedAt ?? null;

    const payload: any = {
      hostaway_id: hostawayId,
      type: r.type ?? null,
      channel_name: channel,
      hostaway_listing_id: r.listingMapId ?? r.listingId ?? null,
      hostaway_listing_db_id: listing?.id ?? null,
      propria_unit_id: listing?.propria_unit_id ?? null,
      hostaway_reservation_id: r.reservationId ?? null,
      guest_name: r.guestName ?? null,
      public_review: r.publicReview ?? r.review ?? null,
      private_review: r.privateReview ?? null,
      rating: rawRating,
      rating_normalized: ratingNormalized,
      category_ratings: r.reviewCategory ?? r.categoryRatings ?? null,
      response_from_host: r.hostReply ?? r.response ?? null,
      response_date: responseDate,
      submitted_at: submittedAt,
      is_published: r.isPublished !== false,
      raw_data: r,
      last_synced_at: new Date().toISOString(),
      // removed_at : on l'EFFACE si l'avis réapparaît (cas rare où Airbnb le re-publie)
      removed_at: null,
    };

    // Vérifie existence pour distinguer create / update + préserver le workflow interne
    const { data: existing } = await supabase
      .from('hostaway_reviews')
      .select('id, internal_status')
      .eq('hostaway_id', hostawayId)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('hostaway_reviews')
        .update(payload)
        .eq('id', (existing as any).id);
      if (!error) updated++;
    } else {
      const { error } = await supabase
        .from('hostaway_reviews')
        .insert(payload);
      if (!error) created++;
    }
  }

  // Détection des avis supprimés : ceux qu'on avait, dans la même période,
  // mais qui ne sont PAS revenus dans la sync.
  const { data: existingInWindow } = await supabase
    .from('hostaway_reviews')
    .select('id, hostaway_id, removed_at')
    .gte('submitted_at', sinceDate)
    .is('deleted_at', null);

  let removed = 0;
  const toRemove: string[] = [];
  for (const row of existingInWindow ?? []) {
    if (!syncedHostawayIds.has((row as any).hostaway_id) && !(row as any).removed_at) {
      toRemove.push((row as any).id);
    }
  }
  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('hostaway_reviews')
      .update({ removed_at: new Date().toISOString() } as any)
      .in('id', toRemove);
    if (!error) removed = toRemove.length;
  }

  revalidatePath('/propria/avis');
  revalidatePath('/propria');
  return { ok: true as const, total: guestReviews.length, created, updated, removed };
}

// ─── Sync des ménages auto depuis les réservations (CEO 2026-06-10) ─
//
// 1) ménage voyageur à chaque check-out
// 2) ménage poussière si la suite est restée vide ≥ 4 jours avant un check-in
// Idempotent. Appelé aussi par le cron horaire automatiquement.

export async function triggerHostawayCleaningsSyncAction() {
  await assertRole(['ceo', 'developer']);
  const supabase = createClient();
  try {
    const result = await syncHostawayCleanings(supabase as any);
    revalidatePath('/propria/menage');
    revalidatePath('/propria');
    return { ok: true as const, ...result };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur' };
  }
}

// ─── Workflow interne sur un avis ────────────────────────────────────

export async function markReviewInternalStatusAction(input: {
  review_id: string;
  status: 'to_review' | 'reviewed' | 'resolved';
  notes?: string | null;
}) {
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const supabase = createClient();

  const update: any = {
    internal_status: input.status,
    internal_handled_by: user.id,
    internal_handled_at: new Date().toISOString(),
  };
  if (input.notes !== undefined) update.internal_notes = input.notes ?? null;

  const { error } = await supabase
    .from('hostaway_reviews')
    .update(update)
    .eq('id', input.review_id);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath('/propria/avis');
  return { ok: true as const };
}

/** Retire le matching (remet propria_unit_id à NULL). */
export async function unmatchHostawayListingAction(hostawayListingId: string) {
  await assertRole(['ceo', 'developer', 'assistante']);
  const supabase = createClient();
  const { error } = await supabase
    .from('hostaway_listings')
    .update({
      propria_unit_id: null,
      matched_by: null,
      matched_at: null,
    } as any)
    .eq('id', hostawayListingId);
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/propria/integrations/hostaway');
  return { ok: true as const };
}
