import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { IncidentActions } from '@/components/propria/incident-actions';

const SEV_BADGE: Record<string, string> = {
  critique: 'bg-red-100 text-red-800',
  haute: 'bg-orange-100 text-orange-800',
  normale: 'bg-amber-100 text-amber-800',
  basse: 'bg-stoniz-gray-100 text-stoniz-gray-700',
};
const SEV_ICON: Record<string, string> = { critique: '🔴', haute: '🟠', normale: '🟡', basse: '🟢' };

const STATUS_BADGE: Record<string, string> = {
  reported:     'bg-red-100 text-red-800',
  // acknowledged toujours dans l'enum BDD pour rétro-compat des données passées
  acknowledged: 'bg-amber-100 text-amber-800',
  resolved:     'bg-emerald-100 text-emerald-800',
  declined:     'bg-stoniz-gray-200 text-stoniz-gray-700',
};
const STATUS_LABEL: Record<string, string> = {
  reported:     '⚠ Signalé',
  acknowledged: '⚠ Signalé', // historique pré-2026-06-09 affiché comme signalé
  resolved:     '✓ Résolu',
  declined:     '✕ Décliné',
};

export default async function CleaningIncidentsListPage({
  searchParams,
}: { searchParams: { status?: string; severity?: string } }) {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  // Par défaut : seulement les non-clos (reported + acknowledged).
  // Filtre 'all' pour inclure résolus + déclinés (historique).
  const filterStatus = searchParams.status ?? 'open';

  const [incidentsRes, profilesRes, propsRes, unitsRes, cleansRes, typesRes] = await Promise.all([
    supabase.from('propria_cleaning_incidents')
      .select(`
        id, cleaning_id, description, severity, status,
        reported_by, reported_at, acknowledged_by, acknowledged_at,
        resolved_at, resolution_notes, declined_at, declined_by, decline_reason,
        linked_intervention_id
      `)
      .is('deleted_at', null)
      .order('reported_at', { ascending: false })
      .limit(500),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
      .neq('role', 'client').order('full_name'),
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_cleanings')
      .select('id, property_id, propria_unit_id, cleaning_type_id, occurred_at, status, hostaway_reservation_id')
      .is('deleted_at', null),
    supabase.from('propria_cleaning_types').select('id, name'),
  ]);

  const profs = new Map((profilesRes.data ?? []).map((p: any) => [p.id, p.full_name]));
  const props = new Map((propsRes.data ?? []).map((p: any) => [p.id, p]));
  const unitsMap = new Map((unitsRes.data ?? []).map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));
  const cleansMap = new Map((cleansRes.data ?? []).map((c: any) => [c.id, c]));
  const typesMap = new Map((typesRes.data ?? []).map((t: any) => [t.id, t.name]));
  const allIncidents = (incidentsRes.data ?? []) as any[];

  // Filtres
  let filtered = allIncidents;
  if (filterStatus === 'open') {
    filtered = filtered.filter((i) => i.status === 'reported' || i.status === 'acknowledged');
  } else if (filterStatus && filterStatus !== 'all') {
    filtered = filtered.filter((i) => i.status === filterStatus);
  }
  if (searchParams.severity) {
    filtered = filtered.filter((i) => i.severity === searchParams.severity);
  }

  // Compteurs pour les filtres (un incident "ouvert" = ni résolu ni décliné)
  const counts = {
    open: allIncidents.filter((i) => i.status !== 'resolved' && i.status !== 'declined').length,
    resolved: allIncidents.filter((i) => i.status === 'resolved').length,
    declined: allIncidents.filter((i) => i.status === 'declined').length,
    all: allIncidents.length,
  };

  const isBackOffice = user.role !== 'propria';
  const assignees = (profilesRes.data ?? []).filter((p: any) => ['propria','ceo','assistante','developer'].includes(p.role));

  return (
    <div className="max-w-7xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/menage" className="hover:text-stoniz-black">Ménage</Link>
        {' · Incidents'}
      </div>
      <h1 className="text-3xl font-display mb-2">⚠ Incidents ménage</h1>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Les incidents ont leur propre cycle de vie, indépendant du ménage source.
        Un ménage peut être validé même si un incident reste ouvert.
      </p>

      {/* Filtres status — workflow simplifié 2026-06-09 : ouvert / résolu / décliné */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Link href={{ pathname: '/propria/menage/incidents', query: { ...searchParams, status: undefined } }}
          className={`px-3 py-1.5 rounded-full ${filterStatus === 'open' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
        >⚠ À traiter ({counts.open})</Link>
        <span className="border-l border-stoniz-gray-300 mx-1" />
        <Link href={{ pathname: '/propria/menage/incidents', query: { ...searchParams, status: 'resolved' } }}
          className={`px-3 py-1.5 rounded-full ${filterStatus === 'resolved' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
        >Résolus ({counts.resolved})</Link>
        <Link href={{ pathname: '/propria/menage/incidents', query: { ...searchParams, status: 'declined' } }}
          className={`px-3 py-1.5 rounded-full ${filterStatus === 'declined' ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`}
        >Déclinés ({counts.declined})</Link>
        <Link href={{ pathname: '/propria/menage/incidents', query: { ...searchParams, status: 'all' } }}
          className={`px-3 py-1.5 rounded-full ${filterStatus === 'all' ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`}
        >Tout ({counts.all})</Link>
      </div>

      {/* Filtres gravité */}
      <div className="flex flex-wrap gap-2 mb-5 text-xs">
        <Link href={{ pathname: '/propria/menage/incidents', query: { ...searchParams, severity: undefined } }}
          className={`px-3 py-1.5 rounded-full ${!searchParams.severity ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`}
        >Toutes gravités</Link>
        {(['critique','haute','normale','basse'] as const).map((s) => (
          <Link key={s} href={{ pathname: '/propria/menage/incidents', query: { ...searchParams, severity: s } }}
            className={`px-3 py-1.5 rounded-full ${searchParams.severity === s ? 'bg-stoniz-black text-white' : SEV_BADGE[s] + ' hover:opacity-80'}`}
          >{SEV_ICON[s]} {s}</Link>
        ))}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-10 text-center text-stoniz-gray-500 text-sm">
          {filterStatus === 'open'
            ? '✓ Aucun incident à traiter actuellement.'
            : 'Aucun incident pour ces filtres.'}
        </div>
      ) : (
        <ul className="space-y-3">
          {filtered.map((inc: any) => {
            const clean = cleansMap.get(inc.cleaning_id) as any;
            const unit = clean?.propria_unit_id ? unitsMap.get(clean.propria_unit_id) as any : null;
            const bienId = unit ? unit.property_id : clean?.property_id;
            const bien = bienId ? props.get(bienId) as any : null;
            const bienCode = bien ? (bien.propria_internal_code ?? bien.name) : 'Bien';
            const scopeLabel = unit ? `${bienCode} · ${unit.label}` : (bien ? `${bienCode} · Bien entier` : '—');
            const typeName = clean?.cleaning_type_id ? typesMap.get(clean.cleaning_type_id) : null;
            const reportedAt = new Date(inc.reported_at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
            // Workflow simplifié : un incident est "ouvert" tant qu'il n'est pas résolu/décliné
            const isOpen = inc.status !== 'resolved' && inc.status !== 'declined';

            return (
              <li key={inc.id} id={inc.id} className={`bg-white border rounded-xl p-4 ${
                inc.status === 'reported' ? 'border-red-300 bg-red-50/30' :
                inc.status === 'acknowledged' ? 'border-amber-300' :
                'border-stoniz-gray-200'
              }`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                      <span className={`px-2 py-0.5 rounded-full ${SEV_BADGE[inc.severity]}`}>
                        {SEV_ICON[inc.severity]} {inc.severity}
                      </span>
                      <span className={`uppercase px-2 py-0.5 rounded-full ${STATUS_BADGE[inc.status]}`}>
                        {STATUS_LABEL[inc.status]}
                      </span>
                      <span className="text-stoniz-gray-500">
                        {profs.get(inc.reported_by) ?? 'Inconnu'} · {reportedAt}
                      </span>
                    </div>

                    {/* Contexte */}
                    <div className="text-xs text-stoniz-gray-600 mb-2">
                      🧹 {typeName ?? 'Ménage'} · {scopeLabel}
                      {clean?.occurred_at && ` · ${new Date(clean.occurred_at).toLocaleDateString('fr-FR')}`}
                      {' · '}
                      <Link href={`/propria/menage/${inc.cleaning_id}`} className="underline hover:text-stoniz-black">
                        Voir le ménage →
                      </Link>
                    </div>

                    {/* Description */}
                    <p className="text-sm text-stoniz-gray-800">{inc.description}</p>

                    {/* Notes de résolution / déclin */}
                    {inc.status === 'resolved' && inc.resolution_notes && (
                      <div className="text-xs text-emerald-700 mt-1.5">
                        <strong>Résolution :</strong> {inc.resolution_notes}
                        {inc.linked_intervention_id && (
                          <Link href={`/propria/interventions/${inc.linked_intervention_id}`}
                            className="ml-2 underline hover:text-emerald-900">
                            Voir l'intervention →
                          </Link>
                        )}
                      </div>
                    )}
                    {inc.status === 'declined' && inc.decline_reason && (
                      <div className="text-xs text-stoniz-gray-600 mt-1.5">
                        <strong>Motif du déclin :</strong> {inc.decline_reason}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {isBackOffice && isOpen && (
                    <IncidentActions
                      incidentId={inc.id}
                      defaultDescription={inc.description}
                      defaultUrgency={inc.severity}
                      assignees={assignees as any}
                      hasReservation={!!clean?.hostaway_reservation_id}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
