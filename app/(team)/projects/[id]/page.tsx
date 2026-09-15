import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { Button } from '@/components/ui/button';
import { formatPhase, formatDate, formatPaymentType } from '@/lib/utils/format';
import { Timeline } from '@/components/projects/timeline';
import { AdvancePhaseButton } from '@/components/projects/advance-phase-button';
import { RevertPhaseButton } from '@/components/projects/revert-phase-button';
import { PhaseAdvanceWarnings, type PhaseWarning } from '@/components/projects/phase-advance-warnings';
import { ProjectClosedBanner } from '@/components/projects/project-closed-banner';
import { PropertyDataCompleteness } from '@/components/projects/property-data-completeness';
import { ProjectChefAssign } from '@/components/projects/project-chef-assign';
import { StonizFeesCard } from '@/components/projects/stoniz-fees-card';
import { ProjectDatesCard } from '@/components/projects/project-dates-card';
import { ContractsCard } from '@/components/projects/contracts-card';
import { ProjectSurveysPanel } from '@/components/projects/project-surveys-panel';
import { ClientMoodboardChoicesPanel } from '@/components/projects/client-moodboard-choices-panel';
import { MoodboardFinalCard } from '@/components/projects/moodboard-final-card';
import { RemoveProposalButton } from '@/components/proposals/remove-proposal-button';
import { PropertyOnBehalfBanner } from '@/components/proposals/property-on-behalf-banner';
import { RequiredDocsChecklist } from '@/components/documents/required-docs-checklist';
import { ProjectNotes } from '@/components/projects/project-notes';
import { BriefStatusCard } from '@/components/brief/brief-status-card';
import { ReceptionBanner } from '@/components/projects/reception-banner';
import { OverduePaymentsAlert } from '@/components/finance/overdue-payments-alert';
import { BackLink } from '@/components/ui/back-link';
import { listOverduePaymentsForProject } from '@/lib/finance/overdue-payments';
import { getSessionUser, requireRole } from '@/lib/auth/require';
import { BudgetVenduBanner } from '@/components/finance/budget-vendu-banner';
import { CommercialActivityPanel } from '@/components/projects/commercial-activity-panel';
import { LifecycleControls } from '@/components/projects/lifecycle-controls';
import { LifecycleTimeline } from '@/components/projects/lifecycle-timeline';
import { PropriaUnitsList } from '@/components/propria/propria-units-list';
import { PropriaAccessCard } from '@/components/propria/propria-access-card';
import { ProjectMetadataEditButton } from '@/components/projects/project-metadata-edit-button';
import { ProjectSuitesCard } from '@/components/projects/project-suites-card';
import { ServiceTypeBadge, type ServiceType } from '@/components/projects/service-type-badge';
import { ProjectDeleteButton } from './delete-button';

const NEXT_PHASE: Record<string, string | null> = {
  onboarding: 'sourcing',
  sourcing: 'design',
  design: 'travaux',
  travaux: 'livraison',
  livraison: 'mise_en_location',
  mise_en_location: 'termine',
  termine: null,
};

// CEO 2026-08-19 (session D) : retour d'étape — miroir exact de NEXT_PHASE.
const PREV_PHASE: Record<string, string | null> = {
  onboarding: null,
  sourcing: 'onboarding',
  design: 'sourcing',
  travaux: 'design',
  livraison: 'travaux',
  mise_en_location: 'livraison',
  termine: 'mise_en_location',
};

export default async function ProjectDetailPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','finance','marketing','assistante','achats']);
  const supabase = createClient();
  const { data: project } = await supabase.from('projects').select(`
      *,
      client:clients(*),
      property:properties(
        id, name, quartier, price, address, floor, superficie, nb_suites,
        propria_managed_at, propria_refused_at, propria_refused_reason,
        propria_apartment_door, propria_google_maps_url,
        propria_water_contract, propria_water_meter,
        propria_electricity_contract, propria_electricity_meter,
        propria_internet_contract, propria_internet_provider,
        propria_wifi_ssid, propria_wifi_password,
        propria_lock_code, propria_smart_lock, propria_access_admin
      ),
      chef:profiles!projects_assigned_chef_projet_fkey(full_name)
    `).eq('id', params.id).single();
  if (!project) notFound();

  // Activation Propria : 3 états mutuellement exclusifs
  //   - proposable : bien existe, phase éligible, ni activé ni refusé
  //   - alreadyPropria : géré par Propria
  //   - propriaRefused : mandat refusé explicitement
  const PROPRIA_ELIGIBLE_PHASES = ['travaux','livraison','mise_en_location','termine'];
  const propertyData = project.property as any;
  const alreadyPropria = propertyData && propertyData.propria_managed_at;
  const propriaRefused = propertyData && propertyData.propria_refused_at;
  const canActivatePropria =
    propertyData &&
    !alreadyPropria &&
    !propriaRefused &&
    PROPRIA_ELIGIBLE_PHASES.includes(project.current_phase);

  // Réception : disponible dès la phase Livraison (et au-delà)
  const RECEPTION_ELIGIBLE_PHASES = ['livraison','mise_en_location','termine'];
  const canShowReception = RECEPTION_ELIGIBLE_PHASES.includes(project.current_phase);

  // Charge VCT + actions correctives ouvertes pour l'encart sur la fiche projet
  const { data: vct } = canShowReception
    ? await supabase.from('project_vct')
        .select('id, status').eq('project_id', params.id).maybeSingle()
    : { data: null };
  const { data: openActions } = vct
    ? await supabase.from('project_vct_corrective_actions')
        .select('id, description, status, deadline, artisan_id, notified_at, intervention_id')
        .eq('project_id', params.id)
        .in('status', ['open','in_progress','resolved'])
        .order('deadline', { ascending: true, nullsFirst: false })
    : { data: null };
  const { data: pvSummary } = canShowReception
    ? await supabase.from('project_reception_pvs')
        .select('id, status, client_signed_at').eq('project_id', params.id).maybeSingle()
    : { data: null };

  const [phasesRes, tasksRes, paymentsRes, proposalsRes, documentsRes, notesRes, briefRes, me, propriaUnitsRes, chefsRes, visitsRes, offersRes] = await Promise.all([
    supabase.from('project_phases_history').select('*').eq('project_id', params.id).order('started_at'),
    supabase.from('tasks').select('id, title, status, phase, is_blocking, assigned_to, due_date, priority')
      .eq('project_id', params.id).order('phase').order('created_at'),
    supabase.from('payments').select('id, type, amount_expected, amount_paid, status, currency, due_date, label')
      .eq('project_id', params.id).is('deleted_at', null),
    supabase.from('property_proposals').select('id, sent_at, client_response, property:properties(name)')
      .eq('project_id', params.id).order('sent_at', { ascending: false }),
    supabase.from('documents').select('id, type, created_at, status')
      .eq('project_id', params.id).is('deleted_at', null),
    supabase.from('project_notes')
      .select('id, body, category, pinned, created_at, updated_at, author_id, author:profiles!project_notes_author_id_fkey(full_name, role)')
      .eq('project_id', params.id).is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('project_briefs')
      .select('id, status, sent_at, validated_at, rejected_at, rejection_reason')
      .eq('project_id', params.id).maybeSingle(),
    getSessionUser(),
    // Suites du bien : on les fetch TOUJOURS dès qu'un bien est lié (pas seulement
    // si Propria activé). Règle métier CEO : les suites existent dès la phase Design,
    // bien avant l'activation Propria.
    project.property_id
      ? supabase.from('propria_units').select(`
          id, order_index, code, is_active,
          propria_apartment_door, propria_capacity_voyageurs, propria_nb_chambres, propria_type_lits,
          propria_lock_code, propria_key_box_suite, propria_nb_keys,
          propria_wifi_ssid, propria_airbnb_url, propria_booking_url,
          propria_base_price_per_night, propria_drive_photos_url, propria_observations
        `).eq('property_id', project.property_id).is('deleted_at', null).order('order_index')
      : Promise.resolve({ data: [] }),
    // Liste des chef_projet actifs — pour le sélecteur d'assignation
    supabase.from('profiles')
      .select('id, full_name')
      .eq('role', 'chef_projet')
      .eq('is_active', true)
      .order('full_name'),
    // Activité commerciale : visites et offres pour ce projet
    supabase.from('property_visits')
      .select('id, visited_at, notes, visited_by_user:profiles!property_visits_visited_by_user_id_fkey(full_name)')
      .eq('project_id', params.id).is('deleted_at', null).order('visited_at', { ascending: false }),
    supabase.from('project_offers')
      .select('id, offer_date, offer_amount, status, counter_amount, notes')
      .eq('project_id', params.id).is('deleted_at', null).order('offer_date', { ascending: false }),
  ]);

  const nextPhase = NEXT_PHASE[project.current_phase];
  const openBlocking = (tasksRes.data ?? [])
    .filter((t: any) => t.phase === project.current_phase && t.is_blocking && t.status !== 'done').length;

  // Date de clôture (entrée en phase 'termine') — pour le bandeau de clôture
  const closedAt = project.current_phase === 'termine'
    ? (phasesRes.data ?? []).find((p: any) => p.phase === 'termine')?.started_at ?? null
    : null;

  // Soft blocks : warnings non bloquants à afficher avant le bouton "Avancer en phase X"
  let phaseWarnings: PhaseWarning[] = [];
  if (nextPhase) {
    const { data: warningsData } = await supabase
      .rpc('get_phase_advance_warnings', {
        p_project_id: params.id,
        p_target_phase: nextPhase,
      });
    phaseWarnings = (warningsData as PhaseWarning[]) ?? [];
  }

  // Paiements Stoniz en retard sur ce projet (recalcul à la volée)
  const overduePayments = await listOverduePaymentsForProject(params.id);

  return (
    <div className="space-y-6">
      <BudgetVenduBanner projectId={params.id} poles={['travaux', 'achats']} />
      {/* Bannière ambre : bien validé par CP au nom du client (CEO 2026-08-31) */}
      <PropertyOnBehalfBanner projectId={params.id} />
      <BackLink href="/projects" label="Retour aux projets" />
      <PageHeader
        title={project.client?.full_name ?? project.reference}
        description={
          <span className="flex items-center gap-2 text-sm">
            <span className="font-medium">{project.code ?? project.reference}</span>
            {project.code && (
              <span className="text-xs text-stoniz-gray-500 font-mono">{project.reference}</span>
            )}
          </span>
        }
        action={
          <div className="flex gap-2 items-center flex-wrap">
            <Link href={`/projects/${project.id}/dashboard`}>
              <Button size="sm" variant="primary">📊 Tableau de bord</Button>
            </Link>
            {/* Activation Propria : bouton header uniquement pour les phases AVANT termine.
                À termine, on remplace par un bandeau plus visible (voir plus bas). */}
            {canActivatePropria && project.current_phase !== 'termine' && (
              <Link href={`/propria/biens/activate?project_id=${project.id}`}>
                <Button size="sm" variant="secondary">🏠 Activer Propria</Button>
              </Link>
            )}
            {alreadyPropria && (project.property as any).id && (
              <Link href={`/propria/biens/${(project.property as any).id}`}>
                <Badge variant="success">✓ Géré par Propria</Badge>
              </Link>
            )}
            {propriaRefused && (
              <Badge variant="default" className="opacity-70">
                ✕ Mandat Propria refusé
              </Badge>
            )}
            <ServiceTypeBadge
              projectId={project.id}
              serviceType={((project as any).service_type ?? 'cle_en_main') as ServiceType}
              userRole={me?.role ?? ''}
            />
            <Badge variant={project.current_phase as any}>{formatPhase(project.current_phase)}</Badge>
            <LifecycleControls
              projectId={project.id}
              status={project.status}
              userRole={me?.role ?? ''}
              pauseReasonCode={(project as any).pause_reason_code_v}
              lostReasonCode={(project as any).lost_reason_code_v}
              expectedResumeAt={(project as any).expected_resume_at}
            />
            {me?.role === 'ceo' && ( /* QA-BUG-024 : suppression CEO-only */
              <ProjectDeleteButton
                projectId={project.id}
                projectLabel={project.client?.full_name ?? project.code ?? project.reference}
              />
            )}
          </div>
        }
      />

      {/* Encart actions VCT ouvertes — visibilité haute pour le chef projet */}
      {openActions && openActions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              🔧 Actions VCT — {openActions.length} ouverte(s)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-stoniz-gray-600 mb-3">
              Défauts identifiés lors de la VCT à corriger avant le PV de réception.
            </p>
            <ul className="space-y-1.5">
              {openActions.slice(0, 5).map((a: any) => (
                <li key={a.id} className="text-sm flex items-center justify-between border-b last:border-0 py-1.5">
                  <span className="truncate">{a.description}</span>
                  <span className="text-xs text-stoniz-gray-500 flex-shrink-0 ml-2">
                    {a.deadline && new Date(a.deadline).toLocaleDateString('fr-FR')}
                  </span>
                </li>
              ))}
              {openActions.length > 5 && (
                <li className="text-xs text-stoniz-gray-500 italic">
                  + {openActions.length - 5} autre(s) action(s)
                </li>
              )}
            </ul>
            <div className="mt-4">
              <Link href={`/projects/${project.id}/reception`}>
                <Button variant="secondary" size="sm">Voir toutes les actions VCT →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bandeau de clôture — visible quand le projet est en phase 'termine' */}
      {project.current_phase === 'termine' && (
        <ProjectClosedBanner variant="staff" closedAt={closedAt} />
      )}

      {/* Bandeau d'activation Propria — proposition automatique à la clôture.
          Hybride : auto-affichage + clic manuel pour activer OU refuser. */}
      {project.current_phase === 'termine' && canActivatePropria && (
        <div className="bg-stoniz-beige border-2 border-stoniz-black rounded-xl p-5">
          <div className="flex items-start gap-3 mb-3">
            <div className="text-2xl">🏠</div>
            <div className="flex-1">
              <h3 className="font-display text-lg text-stoniz-black mb-0.5">
                Activer la gestion Propria pour ce bien ?
              </h3>
              <p className="text-sm text-stoniz-gray-700">
                Le projet est clôturé. Tu peux maintenant transférer le bien à l'équipe Propria
                (gestion locative, conciergerie). 25+ infos sont déjà pré-remplies depuis le projet :
                propriétaire, codes accès, contrats utilités, etc.
              </p>
              <p className="text-xs text-stoniz-gray-600 mt-2">
                Si le client a choisi une autre conciergerie ou de louer en direct, marque le refus
                pour ne plus voir cette proposition.
              </p>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap mt-3">
            <Link href={`/propria/biens/activate?project_id=${project.id}`}>
              <Button variant="primary" size="sm">
                ✓ Activer la gestion Propria
              </Button>
            </Link>
            <form action={async () => {
              'use server';
              const { refusePropriaMandateAction } = await import('@/app/(team)/propria/biens/activate/actions');
              const fd = new FormData();
              fd.set('project_id', project.id);
              await refusePropriaMandateAction(fd);
            }}>
              <Button variant="secondary" size="sm" type="submit">
                ✕ Refuser le mandat
              </Button>
            </form>
          </div>
        </div>
      )}

      {/* Bandeau confirmant le refus du mandat — visible une fois refusé */}
      {project.current_phase === 'termine' && propriaRefused && (
        <div className="bg-stoniz-gray-50 border border-stoniz-gray-300 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="text-xl">✕</div>
            <div className="flex-1">
              <div className="font-medium text-stoniz-gray-800">Mandat Propria refusé</div>
              <div className="text-xs text-stoniz-gray-600 mt-0.5">
                Refusé le {new Date(propertyData.propria_refused_at).toLocaleDateString('fr-FR')}
                {propertyData.propria_refused_reason && ` · raison : ${propertyData.propria_refused_reason}`}
              </div>
            </div>
          </div>
        </div>
      )}

      {overduePayments.length > 0 && (
        <OverduePaymentsAlert payments={overduePayments} variant="project" />
      )}

      {/* Activité commerciale : visites, offres et compromis (uniquement si bien lié) */}
      {project.property_id && (
        <CommercialActivityPanel
          projectId={project.id}
          propertyId={project.property_id}
          visits={(visitsRes.data ?? []) as any}
          offers={(offersRes.data ?? []) as any}
          compromisDate={project.compromis_date ?? null}
        />
      )}

      <Card>
        <CardHeader><CardTitle>Avancement</CardTitle></CardHeader>
        <CardContent>
          <Timeline phases={phasesRes.data ?? []} currentPhase={project.current_phase} />
          {nextPhase && (
            <div className="mt-4 pt-4 border-t">
              {/* Soft blocks : alertes pré-transition (risque métier non couvert par hard blocks) */}
              <PhaseAdvanceWarnings
                warnings={phaseWarnings}
                targetPhaseLabel={formatPhase(nextPhase)}
              />

              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm">Phase suivante : <strong>{formatPhase(nextPhase)}</strong></div>
                  {openBlocking > 0 && (
                    <div className="text-xs text-red-600 mt-1">⚠ {openBlocking} tâche(s) bloquante(s) à compléter d'abord</div>
                  )}
                </div>
                <AdvancePhaseButton projectId={project.id} newPhase={nextPhase} disabled={openBlocking > 0} />
              </div>
            </div>
          )}

          {/* CEO 2026-08-19 (session D) : retour d'étape — corrige un passage
              accidentel. Discret, confirmation obligatoire, rien n'est supprimé,
              tracé dans l'historique des phases. Rôles : ceo + chef_projet. */}
          {PREV_PHASE[project.current_phase] && ['ceo', 'chef_projet'].includes(me?.role ?? '') && (
            <div className="mt-3 pt-3 border-t border-dashed">
              <RevertPhaseButton
                projectId={project.id}
                currentPhase={project.current_phase}
                previousPhase={PREV_PHASE[project.current_phase]!}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bandeau réception (VCT + PV) — au-dessus du cahier des charges, visible en phase Livraison/MEL/Terminé */}
      {canShowReception && (
        <ReceptionBanner
          projectId={project.id}
          vct={vct as any}
          pv={pvSummary as any}
          openActionsCount={openActions?.length ?? 0}
        />
      )}

      {/* Widget complétude des infos bien — visible dès qu'un bien est associé.
          Aligne le terrain sur la règle "collecter à la phase où la source est physique". */}
      {project.property && (
        <PropertyDataCompleteness
          property={project.property as any}
          currentPhase={project.current_phase}
        />
      )}

      <BriefStatusCard projectId={project.id} brief={(briefRes.data as any) ?? null} />

      {me && (
        <ProjectNotes
          projectId={project.id}
          notes={(notesRes.data ?? []) as any}
          currentUserId={me.id}
          currentUserRole={me.role}
        />
      )}

      {/* Accès Propria (wifi + code serrure principale) */}
      {alreadyPropria && (
        <PropriaAccessCard
          wifiSsid={(project.property as any)?.propria_wifi_ssid}
          wifiPassword={(project.property as any)?.propria_wifi_password}
          lockCode={(project.property as any)?.propria_lock_code}
        />
      )}

      {/* Lots Propria — visible si le bien est en gestion Propria */}
      {alreadyPropria && (propriaUnitsRes.data ?? []).length > 0 && (
        <PropriaUnitsList
          units={propriaUnitsRes.data as any}
          propertyId={project.property_id!}
          compact={true}
          maxRows={3}
        />
      )}

      {/* Timeline lifecycle (n'affiche rien si aucune transition n'a eu lieu) */}
      <LifecycleTimeline projectId={project.id} userRole={me?.role ?? ''} />


      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Propositions ({proposalsRes.data?.length ?? 0})</CardTitle>
            <Link href={`/projects/${project.id}/proposals`}><Button size="sm">Envoyer un bien</Button></Link>
          </div>
        </CardHeader>
        <CardContent>
          {(proposalsRes.data ?? []).length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucune proposition envoyée</p>
          ) : (
            <ul className="divide-y text-sm">
              {(proposalsRes.data ?? []).slice(0, 5).map((p: any) => (
                <li key={p.id} className="py-2 flex items-center justify-between gap-3">
                  <span className="flex-1 min-w-0 truncate">{p.property?.name}</span>
                  <span className="flex gap-3 items-center text-xs text-stoniz-gray-500 flex-shrink-0">
                    {formatDate(p.sent_at)}
                    <Badge>{p.client_response}</Badge>
                    {p.client_response === 'pending' && (
                      <RemoveProposalButton
                        proposalId={p.id}
                        projectId={project.id}
                        propertyName={p.property?.name ?? 'ce bien'}
                      />
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Bien & client</CardTitle>
              <ProjectMetadataEditButton
                projectId={project.id}
                propertyId={project.property_id}
                initialPrice={project.property?.price}
                initialCompromis={project.compromis_date}
                initialActe={project.acte_authentique_date}
                initialTravauxStart={project.travaux_start_date}
                initialTravauxEnd={project.travaux_end_date}
                initialLivraison={project.livraison_date}
                userRole={me?.role ?? ''}
              />
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Client" value={<Link href={`/clients/${project.client_id}`} className="underline">{project.client?.full_name}</Link>} />
              <Row label="Chef de projet" value={
                <ProjectChefAssign
                  projectId={project.id}
                  currentChefId={(project as any).assigned_chef_projet ?? null}
                  currentChefName={(project as any).chef?.full_name ?? null}
                  chefs={(chefsRes?.data ?? []) as any}
                  canEdit={me?.role === 'ceo' || me?.role === 'commercial'}
                />
              } />
              <Row label="Bien" value={project.property
                ? <Link href={`/properties/${project.property_id}`} className="underline">{project.property.name}</Link>
                : '—'} />
              <Row label="Prix bien" value={project.property?.price ? <Money amount={project.property.price} /> : '—'} />
              <Row label="Date compromis" value={formatDate(project.compromis_date)} />
              <Row label="Date acte authentique" value={formatDate(project.acte_authentique_date)} />
              <Row label="Date livraison" value={formatDate(project.livraison_date)} />
            </dl>
          </CardContent>
        </Card>

        {/* Carte "Offre client" retirée : redondante avec le panneau Activité commerciale
            (bloc en haut de page). Une seule source de vérité = table project_offers. */}

        <StonizFeesCard
          payments={(paymentsRes.data ?? []).filter((p: any) => p.type !== 'autre')}
          reduction={Number(project.stoniz_reduction ?? 0)}
          projectId={project.id}
          userRole={me?.role ?? ''}
        />
      </div>

      {/* Carte "Suites du bien" — accessible dès la phase Design,
          indépendamment de l'activation Propria (règle CEO 2026-05-30) */}
      {project.property_id && (
        <ProjectSuitesCard
          projectId={project.id}
          nbSuitesPrevues={Number(propertyData?.nb_suites ?? 0)}
          units={(propriaUnitsRes.data ?? []) as any}
          userRole={me?.role ?? ''}
          clientFullName={(project.client as any)?.full_name ?? ''}
        />
      )}

      <div className="flex gap-2 flex-wrap">
        <Link href={`/projects/${project.id}/moodboard`}>
          <Button variant="secondary">🎨 Moodboard 3D</Button>
        </Link>
        <Link href={`/projects/${project.id}/travaux`}>
          <Button variant="secondary">🔨 Suivi travaux & lots</Button>
        </Link>
        <Link href={`/projects/${project.id}/achats`}>
          <Button variant="secondary">🛒 Suivi achats</Button>
        </Link>
        <Link href={`/projects/${project.id}/services`}>
          <Button variant="secondary">📐 Suivi services (architecte, géomètre…)</Button>
        </Link>
        <Link href={`/projects/${project.id}/payments`}>
          <Button variant="secondary">💶 Paiements Stoniz</Button>
        </Link>
        {(me?.role === 'ceo' || me?.role === 'finance' || me?.role === 'chef_projet' || me?.role === 'developer') && (
          <Link href={`/projects/${project.id}/pl`}>
            <Button variant="secondary">📊 P&L projet</Button>
          </Link>
        )}
        <Link href={`/projects/${project.id}/documents`}>
          <Button variant="secondary">📄 Documents</Button>
        </Link>
        <Link href={`/projects/${project.id}/photos`}>
          <Button variant="secondary">📷 Photos</Button>
        </Link>
        <Link href={`/projects/${project.id}/proposals`}>
          <Button variant="secondary">🏠 Propositions</Button>
        </Link>
      </div>

      <ProjectDatesCard
        projectId={project.id}
        currentPhase={project.current_phase}
        dates={{
          onboarding_date: project.onboarding_date,
          compromis_date: project.compromis_date,
          acte_authentique_date: project.acte_authentique_date,
          travaux_start_date: project.travaux_start_date,
          travaux_end_date: project.travaux_end_date,
          livraison_date: project.livraison_date,
        }}
      />

      <ContractsCard
        projectId={project.id}
        waterContractNumber={
          (project as any).property?.propria_water_contract
          ?? project.water_contract_number
        }
        electricityContractNumber={
          (project as any).property?.propria_electricity_contract
          ?? project.electricity_contract_number
        }
        internetContractNumber={
          (project as any).property?.propria_internet_contract
          ?? project.internet_contract_number
        }
        wifiSsid={(project as any).property?.propria_wifi_ssid ?? null}
        wifiPassword={(project as any).property?.propria_wifi_password ?? null}
        lockCode={(project as any).property?.propria_lock_code ?? null}
        smartLock={(project as any).property?.propria_smart_lock ?? null}
        currentPhase={project.current_phase}
      />

      {/* CEO 2026-08-19 (session D) : choix FINAL retenu — toujours visible,
          distinct des préférences client juste en dessous. */}
      <MoodboardFinalCard projectId={project.id} />
      <ClientMoodboardChoicesPanel projectId={project.id} />

      <ProjectSurveysPanel projectId={project.id} />

      <div className="grid md:grid-cols-2 gap-6">
        {(() => {
          // Tâches OUVERTES uniquement (non terminées), priorité phase en cours
          const openTasks = (tasksRes.data ?? [])
            .filter((t: any) => t.status !== 'done')
            .sort((a: any, b: any) => {
              // Phase en cours d'abord, puis les autres
              const aCurrent = a.phase === project.current_phase ? 0 : 1;
              const bCurrent = b.phase === project.current_phase ? 0 : 1;
              if (aCurrent !== bCurrent) return aCurrent - bCurrent;
              return 0;
            });
          return (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Tâches à faire ({openTasks.length})</CardTitle>
                  <Link href={`/projects/${project.id}/tasks`}><Button variant="ghost" size="sm">Voir tout</Button></Link>
                </div>
              </CardHeader>
              <CardContent>
                {openTasks.length === 0 ? (
                  <p className="text-sm text-stoniz-gray-500">Aucune tâche en attente 🎉</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {openTasks.slice(0, 6).map((t: any) => (
                      <li key={t.id} className="flex items-center justify-between border-b pb-1 last:border-0 gap-2">
                        <span className="truncate">{t.title}</span>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {t.phase === project.current_phase && t.is_blocking && (
                            <Badge variant="warning">bloquant</Badge>
                          )}
                          {t.phase !== project.current_phase && (
                            <Badge>{formatPhase(t.phase)}</Badge>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Paiements</CardTitle>
              <Link href={`/projects/${project.id}/payments`}><Button variant="ghost" size="sm">Voir tout</Button></Link>
            </div>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {(paymentsRes.data ?? []).map((p: any) => (
                <li key={p.id} className="flex items-center justify-between border-b pb-1 last:border-0">
                  <span>{formatPaymentType(p.type)}</span>
                  <span className="flex items-center gap-2">
                    <Money amount={p.amount_paid} /> / <Money amount={p.amount_expected} />
                    <Badge>{p.status}</Badge>
                  </span>
                </li>
              ))}
              {(paymentsRes.data ?? []).length === 0 && <li className="text-stoniz-gray-500">Aucun paiement</li>}
            </ul>
          </CardContent>
        </Card>
      </div>

      <RequiredDocsChecklist
        projectId={project.id}
        docs={documentsRes.data ?? []}
        showStoniz={true}
        showClient={true}
        uploadHint={{
          href: `/projects/${project.id}/documents`,
          label: 'Voir tous les documents du projet',
        }}
      />

    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value ?? '—'}</dd>
    </div>
  );
}
