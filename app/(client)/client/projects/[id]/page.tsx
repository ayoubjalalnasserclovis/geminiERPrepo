import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { Timeline } from '@/components/projects/timeline';
import { DocumentValidationCard } from '@/components/documents/document-validation-card';
import { PhaseGuideModal } from '@/components/phase-guides/phase-guide-modal';
import { DesignMilestoneBanner } from '@/components/design/design-milestone-banner';
import { ActeAuthentiqueBanner } from '@/components/design/acte-authentique-banner';
import { FinalPropertyBanner } from '@/components/sourcing/final-property-banner';
import { PvPendingAlert } from '@/components/client/pv-pending-alert';
import { getPendingPvForProject } from '@/lib/reception/get-pending-pvs-for-client';
import { ProjectClosedBanner } from '@/components/projects/project-closed-banner';
import { formatPhase, formatPaymentType, formatDate } from '@/lib/utils/format';
import { STONIZ_FEES_TOTAL, STONIZ_FEE_SCHEDULE, standardAmountForType } from '@/lib/finance/stoniz-fees';
import { aggregatePaymentSummary } from '@/lib/finance/project-payment-summary-pure';
import { calculateKPIs } from '@/lib/finance/property-calc';

const GUIDED_PHASES = new Set(['sourcing', 'design', 'travaux', 'mise_en_location']);

export default async function ClientProjectPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: project } = await supabase.from('projects')
    .select(`*,
      property:properties(name, quartier, price, agency_fees, notary_fees, travaux_budget_estimate, estimated_rent, revenu_locatif_brut_annuel, taux_occupation),
      client:clients(available_savings)
    `)
    .eq('id', params.id).single();
  if (!project) notFound();

  // PV de réception en attente de signature (alerte persistante)
  const pendingPv = await getPendingPvForProject(params.id);

  const [phasesRes, allProposalsRes, paymentsRes, docsToValidateRes, pendingSurveyRes, briefRes, phaseAckRes] = await Promise.all([
    supabase.from('project_phases_history').select('*').eq('project_id', params.id).order('started_at'),
    supabase.from('property_proposals')
      .select('id, sent_at, selection_batch_id, selection_order, team_note, client_response, client_response_at, property:properties(id, name, quartier, price)')
      .eq('project_id', params.id)
      .order('sent_at', { ascending: false })
      .order('selection_order', { ascending: true }),
    supabase.from('payments').select('id, type, amount_expected, amount_paid, status, due_date')
      .eq('project_id', params.id).is('deleted_at', null),
    supabase.from('documents')
      .select('id, name, type, storage_path, created_at, client_validation_status, client_validation_at, client_validation_comment')
      .eq('project_id', params.id)
      .eq('requires_client_validation', true)
      .eq('is_visible_to_client', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('satisfaction_surveys')
      .select('id, trigger_phase, sent_at')
      .eq('project_id', params.id)
      .is('completed_at', null)
      .order('sent_at')
      .limit(1)
      .maybeSingle(),
    supabase.from('project_briefs').select('id, status, sent_at')
      .eq('project_id', params.id).maybeSingle(),
    supabase.from('phase_acknowledgments').select('phase')
      .eq('project_id', params.id)
      .eq('phase', project.current_phase)
      .maybeSingle(),
  ]);

  // ─── Jalons design validés : pour les bandeaux félicitations ─────────────
  // On affiche un bandeau par doc jalon validé (plans 3D, lots techniques, shopping list, devis travaux)
  // pendant toute la phase Design. Disparaît dès le passage à la phase suivante.
  const designMilestones: ('plans_3d' | 'lots_techniques' | 'shopping_list' | 'devis_travaux')[] = [];
  if (project.current_phase === 'design') {
    const { data: validatedMilestones } = await supabase.from('documents')
      .select('type, client_validation_at')
      .eq('project_id', params.id)
      .eq('client_validation_status', 'validated')
      .in('type', ['plans_3d', 'lots_techniques', 'shopping_list', 'devis_travaux'])
      .is('deleted_at', null)
      .order('client_validation_at', { ascending: false });

    // On garde la première occurrence de chaque type (la plus récente)
    const seen = new Set<string>();
    for (const d of (validatedMilestones ?? [])) {
      if (!seen.has(d.type)) {
        seen.add(d.type);
        designMilestones.push(d.type as any);
      }
    }
  }

  // Gate guide de phase : si current_phase a un guide et qu'il n'est pas encore acquitté
  const needsPhaseGuide =
    GUIDED_PHASES.has(project.current_phase) && !phaseAckRes.data;

  const pendingBrief = briefRes.data?.status === 'sent_to_client' ? briefRes.data : null;

  const pendingSurvey = pendingSurveyRes.data;

  // Gate moodboard : phase Design + sélection non complétée
  const needsMoodboardSelection = project.current_phase === 'design' && !project.moodboard_selection_completed_at;

  // Génère les URLs signées pour les docs à valider (batch)
  // On utilise l'admin client : les policies RLS sur storage.objects bloquent
  // souvent les rôles 'client' pour createSignedUrls — le contrôle d'accès
  // est déjà fait au-dessus via le SELECT RLS sur documents.
  const docsToValidate = docsToValidateRes.data ?? [];
  let docsWithUrls: any[] = [];
  if (docsToValidate.length > 0) {
    const paths = docsToValidate.map(d => d.storage_path);
    const storageAdmin = createAdminClient();
    const { data: signed } = await storageAdmin.storage.from('documents').createSignedUrls(paths, 3600);
    const urlByPath = new Map<string, string>();
    (signed ?? []).forEach(s => { if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl); });
    docsWithUrls = docsToValidate.map(d => ({ ...d, signedUrl: urlByPath.get(d.storage_path) ?? null }));
  }
  const pendingDocs = docsWithUrls.filter(d => (d.client_validation_status ?? 'pending') === 'pending');

  const allProposals = (allProposalsRes.data ?? []) as any[];
  const pendingCount = allProposals.filter(p => p.client_response === 'pending').length;

  // Regroupe par batch_id pour afficher l'historique des sélections
  type Selection = {
    batch_id: string | null;
    sent_at: string;
    team_note: string | null;
    proposals: any[];
  };
  const selectionsByBatch = new Map<string, Selection>();
  for (const p of allProposals) {
    const key = p.selection_batch_id ?? `orphan-${p.id}`;
    if (!selectionsByBatch.has(key)) {
      selectionsByBatch.set(key, {
        batch_id: p.selection_batch_id,
        sent_at: p.sent_at,
        team_note: p.team_note,
        proposals: [],
      });
    }
    selectionsByBatch.get(key)!.proposals.push(p);
  }
  const selections = Array.from(selectionsByBatch.values())
    .sort((a, b) => new Date(b.sent_at).getTime() - new Date(a.sent_at).getTime());

  // ─── Gate guide de phase : pop-up bloquant à chaque transition de phase ──
  // Affiché AVANT tout autre gate pour que le client lise d'abord le guide.
  if (needsPhaseGuide) {
    return (
      <>
        <div className="max-w-2xl mx-auto space-y-6 opacity-30 pointer-events-none select-none">
          <div>
            <p className="eyebrow mb-2">Votre espace</p>
            <h1 className="font-display text-4xl">Votre <mark>projet</mark></h1>
          </div>
          <Card>
            <CardContent>
              <p className="text-sm text-grey-text">Lisez le guide ci-dessus pour accéder à votre projet…</p>
            </CardContent>
          </Card>
        </div>
        <PhaseGuideModal
          projectId={params.id}
          phase={project.current_phase as 'sourcing' | 'design' | 'travaux' | 'mise_en_location'}
        />
      </>
    );
  }

  // ─── Gate moodboard : bloque dès l'entrée en phase Design ────────────────
  if (needsMoodboardSelection) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <p className="eyebrow mb-2">Votre espace</p>
          <h1 className="font-display text-4xl">Votre <mark>projet</mark></h1>
        </div>
        <Card className="border-stoniz-black border-2 bg-yellow/15">
          <CardHeader>
            <CardTitle className="text-xl">🎨 Bienvenue en phase Design</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-stoniz-black leading-relaxed">
              Avant que notre architecte puisse commencer à concevoir votre bien, nous avons besoin
              de connaître vos préférences esthétiques.
            </p>
            <p className="text-sm text-grey-text">
              Sélectionnez <strong>1 ou 2 moodboards</strong> (univers de référence) parmi nos
              propositions et laissez-nous un commentaire. Cela ne prendra que quelques minutes.
            </p>
            <div className="pt-4">
              <Link href={`/client/projects/${params.id}/moodboard-selection`}>
                <Button variant="accent" size="lg">Choisir mes moodboards →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Gate cahier des charges : bloque tant que le client n'a pas validé ──
  if (pendingBrief) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <p className="eyebrow mb-2">Votre espace</p>
          <h1 className="font-display text-4xl">Votre <mark>projet</mark></h1>
        </div>
        <Card className="border-stoniz-black border-2 bg-yellow/15">
          <CardHeader>
            <CardTitle className="text-xl">📋 Votre cahier des charges vous attend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-stoniz-black leading-relaxed">
              Votre conseiller Stoniz a préparé le cahier des charges de votre projet d'investissement
              (critères de recherche du bien, budget, stratégie locative…).
            </p>
            <p className="text-sm text-grey-text">
              Validez-le pour démarrer la recherche du bien. Vous pourrez aussi demander des modifications.
            </p>
            <div className="pt-4">
              <Link href={`/client/projects/${params.id}/brief`}>
                <Button variant="accent" size="lg">Voir et valider le cahier des charges →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Gate enquête : bloque l'accès au contenu si enquête en attente ──
  if (pendingSurvey) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <p className="eyebrow mb-2">Votre espace</p>
          <h1 className="font-display text-4xl">Votre <mark>projet</mark></h1>
        </div>
        <Card className="border-stoniz-black border-2 bg-yellow/15">
          <CardHeader>
            <CardTitle className="text-xl">📝 Une enquête de satisfaction vous attend</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-stoniz-black leading-relaxed">
              Avant de poursuivre votre projet, nous aimerions avoir votre retour sur la phase{' '}
              <strong>{formatPhase(pendingSurvey.trigger_phase)}</strong>.
            </p>
            <p className="text-sm text-grey-text">
              Cela ne prend que 2 minutes. Votre avis nous aide à améliorer notre accompagnement
              pour les phases suivantes.
            </p>
            <div className="pt-4">
              <Link href={`/client/surveys/${pendingSurvey.id}`}>
                <Button variant="accent" size="lg">Compléter l'enquête maintenant →</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl">Votre projet</h1>
      </div>

      {/* Bandeau clôture projet — top priorité visuelle quand current_phase = 'termine' */}
      {project.current_phase === 'termine' && (
        <ProjectClosedBanner
          variant="client"
          closedAt={(phasesRes.data ?? []).find((p: any) => p.phase === 'termine')?.started_at ?? null}
        />
      )}

      {/* Alerte persistante PV à signer — priorité absolue, juste après le titre */}
      {pendingPv && <PvPendingAlert pvs={[pendingPv]} variant="project" />}

      <Card>
        <CardHeader><CardTitle>Avancement</CardTitle></CardHeader>
        <CardContent>
          <Timeline phases={phasesRes.data ?? []} currentPhase={project.current_phase} hideDates />
          <p className="mt-4 text-sm text-stoniz-gray-500">
            Vous êtes actuellement en phase <strong className="text-stoniz-black">{formatPhase(project.current_phase)}</strong>.
          </p>
        </CardContent>
      </Card>

      {/* Section dédiée PV de réception (carte détaillée avec CTA prominent) */}
      {pendingPv && (
        <div>
          <h2 className="font-display text-2xl mb-3">📋 PV de réception</h2>
          <PvPendingAlert pvs={[pendingPv]} variant="detailed" />
        </div>
      )}

      {/* Documents à valider — priorité maximale, juste après l'avancement */}
      {pendingDocs.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl">
              Documents à valider ({pendingDocs.length})
            </h2>
          </div>
          <p className="text-sm text-stoniz-gray-500">
            Votre conseiller Stoniz attend votre retour sur les documents ci-dessous.
          </p>
          {pendingDocs.map(d => <DocumentValidationCard key={d.id} doc={d} />)}
        </div>
      )}

      {/* Bandeau bien trouvé — visible toute la phase Sourcing une fois le bien sélectionné */}
      {project.current_phase === 'sourcing' && project.property && (
        <FinalPropertyBanner
          propertyName={(project as any).property.name}
          propertyQuartier={(project as any).property.quartier ?? null}
        />
      )}

      {/* Bandeau acte authentique — visible toute la phase Design une fois la date renseignée */}
      {project.current_phase === 'design' && (project as any).acte_authentique_date && (
        <ActeAuthentiqueBanner signedAt={(project as any).acte_authentique_date} />
      )}

      {/* Bandeaux jalons design — visibles toute la phase Design une fois validés */}
      {designMilestones.map((m) => (
        <DesignMilestoneBanner key={m} milestone={m} />
      ))}

      {pendingCount > 0 && (
        <Card className="bg-yellow/15 border-stoniz-black border-2">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <h3 className="font-display text-lg">
                {pendingCount} proposition{pendingCount > 1 ? 's' : ''} en attente de votre réponse
              </h3>
              <p className="text-sm text-grey-text mt-1">Consultez les biens proposés et indiquez votre intérêt.</p>
            </div>
            <Link href={`/client/projects/${project.id}/proposals`}>
              <Button variant="accent">Voir les propositions →</Button>
            </Link>
          </div>
        </Card>
      )}

      {selections.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Historique de vos sélections</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {selections.map((sel, idx) => {
                const dateStr = new Date(sel.sent_at).toLocaleDateString('fr-FR', {
                  day: 'numeric', month: 'long', year: 'numeric',
                });
                return (
                  <details
                    key={sel.batch_id ?? `sel-${idx}`}
                    open={idx === 0}
                    className="border border-grey-line rounded-md"
                  >
                    <summary className="cursor-pointer px-4 py-3 hover:bg-cream-soft flex items-center justify-between flex-wrap gap-2">
                      <div>
                        <span className="font-semibold text-sm">
                          Sélection du {dateStr}
                        </span>
                        <span className="ml-2 text-xs text-grey-text">
                          ({sel.proposals.length} bien{sel.proposals.length > 1 ? 's' : ''})
                        </span>
                      </div>
                      <SelectionStatusSummary proposals={sel.proposals} />
                    </summary>
                    <div className="px-4 pb-4 pt-2 border-t border-grey-line space-y-3">
                      {sel.team_note && (
                        <div className="bg-yellow/15 rounded-sm p-3 border-l-2 border-stoniz-black">
                          <p className="eyebrow text-[10px] mb-1">Le mot de votre conseiller</p>
                          <p className="italic text-sm whitespace-pre-line">{sel.team_note}</p>
                        </div>
                      )}
                      <ul className="space-y-2">
                        {sel.proposals.map((p: any) => (
                          <li key={p.id} className="flex items-center justify-between gap-3 py-2 border-b border-grey-line/50 last:border-0">
                            <div className="flex items-center gap-3 min-w-0">
                              {p.selection_order && (
                                <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                  p.selection_order === 1 ? 'bg-stoniz-black text-cream' : 'bg-cream-soft text-stoniz-black'
                                }`}>
                                  {p.selection_order}
                                </span>
                              )}
                              <div className="min-w-0">
                                <div className="font-medium text-sm truncate">{p.property?.name}</div>
                                <div className="text-xs text-grey-text">{p.property?.quartier ?? '—'}</div>
                              </div>
                            </div>
                            <ProposalResponseBadge response={p.client_response} />
                          </li>
                        ))}
                      </ul>
                      <div className="pt-2">
                        <Link href={`/client/projects/${project.id}/proposals`} className="text-sm text-stoniz-black underline underline-offset-4 hover:text-stoniz-black/70">
                          Voir les fiches détaillées →
                        </Link>
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Mon bien</CardTitle></CardHeader>
          <CardContent>
            {project.property ? (() => {
              const kpis = calculateKPIs(project.property);
              const availableSavings = Number((project as any).client?.available_savings ?? 0);
              const epargneADecaisser = Math.max(kpis.cout_total_projet - availableSavings, 0);
              return (
                <div className="space-y-3">
                  <div>
                    <p className="font-medium">{project.property.name}</p>
                    <p className="text-sm text-stoniz-gray-500">{project.property.quartier}</p>
                  </div>
                  <dl className="space-y-1.5 text-sm pt-3 border-t">
                    <Row label="Prix d'achat" value={<Money amount={project.property.price} />} />
                    <Row label="Frais de notaire" value={<Money amount={kpis.frais_notaire} />} />
                    <Row label="Travaux estimés" value={<Money amount={kpis.travaux} />} />
                    <Row label="Frais d'agence" value={<Money amount={kpis.frais_agence} />} />
                    <Row label="Frais Stoniz" value={<Money amount={STONIZ_FEES_TOTAL} />} />
                    <div className="pt-2 mt-2 border-t font-medium flex justify-between">
                      <span>Coût total du projet</span>
                      <Money amount={kpis.cout_total_projet} />
                    </div>
                  </dl>
                  <dl className="space-y-1.5 text-sm pt-3 border-t">
                    <Row label="Loyer brut annuel"
                      value={kpis.revenu_locatif_brut_annuel > 0
                        ? <Money amount={kpis.revenu_locatif_brut_annuel} /> : '—'} />
                    <Row label="Revenus nets estimés (annuels)"
                      value={kpis.revenu_locatif_net_annuel > 0
                        ? <Money amount={kpis.revenu_locatif_net_annuel} />
                        : <span className="text-stoniz-gray-400 text-xs">À définir</span>} />
                    {kpis.cashflow_mensuel > 0 && (
                      <Row label="Cashflow mensuel estimé" value={<Money amount={kpis.cashflow_mensuel} />} />
                    )}
                  </dl>
                  <dl className="space-y-1.5 text-sm pt-3 border-t">
                    <Row label="Votre épargne disponible"
                      value={availableSavings > 0
                        ? <Money amount={availableSavings} />
                        : <span className="text-stoniz-gray-400 text-xs">Non renseignée</span>} />
                    <div className="pt-2 mt-2 border-t font-medium flex justify-between bg-accent-light -mx-3 px-3 py-2 rounded-md">
                      <span>Épargne à décaisser</span>
                      <Money amount={epargneADecaisser} />
                    </div>
                  </dl>
                </div>
              );
            })() : (
              <p className="text-sm text-stoniz-gray-500">Aucun bien encore validé. Votre conseiller vous proposera bientôt des biens correspondant à vos critères.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Paiements Stoniz</CardTitle></CardHeader>
          <CardContent>
            {(() => {
              // Source unique : agrégation par SUM par type via le helper pur
              // (gère les doublons sans les cacher). Voir
              // lib/finance/project-payment-summary.ts pour le contexte.
              const summary = aggregatePaymentSummary(
                (paymentsRes.data ?? [])
                  .filter((p: any) => p.type !== 'autre')
                  .map((p: any) => ({
                    id: p.id,
                    type: p.type,
                    amount_expected: p.amount_expected,
                    amount_paid: p.amount_paid,
                    due_date: p.due_date,
                  })),
              );
              const byType = new Map(summary.byType.map(b => [b.type, b]));

              return (
                <ul className="text-sm space-y-2">
                  {STONIZ_FEE_SCHEDULE.map(m => {
                    const row = byType.get(m.type);
                    const exists = row && row.paymentIds.length > 0;
                    return (
                      <li key={m.type} className="flex justify-between border-b pb-1 last:border-0">
                        <span className="text-stoniz-gray-600">{formatPaymentType(m.type)}</span>
                        {exists && row ? (
                          <span className="flex gap-2 items-center">
                            <Money amount={row.paid} /> / <Money amount={row.expected} />
                            <Badge variant={
                              row.status === 'paid' ? 'success' :
                              row.status === 'overdue' ? 'error' :
                              row.status === 'partial' ? 'warning' : 'default'
                            }>{row.status}</Badge>
                          </span>
                        ) : (
                          <span className="flex gap-2 items-center text-stoniz-gray-400">
                            <Money amount={standardAmountForType(m.type)} />
                            <Badge>À venir</Badge>
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value}</dd>
    </div>
  );
}

function ProposalResponseBadge({ response }: { response: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:   { label: '⏳ En attente',   cls: 'bg-yellow text-stoniz-black' },
    accepted:  { label: '✓ Accepté',       cls: 'bg-emerald-100 text-emerald-900' },
    refused:   { label: '✕ Refusé',        cls: 'bg-stoniz-gray-200 text-stoniz-black' },
    more_info: { label: '? Plus d\'infos', cls: 'bg-blue-100 text-blue-900' },
  };
  const v = map[response] ?? { label: response, cls: 'bg-stoniz-gray-100 text-stoniz-black' };
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-1 rounded-full ${v.cls}`}>
      {v.label}
    </span>
  );
}

function SelectionStatusSummary({ proposals }: { proposals: any[] }) {
  const total = proposals.length;
  const accepted = proposals.filter(p => p.client_response === 'accepted').length;
  const refused = proposals.filter(p => p.client_response === 'refused').length;
  const pending = proposals.filter(p => p.client_response === 'pending').length;

  if (pending === total) {
    return <span className="text-xs text-grey-text">À examiner</span>;
  }
  if (accepted > 0) {
    return <span className="text-xs text-emerald-700">✓ {accepted} accepté{accepted > 1 ? 's' : ''}</span>;
  }
  if (refused === total) {
    return <span className="text-xs text-grey-text">Tous refusés</span>;
  }
  return <span className="text-xs text-grey-text">{accepted + refused}/{total} traités</span>;
}
