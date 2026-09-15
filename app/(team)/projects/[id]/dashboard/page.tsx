import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { Button } from '@/components/ui/button';
import { formatPhase, formatDate, formatPaymentType } from '@/lib/utils/format';
import {
  AlertTriangle, CheckCircle2, Calendar, TrendingUp, Users, Building2,
  FileText, Send, Star, Wallet, Hammer,
} from 'lucide-react';
import { OverduePaymentsAlert } from '@/components/finance/overdue-payments-alert';
import { listOverduePaymentsForProject } from '@/lib/finance/overdue-payments';

const PHASE_ORDER = ['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'];

function daysBetween(a: string | Date, b: string | Date = new Date()) {
  const da = new Date(a).getTime();
  const db = new Date(b).getTime();
  return Math.round((db - da) / 86_400_000);
}

function fmtMad(n: any) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' MAD';
}

export default async function ProjectDashboardPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','sourcing','commercial','finance','marketing','assistante','achats']);
  const supabase = createClient();

  const { data: project } = await supabase.from('projects').select(`
      *,
      client:clients(full_name, email, phone, available_savings),
      property:properties(id, name, quartier, price, agency_fees, notary_fees, travaux_budget_estimate, estimated_rent),
      chef:profiles!projects_assigned_chef_projet_fkey(full_name)
    `).eq('id', params.id).single();
  if (!project) notFound();

  const [
    phasesRes, tasksRes, paymentsRes, proposalsRes, lotsRes,
    travauxPaymentsRes, encaissementsRes, docsRes, surveysRes, notesRes,
  ] = await Promise.all([
    supabase.from('project_phases_history').select('*').eq('project_id', params.id).order('started_at'),
    supabase.from('tasks').select('id, title, status, phase, is_blocking, due_date, priority')
      .eq('project_id', params.id),
    supabase.from('payments').select('id, type, amount_expected, amount_paid, status, due_date')
      .eq('project_id', params.id).is('deleted_at', null),
    supabase.from('property_proposals')
      .select('id, sent_at, client_response, selection_batch_id, selection_order')
      .eq('project_id', params.id),
    supabase.from('travaux_lots').select('id, status, devis_artisan_mad, facture_client_mad')
      .eq('project_id', params.id).is('deleted_at', null),
    supabase.from('travaux_payments').select('amount_paid, currency, status')
      .eq('project_id', params.id).is('deleted_at', null),
    supabase.from('travaux_encaissements').select('amount_mad').eq('project_id', params.id).eq('status', 'recu').is('deleted_at', null),
    supabase.from('documents').select('type, status').eq('project_id', params.id).is('deleted_at', null),
    supabase.from('satisfaction_surveys')
      .select('id, trigger_phase, completed_at, global_score, nps_score, comment')
      .eq('project_id', params.id),
    supabase.from('project_notes').select('id, body, category, created_at, author:profiles!project_notes_author_id_fkey(full_name)')
      .eq('project_id', params.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(8),
  ]);

  // ─── Métriques calculées ──────────────────────────────────────────────────

  const phases = (phasesRes.data ?? []) as any[];
  const currentPhaseRow = phases.find((p: any) => p.phase === project.current_phase && !p.completed_at);
  const daysInPhase = currentPhaseRow ? daysBetween(currentPhaseRow.started_at) : 0;
  const currentPhaseIdx = PHASE_ORDER.indexOf(project.current_phase);
  const progressionPct = Math.round((currentPhaseIdx / (PHASE_ORDER.length - 1)) * 100);

  const tasks = (tasksRes.data ?? []) as any[];
  const blockingOpen = tasks.filter(t => t.is_blocking && t.status !== 'done').length;
  const blockingInCurrentPhase = tasks.filter(t => t.phase === project.current_phase && t.is_blocking && t.status !== 'done').length;
  const tasksOpenTotal = tasks.filter(t => t.status !== 'done').length;

  const payments = (paymentsRes.data ?? []) as any[];
  const honosPaid = payments.reduce((s, p) => s + Number(p.amount_paid ?? 0), 0);
  const honosExpected = payments.reduce((s, p) => s + Number(p.amount_expected ?? 0), 0);
  const honosPending = honosExpected - honosPaid;
  // Paiements en retard calculés à la volée (date < today AND amount_paid < amount_expected)
  const overduePayments = await listOverduePaymentsForProject(params.id);
  const overdue = overduePayments.length;
  const nextPayment = payments
    .filter(p => p.status !== 'paid' && p.due_date)
    .sort((a, b) => new Date(a.due_date).getTime() - new Date(b.due_date).getTime())[0];

  const lots = (lotsRes.data ?? []) as any[];
  const lotsClos = lots.filter(l => l.status === 'termine').length;
  const lotsTotal = lots.length;
  const totalDevisMad = lots.reduce((s, l) => s + Number(l.devis_artisan_mad ?? 0), 0);
  const totalFactureMad = lots.reduce((s, l) => s + Number(l.facture_client_mad ?? 0), 0);
  const margeMad = totalFactureMad - totalDevisMad;
  const margePct = totalFactureMad > 0 ? (margeMad / totalFactureMad) * 100 : 0;

  const tpays = (travauxPaymentsRes.data ?? []) as any[];
  const artisansPaidMad = tpays
    .filter(p => p.status === 'paid' && p.currency === 'MAD')
    .reduce((s, p) => s + Number(p.amount_paid ?? 0), 0);
  const encaissements = (encaissementsRes.data ?? []) as any[];
  const encaisseClientMad = encaissements.reduce((s, e) => s + Number(e.amount_mad ?? 0), 0);

  const proposals = (proposalsRes.data ?? []) as any[];
  const batches = new Set(proposals.filter(p => p.selection_batch_id).map(p => p.selection_batch_id));
  const nbSelections = batches.size > 0 ? batches.size : (proposals.length > 0 ? 1 : 0);
  const nbBiensProposes = proposals.length;
  const nbBiensAcceptes = proposals.filter(p => p.client_response === 'accepted').length;
  const nbBiensRefuses = proposals.filter(p => p.client_response === 'refused').length;
  const nbBiensPending = proposals.filter(p => p.client_response === 'pending').length;

  const surveys = (surveysRes.data ?? []) as any[];
  const completedSurveys = surveys.filter(s => s.completed_at);
  const avgSatisfaction = completedSurveys.length > 0
    ? completedSurveys.reduce((s, x) => s + (Number(x.global_score) || 0), 0) / completedSurveys.length
    : null;
  const latestNps = completedSurveys.find(s => s.nps_score != null)?.nps_score ?? null;

  const docs = (docsRes.data ?? []) as any[];
  const docsManquants = docs.filter(d => d.status !== 'received' && d.status !== 'validated').length;

  // Délai livraison
  const livraisonDate = project.travaux_end_date as string | null;
  let livraisonStatus: { label: string; delay: number | null; cls: string } = {
    label: 'Non planifiée', delay: null, cls: 'text-grey-text',
  };
  if (livraisonDate) {
    const delay = daysBetween(new Date(), livraisonDate);
    if (delay >= 0) {
      livraisonStatus = { label: `Dans ${delay}j`, delay, cls: 'text-stoniz-black' };
    } else {
      livraisonStatus = { label: `Retard ${Math.abs(delay)}j`, delay, cls: 'text-red-700' };
    }
  }

  return (
    <div className="space-y-6 max-w-7xl">
      {/* En-tête + retour */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <Link href={`/projects/${project.id}`} className="text-xs text-grey-text hover:text-stoniz-black">
            ← Retour au projet {project.reference}
          </Link>
          <h1 className="font-display text-4xl mt-2">Tableau de <mark>bord</mark></h1>
          <p className="text-sm text-grey-text mt-1">
            {project.client?.full_name} · {(project as any).chef?.full_name ?? 'Pas de chef assigné'}
          </p>
        </div>
        <div className="flex gap-2 items-start">
          <Badge variant={project.current_phase as any}>{formatPhase(project.current_phase)}</Badge>
          <Badge variant={project.status === 'actif' ? 'success' : 'default'}>{project.status}</Badge>
        </div>
      </div>

      {/* ─── KPI CARDS ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        <Kpi
          icon={<Calendar className="w-4 h-4" />}
          label="Phase en cours"
          value={formatPhase(project.current_phase)}
          sub={`J+${daysInPhase} dans la phase`}
        />
        <Kpi
          icon={<TrendingUp className="w-4 h-4" />}
          label="Avancement global"
          value={`${progressionPct}%`}
          sub={`${currentPhaseIdx + 1}/${PHASE_ORDER.length} phases`}
        >
          <div className="mt-2 h-1.5 bg-cream-soft rounded-full overflow-hidden">
            <div className="h-full bg-stoniz-black" style={{ width: `${progressionPct}%` }} />
          </div>
        </Kpi>
        <Kpi
          icon={<Wallet className="w-4 h-4" />}
          label="Honoraires Stoniz"
          value={`${honosPaid.toLocaleString('fr-FR')} €`}
          sub={`/ ${honosExpected.toLocaleString('fr-FR')} € attendus`}
          accent={overdue > 0 ? 'red' : undefined}
        />
        <Kpi
          icon={<Hammer className="w-4 h-4" />}
          label="Marge travaux"
          value={fmtMad(margeMad)}
          sub={totalFactureMad > 0 ? `${margePct.toFixed(1)}% sur ${fmtMad(totalFactureMad)} facturés` : 'Pas encore de facturation'}
          accent={margeMad >= 0 ? 'green' : 'red'}
        />
        <Kpi
          icon={<Calendar className="w-4 h-4" />}
          label="Délai livraison"
          value={livraisonStatus.label}
          sub={livraisonDate ? formatDate(livraisonDate) : 'Date non fixée'}
          accent={livraisonStatus.delay != null && livraisonStatus.delay < 0 ? 'red' : undefined}
        />
        <Kpi
          icon={<Star className="w-4 h-4" />}
          label="Satisfaction"
          value={avgSatisfaction ? `${avgSatisfaction.toFixed(1)}/5` : '—'}
          sub={completedSurveys.length > 0
            ? `${completedSurveys.length} enquête${completedSurveys.length > 1 ? 's' : ''} complétée${completedSurveys.length > 1 ? 's' : ''}`
            : 'Pas encore d\'enquête'}
        />
        <Kpi
          icon={<Send className="w-4 h-4" />}
          label="Sélections envoyées"
          value={nbSelections}
          sub={nbSelections === 0 ? 'Aucune' : `${nbBiensProposes} bien${nbBiensProposes > 1 ? 's' : ''} proposé${nbBiensProposes > 1 ? 's' : ''}`}
        />
        <Kpi
          icon={<Building2 className="w-4 h-4" />}
          label="Réponses client"
          value={`${nbBiensAcceptes} accepté${nbBiensAcceptes > 1 ? 's' : ''}`}
          sub={`${nbBiensRefuses} refusé${nbBiensRefuses > 1 ? 's' : ''} · ${nbBiensPending} en attente`}
        />
      </div>

      {/* ─── ALERTES PAIEMENTS EN RETARD (détaillé) ─────────────────────── */}
      {overduePayments.length > 0 && (
        <OverduePaymentsAlert payments={overduePayments} variant="project" />
      )}

      {/* ─── ALERTES & BLOCAGES ─────────────────────────────────────────── */}
      <AlertsBlock
        blockingInCurrentPhase={blockingInCurrentPhase}
        overdue={overdue}
        docsManquants={docsManquants}
        livraisonDelay={livraisonStatus.delay}
        nextPayment={nextPayment}
      />

      {/* ─── BLOC FINANCES ─────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Honoraires Stoniz</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2">
              {(['acompte_stoniz','honoraires_compromis','honoraires_3d','honoraires_chantier','honoraires_livraison'] as const).map(type => {
                const p = payments.find(x => x.type === type);
                return (
                  <li key={type} className="flex justify-between border-b border-grey-line/50 pb-1.5 last:border-0">
                    <span className="text-grey-text">{formatPaymentType(type)}</span>
                    {p ? (
                      <span className="flex gap-2 items-center">
                        <Money amount={p.amount_paid} /> / <Money amount={p.amount_expected} />
                        <Badge variant={
                          p.status === 'paid' ? 'success' :
                          p.status === 'overdue' ? 'error' :
                          p.status === 'partial' ? 'warning' : 'default'
                        }>{p.status}</Badge>
                      </span>
                    ) : (
                      <span className="text-grey-text/60 text-xs">À venir</span>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 pt-3 border-t border-grey-line flex justify-between text-sm">
              <span className="font-medium">Reste à encaisser</span>
              <span className="font-semibold">{honosPending.toLocaleString('fr-FR')} €</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Travaux (MAD)</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2">
              <Row label="Budget travaux estimé" value={fmtMad(project.travaux_budget_mad)} />
              <Row label="Devis artisans signés" value={fmtMad(totalDevisMad)} />
              <Row label="Facturé au client" value={fmtMad(totalFactureMad)} />
              <Row label="Versé aux artisans" value={fmtMad(artisansPaidMad)} />
              <Row label="Encaissé du client" value={fmtMad(encaisseClientMad)} />
              <li className="flex justify-between pt-2 mt-2 border-t border-grey-line">
                <span className="font-medium">Marge brute</span>
                <span className={`font-semibold ${margeMad >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {fmtMad(margeMad)} {totalFactureMad > 0 && `(${margePct.toFixed(1)}%)`}
                </span>
              </li>
              {lotsTotal > 0 && (
                <li className="flex justify-between pt-1 text-xs text-grey-text">
                  <span>Lots clôturés</span>
                  <span>{lotsClos}/{lotsTotal}</span>
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      {/* ─── BIEN & CLIENT ─────────────────────────────────────────────── */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>Bien & client</CardTitle></CardHeader>
          <CardContent>
            <ul className="text-sm space-y-2">
              <Row label="Client" value={
                <Link href={`/clients/${project.client_id}`} className="underline underline-offset-2 font-medium">
                  {project.client?.full_name}
                </Link>
              } />
              <Row label="Email" value={project.client?.email ?? '—'} />
              <Row label="Téléphone" value={project.client?.phone ?? '—'} />
              <Row label="Chef de projet" value={(project as any).chef?.full_name ?? '—'} />
              <Row label="Bien" value={project.property
                ? <Link href={`/properties/${project.property_id}`} className="underline underline-offset-2 font-medium">{project.property.name}</Link>
                : '—'} />
              <Row label="Prix bien" value={project.property?.price ? <Money amount={project.property.price} /> : '—'} />
              <Row label="Date compromis" value={project.compromis_date ? formatDate(project.compromis_date) : '—'} />
              <Row label="Date livraison prévue" value={livraisonDate ? formatDate(livraisonDate) : '—'} />
            </ul>
          </CardContent>
        </Card>

        {/* Activité récente */}
        <Card>
          <CardHeader><CardTitle>Activité récente</CardTitle></CardHeader>
          <CardContent>
            {(notesRes.data ?? []).length === 0 ? (
              <p className="text-sm text-grey-text">Aucune note pour l'instant.</p>
            ) : (
              <ul className="space-y-3">
                {(notesRes.data ?? []).map((n: any) => (
                  <li key={n.id} className="border-l-2 border-stoniz-black/30 pl-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-grey-text">
                        {(n.author as any)?.full_name ?? 'Système'} · {formatDate(n.created_at)}
                      </span>
                      {n.category && <Badge variant="default">{n.category}</Badge>}
                    </div>
                    <p className="mt-1 line-clamp-2">{n.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ─── ENQUÊTES (si complétées) ──────────────────────────────────── */}
      {completedSurveys.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Satisfaction client</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {completedSurveys.map((s: any) => (
                <li key={s.id} className="flex items-center justify-between text-sm border-b border-grey-line/50 pb-2 last:border-0">
                  <div>
                    <div className="font-medium">Phase {formatPhase(s.trigger_phase)}</div>
                    {s.comment && <p className="text-xs italic text-grey-text mt-0.5">« {s.comment.substring(0, 100)}{s.comment.length > 100 ? '…' : ''} »</p>}
                  </div>
                  <div className="text-right">
                    <div className="text-amber-500 font-semibold">{'★'.repeat(s.global_score)}<span className="text-grey-line">{'★'.repeat(5 - s.global_score)}</span></div>
                    {s.nps_score != null && <div className="text-xs text-grey-text">NPS: {s.nps_score}/10</div>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="pt-4">
        <Link href={`/projects/${project.id}`}>
          <Button variant="secondary">← Retour à la fiche projet complète</Button>
        </Link>
      </div>
    </div>
  );
}

function Kpi({
  icon, label, value, sub, accent, children,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'green' | 'red';
  children?: React.ReactNode;
}) {
  const accentCls = accent === 'green'
    ? 'text-emerald-700'
    : accent === 'red'
      ? 'text-red-700'
      : 'text-stoniz-black';
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-2">
        <span className="text-grey-text">{icon}</span>
      </div>
      <div className={`text-2xl font-display ${accentCls}`}>{value}</div>
      <div className="text-xs text-grey-text mt-1 leading-tight">{label}</div>
      {sub && <div className="text-[11px] text-grey-text/70 mt-1.5">{sub}</div>}
      {children}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <li className="flex justify-between border-b border-grey-line/50 pb-1.5 last:border-0">
      <span className="text-grey-text">{label}</span>
      <span className="font-medium text-right">{value}</span>
    </li>
  );
}

function AlertsBlock({
  blockingInCurrentPhase, overdue, docsManquants, livraisonDelay, nextPayment,
}: {
  blockingInCurrentPhase: number;
  overdue: number;
  docsManquants: number;
  livraisonDelay: number | null;
  nextPayment: any;
}) {
  const alerts: { msg: React.ReactNode; type: 'red' | 'orange' }[] = [];
  if (blockingInCurrentPhase > 0) {
    alerts.push({ type: 'red', msg: <><strong>{blockingInCurrentPhase}</strong> tâche{blockingInCurrentPhase > 1 ? 's' : ''} bloquante{blockingInCurrentPhase > 1 ? 's' : ''} sur la phase en cours</> });
  }
  if (overdue > 0) {
    alerts.push({ type: 'red', msg: <><strong>{overdue}</strong> paiement{overdue > 1 ? 's' : ''} en retard</> });
  }
  if (docsManquants > 0) {
    alerts.push({ type: 'orange', msg: <><strong>{docsManquants}</strong> document{docsManquants > 1 ? 's' : ''} manquant{docsManquants > 1 ? 's' : ''}</> });
  }
  if (livraisonDelay != null && livraisonDelay < 0) {
    alerts.push({ type: 'red', msg: <>Livraison en retard de <strong>{Math.abs(livraisonDelay)}j</strong></> });
  }
  if (nextPayment && nextPayment.due_date) {
    const dueIn = daysBetween(new Date(), nextPayment.due_date);
    if (dueIn >= 0 && dueIn <= 7) {
      alerts.push({ type: 'orange', msg: <>Échéance <strong>{formatPaymentType(nextPayment.type)}</strong> dans {dueIn}j ({nextPayment.amount_expected} €)</> });
    }
  }

  if (alerts.length === 0) {
    return (
      <Card className="bg-emerald-50 border-emerald-200">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-700" />
          <p className="text-sm text-emerald-900 font-medium">Tout est sous contrôle — aucune alerte sur ce projet.</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="bg-red-50/40 border-red-200">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-red-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h3 className="font-display text-base mb-2">Alertes &amp; blocages ({alerts.length})</h3>
          <ul className="space-y-1.5 text-sm">
            {alerts.map((a, i) => (
              <li key={i} className={`flex items-start gap-2 ${a.type === 'red' ? 'text-red-900' : 'text-amber-900'}`}>
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                <span>{a.msg}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
