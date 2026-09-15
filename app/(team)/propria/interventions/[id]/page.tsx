import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { InterventionForm } from '@/components/propria/intervention-form';
import {
  InterventionProofUploader,
  type InterventionProof,
} from '@/components/propria/intervention-proof-uploader';
import { buildScopeGroups, scopeValue } from '@/lib/propria/intervention-scope';
import { getUpcomingResaOptions } from '@/lib/propria/reservations';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaAccessInfoCard } from '@/components/propria/propria-access-info-card';
import { InterventionWorkflowActions } from '@/components/propria/intervention-workflow-actions';
import { InterventionActivityTimeline, type ActivityEvent } from '@/components/propria/intervention-activity-timeline';
import {
  getUnitOperationalContext,
  aggregateUnitContexts,
  computeArrivalAlert,
  computeOccupancyBlock,
  computeCleaningMutualisation,
} from '@/lib/propria/unit-context';
import {
  UnitContextCard,
  ArrivalAlertBanner,
  OccupancyBlockBanner,
  CleaningMutualisationHint,
} from '@/components/propria/unit-context-card';
import {
  updateInterventionAction,
  getInterventionProofUrls,
} from '../actions';

const STATUS_META: Record<string, { label: string; icon: string }> = {
  a_traiter: { label: 'À faire', icon: '⏳' },
  en_cours: { label: 'En cours', icon: '🔄' },
  a_valider: { label: 'À valider', icon: '📋' },
  cloture: { label: 'Validée', icon: '✓' },
  refusee: { label: 'Refusée — à refaire', icon: '↩️' },
  annule: { label: 'Annulée', icon: '✕' },
};

const STEPS = [
  { key: 'a_traiter', label: 'À faire' },
  { key: 'en_cours', label: 'En cours' },
  { key: 'a_valider', label: 'À valider' },
  { key: 'cloture', label: 'Validée' },
] as const;

export default async function InterventionDetailPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const [intRes, propsRes, unitsRes, typesRes, provRes, profRes, walletsRes, balancesRes, linkedExpenseRes, activityRes, resaOptions] = await Promise.all([
    supabase.from('propria_interventions').select('*').eq('id', params.id).single(),
    supabase.from('properties').select('id, name, propria_internal_code')
      .not('propria_managed_at', 'is', null).is('deleted_at', null).order('propria_internal_code'),
    supabase.from('propria_units').select('id, code, order_index, property_id')
      .is('deleted_at', null).eq('is_active', true),
    supabase.from('propria_intervention_types').select('id, name, category')
      .eq('is_active', true).order('display_order'),
    supabase.from('propria_providers').select('id, name, function')
      .eq('is_active', true).is('deleted_at', null).order('name'),
    supabase.from('profiles').select('id, full_name, role').eq('is_active', true).neq('role', 'client').order('full_name'),
    supabase.from('propria_wallets')
      .select('id, label, profile_id, is_active, owner:profiles!propria_wallets_profile_id_fkey(full_name)')
      .eq('is_active', true).order('label'),
    supabase.from('propria_wallet_balances').select('wallet_id, solde_mad'),
    supabase.from('propria_wallet_expenses')
      .select('id, amount_mad, is_validated, wallet_id')
      .eq('linked_intervention_id', params.id).is('deleted_at', null).maybeSingle(),
    // Push B : historique d'activité (timeline en bas de la fiche)
    supabase.from('propria_intervention_activity')
      .select('id, intervention_id, actor_id, action, payload, created_at')
      .eq('intervention_id', params.id)
      .order('created_at', { ascending: false })
      .limit(200),
    // Chantier 14 : résas en cours/à venir pour le sélecteur « Réservation liée »
    getUpcomingResaOptions(),
  ]);

  if (!intRes.data) notFound();
  const intervention = intRes.data;

  const properties = propsRes.data ?? [];
  const units = unitsRes.data ?? [];
  const scopeGroups = buildScopeGroups(properties, units);
  const propsMap = new Map(properties.map((p: any) => [p.id, p.propria_internal_code ?? p.name]));
  const unitsMap = new Map(units.map((u: any) => [u.id, { label: u.code ?? `Suite ${u.order_index}`, property_id: u.property_id }]));

  let scopeLabel = '—';
  if (intervention.propria_unit_id) {
    const u = unitsMap.get(intervention.propria_unit_id);
    if (u) scopeLabel = `${propsMap.get(u.property_id) ?? 'Bien'} · ${u.label}`;
  } else if (intervention.property_id) {
    scopeLabel = `${propsMap.get(intervention.property_id) ?? 'Bien'} · Bien entier`;
  }

  // ─── Infos d'accès auto (chantier 2 marathon) — lecture seule terrain ────
  const accessUnitMeta = intervention.propria_unit_id
    ? (unitsMap.get(intervention.propria_unit_id) as any)
    : null;
  const accessPropertyId = accessUnitMeta?.property_id ?? intervention.property_id ?? null;

  // ─── Chantier 12 : contexte opérationnel dérivé (résas + ménages) ────────
  // Tâche sur un lot → ce lot ; tâche sur le bien entier → agrégation sur
  // tous les lots actifs du bien. Une seule passe groupée, pas de N+1.
  const contextUnitIds: string[] = intervention.propria_unit_id
    ? [intervention.propria_unit_id]
    : intervention.property_id
      ? units.filter((u: any) => u.property_id === intervention.property_id).map((u: any) => u.id)
      : [];

  const [accessPropRes, accessUnitRes, unitCtxMap] = await Promise.all([
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
    intervention.propria_unit_id
      ? supabase.from('propria_units').select(`
          code, propria_apartment_door, propria_lock_code,
          propria_key_box_suite, propria_key_box_location,
          propria_arrival_instructions, propria_wifi_ssid, propria_wifi_password,
          propria_security_key_location
        `).eq('id', intervention.propria_unit_id).maybeSingle()
      : Promise.resolve({ data: null }),
    getUnitOperationalContext(contextUnitIds, supabase),
  ]);

  // Contexte agrégé + alertes dérivées (rien n'est stocké, tout est recalculé)
  const unitCtx = aggregateUnitContexts(contextUnitIds.map((id) => unitCtxMap.get(id)));
  const dueDate = (intervention.due_date as string | null) ?? null;
  const arrivalAlert = computeArrivalAlert({ ctx: unitCtx, status: intervention.status, dueDate });
  const occupancyBlock = computeOccupancyBlock({ ctx: unitCtx, status: intervention.status, dueDate });
  const mutualisableCleaning = computeCleaningMutualisation({ ctx: unitCtx, status: intervention.status });

  const proofs = (await getInterventionProofUrls(params.id)) as InterventionProof[];
  const uploaderNames: Record<string, string> = Object.fromEntries(
    (profRes.data ?? []).map((p: any) => [p.id, p.full_name])
  );

  // Enrichit chaque événement de timeline avec le nom de l'acteur (depuis
  // le mapping uploaderNames déjà construit), pour éviter une 2e query.
  const activityEvents: ActivityEvent[] = ((activityRes.data ?? []) as any[]).map((e) => ({
    id: e.id,
    intervention_id: e.intervention_id,
    actor_id: e.actor_id,
    action: e.action,
    payload: e.payload,
    created_at: e.created_at,
    actor_name: e.actor_id ? (uploaderNames[e.actor_id] ?? null) : null,
  }));

  const isBackOffice = user.role !== 'propria';
  const isAssignee = intervention.assigned_to_id === user.id;
  const isCreator = (intervention as any).created_by === user.id;
  // L'équipe propria s'organise librement : n'importe qui pilote/soumet/dépose
  // preuve. Seul valider/refuser reste back-office.
  const canAct = true;
  const canUpload = true;
  const canValidate = isBackOffice;
  const hasProof = proofs.length > 0;

  // Caisses Propria + soldes pour le sélecteur "Payé depuis la caisse de"
  const balanceById = new Map<string, number>(
    ((balancesRes.data ?? []) as any[]).map((b: any) => [b.wallet_id, Number(b.solde_mad ?? 0)])
  );
  const linkedExpense = linkedExpenseRes.data as any;
  const expenseLockedWalletId = linkedExpense?.is_validated ? linkedExpense.wallet_id : null;
  const wallets = ((walletsRes.data ?? []) as any[]).map((w: any) => ({
    id: w.id,
    label: w.owner?.full_name ? `${w.owner.full_name} (${w.label ?? 'Caisse'})` : (w.label ?? 'Caisse'),
    balance_mad: balanceById.get(w.id) ?? 0,
    is_validated_lock: w.id === expenseLockedWalletId,
    profile_id: w.profile_id,
  }));

  const updateAction = updateInterventionAction.bind(null, params.id);
  const meta = STATUS_META[intervention.status] ?? { label: intervention.status, icon: '•' };
  const currentIdx = STEPS.findIndex(s => s.key === intervention.status);
  const assignedName = intervention.assigned_to_id ? uploaderNames[intervention.assigned_to_id] : null;

  return (
    <div className="max-w-3xl">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria/interventions" className="hover:text-stoniz-black">Interventions</Link>
          </div>
          <h1 className="text-3xl font-display">Tâche #{intervention.id.slice(0, 8)}</h1>
          <p className="text-sm font-medium text-stoniz-gray-800 mt-1">
            {scopeLabel}
            {/* Chantier 14 : code résa propagé, affiché dès qu'il existe */}
            {intervention.hostaway_ref && (
              <span className="ml-2 inline-flex items-center text-xs px-2 py-0.5 rounded-full bg-blue-50 border border-blue-200 text-blue-800 font-normal">
                🔖 Résa {intervention.hostaway_ref}
              </span>
            )}
          </p>
          <p className="text-sm text-stoniz-gray-600 mt-0.5">
            Créée le {new Date(intervention.created_at).toLocaleDateString('fr-FR')}
            {assignedName && <> · Assignée à <span className="font-medium">{assignedName}</span></>}
            {intervention.due_date && (
              <> · Échéance {new Date(intervention.due_date).toLocaleDateString('fr-FR')}</>
            )}
          </p>
          {/* Badge "Payé depuis la caisse de…" si débours cash lié */}
          {intervention.paid_from_wallet_id && Number(intervention.cost_propria_mad ?? 0) > 0 && (() => {
            const linkedWallet = wallets.find((w) => w.id === intervention.paid_from_wallet_id);
            return linkedWallet ? (
              <Link
                href="/propria/caisse"
                className={`mt-2 inline-flex items-center gap-2 text-xs px-2.5 py-1 rounded-full border ${
                  linkedExpense?.is_validated
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
                title="Voir la caisse"
              >
                💰 Payé depuis caisse {linkedWallet.label} ·{' '}
                <strong>
                  {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(
                    Number(intervention.cost_propria_mad)
                  )} DH
                </strong>
                {linkedExpense?.is_validated ? ' · ✓ Validé' : ' · ⏳ À valider'}
              </Link>
            ) : null;
          })()}
        </div>
        {isBackOffice && (
          <PropriaDeleteButton
            table="propria_interventions"
            id={params.id}
            redirectTo="/propria/interventions"
            iconOnly={false}
            className="inline-flex items-center gap-1 border border-red-200 text-red-600 px-3 py-1.5 rounded-md text-sm hover:bg-red-50"
          />
        )}
      </div>

      {/* Chantier 12 — alertes calendaires dérivées (résas Hostaway) */}
      {arrivalAlert && <ArrivalAlertBanner alert={arrivalAlert} />}
      {occupancyBlock && <OccupancyBlockBanner block={occupancyBlock} />}
      {mutualisableCleaning && <CleaningMutualisationHint cleaning={mutualisableCleaning} />}

      {/* Chantier 12 — contexte du logement (occupation / arrivée / sortie / ménage) */}
      {contextUnitIds.length > 0 && <UnitContextCard ctx={unitCtx} />}

      {/* Infos d'accès auto — chantier 2 marathon (WiFi visible : utile en intervention technique) */}
      {accessPropRes.data && (
        <PropriaAccessInfoCard
          property={accessPropRes.data as any}
          unit={accessUnitRes.data as any}
          showWifi={true}
        />
      )}

      {/* Motif de refus — rouge car perte réelle (travail à refaire) */}
      {intervention.status === 'refusee' && intervention.refusal_reason && (
        <div className="mb-5 bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="text-xs uppercase tracking-wider text-red-700 mb-1">Refusée — à refaire</div>
          <p className="text-sm text-red-900">{intervention.refusal_reason}</p>
        </div>
      )}

      {/* Statut + actions */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4 sm:p-5 mb-5">
        {/* Statut au-dessus, boutons pleine largeur en dessous sur mobile */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div>
            <div className="text-xs text-stoniz-gray-600 mb-1">Statut actuel</div>
            <div className="font-medium text-lg">{meta.icon} {meta.label}</div>
          </div>
          <InterventionWorkflowActions
            id={params.id}
            status={intervention.status}
            hasProof={hasProof}
            canValidate={canValidate}
            isBackOffice={isBackOffice}
            canAct={canAct}
          />
        </div>

        {/* Stepper */}
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {STEPS.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <span className={`w-6 h-6 rounded-full inline-flex items-center justify-center ${
                currentIdx >= 0 && i <= currentIdx ? 'bg-emerald-500 text-white' : 'bg-stoniz-gray-200 text-stoniz-gray-500'
              }`}>{i + 1}</span>
              <span className={currentIdx >= 0 && i <= currentIdx ? '' : 'text-stoniz-gray-500'}>{s.label}</span>
              {i < STEPS.length - 1 && <span className="w-8 h-px bg-stoniz-gray-300 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Preuves photo / vidéo */}
      <div className="mb-5">
        <InterventionProofUploader
          interventionId={params.id}
          proofs={proofs}
          uploaderNames={uploaderNames}
          canUpload={canUpload}
          canDelete={isBackOffice}
        />
      </div>

      {/* Détails — édition ouverte à tout staff Propria (CEO 2026-06-09).
          Chaque modification est consignée dans l'historique en bas de page,
          ce qui garantit la traçabilité même avec un workflow ouvert. */}
      <h2 className="font-display text-lg mb-3">Détails</h2>
      <InterventionForm
        initial={{
          ...intervention,
          occurred_at: intervention.occurred_at?.slice(0, 10),
          due_date: intervention.due_date ?? '',
          scope: scopeValue(intervention),
        }}
        scopeGroups={scopeGroups}
        types={(typesRes.data ?? []).map((t: any) => ({ id: t.id, label: `${t.name} (${t.category})` }))}
        providers={(provRes.data ?? []).map((p: any) => ({
          id: p.id, label: `${p.name}${p.function ? ' · ' + p.function : ''}`,
        }))}
        profiles={(profRes.data ?? []).map((p: any) => ({ id: p.id, label: p.full_name }))}
        wallets={wallets}
        reservations={resaOptions}
        action={updateAction}
        submitLabel="Mettre à jour"
      />

      {/* Historique d'activité — toujours visible, lecture pour tout staff */}
      <InterventionActivityTimeline events={activityEvents} />
    </div>
  );
}
