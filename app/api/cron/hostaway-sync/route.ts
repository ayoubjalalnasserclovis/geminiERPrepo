import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { hostawayFetch, hostawayListReviews } from '@/lib/hostaway/client';
import { syncHostawayCleanings } from '@/lib/propria/cleanings-auto';
import { syncPreReviewTrackings } from '@/lib/propria/pre-review-tracking';
import { requireCronAuth } from '@/lib/cron/auth';

// CEO 2026-06-12 : timeout étendu à 300s. Avant le default Vercel
// (10-60s selon plan) tuait silencieusement le cron en plein milieu
// du upsert des résa → BDD jamais à jour, sync runs en status='running'
// indéfini. Diag : table hostaway_sync_runs avant fix montrait que
// AUCUN run n'a jamais fini.
export const maxDuration = 300;

/**
 * Cron Vercel quotidien — sync listings + réservations Hostaway.
 *
 * Déclenché par vercel.json à 5h UTC tous les jours.
 *
 * Sécurité : garde-fou centralisé `requireCronAuth` (lib/cron/auth.ts).
 * Vercel Cron envoie `Authorization: Bearer <CRON_SECRET>`. Si CRON_SECRET
 * est absente, la route refuse (503) au lieu de devenir publique — aucun
 * repli, aucun mot de passe de secours.
 *
 * On ne passe PAS par les server actions (qui requièrent un utilisateur
 * connecté). On utilise le client admin Supabase pour bypasser RLS.
 */
export async function GET(request: Request) {
  // 1. Garde-fou centralisé (lib/cron/auth.ts) : Bearer CRON_SECRET obligatoire.
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const admin = createAdminClient();
  const startedAt = Date.now();
  const summary: any = {
    listings: { synced: 0, errors: 0 },
    reservations: { synced: 0, errors: 0 },
    reviews: { synced: 0, errors: 0, removed: 0 },
    cleanings: { created_voyageur: 0, created_poussiere: 0, upgraded_deep: 0, cancelled: 0, errors: [] as string[] },
  };

  // CEO 2026-06-12 : sentinelle BDD sur chaque cron run pour detecter les
  // jours ou la sync n'a pas tourne correctement (ex: 12/06 capture qui
  // montrait des resa visibles dans Hostaway mais pas dans la BDD).
  const { data: runRow } = await admin
    .from('hostaway_sync_runs')
    .insert({
      trigger: 'cron',
      status: 'running',
      summary: {},
    } as any)
    .select('id')
    .single();
  const runId = (runRow as any)?.id ?? null;

  // ─── Sync listings (CEO 2026-06-12 : UPSERT en batch) ─────────────────
  try {
    const listingsResp: any = await hostawayFetch('/listings', { query: { limit: 500 } });
    const listings = Array.isArray(listingsResp?.result) ? listingsResp.result : [];
    const listingPayloads = listings
      .filter((l: any) => l?.id)
      .map((l: any) => ({
        hostaway_id: l.id,
        name: l.name ?? null,
        address: l.address ?? null,
        external_listing_id: l.externalListingId ?? null,
        is_active: l.status !== 'inactive',
        raw_data: l,
        last_synced_at: new Date().toISOString(),
      }));
    if (listingPayloads.length > 0) {
      const { error } = await admin
        .from('hostaway_listings')
        .upsert(listingPayloads as any, { onConflict: 'hostaway_id' });
      if (error) summary.listings.errors = listingPayloads.length;
      else summary.listings.synced = listingPayloads.length;
    }
  } catch (e: any) {
    summary.listings.fatal = e?.message ?? 'unknown';
  }

  // ─── Sync réservations ───────────────────────────────────────────────
  try {
    // Map listing_id Hostaway → hostaway_listings.id DB
    const { data: listingsDB } = await admin
      .from('hostaway_listings')
      .select('id, hostaway_id')
      .is('deleted_at', null);
    const listingIdMap = new Map<number, string>();
    for (const l of (listingsDB ?? []) as any[]) {
      listingIdMap.set(Number(l.hostaway_id), l.id);
    }

    // Période : 12 mois en arrière → futur (CEO 2026-06-10 — étendu de 7j
    // à 12 mois pour alimenter l'historique de la page Performance).
    // Sync idempotente (upsert hostaway_id) donc relancer chaque heure OK.
    const from = new Date();
    from.setMonth(from.getMonth() - 12);
    const arrivalStartDate = from.toISOString().slice(0, 10);

    let allReservations: any[] = [];
    let offset = 0;
    const PAGE_SIZE = 500;
    while (true) {
      const resp: any = await hostawayFetch('/reservations', {
        query: { arrivalStartDate, limit: PAGE_SIZE, offset, sortOrder: 'arrivalDate' },
      });
      const page = Array.isArray(resp?.result) ? resp.result : [];
      if (page.length === 0) break;
      allReservations = allReservations.concat(page);
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
      // Garde-fou élargi : 12 mois × 40 listings ≈ 400-1000 résa attendues
      if (offset >= 10000) break;
    }

    // CEO 2026-06-12 : UPSERT en batch (1 requête par 500 résa au lieu
    // de 2 par résa). Passe de ~2822 requêtes BDD à ~3 → divise le temps
    // par 1000x. Sans ça le cron timeoutait sans jamais finir.
    const payloads = allReservations
      .filter((r: any) => r?.id && r?.listingMapId && r?.arrivalDate && r?.departureDate)
      .map((r: any) => ({
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
      }));

    // Upsert par chunks de 500 (limite Supabase)
    const CHUNK = 500;
    for (let i = 0; i < payloads.length; i += CHUNK) {
      const chunk = payloads.slice(i, i + CHUNK);
      const { error } = await admin
        .from('hostaway_reservations')
        .upsert(chunk as any, { onConflict: 'hostaway_id' });
      if (error) {
        summary.reservations.errors += chunk.length;
      } else {
        summary.reservations.synced += chunk.length;
      }
    }
  } catch (e: any) {
    summary.reservations.fatal = e?.message ?? 'unknown';
  }

  // ─── Sync avis voyageurs (CEO 2026-06-10) ────────────────────────────
  try {
    const since = new Date();
    since.setMonth(since.getMonth() - 12);
    const sinceDate = since.toISOString().slice(0, 10);

    const reviews = await hostawayListReviews({ sinceDate });

    // Map listing → unit
    const { data: listingsForRev } = await admin
      .from('hostaway_listings')
      .select('id, hostaway_id, propria_unit_id')
      .is('deleted_at', null);
    const lMap = new Map<number, { id: string; propria_unit_id: string | null }>();
    for (const l of (listingsForRev ?? []) as any[]) {
      lMap.set(Number(l.hostaway_id), { id: l.id, propria_unit_id: l.propria_unit_id });
    }

    const guestReviews = reviews.filter((r: any) => {
      const t = (r.type ?? '').toLowerCase();
      return t === 'guest-to-host' || t === '' || t === 'guesttohost';
    });

    const syncedIds = new Set<number>();
    const reviewPayloads: any[] = [];
    for (const r of guestReviews) {
      const hostawayId = r.id;
      if (!hostawayId) continue;
      syncedIds.add(hostawayId);

      const listing = lMap.get(r.listingMapId ?? r.listingId);
      // Hostaway harmonise tout sur 10 (vérifié 2026-06-10) → toujours /2 si > 5
      const rawRating = r.rating != null ? Number(r.rating) : null;
      const ratingNormalized = rawRating == null ? null :
        rawRating > 5
          ? Math.round((rawRating / 2) * 10) / 10
          : Math.round(rawRating * 10) / 10;
      // channelName absent du payload /reviews — fallback sur channelId
      const cid = r.channelId != null ? Number(r.channelId) : null;
      const channel = r.channelName ?? r.channel ?? (
        cid === 2018 || cid === 2013 || cid === 2002 ? 'Airbnb'
        : cid === 2005 ? 'Booking.com'
        : cid === 2007 ? 'Expedia'
        : cid === 2010 ? 'VRBO'
        : cid === 2021 ? 'TripAdvisor'
        : cid === 2000 ? 'Direct'
        : cid ? `Canal ${cid}` : null
      );

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
        response_date: r.hostReviewedAt ?? null,
        submitted_at: r.submittedAt ?? r.insertedOn ?? new Date().toISOString(),
        is_published: r.isPublished !== false,
        raw_data: r,
        last_synced_at: new Date().toISOString(),
        removed_at: null,
      };

      // Stocke pour upsert en batch après la boucle
      reviewPayloads.push(payload);
    }

    // CEO 2026-06-12 : UPSERT en batch (idem résa, divise temps par 1000x)
    const CHUNK_REV = 500;
    for (let i = 0; i < reviewPayloads.length; i += CHUNK_REV) {
      const chunk = reviewPayloads.slice(i, i + CHUNK_REV);
      const { error } = await admin
        .from('hostaway_reviews')
        .upsert(chunk as any, { onConflict: 'hostaway_id' });
      if (error) summary.reviews.errors += chunk.length;
      else summary.reviews.synced += chunk.length;
    }

    // Détection avis supprimés
    const { data: existingInWindow } = await admin
      .from('hostaway_reviews')
      .select('id, hostaway_id, removed_at')
      .gte('submitted_at', sinceDate)
      .is('deleted_at', null);
    const toRemove: string[] = [];
    for (const row of (existingInWindow ?? []) as any[]) {
      if (!syncedIds.has(row.hostaway_id) && !row.removed_at) {
        toRemove.push(row.id);
      }
    }
    if (toRemove.length > 0) {
      const { error } = await admin
        .from('hostaway_reviews')
        .update({ removed_at: new Date().toISOString() })
        .in('id', toRemove);
      if (!error) summary.reviews.removed = toRemove.length;
    }
  } catch (e: any) {
    summary.reviews.fatal = e?.message ?? 'unknown';
  }

  // ─── Création auto des ménages (CEO 2026-06-10 — étape 5) ────────────
  try {
    const cleaningsResult = await syncHostawayCleanings(admin as any);
    summary.cleanings = cleaningsResult;
  } catch (e: any) {
    summary.cleanings.fatal = e?.message ?? 'unknown';
  }

  // ─── Trackings avis préventifs (CEO 2026-06-10 — Kanban 2) ────────────
  // Crée les trackings pour les checkouts récents + bascule auto quand
  // l'avis est reçu ou que les 14 jours expirent.
  try {
    summary.pre_reviews = await syncPreReviewTrackings(admin as any);
  } catch (e: any) {
    summary.pre_reviews = { fatal: e?.message ?? 'unknown' };
  }

  // CEO 2026-06-12 : finaliser le log du run
  const durationMs = Date.now() - startedAt;
  const hasError =
    summary.listings?.fatal ||
    summary.reservations?.fatal ||
    summary.reviews?.fatal ||
    (summary.cleanings?.fatal as any) ||
    (summary.reservations?.errors ?? 0) > 0 ||
    (summary.listings?.errors ?? 0) > 0;
  const status: 'ok' | 'partial' | 'error' = summary.reservations?.fatal
    ? 'error'
    : hasError
    ? 'partial'
    : 'ok';
  if (runId) {
    await admin
      .from('hostaway_sync_runs')
      .update({
        ended_at: new Date().toISOString(),
        summary,
        status,
        duration_ms: durationMs,
        error_message: summary.reservations?.fatal ?? summary.listings?.fatal ?? null,
      } as any)
      .eq('id', runId);
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString(), summary });
}
