import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { CleaningForm } from '@/components/propria/cleaning-form';
import { CleaningProofUploader, type CleaningProof } from '@/components/propria/cleaning-proof-uploader';
import { CleaningWorkflowActions } from '@/components/propria/cleaning-workflow-actions';
import { CleaningActivityTimeline, type CleaningActivityEvent } from '@/components/propria/cleaning-activity-timeline';
import { CleaningChecklistGrid } from '@/components/propria/cleaning-checklist';
import { CleaningIncidentsPanel, type CleaningIncident } from '@/components/propria/cleaning-incidents';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaAccessInfoCard } from '@/components/propria/propria-access-info-card';
import { expandChecklist } from '@/lib/propria/cleaning-checklist';
import { buildScopeGroups, scopeValue } from '@/lib/propria/intervention-scope';
import { OPEN_TASK_STATUSES } from '@/lib/propria/unit-context';
import { OpenTasksForCleaningCard, type OpenTaskRef } from '@/components/propria/unit-context-card';
import {
  updateCleaningAction,
  getCleaningProofUrls,
} from '../actions';

const STATUS_META: Record<string, { label: string; icon: string }> = {
  a_traiter: { label: 'À faire', icon: '⏳' },
  en_cours: { label: 'En cours', icon: '🔄' },
  a_valider: { label: 'À valider', icon: '📋' },
  cloture: { label: 'Validé', icon: '✓' },
  refusee: { label: 'Refusé — à refaire', icon: '↩️' },
  annule: { label: 'Annulé', icon: '✕' },
};

const STEPS = [
  { key: 'a_traiter', label: 'À faire' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'a_valider', label: 'À valider' },
  { key: 'cloture', label: 'Validé' },
] as const;

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function durationHours(startIso: string, endIso: string): number {
  return (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3600000;
}

export default async function CleaningDetailPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria', 'menage']);
  const supabase = createClient();

  const [cleanRes, propsRes, unitsRes, typesRes, profRes, activityRes, incidentsRes] = await Promise.all([
    supabase.from('propria_cleanings').select('*').eq('id', params.id).single(),
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null).order('propria_internal_code'),
    supabase.from('propria_units')
      .select('id, code, order_index, property_id, propria_nb_chambres, propria_nb_sdb, propria_capacity_voyageurs, propria_type_lits')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_cleaning_types').select('id, name')
      .eq('is_active', true).order('display_order'),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true)
      .neq('role', 'client').order('full_name'),
    supabase.from('propria_cleaning_activity')
      .select('id, cleaning_id, actor_id, action, payload, created_at')
      .eq('cleaning_id', params.id)
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('propria_cleaning_incidents')
      .select('id, cleaning_id, description, severity, status, reported_by, reported_at, acknowledged_by, acknowledged_at, resolved_at, resolution_notes')
      .eq('cleaning_id', params.id)
      .is('deleted_at', null)
      .order('reported_at', { ascending: false }),
  ]);

  if (!cleanRes.data) notFound();
  const cleaning = cleanRes.data;

  const properties = propsRes.data ?? [];
  const units = unitsRes.data ?? [];
  const scopeGroups = buildScopeGroups(properties, units);
  const propsMap = new Map(properties.map((p: any) => [p.id, p.propria_internal_code ?? p.name]));
  const unitsMap = new Map(units.map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));
  const typesMap = new Map((typesRes.data ?? []).map((t: any) => [t.id, t.name]));

  let scopeLabel = '—';
  let scopeUnit: any = null;
  if (cleaning.propria_unit_id) {
    scopeUnit = unitsMap.get(cleaning.propria_unit_id) as any;
    if (scopeUnit) scopeLabel = `${propsMap.get(scopeUnit.property_id) ?? 'Bien'} · ${scopeUnit.label}`;
  } else if (cleaning.property_id) {
    scopeLabel = `${propsMap.get(cleaning.property_id) ?? 'Bien'} · Bien entier`;
  }

  // Récupère la "spec" de la suite/bien (nb chambres, sdb, voyageurs) pour la checklist
  let suiteSpec: { nbChambres: number | null; nbSdb: number | null; capacity: number | null; typeLits: string | null } = {
    nbChambres: null, nbSdb: null, capacity: null, typeLits: null,
  };
  if (scopeUnit) {
    const fullUnit = units.find((u: any) => u.id === cleaning.propria_unit_id) as any;
    if (fullUnit) {
      suiteSpec = {
        nbChambres: fullUnit.propria_nb_chambres ?? null,
        nbSdb: fullUnit.propria_nb_sdb ?? null,
        capacity: fullUnit.propria_capacity_voyageurs ?? null,
        typeLits: fullUnit.propria_type_lits ?? null,
      };
    }
  } else if (cleaning.property_id) {
    // Bien entier : somme des suites pour donner un contexte à la checklist
    const allUnitsOfBien = units.filter((u: any) => u.property_id === cleaning.property_id);
    suiteSpec = {
      nbChambres: allUnitsOfBien.reduce((s: number, u: any) => s + Number(u.propria_nb_chambres ?? 0), 0) || null,
      nbSdb: allUnitsOfBien.reduce((s: number, u: any) => s + Number(u.propria_nb_sdb ?? 0), 0) || null,
      capacity: allUnitsOfBien.reduce((s: number, u: any) => s + Number(u.propria_capacity_voyageurs ?? 0), 0) || null,
      typeLits: allUnitsOfBien.map((u: any) => u.propria_type_lits).filter(Boolean).join(' · ') || null,
    };
  }

  const proofs = (await getCleaningProofUrls(params.id)) as CleaningProof[];
  const uploaderNames: Record<string, string> = Object.fromEntries(
    (profRes.data ?? []).map((p: any) => [p.id, p.full_name])
  );

  const activityEvents: CleaningActivityEvent[] = ((activityRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    cleaning_id: e.cleaning_id,
    actor_id: e.actor_id,
    action: e.action,
    payload: e.payload,
    created_at: e.created_at,
    actor_name: e.actor_id ? (uploaderNames[e.actor_id] ?? null) : null,
  }));

  const isBackOffice = user.role !== 'propria';
  const canValidate = isBackOffice;
  const hasProof = proofs.length > 0;

  // Chantier 5 marathon (U21) : TERMINER bloqué tant que la checklist n'est
  // pas complète — nb d'items sans photo, même logique que la grille.
  // Les « équipements » ne bloquent pas (un logement peut ne pas avoir de
  // four / fer à repasser) — conforme à la liste U21 du consultant.
  const expandedItems = expandChecklist(suiteSpec.nbChambres, suiteSpec.nbSdb)
    .filter((s) => s.section.key !== 'equipements')
    .flatMap((s) => s.items);
  const proofKeys = new Set(
    (proofs as any[]).map((p) => p.checklistItemKey).filter(Boolean)
  );
  const checklistMissingCount = expandedItems.filter((i) => !proofKeys.has(i.expandedKey)).length;

  const updateAction = updateCleaningAction.bind(null, params.id);
  const meta = STATUS_META[cleaning.status] ?? { label: cleaning.status, icon: '•' };
  const currentIdx = STEPS.findIndex(s => s.key === cleaning.status);
  const assignedName = cleaning.assigned_to_id ? uploaderNames[cleaning.assigned_to_id] : null;
  const responsableName = cleaning.responsable_id ? uploaderNames[cleaning.responsable_id] : null;
  const typeName = typesMap.get(cleaning.cleaning_type_id) ?? '—';

  // Calcul de la durée de réalisation (si terminé) basé sur started_at (le
  // clic « Démarrer ») et non plus sur created_at. Rétro-compatible : si pas
  // de started_at (ancien ménage), on retombe sur created_at.
  const realisationH = cleaning.submitted_at
    ? durationHours(cleaning.started_at ?? cleaning.created_at, cleaning.submitted_at).toFixed(1)
    : null;

  // ─── Infos d'accès auto (chantier 2 marathon) — lecture seule terrain ────
  const accessPropertyId = scopeUnit?.property_id ?? cleaning.property_id ?? null;

  // ─── Chantier 12 : mutualisation des déplacements (symétrique) ───────────
  // Tâches/interventions OUVERTES sur le même lot (+ celles posées sur le
  // bien entier parent) → « à confier à l'équipe ménage ? ». Tout dérivé.
  const openTaskFilters: string[] = [];
  if (cleaning.propria_unit_id) {
    openTaskFilters.push(`propria_unit_id.eq.${cleaning.propria_unit_id}`);
    if (scopeUnit?.property_id) {
      openTaskFilters.push(`and(property_id.eq.${scopeUnit.property_id},propria_unit_id.is.null)`);
    }
  } else if (cleaning.property_id) {
    openTaskFilters.push(`property_id.eq.${cleaning.property_id}`);
    const siblingUnitIds = (units as any[])
      .filter((u) => u.property_id === cleaning.property_id)
      .map((u) => u.id);
    if (siblingUnitIds.length) {
      openTaskFilters.push(`propria_unit_id.in.(${siblingUnitIds.join(',')})`);
    }
  }

  const [accessPropRes, accessUnitRes, openTasksRes] = await Promise.all([
    accessPropertyId
      ? supabase.from('properties').select(`
          name, address, floor, google_maps_url, propria_google_maps_url,
          propria_building_access_type, propria_elevator_code, propria_badge_building,
          propria_key_box_building, propria_key_box_home,
          propria_guardian_name, propria_guardian_phone, propria_parking_info,
          propria_arrival_instructions, propria_arrival_video_url,
          propria_wifi_ssid, propria_wifi_password
        `).eq('id', accessPropertyId).maybeSingle()
      : Promise.resolve({ data: null }),
    cleaning.propria_unit_id
      ? supabase.from('propria_units').select(`
          code, propria_apartment_door, propria_lock_code,
          propria_key_box_suite, propria_key_box_location,
          propria_arrival_instructions, propria_wifi_ssid, propria_wifi_password,
          propria_security_key_location
        `).eq('id', cleaning.propria_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    openTaskFilters.length
      ? supabase.from('propria_interventions')
          .select('id, description, kind, status, due_date, urgency')
          .or(openTaskFilters.join(','))
          .in('status', OPEN_TASK_STATUSES)
          .is('deleted_at', null)
          .order('due_date', { ascending: true, nullsFirst: false })
          .limit(20)
      : Promise.resolve({ data: null }),
  ]);

  const openTasks = ((openTasksRes.data ?? []) as any[]) as OpenTaskRef[];

  // Sépare les preuves selon leur section pour afficher dans les bons blocs
  const generalProofs = proofs.filter((p: any) => (p.section ?? 'general') === 'general');
  const incidents = (incidentsRes.data ?? []) as CleaningIncident[];
  // Compteur d'incidents ouverts (warn à la validation)
  const openIncidentsCount = incidents.filter(
    (i) => i.status === 'reported' || i.status === 'acknowledged'
  ).length;

  return (
    <div className="max-w-5xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/menage" className="hover:text-stoniz-black">Ménage</Link>
        {' · '}
        Détail
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 sm:gap-6 mb-6">
        <div className="flex-1 min-w-0">
          <div className="text-xs text-purple-700 mb-1">🧹 {typeName}</div>
          <h1 className="text-2xl font-display">{cleaning.description ?? '(sans description)'}</h1>
          <div className="text-sm text-stoniz-gray-600 mt-1">
            {scopeLabel}{cleaning.due_date && ` · échéance ${new Date(cleaning.due_date).toLocaleDateString('fr-FR')}`}
          </div>
          {/* Spec de la suite : nb chambres / SDB / voyageurs (info contexte ménage) */}
          {(suiteSpec.nbChambres || suiteSpec.nbSdb || suiteSpec.capacity) && (
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-stoniz-gray-600">
              {suiteSpec.nbChambres ? <span>🛏 {suiteSpec.nbChambres} chambre{suiteSpec.nbChambres > 1 ? 's' : ''}</span> : null}
              {suiteSpec.nbSdb ? <span>🚿 {suiteSpec.nbSdb} SDB</span> : null}
              {suiteSpec.capacity ? <span>👥 {suiteSpec.capacity} voyageurs max</span> : null}
              {suiteSpec.typeLits ? <span className="text-stoniz-gray-500">· {suiteSpec.typeLits}</span> : null}
            </div>
          )}
        </div>
        <div className="flex flex-col items-stretch sm:items-end gap-2">
          <span className="text-xs uppercase tracking-wider text-stoniz-gray-500 sm:text-right">{meta.icon} {meta.label}</span>
          <CleaningWorkflowActions
            id={params.id}
            status={cleaning.status}
            hasProof={hasProof}
            canValidate={canValidate}
            isBackOffice={isBackOffice}
            openIncidentsCount={openIncidentsCount}
            checklistMissingCount={checklistMissingCount}
          />
        </div>
      </div>

      {/* Infos d'accès auto — chantier 2 marathon */}
      {accessPropRes.data && (
        <PropriaAccessInfoCard
          property={accessPropRes.data as any}
          unit={accessUnitRes.data as any}
          showWifi={false}
        />
      )}

      {/* Chantier 12 — mutualisation : tâches ouvertes sur le même logement */}
      <OpenTasksForCleaningCard tasks={openTasks} />

      {/* Stepper */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-5">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded-full ${
                i === currentIdx ? 'bg-stoniz-black text-white' :
                i < currentIdx ? 'bg-emerald-100 text-emerald-700' : 'bg-stoniz-gray-100 text-stoniz-gray-500'
              }`}>
                {i < currentIdx ? '✓' : ''} {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-stoniz-gray-300">→</span>}
            </div>
          ))}
          {cleaning.status === 'refusee' && (
            <span className="ml-2 text-red-700 italic">↩ Refusé{cleaning.refusal_reason ? ` : ${cleaning.refusal_reason}` : ''}</span>
          )}
        </div>
      </div>

      {/* Infos clés horodatées */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Assignée à</div>
          <div className="text-sm font-medium">{assignedName ?? <span className="text-orange-600">Non assigné</span>}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Suivi par</div>
          <div className="text-sm font-medium">{responsableName ?? '—'}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Démarrage (clic)</div>
          <div className="text-sm font-medium">{formatDateTime(cleaning.started_at)}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Fin terrain</div>
          <div className="text-sm font-medium">{formatDateTime(cleaning.submitted_at)}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-3">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Durée</div>
          <div className="text-sm font-medium">{realisationH ? `${realisationH} h` : '—'}</div>
        </div>
      </div>

      {/* Checklist photo/vidéo organisée par section */}
      <div className="mb-5">
        <CleaningChecklistGrid
          cleaningId={params.id}
          proofs={proofs}
          uploaderNames={uploaderNames}
          nbChambres={suiteSpec.nbChambres}
          nbSdb={suiteSpec.nbSdb}
          canUpload={true}
          canDelete={isBackOffice}
        />
      </div>

      {/* Section Incidents : signaler canapé sale, télé cassée, etc. */}
      <div className="mb-5">
        <CleaningIncidentsPanel
          cleaningId={params.id}
          incidents={incidents}
          proofs={proofs}
          uploaderNames={uploaderNames}
          canReport={true}
          canManage={isBackOffice}
        />
      </div>

      {/* Preuves libres (hors checklist / hors incident) */}
      <div className="mb-5">
        <CleaningProofUploader
          cleaningId={params.id}
          proofs={generalProofs}
          uploaderNames={uploaderNames}
          canUpload={true}
          canDelete={isBackOffice}
          section="general"
          title={`📷 Autres photos / vidéos (${generalProofs.length})`}
        />
      </div>

      {/* Formulaire d'édition — ouvert à tout staff (historique tracé) */}
      <h2 className="font-display text-lg mb-3">Détails</h2>
      <CleaningForm
        initial={{
          ...cleaning,
          occurred_at: cleaning.occurred_at?.slice(0, 10),
          due_date: cleaning.due_date ?? '',
          scope: scopeValue(cleaning),
        }}
        scopeGroups={scopeGroups}
        types={(typesRes.data ?? []).map((t: any) => ({ id: t.id, label: t.name }))}
        profiles={(profRes.data ?? []).map((p: any) => ({ id: p.id, label: p.full_name }))}
        action={updateAction}
        submitLabel="Mettre à jour"
      />

      <div className="flex justify-end mt-3">
        <PropriaDeleteButton table="propria_cleanings" id={params.id} />
      </div>

      {/* Historique */}
      <CleaningActivityTimeline events={activityEvents} />
    </div>
  );
}
