import Link from 'next/link';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { HostawayReservationsTable } from '@/components/propria/hostaway-reservations-table';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { single, multi, period, search, escapeIlike as parseEscapeIlike, type SP } from '@/lib/list-filters/parse';

/**
 * Outer wrapper avec sentinelle BDD (CEO 2026-06-11) : toute erreur de rendu
 * est persistée dans app_error_logs avant d'être propagée. Pattern qui a
 * sauvé la caisse plusieurs fois — Vercel masque les error.message en prod.
 */
export default async function PropriaReservationsPageOuter({ searchParams }: { searchParams: SP }) {
  try {
    return await PropriaReservationsPage({ searchParams });
  } catch (err: any) {
    if (err?.digest === 'NEXT_NOT_FOUND' || err?.digest?.startsWith?.('NEXT_REDIRECT')) {
      throw err;
    }
    try {
      const admin = createAdminClient();
      const me = await getSessionUser().catch(() => null);
      await admin.from('app_error_logs').insert({
        source: 'PropriaReservationsPage:render',
        user_id: me?.id ?? null,
        message: (err?.message ?? 'unknown render error').slice(0, 1000),
        details: {
          stack: (err?.stack ?? '').slice(0, 4000),
          name: err?.name,
          digest: err?.digest,
        },
        payload: {
          pathname: '/propria/reservations',
          searchParams,
          role: me?.role ?? null,
        },
      } as any);
    } catch { /* never let the logger break the error path */ }
    throw err;
  }
}

async function PropriaReservationsPage({
  searchParams,
}: { searchParams: SP }) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  // Legacy filtres conservés (chips temporels du composant client)
  const filter = single(searchParams, 'filter') ?? 'upcoming';
  const channel = single(searchParams, 'channel') ?? '';

  // Nouveaux filtres toolbar
  const q = search(searchParams);
  const propertyId = single(searchParams, 'property');
  const platforms = multi(searchParams, 'platform');
  const statuses = multi(searchParams, 'status');
  const arrivalPeriod = period(searchParams, 'arrival_period');

  async function fetchAllActiveReservations() {
    const PAGE = 1000;
    const HARD_CAP = 10_000;
    let all: any[] = [];
    let offset = 0;
    const activeStatuses = statuses.length ? statuses : ['new', 'modified'];
    while (offset < HARD_CAP) {
      const { data, error } = await supabase
        .from('hostaway_reservations')
        .select(`
          id, hostaway_id, hostaway_listing_id, hostaway_listing_db_id,
          guest_name, guest_email, number_of_guests,
          arrival_date, departure_date, check_in_time, check_out_time, nights,
          status, channel_name, total_price, currency, guest_note, last_synced_at
        `)
        .is('deleted_at', null)
        .in('status', activeStatuses)
        .order('arrival_date', { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) throw error;
      const page = data ?? [];
      all = all.concat(page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  const [reservationsList, listingsRes, unitsRes, propsRes] = await Promise.all([
    fetchAllActiveReservations(),
    supabase
      .from('hostaway_listings')
      .select('id, hostaway_id, name, propria_unit_id')
      .is('deleted_at', null),
    supabase
      .from('propria_units')
      .select(`
        id, code, property_id,
        property:properties(name, propria_internal_code)
      `)
      .is('deleted_at', null)
      .eq('is_active', true),
    supabase
      .from('properties')
      .select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null)
      .is('deleted_at', null),
  ]);

  const listingsMap = new Map(
    (listingsRes.data ?? []).map((l: any) => [l.id, l]),
  );
  const unitsMap = new Map(
    (unitsRes.data ?? []).map((u: any) => [u.id, u]),
  );

  const allReservations = (reservationsList ?? []).map((r: any) => {
    const listing = r.hostaway_listing_db_id ? (listingsMap.get(r.hostaway_listing_db_id) as any) : null;
    const unit = listing?.propria_unit_id ? (unitsMap.get(listing.propria_unit_id) as any) : null;
    return {
      ...r,
      listing_name: listing?.name ?? null,
      unit_code: unit?.code ?? null,
      unit_property_id: unit?.property_id ?? null,
      property_name: unit?.property?.name ?? null,
      property_code: unit?.property?.propria_internal_code ?? null,
    };
  });

  const today = new Date().toISOString().slice(0, 10);

  const isOngoing = (r: any) => r.arrival_date <= today && r.departure_date > today;

  let filtered = allReservations;
  if (filter === 'upcoming') {
    filtered = filtered.filter((r) => r.arrival_date >= today);
  } else if (filter === 'today') {
    filtered = filtered.filter((r) => r.arrival_date === today || r.departure_date === today);
  } else if (filter === 'ongoing') {
    filtered = filtered.filter(isOngoing);
  } else if (filter === 'week') {
    const end = new Date();
    end.setDate(end.getDate() + 7);
    const endStr = end.toISOString().slice(0, 10);
    filtered = filtered.filter((r) => r.arrival_date >= today && r.arrival_date <= endStr);
  } else if (filter === 'checkins-today') {
    filtered = filtered.filter((r) => r.arrival_date === today);
  } else if (filter === 'checkouts-today') {
    filtered = filtered.filter((r) => r.departure_date === today);
  } else if (filter === 'past') {
    filtered = filtered.filter((r) => r.departure_date < today);
  }

  // Filtres ListToolbar (en plus du chip temporel)
  if (channel) {
    filtered = filtered.filter((r) => (r.channel_name ?? '').toLowerCase() === channel.toLowerCase());
  }
  if (platforms.length) {
    const platLower = platforms.map(p => p.toLowerCase());
    filtered = filtered.filter((r) => platLower.includes((r.channel_name ?? '').toLowerCase()));
  }
  if (propertyId) {
    filtered = filtered.filter((r) => r.unit_property_id === propertyId);
  }
  if (arrivalPeriod.from) {
    filtered = filtered.filter((r) => r.arrival_date >= arrivalPeriod.from!);
  }
  if (arrivalPeriod.to) {
    filtered = filtered.filter((r) => r.arrival_date <= arrivalPeriod.to!);
  }
  if (q) {
    const needle = q.toLowerCase();
    filtered = filtered.filter((r) =>
      (r.guest_name ?? '').toLowerCase().includes(needle) ||
      String(r.hostaway_id ?? '').includes(needle) ||
      (r.guest_email ?? '').toLowerCase().includes(needle)
    );
  }

  const counts = {
    upcoming: allReservations.filter((r) => r.arrival_date >= today).length,
    today: allReservations.filter((r) => r.arrival_date === today || r.departure_date === today).length,
    ongoing: allReservations.filter(isOngoing).length,
    checkinsToday: allReservations.filter((r) => r.arrival_date === today).length,
    checkoutsToday: allReservations.filter((r) => r.departure_date === today).length,
    week: allReservations.filter((r) => {
      const end = new Date(); end.setDate(end.getDate() + 7);
      const endStr = end.toISOString().slice(0, 10);
      return r.arrival_date >= today && r.arrival_date <= endStr;
    }).length,
    past: allReservations.filter((r) => r.departure_date < today).length,
    all: allReservations.length,
  };

  const channels = Array.from(
    new Set(allReservations.map((r) => r.channel_name).filter(Boolean)),
  ) as string[];

  const lastSync = allReservations[0]?.last_synced_at
    ? new Date(allReservations[0].last_synced_at).toLocaleString('fr-FR')
    : null;

  const me = await getSessionUser();
  const isCeoOrDev = me?.role === 'ceo' || me?.role === 'developer';
  const { count: rawTotal } = await supabase
    .from('hostaway_reservations')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);
  const { count: rawActive } = await supabase
    .from('hostaway_reservations')
    .select('id', { count: 'exact', head: true })
    .in('status', ['new', 'modified'])
    .is('deleted_at', null);

  // ─── Options dynamiques ─────────────────────────────────────────────
  const propertyOptions = [...(propsRes.data ?? [])]
    .sort((a: any, b: any) =>
      (a.propria_internal_code ?? a.name).localeCompare(b.propria_internal_code ?? b.name))
    .map((p: any) => ({ v: p.id, label: p.propria_internal_code ?? p.name }));

  const platformOptions = channels.map(c => ({ v: c, label: c }));

  const STATUS_OPTIONS = [
    { v: 'new',       label: 'Nouvelle' },
    { v: 'modified',  label: 'Modifiée' },
    { v: 'cancelled', label: 'Annulée' },
    { v: 'ownerStay', label: 'Propriétaire' },
    { v: 'inquiry',   label: 'Demande' },
  ];

  const filters: FilterDef[] = [
    { kind: 'single', key: 'property',        label: 'Bien',         options: propertyOptions },
    { kind: 'multi',  key: 'platform',        label: 'Plateforme',   options: platformOptions },
    { kind: 'multi',  key: 'status',          label: 'Statut',       options: STATUS_OPTIONS },
    { kind: 'period', key: 'arrival_period',  label: 'Période arrivée' },
  ];

  return (
    <div className="max-w-7xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Réservations'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-2">📅 Réservations</h1>

      {isCeoOrDev && (
        <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md px-3 py-2 mb-3 text-xs text-stoniz-gray-700 flex flex-wrap items-center gap-3">
          <span>🔍 <strong>Diagnostic CEO</strong> :</span>
          <span>BDD : <strong>{rawTotal ?? '?'}</strong> résa totales · <strong>{rawActive ?? '?'}</strong> actives (new/modified)</span>
          <span>·</span>
          <span>Chargées (avec limit) : <strong>{allReservations.length}</strong></span>
          <span>·</span>
          <span>Affichées (filtre {filter}) : <strong>{filtered.length}</strong></span>
          {(rawActive ?? 0) > 0 && allReservations.length === 0 && (
            <span className="text-red-700 font-medium">⚠ Anomalie : résa en BDD mais 0 chargée</span>
          )}
        </div>
      )}
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Réservations synchronisées depuis Hostaway.
        {lastSync && (
          <span className="ml-2 text-xs text-stoniz-gray-500">
            · Dernière synchro : {lastSync}
          </span>
        )}
        {' · '}
        <Link
          href="/propria/integrations/hostaway"
          className="text-blue-600 hover:underline"
        >
          Gérer la connexion Hostaway →
        </Link>
      </p>

      {/* Toolbar unifiée (recherche, bien, plateforme, statut, période arrivée) */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-reservations"
          count={{ filtered: filtered.length, total: allReservations.length }}
          filters={filters}
          searchHint="voyageur, référence, email"
        />
      </div>

      <HostawayReservationsTable
        reservations={filtered as any}
        counts={counts}
        channels={channels}
        currentFilter={filter}
        currentChannel={channel}
      />
    </div>
  );
}
