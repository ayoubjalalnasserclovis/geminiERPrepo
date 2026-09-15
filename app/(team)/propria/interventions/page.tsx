import Link from 'next/link';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';
import { InterventionsColumnSettings } from '@/components/propria/interventions-column-settings';
import { BulkAssignBanner } from '@/components/propria/bulk-assign-banner';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import { single, multi, period, search, escapeIlike as parseEscapeIlike, sort, type SP } from '@/lib/list-filters/parse';
import {
  getUnitOperationalContext,
  aggregateUnitContexts,
  computeArrivalAlert,
  OPEN_TASK_STATUSES,
} from '@/lib/propria/unit-context';

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
const URG_LABELS: Record<string, string> = {
  critique: '🔴 Critique', haute: '🟠 Haute', normale: '🟡 Normale', basse: '🟢 Basse',
};
const STATUS_LABELS: Record<string, string> = {
  a_traiter: 'À faire', en_cours: 'En cours', a_valider: 'À valider',
  cloture: 'Validée', refusee: 'Refusée', annule: 'Annulée',
};

const STATUS_OPTIONS = [
  { v: 'a_traiter', label: 'À faire' },
  { v: 'en_cours',  label: 'En cours' },
  { v: 'a_valider', label: 'À valider' },
  { v: 'cloture',   label: 'Validée' },
  { v: 'refusee',   label: 'Refusée' },
  { v: 'annule',    label: 'Annulée' },
];

const URGENCY_OPTIONS = [
  { v: 'critique', label: '🔴 Critique' },
  { v: 'haute',    label: '🟠 Haute' },
  { v: 'normale',  label: '🟡 Normale' },
  { v: 'basse',    label: '🟢 Basse' },
];

const KIND_OPTIONS = [
  { v: 'intervention', label: '🔧 Intervention' },
  { v: 'tache',        label: '📋 Tâche' },
];

const SORT_FIELDS: Record<string, string> = {
  occurred_at: 'occurred_at',
  due_date:    'due_date',
  urgency:     'urgency',
};

// Tâches "actives" = ni validées ni annulées.
const ACTIVE_STATUSES = ['a_traiter', 'en_cours', 'a_valider', 'refusee'];

function fmtMad(n: any) {
  if (n == null) return '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n))} DH`;
}

export default async function InterventionsListPage({
  searchParams,
}: { searchParams: SP }) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const me = await getSessionUser();
  const canManageColumns = me?.role === 'ceo' || me?.role === 'developer';
  const supabase = createClient();

  // Référentiels d'abord : les lots servent à résoudre l'affichage ET le filtre par bien.
  const [propsRes, unitsRes, provRes, typesRes, profRes, assigneesRes] = await Promise.all([
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_providers').select('id, name').eq('is_active', true).is('deleted_at', null),
    supabase.from('propria_intervention_types').select('id, name'),
    supabase.from('profiles').select('id, full_name'),
    supabase.from('profiles')
      .select('id, full_name, role')
      .in('role', ['propria','ceo','assistante','developer'])
      .eq('is_active', true)
      .order('role')
      .order('full_name'),
  ]);

  const unitsList = unitsRes.data ?? [];
  const props = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const unitsMap = new Map(unitsList.map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));
  const types = new Map((typesRes.data ?? []).map((t: any) => [t.id, t.name]));
  const profs = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  // ─── Parse filtres toolbar ─────────────────────────────────────────────
  const q = search(searchParams);
  const statuses = multi(searchParams, 'status');
  const urgency = single(searchParams, 'urgency');
  const kinds = multi(searchParams, 'kind');
  const types_filter = multi(searchParams, 'type');
  const property = single(searchParams, 'property');
  const periodOcc = period(searchParams, 'period');
  const { field: sortField, dir: sortDir } = sort(searchParams, 'occurred_at', 'desc');
  const dbSortField = SORT_FIELDS[sortField] ?? 'occurred_at';

  let qBuilder = supabase
    .from('propria_interventions_enriched')
    .select(`
      id, property_id, propria_unit_id, type_label, description, occurred_at, due_date, urgency, status, closed_at,
      cost_propria_mad, client_billing_mad, charge_to, marge_mad, observations,
      responsable_id, assigned_to_id, provider_id, intervention_type_id, hostaway_integrated,
      is_overdue, is_awaiting_validation, refused_count, kind
    `)
    .order(dbSortField, { ascending: sortDir === 'asc' })
    .limit(500);

  // Compat legacy : ?status=actives / ?status=retard restent acceptés.
  const legacyStatus = single(searchParams, 'status');
  if (legacyStatus === 'actives') qBuilder = qBuilder.in('status', ACTIVE_STATUSES);
  else if (legacyStatus === 'retard') qBuilder = qBuilder.eq('is_overdue', true);
  else if (statuses.length) qBuilder = qBuilder.in('status', statuses);

  if (urgency) qBuilder = qBuilder.eq('urgency', urgency);
  if (kinds.length === 1) qBuilder = qBuilder.eq('kind', kinds[0]);
  if (kinds.length > 1) qBuilder = qBuilder.in('kind', kinds);
  if (types_filter.length) qBuilder = qBuilder.in('intervention_type_id', types_filter);

  if (property) {
    const unitIds = unitsList.filter((u: any) => u.property_id === property).map((u: any) => u.id);
    if (unitIds.length) qBuilder = qBuilder.or(`property_id.eq.${property},propria_unit_id.in.(${unitIds.join(',')})`);
    else qBuilder = qBuilder.eq('property_id', property);
  }

  if (periodOcc.from) qBuilder = qBuilder.gte('occurred_at', periodOcc.from);
  if (periodOcc.to) qBuilder = qBuilder.lte('occurred_at', periodOcc.to);

  if (q) {
    const needle = parseEscapeIlike(q);
    qBuilder = qBuilder.or(`description.ilike.%${needle}%,type_label.ilike.%${needle}%`);
  }

  const intsRes = await qBuilder;
  let rows = (intsRes.data ?? []) as any[];

  // Total non filtré (pour compteur "X sur Y")
  const totalRes = await supabase
    .from('propria_interventions_enriched')
    .select('id', { count: 'exact', head: true });
  const totalCount = totalRes.count ?? rows.length;

  // ─── badges ⚠ « arrivée avant l'échéance » ──────────
  const ctxUnitIds = new Set<string>();
  for (const r of rows) {
    if (!OPEN_TASK_STATUSES.includes(r.status)) continue;
    if (r.propria_unit_id) ctxUnitIds.add(r.propria_unit_id);
    else if (r.property_id) {
      for (const u of unitsList as any[]) {
        if (u.property_id === r.property_id) ctxUnitIds.add(u.id);
      }
    }
  }
  const unitCtxMap = await getUnitOperationalContext([...ctxUnitIds], supabase);
  const rowArrivalAlert = (r: any) => {
    if (!OPEN_TASK_STATUSES.includes(r.status)) return null;
    const ids: string[] = r.propria_unit_id
      ? [r.propria_unit_id]
      : r.property_id
        ? (unitsList as any[]).filter((u) => u.property_id === r.property_id).map((u) => u.id)
        : [];
    if (ids.length === 0) return null;
    const ctx = aggregateUnitContexts(ids.map((id) => unitCtxMap.get(id)));
    return computeArrivalAlert({ ctx, status: r.status, dueDate: r.due_date ?? null });
  };

  // ─── KPI back office ──
  const stats = {
    a_valider: rows.filter(r => r.status === 'a_valider').length,
    en_retard: rows.filter(r => r.is_overdue).length,
    refusee: rows.filter(r => r.status === 'refusee').length,
    interventions: rows.filter(r => r.kind === 'intervention').length,
    taches: rows.filter(r => r.kind === 'tache').length,
  };

  const unassignedRows = rows
    .filter((r) => !r.assigned_to_id && !['cloture','annule'].includes(r.status))
    .map((r) => {
      const unit = r.propria_unit_id ? (unitsMap.get(r.propria_unit_id) as any) : null;
      const bienId = unit ? unit.property_id : r.property_id;
      const bien = bienId ? (props.get(bienId) as any) : null;
      const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : 'Bien';
      const scope_label = unit ? `${bienCode} · ${unit.label}` : (bien ? `${bienCode}` : '—');
      return {
        id: r.id,
        description: r.description,
        urgency: r.urgency,
        occurred_at: r.occurred_at,
        due_date: r.due_date,
        scope_label,
      };
    });

  const assignees = (assigneesRes.data ?? []) as { id: string; full_name: string | null; role: string | null }[];

  // ─── Options dynamiques ─────────────────────────────────────────────
  const propertyOptions = [...(propsRes.data ?? [])]
    .sort((a: any, b: any) =>
      (a.propria_internal_code ?? a.name).localeCompare(b.propria_internal_code ?? b.name))
    .map((p: any) => ({ v: p.id, label: p.propria_internal_code ?? p.name }));

  const typeOptions = [...(typesRes.data ?? [])]
    .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name)))
    .map((t: any) => ({ v: t.id, label: t.name }));

  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'type',     label: 'Type',       options: typeOptions },
    { kind: 'multi',  key: 'status',   label: 'Statut',     options: STATUS_OPTIONS },
    { kind: 'single', key: 'urgency',  label: 'Urgence',    options: URGENCY_OPTIONS },
    { kind: 'single', key: 'property', label: 'Bien',       options: propertyOptions },
    { kind: 'multi',  key: 'kind',     label: 'Nature',     options: KIND_OPTIONS },
    { kind: 'period', key: 'period',   label: 'Période' },
  ];

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Interventions
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Interventions &amp; tâches ({rows.length})</h1>
          <div className="text-xs text-stoniz-gray-500 mt-1">
            🔧 {stats.interventions} intervention{stats.interventions > 1 ? 's' : ''}
            <span className="mx-2 text-stoniz-gray-300">·</span>
            📋 {stats.taches} tâche{stats.taches > 1 ? 's' : ''}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <InterventionsColumnSettings isCeo={canManageColumns} />
          <Link
            href="/propria/interventions/parametres"
            className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50"
          >
            ⚙ Prestataires
          </Link>
          <Link
            href="/propria/interventions/new"
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800"
          >
            + Nouvelle tâche
          </Link>
        </div>
      </div>

      {/* Bandeau "non assignées" + bulk-assign */}
      <BulkAssignBanner unassigned={unassignedRows} assignees={assignees} />

      {/* Bandeau KPI — clic = filtre */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Link
          href="/propria/interventions?status=a_valider"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.a_valider > 0 ? 'bg-amber-50 border-amber-300 hover:bg-amber-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.a_valider > 0 ? 'text-amber-700' : 'text-stoniz-gray-500'}`}>
            📋 À valider
          </p>
          <p className={`font-display text-3xl ${stats.a_valider > 0 ? 'text-amber-900' : 'text-stoniz-gray-400'}`}>{stats.a_valider}</p>
          <p className={`text-xs mt-1 ${stats.a_valider > 0 ? 'text-amber-700' : 'text-stoniz-gray-500'}`}>
            Preuve déposée, en attente du back office
          </p>
        </Link>

        <Link
          href="/propria/interventions?status=retard"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.en_retard > 0 ? 'bg-red-50 border-red-300 hover:bg-red-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.en_retard > 0 ? 'text-red-700' : 'text-stoniz-gray-500'}`}>
            ⏰ En retard
          </p>
          <p className={`font-display text-3xl ${stats.en_retard > 0 ? 'text-red-900' : 'text-stoniz-gray-400'}`}>{stats.en_retard}</p>
          <p className={`text-xs mt-1 ${stats.en_retard > 0 ? 'text-red-700' : 'text-stoniz-gray-500'}`}>
            Échéance dépassée, non terminées
          </p>
        </Link>

        <Link
          href="/propria/interventions?status=refusee"
          className={`block rounded-md border-2 p-4 transition-colors ${
            stats.refusee > 0 ? 'bg-orange-50 border-orange-300 hover:bg-orange-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${stats.refusee > 0 ? 'text-orange-700' : 'text-stoniz-gray-500'}`}>
            ↩️ Refusées
          </p>
          <p className={`font-display text-3xl ${stats.refusee > 0 ? 'text-orange-900' : 'text-stoniz-gray-400'}`}>{stats.refusee}</p>
          <p className={`text-xs mt-1 ${stats.refusee > 0 ? 'text-orange-700' : 'text-stoniz-gray-500'}`}>
            À refaire côté terrain
          </p>
        </Link>
      </div>

      {/* Toolbar unifiée */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-interventions"
          count={{ filtered: rows.length, total: totalCount }}
          filters={filters}
          searchHint="description, type"
        />
      </div>

      <PropriaBulkDeleteForm table="propria_interventions">
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-3"></th>
              <th data-col="date"        className="px-3 py-3 text-left">
                <SortableHeader field="occurred_at">Date</SortableHeader>
              </th>
              <th data-col="echeance"    className="px-3 py-3 text-left">
                <SortableHeader field="due_date">Échéance</SortableHeader>
              </th>
              <th data-col="bien"        className="px-3 py-3 text-left">Bien · Lot</th>
              <th data-col="type"        className="px-3 py-3 text-left">Type</th>
              <th data-col="description" className="px-3 py-3 text-left">Description</th>
              <th data-col="urgence"     className="px-3 py-3 text-center">
                <SortableHeader field="urgency">Urgence</SortableHeader>
              </th>
              <th data-col="statut"      className="px-3 py-3 text-center">Statut</th>
              <th data-col="assignee"    className="px-3 py-3 text-left">Assignée à</th>
              <th data-col="suivi"       className="px-3 py-3 text-left">Suivi par</th>
              <th data-col="hostaway"    className="px-3 py-3 text-center" title="Intégré dans Hostaway">Hostaway</th>
              <th data-col="cout"        className="px-3 py-3 text-right">Coût Propria</th>
              <th data-col="refacturation" className="px-3 py-3 text-right">Refact. client</th>
              <th data-col="marge"       className="px-3 py-3 text-right">Marge</th>
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
              const typeName = r.intervention_type_id ? types.get(r.intervention_type_id) : r.type_label;
              const marge = Number(r.marge_mad ?? 0);
              const alert = rowArrivalAlert(r);
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" data-bulk-id={r.id} />
                  </td>
                  <td data-col="date" className="px-3 py-2 whitespace-nowrap text-xs text-stoniz-gray-600">
                    {new Date(r.occurred_at).toLocaleDateString('fr-FR')}
                  </td>
                  <td data-col="echeance" className={`px-3 py-2 whitespace-nowrap text-xs ${r.is_overdue ? 'text-red-700 font-medium' : 'text-stoniz-gray-600'}`}>
                    {r.due_date ? new Date(r.due_date).toLocaleDateString('fr-FR') : '—'}
                    {alert && (
                      <span
                        className={`ml-1 ${alert.level === 'red' ? 'text-red-600' : 'text-amber-600'}`}
                        title={`À réaliser avant le ${new Date(alert.arrival_date).toLocaleDateString('fr-FR')} — arrivée${alert.guest_name ? ` de ${alert.guest_name}` : ' voyageur'}`}
                      >
                        ⚠
                      </span>
                    )}
                  </td>
                  <td data-col="bien" className="px-3 py-2 text-xs">
                    {bienId ? (
                      <Link href={`/propria/biens/${bienId}`} className="hover:underline">{scopeText}</Link>
                    ) : '—'}
                  </td>
                  <td data-col="type" className="px-3 py-2 text-xs">{typeName ?? '—'}</td>
                  <td data-col="description" className="px-3 py-2 max-w-xs truncate" title={r.description}>
                    <span className="mr-1 text-stoniz-gray-400" title={r.kind === 'tache' ? 'Tâche logistique' : 'Intervention technique'}>
                      {r.kind === 'tache' ? '📋' : '🔧'}
                    </span>
                    <Link href={`/propria/interventions/${r.id}`} className="hover:underline">
                      {r.description}
                    </Link>
                  </td>
                  <td data-col="urgence" className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${URGENCY_BADGE[r.urgency]}`}>
                      {URG_LABELS[r.urgency]}
                    </span>
                  </td>
                  <td data-col="statut" className="px-3 py-2 text-center whitespace-nowrap">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status]}`}>
                      {STATUS_LABELS[r.status]}
                    </span>
                    {r.refused_count > 0 && (
                      <span className="ml-1 text-[10px] text-orange-700" title="Nombre de refus">×{r.refused_count}</span>
                    )}
                  </td>
                  <td data-col="assignee" className="px-3 py-2 text-xs">{profs.get(r.assigned_to_id) ?? '—'}</td>
                  <td data-col="suivi" className="px-3 py-2 text-xs">{profs.get(r.responsable_id) ?? '—'}</td>
                  <td data-col="hostaway" className="px-3 py-2 text-center text-xs">
                    {r.hostaway_integrated
                      ? <span className="text-emerald-700" title="Intégré dans Hostaway">✓</span>
                      : <span className="text-orange-600" title="Pas encore intégré dans Hostaway">—</span>}
                  </td>
                  <td data-col="cout" className="px-3 py-2 text-right text-xs text-stoniz-gray-700">
                    {fmtMad(r.cost_propria_mad)}
                  </td>
                  <td data-col="refacturation" className="px-3 py-2 text-right text-xs text-stoniz-gray-700">
                    {fmtMad(r.client_billing_mad)}
                  </td>
                  <td data-col="marge" className={`px-3 py-2 text-right text-xs font-medium ${marge >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {r.marge_mad != null ? fmtMad(r.marge_mad) : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/propria/interventions/${r.id}`} className="text-xs hover:underline">→</Link>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_interventions" id={r.id} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={16} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucune tâche pour ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </PropriaBulkDeleteForm>
    </div>
  );
}
