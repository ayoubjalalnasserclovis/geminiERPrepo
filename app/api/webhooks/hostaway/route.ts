import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Webhook Hostaway temps réel (CEO 2026-06-12).
 *
 * Endpoint à configurer côté dashboard Hostaway :
 *   URL          : https://studio.stoniz.co/api/webhooks/hostaway
 *   Username     : valeur de HOSTAWAY_WEBHOOK_USERNAME (env Vercel)
 *   Password     : valeur de HOSTAWAY_WEBHOOK_PASSWORD (env Vercel)
 *   Annonce      : Toutes les annonces
 *   Canal        : Tous les canaux
 *   Activé       : Oui
 *
 * Pourquoi temps réel et pas que le cron ?
 * Le cron tourne toutes les 15 min → jusqu'à 15 min de retard sur les
 * nouvelles résa. Sur des opérations terrain (arrivées du jour), c'est
 * trop. Avec le webhook, dès qu'un voyageur réserve, la BDD est à jour
 * en quelques secondes.
 *
 * Le cron toutes les 15 min reste comme filet de sécurité (rattrape les webhooks qu'on
 * aurait ratés à cause d'un déploiement, d'une erreur réseau, etc.).
 *
 * Sécurité : Hostaway ajoute l'en-tête Authorization: Basic base64(user:pass)
 * sur chaque POST. On vérifie ici avec comparaison constante-time pour
 * éviter les attaques timing.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const admin = createAdminClient();

  // Body brut nécessaire pour vérifier la signature
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: 'Bad body' }, { status: 400 });
  }

  // Vérification de l'authentification Basic (Hostaway envoie
  // Authorization: Basic base64(username:password) sur chaque POST).
  // On logge MÊME si l'auth est invalide pour auditer les tentatives.
  const authHeader = request.headers.get('authorization')
    ?? request.headers.get('Authorization')
    ?? null;

  const expectedUsername = process.env.HOSTAWAY_WEBHOOK_USERNAME;
  const expectedPassword = process.env.HOSTAWAY_WEBHOOK_PASSWORD;
  let signatureValid: boolean | null = null; // reuse same column = "auth_valid"

  if (expectedUsername && expectedPassword) {
    if (!authHeader || !authHeader.toLowerCase().startsWith('basic ')) {
      signatureValid = false;
    } else {
      try {
        const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf-8');
        const [user, ...rest] = decoded.split(':');
        const pass = rest.join(':'); // au cas où le password contienne des ':'
        // Comparaison constant-time pour éviter timing attacks
        const userBuf = Buffer.from(user);
        const expectedUserBuf = Buffer.from(expectedUsername);
        const passBuf = Buffer.from(pass);
        const expectedPassBuf = Buffer.from(expectedPassword);
        const userOk =
          userBuf.length === expectedUserBuf.length &&
          timingSafeEqual(userBuf, expectedUserBuf);
        const passOk =
          passBuf.length === expectedPassBuf.length &&
          timingSafeEqual(passBuf, expectedPassBuf);
        signatureValid = userOk && passOk;
      } catch {
        signatureValid = false;
      }
    }
  }

  // Parse payload — Hostaway envoie du JSON
  let payload: any = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Pas du JSON — on log et on répond 400
    await admin.from('hostaway_webhook_events').insert({
      signature_valid: signatureValid,
      processing_status: 'failed',
      error_message: 'Body is not valid JSON',
      raw_payload: { _raw: rawBody.slice(0, 5000) },
      headers: serializeHeaders(request.headers),
    } as any);
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  // Sécurité : refuse si auth invalide ET credentials configurés
  if (expectedUsername && expectedPassword && signatureValid === false) {
    await admin.from('hostaway_webhook_events').insert({
      signature_valid: false,
      processing_status: 'failed',
      error_message: 'Invalid Basic Auth credentials',
      raw_payload: payload,
      headers: serializeHeaders(request.headers),
    } as any);
    return NextResponse.json({ ok: false, error: 'Invalid credentials' }, { status: 401 });
  }

  // Identifie l'événement
  const eventType: string | null =
    payload?.event ?? payload?.eventType ?? payload?.type ?? null;
  const objectType: string | null =
    payload?.object ?? payload?.objectType ?? eventType?.split('.')[0] ?? null;
  const data = payload?.data ?? payload?.object_data ?? payload;
  const hostawayObjectId: number | null =
    data?.id != null ? Number(data.id) :
    payload?.objectId != null ? Number(payload.objectId) :
    null;

  // Insert le log "received" pour avoir l'ID
  const { data: logRow } = await admin
    .from('hostaway_webhook_events')
    .insert({
      event_type: eventType,
      object_type: objectType,
      hostaway_object_id: hostawayObjectId,
      signature_valid: signatureValid,
      processing_status: 'received',
      raw_payload: payload,
      headers: serializeHeaders(request.headers),
    } as any)
    .select('id')
    .single();
  const logId = (logRow as any)?.id ?? null;

  // Traitement métier selon le type d'objet
  let processingStatus: 'processed' | 'failed' | 'ignored' = 'ignored';
  let errorMessage: string | null = null;

  try {
    if (objectType === 'reservation' || eventType?.startsWith('reservation')) {
      await upsertReservation(admin, data, eventType);
      processingStatus = 'processed';
    } else if (objectType === 'listing' || eventType?.startsWith('listing')) {
      await upsertListing(admin, data);
      processingStatus = 'processed';
    } else if (objectType === 'review' || eventType?.startsWith('review')) {
      // Pour les avis on délègue au cron (logique plus complexe avec
      // normalisation rating + canal). Le webhook déclenche juste un signal
      // mais le vrai sync reviewra à la prochaine itération du cron.
      processingStatus = 'ignored';
      errorMessage = 'review sync handled by cron (no immediate processing)';
    } else {
      processingStatus = 'ignored';
      errorMessage = `unknown object_type: ${objectType}`;
    }
  } catch (e: any) {
    processingStatus = 'failed';
    errorMessage = e?.message ?? 'unknown error';
  }

  // Finalise le log
  if (logId) {
    await admin
      .from('hostaway_webhook_events')
      .update({
        processing_status: processingStatus,
        error_message: errorMessage,
        duration_ms: Date.now() - startedAt,
      } as any)
      .eq('id', logId);
  }

  return NextResponse.json({ ok: true, status: processingStatus });
}

// ─── Helpers ────────────────────────────────────────────────────────────

function serializeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((v, k) => { out[k] = v; });
  return out;
}

/**
 * Upsert d'une réservation reçue via webhook (réutilise la même logique
 * que le cron mais sur 1 seul objet — beaucoup plus rapide).
 */
async function upsertReservation(admin: any, r: any, eventType: string | null) {
  if (!r?.id || !r?.listingMapId || !r?.arrivalDate || !r?.departureDate) {
    throw new Error('Réservation incomplète : id, listingMapId, arrivalDate ou departureDate manquant');
  }

  // Si c'est une suppression Hostaway → soft-delete
  if (eventType?.includes('deleted')) {
    const { error } = await admin
      .from('hostaway_reservations')
      .update({ deleted_at: new Date().toISOString() })
      .eq('hostaway_id', r.id);
    if (error) throw new Error(`soft-delete: ${error.message}`);
    return;
  }

  // Résout l'ID listing en BDD
  const { data: listingRow } = await admin
    .from('hostaway_listings')
    .select('id')
    .eq('hostaway_id', r.listingMapId)
    .maybeSingle();
  const listingDbId = (listingRow as any)?.id ?? null;

  const payload: any = {
    hostaway_id: r.id,
    hostaway_listing_id: r.listingMapId,
    hostaway_listing_db_id: listingDbId,
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
    deleted_at: null, // au cas où on revive une résa précédemment soft-deleted
  };

  const { data: existing } = await admin
    .from('hostaway_reservations')
    .select('id')
    .eq('hostaway_id', r.id)
    .maybeSingle();

  if (existing) {
    const { error } = await admin
      .from('hostaway_reservations')
      .update(payload)
      .eq('id', (existing as any).id);
    if (error) throw new Error(`update: ${error.message}`);
  } else {
    const { error } = await admin.from('hostaway_reservations').insert(payload);
    if (error) throw new Error(`insert: ${error.message}`);
  }
}

/**
 * Upsert d'un listing.
 */
async function upsertListing(admin: any, l: any) {
  if (!l?.id) throw new Error('Listing sans id');

  const { data: existing } = await admin
    .from('hostaway_listings')
    .select('id')
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
    const { error } = await admin
      .from('hostaway_listings')
      .update(payload)
      .eq('id', (existing as any).id);
    if (error) throw new Error(`update listing: ${error.message}`);
  } else {
    const { error } = await admin.from('hostaway_listings').insert(payload);
    if (error) throw new Error(`insert listing: ${error.message}`);
  }
}
