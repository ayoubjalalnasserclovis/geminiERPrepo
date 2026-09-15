import Link from 'next/link';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { BulkAssignCleaningsBanner } from '@/components/propria/bulk-assign-cleanings-banner';
import { SyncHostawayCleaningsButton } from '@/components/propria/sync-hostaway-cleanings-button';
import { MenageRoleView } from '@/components/propria/menage-role-view';
import { cleaningCategoryMeta } from '@/lib/propria/cleaning-categories';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, period, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';

const URGENCY_BADGE: Record<string, string> = {
  critique: 'bg-red-100 text-red-800',
  haute: 'bg-orange-100 text-orange-800',
  normale: 'bg-amber-100 text-amber-800',
  basse: 'bg-stoniz-gray-100 text-stoniz-gray-700',
};
const STATUS_BADGE: Record<string, string> = {
  a_traiter: 'bg-stoniz-gray-100 text-stoniz-gray-800',
  en_cours: 'bg-blue-100 text-blue-800',
  a_valider: 'bg-amber-100 text-amber-800',
  cloture: 'bg-emerald-100 text-emerald-800',
  refusee: 'bg-red-100 text-red-800',
  annule: 'bg-stoniz-gray-200 text-stoniz-gray-600',
};
const STATUS_LABELS: Record<string, string> = {
  a_traiter: 'À faire', en_cours: 'En cours', a_valider: 'À valider',
  cloture: 'Validé', refusee: 'Refusé', annule: 'Annulé',
};
const URG_LABELS: Record<string, string> = {
  critique: '🔴 Critique', haute: '🟠 Haute', normale: '🟡 Normale', basse: '🟢 Basse',
};

const STATUS_OPTIONS = [
  { v: 'a_traiter', label: 'À faire' },
  { v: 'en_cours',  label: 'En cours' },
  { v: 'a_valider', label: 'À valider' },
  { v: 'cloture',   label: 'Validé' },
  { v: 'refusee',   label: 'Refusé' },
  { v: 'annule',    label: 'Annulé' },
];

const SORT_FIELDS: Record<string, string> = {
  occurred_at: 'occurred_at',
  due_date:    'due_date',
};

const ACTIVE_STATUSES = ['a_traiter', 'en_cours', 'a_valider', 'refusee'];

export default async function CleaningsListPage({
  searchParams,
}: { searchParams: SP }) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria', 'menage']);

  const me = await getSessionUser();
  if (me?.role === 'menage') {
    return <MenageRoleView />;
  }

  const supabase = createClient();

  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const tomorrowDate = new Date(today); tomorrowDate.setDate(tomorrowDate.getDate() + 1);
  const tomorrowIso = tomorrowDate.toISOString().slice(0, 10);
  const dueMax = new Date(today); dueMax.setDate(dueMax.getDate() + 4);
  const dueMaxIso = dueMax.toISOString().slice(0, 10);

  const [propsRes, unitsRes, typesRes, profRes, assigneesRes, openIncidentsRes, cleanersRes] = await Promise.all([
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_cleaning_types').select('id, name, display_order')
      .eq('is_active', true).order('display_order'),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('profiles')
      .select('id, full_name, role')
      .in('role', ['propria','ceo','assistante','developer','menage'])
      .eq('is_active', true)
      .order('role').order('full_name'),
    supabase.from('propria_cleaning_incidents').select('id', { count: 'exact', head: true })
      .not('status', 'in', '(resolved,declined)')
      .is('deleted_at', null),
    // Liste dames de ménage (pour filtre dynamique)
    supabase.from('profiles')
      .select('id, full_name')
      .in('role', ['menage','propria'])
      .eq('is_active', true)
      .order('full_name'),
  ]);

  const unitsList = unitsRes.data ?? [];
  const props = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const unitsMap = new Map(unitsList.map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));
  const typesMap = new Map((typesRes.data ?? []).map((t: any) => [t.id, t.name]));
  const profs = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  // ─── Parse toolbar ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const assignedTo = single(searchParams, 'assigned');
  const propertyId = single(searchParams, 'property');
  const unitId = single(searchParams, 'unit');
  const typeId = single(searchParams, 'type');
  const periodOcc = period(searchParams, 'period');
  const fenetre = single(searchParams, 'window') ?? '4days';
  const dateExact = single(searchParams, 'date');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'occurred_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'occurred_at';

  let qBuilder = supabase
    .from('propria_cleanings_enriched')
    .select(`
      id, property_id, propria_unit_id, cleaning_type_id, description,
      occurred_at, due_date, urgency, status, closed_at,
      assigned_to_id, responsable_id, observations,
      submitted_at, validated_at, refused_count,
      is_overdue, is_awaiting_validation, realisation_hours,
      category, has_same_day_arrival, cleaning_type_name
    `)
    .order(dbSortField, { ascending: sortDir === 'asc' })
    .limit(500);

  // Compat statut legacy (chip "actives", "retard")
  const legacyStatus = single(searchParams, 'status');
  if (legacyStatus === 'actives') qBuilder = qBuilder.in('status', ACTIVE_STATUSES);
  else if (legacyStatus === 'retard') qBuilder = qBuilder.eq('is_overdue', true);
  else if (statuses.length) qBuilder = qBuilder.in('status', statuses);

  if (dateExact) {
    qBuilder = qBuilder.eq('due_date', dateExact);
  } else if (fenetre === 'today') {
    qBuilder = qBuilder.eq('due_date', todayIso);
  } else if (fenetre === 'tomorrow') {
    qBuilder = qBuilder.eq('due_date', tomorrowIso);
  } else if (fenetre === '4days') {
    qBuilder = qBuilder.or(`due_date.lte.${dueMaxIso},due_date.is.null`);
  } else if (fenetre === 'week') {
    const wk = new Date(today); wk.setDate(wk.getDate() + 7);
    qBuilder = qBuilder.or(`due_date.lte.${wk.toISOString().slice(0, 10)},due_date.is.null`);
  }

  const urgency = single(searchParams, 'urgency');
  if (urgency) qBuilder = qBuilder.eq('urgency', urgency);
  if (typeId) qBuilder = qBuilder.eq('cleaning_type_id', typeId);
  if (assignedTo) qBuilder = qBuilder.eq('assigned_to_id', assignedTo);
  if (unitId) qBuilder = qBuilder.eq('propria_unit_id', unitId);
  if (propertyId) {
    const unitIds = unitsList.filter((u: any) => u.property_id === propertyId).map((u: any) => u.id);
    if (unitIds.length) qBuilder = qBuilder.or(`property_id.eq.${propertyId},propria_unit_id.in.(${unitIds.join(',')})`);
    else qBuilder = qBuilder.eq('property_id', propertyId);
  }
  if (periodOcc.from) qBuilder = qBuilder.gte('occurred_at', periodOcc.from);
  if (periodOcc.to) qBuilder = qBuilder.lte('occurred_at', periodOcc.to);

  if (q) {
    const needle = parseEscapeIlike(q);
    qBuilder = qBuilder.or(`description.ilike.%${needle}%,observations.ilike.%${needle}%`);
  }

  const cleansRes = await qBuilder;
  const rows = (cleansRes.data ?? []) as any[];

  const totalRes = await supabase
    .from('propria_cleanings_enriched')
    .select('id', { count: 'exact', head: true });
  const totalCount = totalRes.count ?? rows.length;

  const stats = {
    a_valider: rows.filter(r => r.status === 'a_valider').length,
    en_retard: rows.filter(r => r.is_overdue).length,
    refusee: rows.filter(r => r.status === 'refusee').length,
  };

  const unassignedRows = rows
    .filter((r) => !r.assigned_to_id && !['cloture','annule'].includes(r.status))
    .filter((r) => r.due_date != null && r.due_date <= tomorrowIso)
    .map((r) => {
      const unit = r.propria_unit_id ? (unitsMap.get(r.propria_unit_id) as any) : null;
      const bienId = unit ? unit.property_id : r.property_id;
      const bien = bienId ? (props.get(bienId) as any) : null;
      const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : 'Bien';
      const scope_label = unit ? `${bienCode} · ${unit.label}` : (bien ? `${bienCode}` : '—');
      return {
        id: r.id,
        description: r.description,
        type_label: typesMap.get(r.cleaning_type_id) ?? 'Ménage',
        urgency: r.urgency,
        occurred_at: r.occurred_at,
        due_date: r.due_date,
        scope_label,
      };
    });

  const assignees = (assigneesRes.data ?? []) as { id: string; full_name: string | null; role: string | null }[];
  const openIncidents = openIncidentsRes.count ?? 0;

  // ─── Options dynamiques ─────────────────────────────────────────────
  const propertyOptions = [...(propsRes.data ?? [])]
    .sort((a: any, b: any) =>
      (a.propria_internal_code ?? a.name).localeCompare(b.propria_internal_code ?? b.name))
    .map((p: any) => ({ v: p.id, label: p.propria_internal_code ?? p.name }));

  const unitOptions = [...(unitsList as any[])]
    .map((u: any) => {
      const p = props.get(u.property_id) as any;
      const code = p ? (p.propria_internal_code ?? p.name) : '';
      const label = u.code ?? `Suite ${u.order_index}`;
      return { v: u.id, label: code ? `${code} · ${label}` : label };
    })
    .sort((a, b) => a.label.localeCompare(b.label));

  const cleanerOptions = ((cleanersRes.data ?? []) as any[])
    .filter((p: any) => p.full_name)
    .map((p: any) => ({ v: p.id, label: p.full_name }));

  const typeOptions = ((typesRes.data ?? []) as any[])
    .map((t: any) => ({ v: t.id, label: t.name }));

  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'status',   label: 'Statut',         options: STATUS_OPTIONS },
    { kind: 'single', key: 'assigned', label: 'Dame de ménage', options: cleanerOptions },
    { kind: 'single', key: 'property', label: 'Bien',           options: propertyOptions },
    { kind: 'single', key: 'unit',     label: 'Suite',          options: unitOptions },
    { kind: 'single', key: 'type',     label: 'Type ménage',    options: typeOptions },
    { kind: 'period', key: 'period',   label: 'Période' },
  ];

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Ménage
          </div>
          <h1 className="text-2xl md:text-3xl font-display">🧹 Ménages ({rows.length})</h1>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Link
            href="/propria/menage/incidents"
            className={`px-4 py-2 rounded-md text-sm border inline-flex items-center gap-1.5 ${
              openIncidents > 0
                ? 'bg-red-50 border-red-300 text-red-700 hover:bg-red-100'
                : 'bg-white border-stoniz-gray-300 text-stoniz-gray-600 hover:bg-stoniz-gray-50'
            }`}
            title="Incidents signalés par les dames de ménage (canapé sale, télé cassée…)"
          >
            ⚠ Incidents{openIncidents > 0 && <span className="ml-1 font-medium">({openIncidents})</span>}
          </Link>
          <SyncHostawayCleaningsButton />
          <Link
            href="/propria/menage/parametres"
            className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50"
          >
            ⚙ Types de ménage
          </Link>
          <Link
            href="/propria/menage/new"
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800"
          >
            + Nouveau ménage
          </Link>
        </div>
      </div>

      {/* Bandeau alerte incidents — cohérent avec le dashboard /propria */}
      {openIncidents > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-4 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <span className="text-xl flex-shrink-0">⚠</span>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-red-900">
                {openIncidents} incident{openIncidents > 1 ? 's' : ''} ménage à traiter
              </div>
              <p className="text-xs text-red-800/80 mt-0.5">
                Vivants indépendamment des ménages source — un ménage validé peut conserver des incidents ouverts.
              </p>
            </div>
          </div>
          <Link
            href="/propria/menage/incidents"
            className="bg-red-600 text-white px-4 py-2 rounded-md text-sm hover:bg-red-700 flex-shrink-0"
          >
            Voir et traiter →
          </Link>
        </div>
      )}

      <BulkAssignCleaningsBanner unassigned={unassignedRows} assignees={assignees} />

      {/* Bandeau KPI */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Link
          href="/propria/menage?status=a_valider"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.a_valider > 0 ? 'bg-amber-50 border-amber-300 hover:bg-amber-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.a_valider > 0 ? 'text-amber-700' : 'text-stoniz-gray-500'}`}>📋 À valider</p>
          <p className={`font-display text-3xl ${stats.a_valider > 0 ? 'text-amber-900' : 'text-stoniz-gray-400'}`}>{stats.a_valider}</p>
        </Link>
        <Link
          href="/propria/menage?status=retard"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.en_retard > 0 ? 'bg-red-50 border-red-300 hover:bg-red-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.en_retard > 0 ? 'text-red-700' : 'text-stoniz-gray-500'}`}>⏰ En retard</p>
          <p className={`font-display text-3xl ${stats.en_retard > 0 ? 'text-red-900' : 'text-stoniz-gray-400'}`}>{stats.en_retard}</p>
        </Link>
        <Link
          href="/propria/menage?status=refusee"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.refusee > 0 ? 'bg-orange-50 border-orange-300 hover:bg-orange-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.refusee > 0 ? 'text-orange-700' : 'text-stoniz-gray-500'}`}>↩️ Refusés</p>
          <p className={`font-display text-3xl ${stats.refusee > 0 ? 'text-orange-900' : 'text-stoniz-gray-400'}`}>{stats.refusee}</p>
        </Link>
      </div>

      {/* Fenêtre temporelle (conservée car ergo terrain) */}
      <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
        <span className="text-stoniz-gray-500">Échéance :</span>
        <Link href={{ pathname: '/propria/menage', query: { ...searchParams, window: 'today', date: undefined } }}
          className={`px-3 py-1.5 rounded-full ${fenetre === 'today' && !dateExact ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
        >📍 Aujourd&apos;hui</Link>
        <Link href={{ pathname: '/propria/menage', query: { ...searchParams, window: 'tomorrow', date: undefined } }}
          className={`px-3 py-1.5 rounded-full ${fenetre === 'tomorrow' && !dateExact ? 'bg-blue-600 text-white' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}
        >☀ Demain</Link>
        <Link href={{ pathname: '/propria/menage', query: { ...searchParams, window: '4days', date: undefined } }}
          className={`px-3 py-1.5 rounded-full ${fenetre === '4days' && !dateExact ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
        >📅 4 prochains jours</Link>
        <Link href={{ pathname: '/propria/menage', query: { ...searchParams, window: 'week', date: undefined } }}
          className={`px-3 py-1.5 rounded-full ${fenetre === 'week' && !dateExact ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
        >Cette semaine</Link>
        <Link href={{ pathname: '/propria/menage', query: { ...searchParams, window: 'all', date: undefined } }}
          className={`px-3 py-1.5 rounded-full ${fenetre === 'all' && !dateExact ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`}
        >Tous</Link>
      </div>

      {/* Toolbar unifiée */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-menage"
          count={{ filtered: rows.length, total: totalCount }}
          filters={filters}
          searchHint="description, observation"
        />
      </div>

      {/* Tableau */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-3 text-left"><SortableHeader field="occurred_at">Date</SortableHeader></th>
              <th className="px-3 py-3 text-left"><SortableHeader field="due_date">Échéance</SortableHeader></th>
              <th className="px-3 py-3 text-left">Bien · Lot</th>
              <th className="px-3 py-3 text-left">Type</th>
              <th className="px-3 py-3 text-left">Description</th>
              <th className="px-3 py-3 text-center">Urgence</th>
              <th className="px-3 py-3 text-center">Statut</th>
              <th className="px-3 py-3 text-left">Assignée à</th>
              <th className="px-3 py-3 text-left">Durée</th>
              <th className="px-3 py-3"></th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map(r => {
              const unit = r.propria_unit_id ? (unitsMap.get(r.propria_unit_id) as any) : null;
              const bienId = unit ? unit.property_id : r.property_id;
              const bien = bienId ? (props.get(bienId) as any) : null;
              const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : 'Bien';
              const scopeText = unit ? `${bienCode} · ${unit.label}` : (bien ? `${bienCode} · Bien entier` : '—');
              const typeName = typesMap.get(r.cleaning_type_id) ?? '—';
              const durationH = r.realisation_hours != null ? Number(r.realisation_hours).toFixed(1) : null;
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-stoniz-gray-600">
                    {new Date(r.occurred_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td className={`px-3 py-2 whitespace-nowrap text-xs ${r.is_overdue ? 'text-red-700 font-medium' : 'text-stoniz-gray-600'}`}>
                    {r.due_date ? new Date(r.due_date).toLocaleDateString('fr-FR') : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {bienId ? (
                      <Link href={`/propria/biens/${bienId}`} className="hover:underline">{scopeText}</Link>
                    ) : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs font-medium whitespace-nowrap">
                    {(() => {
                      const cat = cleaningCategoryMeta(r.category);
                      return (
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${cat.badgeClass}`} title={typeName}>
                          {cat.icon} {cat.label}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="px-3 py-2 max-w-xs truncate" title={r.description ?? ''}>
                    <Link href={`/propria/menage/${r.id}`} className="hover:underline">
                      {r.description ?? <span className="text-stoniz-gray-400 italic">(sans description)</span>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${URGENCY_BADGE[r.urgency]}`}>
                      {URG_LABELS[r.urgency]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                    {r.refused_count > 0 && (
                      <span className="ml-1 text-[10px] text-orange-700" title="Refus">×{r.refused_count}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{profs.get(r.assigned_to_id) ?? <span className="text-orange-600">non assigné</span>}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {durationH ? `${durationH} h` : <span className="text-stoniz-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/propria/menage/${r.id}`} className="text-xs hover:underline">→</Link>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_cleanings" id={r.id} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucun ménage pour ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
