import Link from 'next/link';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  Home, Plane, Plug, ShieldAlert, ClipboardCheck, Wrench, Star,
  AlertTriangle, ChevronRight, RefreshCw, Clock,
} from 'lucide-react';
import { DailyNotesCard, type DailyNote } from '@/components/propria/daily-notes-card';
import { DailyForceSyncButton } from '@/components/propria/daily-force-sync-button';
import {
  DailyArrivalsSection, DailyDeparturesSection, DailyRealtimePanel,
} from '@/components/propria/daily-context-sections';

/**
 * Dashboard Daily Propria (CEO 2026-06-10).
 *
 * Écran unique pour le point quotidien de 14h.
 * 7 zones cliquables : Séjours en cours · Arrivées · Départs · Litiges ·
 * Tâches · Interventions · Avis.
 *
 * Chaque card : compteur + 3 items preview inline + lien « Voir tout ».
 * Permissions : CEO + Propria (PAS assistante d'après cadrage CEO).
 */
export default async function PropriaDailyPage() {
  const user = await requireRole(['ceo', 'developer', 'propria']);
  const supabase = createClient();

  const todayIso = new Date().toISOString().slice(0, 10);
  const tomorrowDate = new Date(Date.now() + 86400000);
  const tomorrowIso = tomorrowDate.toISOString().slice(0, 10);
  const yesterdayDate = new Date(Date.now() - 86400000);
  const yesterdayIso = yesterdayDate.toISOString().slice(0, 10);

  // ─── Pulls parallèles ────────────────────────────────────────────────
  const [
    reservRes,
    litigesRes,
    tasksRes,
    interventionsRes,
    preReviewsRes,
    newReviewsRes,
    listingsRes,
    unitsRes,
    profilesRes,
    dailyNotesRes,
  ] = await Promise.all([
    supabase.from('hostaway_reservations')
      .select('id, hostaway_id, hostaway_listing_db_id, guest_name, channel_name, arrival_date, departure_date, check_in_time, check_out_time, nights')
      .in('status', ['new','modified'])
      .or(`and(arrival_date.lte.${todayIso},departure_date.gt.${todayIso}),arrival_date.eq.${todayIso},departure_date.eq.${todayIso}`)
      .is('deleted_at', null)
      .order('arrival_date'),
    supabase.from('propria_litiges')
      .select(`
        id, type, description, amount, currency, kanban_column, opened_at,
        propria_unit_id, hostaway_reservation_id
      `)
      .not('kanban_column', 'in', '(gagne,perdu)')
      .is('deleted_at', null)
      .order('opened_at', { ascending: false }),
    // Tâches = propria_interventions kind=tache (CEO Q4 reco)
    supabase.from('propria_interventions')
      .select(`
        id, description, urgency, status, due_date, kind, property_id, propria_unit_id
      `)
      .eq('kind', 'tache')
      .in('status', ['a_traiter','en_cours'])
      .is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }),
    // Interventions = kind=intervention
    supabase.from('propria_interventions')
      .select(`
        id, description, urgency, status, due_date, kind, property_id, propria_unit_id
      `)
      .eq('kind', 'intervention')
      .in('status', ['a_traiter','en_cours'])
      .is('deleted_at', null)
      .order('due_date', { ascending: true, nullsFirst: false }),
    supabase.from('hostaway_pre_review_tracking')
      .select(`
        id, sentiment, kanban_status, hostaway_reservation_id, propria_unit_id, created_at
      `)
      .in('kanban_status', ['nouveau','bon','risque','neutre'])
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('hostaway_reviews')
      .select('id, guest_name, rating_normalized, public_review, submitted_at, propria_unit_id')
      .gte('submitted_at', yesterdayIso)
      .is('deleted_at', null)
      .order('submitted_at', { ascending: false }),
    supabase.from('hostaway_listings').select('id, name, propria_unit_id').is('deleted_at', null),
    supabase.from('propria_units').select(`id, code, is_active, property:properties(id, name)`).is('deleted_at', null),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('propria_daily_notes')
      .select('id, content, created_at, created_by_id, resolved_at, resolved_by_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ]);

  // ─── Chantier 4 marathon : contexte arrivées/départs + panel temps réel ──
  const past60 = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const future60 = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
  const [futureResasRes, pastDepsRes, todayCleansRes, lastCleansRes, sentimentsRes] = await Promise.all([
    // Prochaines arrivées (60 j) — pour le panel VERT « prochaine résa »
    supabase.from('hostaway_reservations')
      .select('hostaway_listing_db_id, arrival_date, guest_name')
      .in('status', ['new', 'modified'])
      .gt('arrival_date', todayIso)
      .lte('arrival_date', future60)
      .is('deleted_at', null)
      .order('arrival_date')
      .limit(1000),
    // Derniers départs (60 j) — « date dernier départ »
    supabase.from('hostaway_reservations')
      .select('hostaway_listing_db_id, departure_date')
      .in('status', ['new', 'modified'])
      .lte('departure_date', todayIso)
      .gte('departure_date', past60)
      .is('deleted_at', null)
      .order('departure_date', { ascending: false })
      .limit(1000),
    // Ménages du jour (tous statuts sauf annulé) — statut temps réel
    supabase.from('propria_cleanings_enriched')
      .select('id, propria_unit_id, status, started_at, assigned_to_id, category')
      .eq('due_date', todayIso)
      .neq('status', 'annule'),
    // Derniers ménages clôturés (90 j) — « date dernier ménage »
    supabase.from('propria_cleanings_enriched')
      .select('propria_unit_id, occurred_at, status')
      .in('status', ['cloture'])
      .gte('occurred_at', new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
      .order('occurred_at', { ascending: false })
      .limit(1000),
    // Dernier sentiment voyageur par suite (préventifs, tous statuts)
    supabase.from('hostaway_pre_review_tracking')
      .select('propria_unit_id, sentiment, created_at, hostaway_reservation_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const reservations = (reservRes.data ?? []) as any[];
  const litiges = (litigesRes.data ?? []) as any[];

  // Chantier 6 (décision B4) : montant litige dérivé des lignes items
  // (vue propria_litiges_totals) — propria_litiges.amount est déprécié.
  const litigeTotalsMap = new Map<string, number>();
  if (litiges.length > 0) {
    const { data: litigeTotals } = await supabase
      .from('propria_litiges_totals')
      .select('litige_id, total_claimed_mad')
      .in('litige_id', litiges.map((l) => l.id));
    for (const t of (litigeTotals ?? []) as any[]) {
      litigeTotalsMap.set(t.litige_id, Number(t.total_claimed_mad ?? 0));
    }
  }
  const tasks = (tasksRes.data ?? []) as any[];
  const interventions = (interventionsRes.data ?? []) as any[];
  const preReviews = (preReviewsRes.data ?? []) as any[];
  const newReviews = (newReviewsRes.data ?? []) as any[];
  const listingMap = new Map((listingsRes.data ?? []).map((l: any) => [l.id, l]));
  const unitMap = new Map((unitsRes.data ?? []).map((u: any) => [u.id, u]));
  const profileMap = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  // ─── Notes du daily (CEO 2026-06-11) ───────────────────────────────
  const allNotes = (dailyNotesRes.data ?? []) as any[];
  const enrichNote = (n: any): DailyNote => ({
    id: n.id,
    content: n.content,
    created_at: n.created_at,
    created_by_name: n.created_by_id ? (profileMap.get(n.created_by_id) ?? null) : null,
    resolved_at: n.resolved_at,
    resolved_by_name: n.resolved_by_id ? (profileMap.get(n.resolved_by_id) ?? null) : null,
  });
  const activeNotes: DailyNote[] = allNotes.filter((n) => !n.resolved_at).map(enrichNote);
  const resolvedNotes: DailyNote[] = allNotes.filter((n) => !!n.resolved_at).map(enrichNote);
  const canDeleteNotes = user.role === 'ceo' || user.role === 'developer';

  // ─── Catégorisation séjours ──────────────────────────────────────────
  const ongoing = reservations.filter((r) =>
    r.arrival_date <= todayIso && r.departure_date > todayIso);
  const arrivals = reservations.filter((r) => r.arrival_date === todayIso);
  const departures = reservations.filter((r) => r.departure_date === todayIso);

  // ─── Tâches & interventions ──────────────────────────────────────────
  const tasksLate = tasks.filter((t) => t.due_date && t.due_date < todayIso);
  const interventionsLate = interventions.filter((i) => i.due_date && i.due_date < todayIso);

  // ─── Avis sous-KPI ───────────────────────────────────────────────────
  const reviewsAEvaluer = preReviews.filter((p) => p.kanban_status === 'nouveau');
  const reviewsBonRetour = preReviews.filter((p) => p.kanban_status === 'bon');
  const reviewsRisque = preReviews.filter((p) => p.kanban_status === 'risque');
  // CEO 2026-06-11 : colonne 'neutre' dédiée dans le Kanban préventif
  const reviewsNeutre = preReviews.filter((p) => p.kanban_status === 'neutre');

  // Helper : enrichir une résa avec nom suite
  function resaUnit(r: any) {
    const listing = r.hostaway_listing_db_id ? listingMap.get(r.hostaway_listing_db_id) as any : null;
    const unit = listing?.propria_unit_id ? unitMap.get(listing.propria_unit_id) as any : null;
    return unit?.code ?? listing?.name ?? '—';
  }
  function unitLabel(unitId: string | null) {
    if (!unitId) return '—';
    const u = unitMap.get(unitId) as any;
    return u?.code ?? '—';
  }

  // ─── Construction du contexte enrichi (chantier 4 marathon) ─────────────
  // Maps par suite : listing → unit, dernier départ, prochaine arrivée,
  // ménage du jour, dernier ménage clôturé, dernier sentiment.
  const listingToUnit = new Map<string, string>();
  for (const l of (listingsRes.data ?? []) as any[]) {
    if (l.propria_unit_id) listingToUnit.set(l.id, l.propria_unit_id);
  }
  const lastDepartureByUnit = new Map<string, string>();
  for (const r of (pastDepsRes.data ?? []) as any[]) {
    const uid = r.hostaway_listing_db_id ? listingToUnit.get(r.hostaway_listing_db_id) : null;
    if (uid && !lastDepartureByUnit.has(uid)) lastDepartureByUnit.set(uid, r.departure_date);
  }
  const nextArrivalByUnit = new Map<string, { date: string; guest: string | null }>();
  for (const r of (futureResasRes.data ?? []) as any[]) {
    const uid = r.hostaway_listing_db_id ? listingToUnit.get(r.hostaway_listing_db_id) : null;
    if (uid && !nextArrivalByUnit.has(uid)) nextArrivalByUnit.set(uid, { date: r.arrival_date, guest: r.guest_name ?? null });
  }
  const todayCleaningByUnit = new Map<string, any>();
  for (const c of (todayCleansRes.data ?? []) as any[]) {
    if (c.propria_unit_id && !todayCleaningByUnit.has(c.propria_unit_id)) todayCleaningByUnit.set(c.propria_unit_id, c);
  }
  const lastCleaningByUnit = new Map<string, string>();
  for (const c of (lastCleansRes.data ?? []) as any[]) {
    if (c.propria_unit_id && !lastCleaningByUnit.has(c.propria_unit_id)) lastCleaningByUnit.set(c.propria_unit_id, c.occurred_at);
  }
  const lastSentimentByUnit = new Map<string, string>();
  for (const s of (sentimentsRes.data ?? []) as any[]) {
    if (s.propria_unit_id && s.sentiment && !lastSentimentByUnit.has(s.propria_unit_id)) {
      lastSentimentByUnit.set(s.propria_unit_id, s.sentiment);
    }
  }
  const litigeResaIds = new Set((litiges as any[]).map((l) => l.hostaway_reservation_id).filter(Boolean));
  const openLitigesByUnit = new Map<string, number>();
  for (const l of litiges as any[]) {
    if (l.propria_unit_id) openLitigesByUnit.set(l.propria_unit_id, (openLitigesByUnit.get(l.propria_unit_id) ?? 0) + 1);
  }
  function countByUnitOrProperty(items: any[], unitId: string | null, propertyId: string | null) {
    return items.filter((i) =>
      (unitId && i.propria_unit_id === unitId) ||
      (!i.propria_unit_id && propertyId && i.property_id === propertyId)
    ).length;
  }
  function cleaningStatusOf(unitId: string | null): 'valide' | 'en_cours' | 'non_commence' | 'aucun' {
    if (!unitId) return 'aucun';
    const c = todayCleaningByUnit.get(unitId);
    if (!c) return 'aucun';
    if (c.status === 'cloture') return 'valide';
    if (c.status === 'a_valider' || c.status === 'en_cours' || c.started_at) return 'en_cours';
    return 'non_commence'; // a_traiter, refusee
  }
  function resaUnitFull(r: any): { unitId: string | null; propertyId: string | null; label: string } {
    const uid = r.hostaway_listing_db_id ? (listingToUnit.get(r.hostaway_listing_db_id) ?? null) : null;
    const u = uid ? (unitMap.get(uid) as any) : null;
    return { unitId: uid, propertyId: null, label: u?.code ?? '—' };
  }

  const arrivalContexts = arrivals.map((r) => {
    const { unitId, label } = resaUnitFull(r);
    return {
      reservationId: r.id,
      guestName: r.guest_name ?? null,
      checkInTime: r.check_in_time ?? null,
      unitLabel: label,
      unitId,
      propertyId: null,
      lastDeparture: unitId ? (lastDepartureByUnit.get(unitId) ?? null) : null,
      lastCleaningDate: unitId ? (lastCleaningByUnit.get(unitId) ?? null) : null,
      todayCleaningStatus: cleaningStatusOf(unitId),
      lastSentiment: unitId ? (lastSentimentByUnit.get(unitId) ?? null) : null,
      openLitigesCount: unitId ? (openLitigesByUnit.get(unitId) ?? 0) : 0,
      openTasksCount: countByUnitOrProperty(tasks, unitId, null),
      openInterventionsCount: countByUnitOrProperty(interventions, unitId, null),
    };
  });

  const arrivalUnitIds = new Set(arrivalContexts.map((a) => a.unitId).filter(Boolean));
  const departureContexts = departures.map((r) => {
    const { unitId, label } = resaUnitFull(r);
    return {
      reservationId: r.id,
      guestName: r.guest_name ?? null,
      checkOutTime: r.check_out_time ?? null,
      unitLabel: label,
      unitId,
      todayCleaningStatus: cleaningStatusOf(unitId),
      sameDayArrival: unitId ? arrivalUnitIds.has(unitId) : false,
      openLitigeOnResa: litigeResaIds.has(r.hostaway_id),
      openInterventionsCount: countByUnitOrProperty(interventions, unitId, null),
      lastSentiment: unitId ? (lastSentimentByUnit.get(unitId) ?? null) : null,
    };
  });

  // Panel temps réel : 1 carte par lot actif
  const occupiedUnitIds = new Set(
    ongoing.map((r) => (r.hostaway_listing_db_id ? listingToUnit.get(r.hostaway_listing_db_id) : null)).filter(Boolean)
  );
  const realtimeUnits = ((unitsRes.data ?? []) as any[]).filter((u: any) => u.is_active !== false).map((u: any) => {
    const todayClean = todayCleaningByUnit.get(u.id);
    const occupied = occupiedUnitIds.has(u.id);
    const next = nextArrivalByUnit.get(u.id);
    let state: 'vert' | 'orange' | 'rouge';
    let blockReason: string | null = null;
    if (occupied) {
      state = 'rouge'; blockReason = 'Occupé (séjour en cours)';
    } else if (todayClean && (todayClean.status === 'en_cours' || (todayClean.started_at && todayClean.status !== 'cloture'))) {
      state = 'orange';
    } else if (todayClean && ['a_traiter', 'refusee'].includes(todayClean.status)) {
      state = 'rouge'; blockReason = 'Ménage non commencé';
    } else {
      state = 'vert';
    }
    return {
      unitId: u.id,
      unitLabel: u.code ?? '—',
      propertyId: (u as any).property?.id ?? null,
      state,
      nextArrival: next?.date ?? null,
      nextGuest: next?.guest ?? null,
      cleanerName: todayClean?.assigned_to_id ? (profileMap.get(todayClean.assigned_to_id) ?? null) : null,
      startedAt: todayClean?.started_at ?? null,
      lastDeparture: lastDepartureByUnit.get(u.id) ?? null,
      blockReason,
    };
  }).sort((a, b) => {
    const rank = (s: string) => (s === 'rouge' ? 0 : s === 'orange' ? 1 : 2);
    return rank(a.state) - rank(b.state) || a.unitLabel.localeCompare(b.unitLabel);
  });

  const refreshedAt = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ─── Card générique ──────────────────────────────────────────────────
  type CardItem = { id: string; primary: string; secondary?: string; meta?: string };
  function Card({
    title, icon: Icon, accent, count, items, href, voirToutLabel, emptyText,
  }: {
    title: string;
    icon: any;
    accent: string;
    count: number;
    items: CardItem[];
    href: string;
    voirToutLabel?: string;
    emptyText?: string;
  }) {
    return (
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${accent}`} />
            <span className="text-sm font-medium">{title}</span>
          </div>
          <span className={`text-3xl font-display ${count > 0 ? 'text-stoniz-black' : 'text-stoniz-gray-300'}`}>
            {count}
          </span>
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-stoniz-gray-400 py-2">{emptyText ?? 'Aucun élément'}</div>
        ) : (
          <ul className="space-y-1.5 mb-2">
            {items.slice(0, 3).map((it) => (
              <li key={it.id} className="text-xs border-l-2 border-stoniz-gray-200 pl-2">
                <div className="font-medium truncate">{it.primary}</div>
                {it.secondary && <div className="text-stoniz-gray-500 truncate">{it.secondary}</div>}
                {it.meta && <div className="text-[10px] text-stoniz-gray-400">{it.meta}</div>}
              </li>
            ))}
          </ul>
        )}
        <Link
          href={href}
          className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5"
        >
          {voirToutLabel ?? 'Voir tout'} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">Propria · Daily</div>
          <h1 className="text-2xl md:text-3xl font-display">📋 Daily — point 14h</h1>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            L'écran unique pour piloter ton opérationnel quotidien.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stoniz-gray-500 inline-flex items-center gap-1">
            <Clock className="w-3 h-3" /> Maj {refreshedAt}
          </span>
          {/* CEO 2026-06-12 : bouton de sync forcée Hostaway pour ne plus
              dépendre du cron horaire (bug compteurs Daily du 12/06) */}
          <DailyForceSyncButton />
          <form action="/propria/daily" method="GET" className="inline-flex items-center gap-2">
            <button
              type="submit"
              className="bg-stoniz-gray-100 text-stoniz-black px-3 py-2 rounded-md text-xs hover:bg-stoniz-gray-200 inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Recharger
            </button>
          </form>
        </div>
      </div>

      {/* Section : Notes du daily (CEO 2026-06-11) */}
      <div className="mb-6">
        <DailyNotesCard
          activeNotes={activeNotes}
          resolvedNotes={resolvedNotes}
          canDelete={canDeleteNotes}
        />
      </div>

      {/* Chantier 4 marathon : panel temps réel + arrivées/départs enrichis */}
      <DailyRealtimePanel units={realtimeUnits} />
      <DailyArrivalsSection arrivals={arrivalContexts} />
      <DailyDeparturesSection departures={departureContexts} />

      {/* Section : Voyageurs */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">Voyageurs</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card
          title="🏠 Séjours en cours"
          icon={Home}
          accent="text-blue-600"
          count={ongoing.length}
          href="/propria/reservations?filter=ongoing"
          items={ongoing.map((r) => ({
            id: r.id,
            primary: r.guest_name ?? 'Voyageur',
            secondary: `${resaUnit(r)} · jusqu'au ${r.departure_date}`,
            meta: r.channel_name ?? '',
          }))}
        />
        <Card
          title="📥 Arrivées du jour"
          icon={Plane}
          accent="text-emerald-600"
          count={arrivals.length}
          href="/propria/reservations?filter=checkins-today"
          items={arrivals.map((r) => ({
            id: r.id,
            primary: r.guest_name ?? 'Voyageur',
            secondary: `${resaUnit(r)}${r.check_in_time ? ` · arr ${r.check_in_time}` : ''}`,
            meta: r.channel_name ?? '',
          }))}
        />
        <Card
          title="📤 Départs du jour"
          icon={Plane}
          accent="text-orange-600"
          count={departures.length}
          href="/propria/reservations?filter=checkouts-today"
          items={departures.map((r) => ({
            id: r.id,
            primary: r.guest_name ?? 'Voyageur',
            secondary: `${resaUnit(r)}${r.check_out_time ? ` · dép ${r.check_out_time}` : ''}`,
            meta: r.channel_name ?? '',
          }))}
        />
      </div>

      {/* Section : Opérationnel */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">Opérationnel</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Card
          title="✅ Tâches en cours"
          icon={ClipboardCheck}
          accent="text-blue-600"
          count={tasks.length}
          href="/propria/interventions?status=actives&kind=tache"
          items={tasks.map((t) => ({
            id: t.id,
            primary: t.description ?? 'Tâche',
            secondary: unitLabel(t.propria_unit_id),
            meta: t.due_date ? `Échéance ${t.due_date}` : '',
          }))}
        />
        <Card
          title="⏰ Tâches en retard"
          icon={AlertTriangle}
          accent="text-red-600"
          count={tasksLate.length}
          href="/propria/interventions?status=retard&kind=tache"
          items={tasksLate.map((t) => ({
            id: t.id,
            primary: t.description ?? 'Tâche',
            secondary: unitLabel(t.propria_unit_id),
            meta: t.due_date ? `🔴 Dépassée depuis ${t.due_date}` : '',
          }))}
          emptyText="Aucune tâche en retard ✨"
        />
        <Card
          title="🔧 Interventions ouvertes"
          icon={Wrench}
          accent="text-blue-600"
          count={interventions.length}
          href="/propria/interventions?status=actives&kind=intervention"
          items={interventions.map((i) => ({
            id: i.id,
            primary: i.description ?? 'Intervention',
            secondary: unitLabel(i.propria_unit_id),
            meta: i.due_date ? `Échéance ${i.due_date}` : `${i.urgency ?? ''}`,
          }))}
        />
        <Card
          title="⏰ Interventions en retard"
          icon={AlertTriangle}
          accent="text-red-600"
          count={interventionsLate.length}
          href="/propria/interventions?status=retard&kind=intervention"
          items={interventionsLate.map((i) => ({
            id: i.id,
            primary: i.description ?? 'Intervention',
            secondary: unitLabel(i.propria_unit_id),
            meta: i.due_date ? `🔴 Dépassée depuis ${i.due_date}` : '',
          }))}
          emptyText="Aucune intervention en retard ✨"
        />
      </div>

      {/* Section : Litiges */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">Litiges Airbnb</div>
      <div className="grid grid-cols-1 md:grid-cols-1 gap-3 mb-6">
        <Card
          title="⚖️ Litiges en cours"
          icon={ShieldAlert}
          accent="text-orange-600"
          count={litiges.length}
          href="/propria/litiges"
          items={litiges.map((l) => ({
            id: l.id,
            primary: `${l.type} · ${(litigeTotalsMap.get(l.id) ?? 0) > 0 ? Intl.NumberFormat('fr-FR').format(litigeTotalsMap.get(l.id)!) + ' MAD' : 'sans montant'}`,
            secondary: unitLabel(l.propria_unit_id),
            meta: `Ouvert le ${l.opened_at} · Colonne : ${l.kanban_column}`,
          }))}
          emptyText="Aucun litige en cours 🎉"
        />
      </div>

      {/* Section : Avis voyageurs */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">Avis voyageurs</div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        <Card
          title="🆕 À évaluer"
          icon={Star}
          accent="text-stoniz-gray-700"
          count={reviewsAEvaluer.length}
          href="/propria/avis/preventif"
          items={reviewsAEvaluer.map((p) => ({
            id: p.id,
            primary: unitLabel(p.propria_unit_id),
            secondary: 'Sentiment à classer',
          }))}
          emptyText="Rien à évaluer ✨"
          voirToutLabel="Voir le Kanban"
        />
        <Card
          title="🟢 Bon retour attendu"
          icon={Star}
          accent="text-emerald-600"
          count={reviewsBonRetour.length}
          href="/propria/avis/preventif"
          items={reviewsBonRetour.map((p) => ({
            id: p.id,
            primary: unitLabel(p.propria_unit_id),
            secondary: 'Relance positive possible',
          }))}
          emptyText="Aucune relance à faire"
          voirToutLabel="Voir le Kanban"
        />
        <Card
          title="🔴 Risque mauvais avis"
          icon={Star}
          accent="text-red-600"
          count={reviewsRisque.length}
          href="/propria/avis/preventif"
          items={reviewsRisque.map((p) => ({
            id: p.id,
            primary: unitLabel(p.propria_unit_id),
            secondary: 'Action urgente requise',
          }))}
          emptyText="Aucun risque ✨"
          voirToutLabel="Voir le Kanban"
        />
        {/* CEO 2026-06-11 : 4e card dédiée aux neutres (auparavant mélangés
            dans 'Risque mauvais avis' ce qui rendait le risque illisible). */}
        <Card
          title="🟡 Neutre"
          icon={Star}
          accent="text-amber-600"
          count={reviewsNeutre.length}
          href="/propria/avis/preventif"
          items={reviewsNeutre.map((p) => ({
            id: p.id,
            primary: unitLabel(p.propria_unit_id),
            secondary: 'À surveiller',
          }))}
          emptyText="Aucun neutre"
          voirToutLabel="Voir le Kanban"
        />
      </div>

      {/* Bonus : Avis reçus dans les dernières 24h */}
      {newReviews.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium text-amber-900 inline-flex items-center gap-2">
              <Star className="w-4 h-4" />
              {newReviews.length} nouvel{newReviews.length > 1 ? 's' : ''} avis reçu{newReviews.length > 1 ? 's' : ''} (24h)
            </div>
            <Link href="/propria/avis" className="text-xs text-amber-800 hover:underline">Voir tous →</Link>
          </div>
          <ul className="space-y-1.5">
            {newReviews.slice(0, 3).map((r) => (
              <li key={r.id} className="text-xs border-l-2 border-amber-300 pl-2">
                <div className="font-medium">
                  <span className={r.rating_normalized && r.rating_normalized >= 4.5 ? 'text-emerald-700' : 'text-red-700'}>
                    ⭐ {r.rating_normalized?.toFixed(1) ?? '?'}/5
                  </span>
                  {' · '}{r.guest_name ?? 'Voyageur'} · {unitLabel(r.propria_unit_id)}
                </div>
                {r.public_review && (
                  <div className="text-stoniz-gray-700 italic truncate">« {r.public_review.slice(0, 120)} »</div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
