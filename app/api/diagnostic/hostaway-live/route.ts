import { NextResponse } from 'next/server';
import { hostawayFetch } from '@/lib/hostaway/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSessionUser } from '@/lib/auth/require';

/**
 * Diagnostic LIVE Hostaway (CEO 2026-06-12).
 *
 * Compare ce que l'API Hostaway renvoie pour 1 listing donné à ce qu'on
 * a en BDD. Permet de pinpointer pourquoi certaines résa n'apparaissent
 * pas (filtre API, pagination, bug code).
 *
 * URL : /api/diagnostic/hostaway-live?listingId=511031
 *       /api/diagnostic/hostaway-live?guest=boutayna  (recherche par nom)
 *       /api/diagnostic/hostaway-live (toutes les résa juin 2026)
 *
 * Accès : CEO + developer uniquement.
 */
export async function GET(request: Request) {
  const me = await getSessionUser();
  if (!me || (me.role !== 'ceo' && me.role !== 'developer')) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 });
  }

  const url = new URL(request.url);
  const listingIdParam = url.searchParams.get('listingId');
  const guestParam = url.searchParams.get('guest');

  try {
    // 1) Appel API Hostaway brut sur juin 2026
    const apiResp: any = await hostawayFetch('/reservations', {
      query: {
        arrivalStartDate: '2026-06-01',
        arrivalEndDate: '2026-06-30',
        limit: 500,
        ...(listingIdParam ? { listingMapIds: listingIdParam } : {}),
        sortOrder: 'arrivalDate',
      },
    });
    const apiResas = Array.isArray(apiResp?.result) ? apiResp.result : [];

    // 2) Filtre côté nom si demandé
    const filtered = guestParam
      ? apiResas.filter((r: any) =>
          (r.guestName ?? '').toLowerCase().includes(guestParam.toLowerCase()),
        )
      : apiResas;

    // 3) BDD : mêmes résa pour juin 2026
    const admin = createAdminClient();
    const { data: bddResas } = await admin
      .from('hostaway_reservations')
      .select('hostaway_id, guest_name, status, arrival_date, departure_date, hostaway_listing_id')
      .gte('arrival_date', '2026-06-01')
      .lte('arrival_date', '2026-06-30')
      .is('deleted_at', null);

    const bddIdSet = new Set((bddResas ?? []).map((r: any) => Number(r.hostaway_id)));
    const apiIdSet = new Set(apiResas.map((r: any) => Number(r.id)));

    // 4) Diff : qui est dans l'API mais pas en BDD
    const missingInBdd = apiResas
      .filter((r: any) => !bddIdSet.has(Number(r.id)))
      .map((r: any) => ({
        hostaway_id: r.id,
        guest_name: r.guestName,
        status: r.status,
        arrival_date: r.arrivalDate,
        departure_date: r.departureDate,
        channel_name: r.channelName,
        listingMapId: r.listingMapId,
        has_listingMapId: !!r.listingMapId,
        skipped_by_our_check: !r?.id || !r?.listingMapId || !r?.arrivalDate || !r?.departureDate,
      }));

    // 5) Et inversement (BDD mais plus dans l'API = peut-être annulées côté Hostaway)
    const missingInApi = (bddResas ?? [])
      .filter((r: any) => !apiIdSet.has(Number(r.hostaway_id)))
      .map((r: any) => ({
        hostaway_id: r.hostaway_id,
        guest_name: r.guest_name,
        status: r.status,
        arrival_date: r.arrival_date,
      }));

    return NextResponse.json({
      ok: true,
      query_window: 'arrivalDate 2026-06-01 to 2026-06-30',
      filters_used: {
        listingMapIds: listingIdParam,
        guest_search: guestParam,
      },
      counts: {
        api_returned: apiResas.length,
        api_after_guest_filter: filtered.length,
        bdd_total: (bddResas ?? []).length,
        missing_in_bdd: missingInBdd.length,
        missing_in_api: missingInApi.length,
      },
      api_filtered_preview: filtered.slice(0, 50).map((r: any) => ({
        hostaway_id: r.id,
        guest_name: r.guestName,
        status: r.status,
        arrival_date: r.arrivalDate,
        departure_date: r.departureDate,
        channel_name: r.channelName,
        listingMapId: r.listingMapId,
      })),
      missing_in_bdd: missingInBdd,
      missing_in_api: missingInApi,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: e?.message ?? 'unknown error',
      stack: e?.stack?.slice(0, 2000),
    }, { status: 500 });
  }
}
