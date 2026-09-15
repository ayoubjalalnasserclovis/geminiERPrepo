import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { excludeLostByProject, isProjectLost } from '@/lib/projects/lost';
import { computeProjectCompleteness, type ProjectCompleteness } from '@/lib/completude/projets-completude';
import {
  ShieldAlert, CheckSquare, CalendarClock, Hammer, Euro, Wallet,
  MapPin, PhoneOff, ClipboardCheck, ChevronRight, Clock, RefreshCw,
  TrendingUp, TrendingDown, Minus,
} from 'lucide-react';
import { StonizDailyNotesCard, type StonizDailyNote } from '@/components/daily/stoniz-daily-notes-card';
import { DAILY_STONIZ_ROLES } from './roles';

export const dynamic = 'force-dynamic';

/**
 * Daily Stoniz (CEO 2026-07-06) — pendant clé-en-main du Daily Propria.
 *
 * Écran unique pour le point quotidien équipe. 8 zones, lues dans l'ordre
 * de la discussion : ce qui bloque → ce qui arrive → l'argent → ce qui dort.
 *
 * Cadrage CEO validé (2026-07-06) :
 *  - Accès : toute l'équipe interne, visibilité complète (écran partagé)
 *  - Seuils : blocage rouge > 3 j · lot sans avancement > 7 j ·
 *    proposition sans retour > 5 j · sourcing sans bien > 14 j ·
 *    client sans nouvelles > 10 j
 *  - « Dernier contact » client = email OU note projet OU tâche complétée
 *  - Semaine sourcing = lundi 00:00 → dimanche 23:59
 *
 * Règle permanente : exclusion projets perdus sur toutes les zones
 * (helper lib/projects/lost.ts).
 */

const THRESHOLDS = {
  blocageRougeJours: 3,
  lotStaleJours: 7,
  propositionSansRetourJours: 5,
  sourcingSansBienJours: 14,
  clientSansNouvellesJours: 10,
  /** Fenêtre de recherche du dernier contact (au-delà : « 60+ j ») */
  contactLookbackJours: 60,
} as const;

const DAY_MS = 86_400_000;

function fmtEur(n: number): string {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
}
function fmtMad(n: number): string {
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} MAD`;
}
function fmtDateFr(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' });
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

export default async function DailyStonizPage() {
  const user = await requireRole(DAILY_STONIZ_ROLES);
  const supabase = createClient();

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const in7dIso = new Date(now.getTime() + 7 * DAY_MS).toISOString().slice(0, 10);

  // Semaine sourcing : lundi 00:00 → dimanche 23:59 (cadrage CEO)
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const prevMonday = new Date(monday.getTime() - 7 * DAY_MS);
  const weekStartIso = monday.toISOString();
  const prevWeekStartIso = prevMonday.toISOString();

  const lookbackIso = new Date(now.getTime() - THRESHOLDS.contactLookbackJours * DAY_MS).toISOString();
  const propStaleIso = new Date(now.getTime() - THRESHOLDS.propositionSansRetourJours * DAY_MS).toISOString();
  const lotStaleIso = new Date(now.getTime() - THRESHOLDS.lotStaleJours * DAY_MS).toISOString();
  const sourcingStaleIso = new Date(now.getTime() - THRESHOLDS.sourcingSansBienJours * DAY_MS).toISOString();

  // ─── Pulls parallèles ────────────────────────────────────────────────
  const [
    approvalsRes,
    blockedTasksRes,
    dueTasksRes,
    projectsRes,
    visitesRes,
    lotsRes,
    travauxDueRes,
    achatsDueRes,
    honorairesOverdueRes,
    propsWeekRes,
    propsPrevWeekRes,
    partnersWeekRes,
    partnersPrevWeekRes,
    proposalsPendingRes,
    proposalsRecentRes,
    emailContactsRes,
    noteContactsRes,
    taskContactsRes,
    profilesRes,
    dailyNotesRes,
    completenessRows,
  ] = await Promise.all([
    // Zone 1a — validations paiement en attente (même filtre que /validations)
    supabase.from('payment_approvals')
      .select('id, amount, currency, beneficiary_name, description, urgency, requested_at, finance_status, ceo_status, project:projects(reference, code, status, deleted_at)')
      .eq('final_status', 'pending')
      .is('paid_at', null)
      .is('deleted_at', null)
      .order('requested_at', { ascending: true }),
    // Zone 1b — tâches bloquées
    supabase.from('tasks')
      .select('id, title, due_date, priority, assigned_to, updated_at, project:projects(reference, code, status, deleted_at)')
      .eq('status', 'blocked'),
    // Zone 2 — tâches en retard + du jour (non terminées, échéance ≤ aujourd'hui)
    supabase.from('tasks')
      .select('id, title, due_date, priority, assigned_to, project:projects(reference, code, status, deleted_at)')
      .in('status', ['todo', 'in_progress'])
      .lte('due_date', todayIso)
      .order('due_date', { ascending: true }),
    // Zones 3/4/6/7 — socle projets (hors perdus, hors préparation)
    supabase.from('projects')
      .select('id, reference, code, status, deleted_at, current_phase, is_preparation, legacy_imported, assigned_chef_projet, compromis_date, acte_authentique_date, travaux_start_date, travaux_end_date, livraison_date, client:clients(full_name)')
      .is('deleted_at', null)
      .neq('status', 'perdu')
      .eq('is_preparation', false),
    // Zone 3 — visites planifiées sur biens (J → J+7)
    supabase.from('properties')
      .select('id, name, first_visit_date')
      .gte('first_visit_date', todayIso)
      .lte('first_visit_date', in7dIso)
      .is('deleted_at', null),
    // Zone 4 — lots travaux actifs (pour stale > 7 j)
    supabase.from('travaux_lots')
      .select('id, project_id, status, updated_at, artisan_name, category')
      .in('status', ['demarre', 'en_cours', 'en_attente'])
      .is('deleted_at', null),
    // Zones 4/5 — paiements artisans dus (échéance ≤ J+7, retards inclus)
    supabase.from('travaux_payments')
      .select('id, project_id, artisan_name, amount_total, amount_paid, currency, scheduled_date')
      .neq('status', 'paid')
      .lte('scheduled_date', in7dIso)
      .is('deleted_at', null)
      .order('scheduled_date', { ascending: true }),
    supabase.from('achats_payments')
      .select('id, project_id, supplier_name, amount_total, amount_paid, currency, scheduled_date')
      .neq('status', 'paid')
      .lte('scheduled_date', in7dIso)
      .is('deleted_at', null)
      .order('scheduled_date', { ascending: true }),
    // Zone 5 — honoraires en retard d'encaissement (échéance passée, non soldée)
    supabase.from('payments')
      .select('id, project_id, type, label, amount_expected, amount_paid, due_date, project:projects(reference, code, status, deleted_at, client:clients(full_name))')
      .neq('status', 'paid')
      .lt('due_date', todayIso)
      .is('deleted_at', null)
      .order('due_date', { ascending: true }),
    // Zone 6 — momentum semaine (lundi → dimanche) vs semaine précédente
    supabase.from('properties').select('id', { count: 'exact', head: true })
      .gte('created_at', weekStartIso).is('deleted_at', null),
    supabase.from('properties').select('id', { count: 'exact', head: true })
      .gte('created_at', prevWeekStartIso).lt('created_at', weekStartIso).is('deleted_at', null),
    supabase.from('partners').select('id', { count: 'exact', head: true })
      .gte('created_at', weekStartIso).is('deleted_at', null),
    supabase.from('partners').select('id', { count: 'exact', head: true })
      .gte('created_at', prevWeekStartIso).lt('created_at', weekStartIso).is('deleted_at', null),
    // Zone 6 — propositions sans retour client > 5 j
    supabase.from('property_proposals')
      .select('id, project_id, sent_at, property:properties(name), project:projects(reference, code, status, deleted_at)')
      .eq('client_response', 'pending')
      .lt('sent_at', propStaleIso)
      .order('sent_at', { ascending: true }),
    // Zone 6 — propositions récentes (pour détecter le sourcing qui dort)
    supabase.from('property_proposals')
      .select('project_id, sent_at')
      .gte('sent_at', sourcingStaleIso),
    // Zone 7 — traces de contact client (email / note / tâche complétée)
    supabase.from('email_logs')
      .select('project_id, sent_at')
      .in('status', ['sent', 'delivered', 'opened'])
      .gte('sent_at', lookbackIso)
      .not('project_id', 'is', null),
    supabase.from('project_notes')
      .select('project_id, created_at')
      .gte('created_at', lookbackIso)
      .is('deleted_at', null),
    supabase.from('tasks')
      .select('project_id, completed_at')
      .gte('completed_at', lookbackIso)
      .not('project_id', 'is', null),
    supabase.from('profiles').select('id, full_name'),
    // Notes du daily
    supabase.from('stoniz_daily_notes')
      .select('id, content, created_at, created_by_id, resolved_at, resolved_by_id')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(100),
    // Zone 8 — complétude dossiers (même moteur que /admin/completude)
    computeProjectCompleteness(),
  ]);

  const profileMap = new Map<string, string>(
    ((profilesRes.data ?? []) as any[]).map((p) => [p.id, p.full_name])
  );
  const who = (id: string | null | undefined) => (id ? profileMap.get(id) ?? '—' : 'Non assigné');

  const projects = ((projectsRes.data ?? []) as any[]);
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const projLabel = (p: any) => `${p.code ?? p.reference}${p.client?.full_name ? ` · ${p.client.full_name}` : ''}`;

  // ─── Zone 1 : blocages & décisions ───────────────────────────────────
  const approvals = excludeLostByProject(
    (approvalsRes.data ?? []) as any[],
    (r) => r.project
  );
  const approvalsRed = approvals.filter((a) => daysSince(a.requested_at) > THRESHOLDS.blocageRougeJours);

  const blockedTasks = excludeLostByProject(
    (blockedTasksRes.data ?? []) as any[],
    (r) => r.project
  );
  const blockedRed = blockedTasks.filter((t) => daysSince(t.updated_at) > THRESHOLDS.blocageRougeJours);

  // ─── Zone 2 : tâches en retard + du jour ─────────────────────────────
  const dueTasks = excludeLostByProject((dueTasksRes.data ?? []) as any[], (r) => r.project);
  const overdueTasks = dueTasks.filter((t) => t.due_date < todayIso);
  const todayTasks = dueTasks.filter((t) => t.due_date === todayIso);
  const overdueByAssignee = new Map<string, number>();
  for (const t of overdueTasks) {
    const k = who(t.assigned_to);
    overdueByAssignee.set(k, (overdueByAssignee.get(k) ?? 0) + 1);
  }
  const overdueGroups = [...overdueByAssignee.entries()].sort((a, b) => b[1] - a[1]);

  // ─── Zone 3 : jalons J → J+7 ─────────────────────────────────────────
  type Jalon = { id: string; date: string; label: string; project: string; owner: string };
  const jalons: Jalon[] = [];
  const MILESTONE_FIELDS: Array<[string, string]> = [
    ['compromis_date', 'Signature compromis'],
    ['acte_authentique_date', 'Acte authentique'],
    ['travaux_start_date', 'Lancement chantier'],
    ['travaux_end_date', 'Fin chantier prévue'],
    ['livraison_date', 'Livraison'],
  ];
  for (const p of projects) {
    for (const [field, label] of MILESTONE_FIELDS) {
      const d = p[field];
      if (d && d >= todayIso && d <= in7dIso) {
        jalons.push({ id: `${p.id}-${field}`, date: d, label, project: projLabel(p), owner: who(p.assigned_chef_projet) });
      }
    }
  }
  for (const v of ((visitesRes.data ?? []) as any[])) {
    jalons.push({ id: `visite-${v.id}`, date: v.first_visit_date, label: 'Visite bien', project: v.name, owner: '—' });
  }
  jalons.sort((a, b) => a.date.localeCompare(b.date));

  // ─── Zone 4 : chantiers en cours ─────────────────────────────────────
  const chantierProjects = projects.filter((p) => p.current_phase === 'travaux' && p.status !== 'pause');
  const lots = ((lotsRes.data ?? []) as any[]).filter((l) => {
    const p = projectMap.get(l.project_id);
    return p ? !isProjectLost(p) : false;
  });
  const travauxDue = ((travauxDueRes.data ?? []) as any[]).filter((x) => {
    const p = projectMap.get(x.project_id);
    return p ? !isProjectLost(p) : false;
  });
  const achatsDue = ((achatsDueRes.data ?? []) as any[]).filter((x) => {
    const p = projectMap.get(x.project_id);
    return p ? !isProjectLost(p) : false;
  });
  const chantierItems = chantierProjects.map((p) => {
    const pLots = lots.filter((l) => l.project_id === p.id);
    const staleLots = pLots.filter((l) => l.updated_at < lotStaleIso);
    const dueMad = travauxDue
      .filter((x) => x.project_id === p.id && x.currency === 'MAD')
      .reduce((s, x) => s + (Number(x.amount_total) - Number(x.amount_paid)), 0);
    return {
      id: p.id,
      label: projLabel(p),
      lotsActifs: pLots.length,
      lotsStale: staleLots.length,
      dueMad,
      owner: who(p.assigned_chef_projet),
    };
  }).sort((a, b) => b.lotsStale - a.lotsStale || b.dueMad - a.dueMad);

  // ─── Zone 5 : encaissements & paiements ──────────────────────────────
  const honorairesOverdue = excludeLostByProject(
    (honorairesOverdueRes.data ?? []) as any[],
    (r) => r.project
  );
  // Canon : reste_a_encaisser = facture (attendu) − encaissé, jamais stocké
  const totalAEncaisser = honorairesOverdue
    .reduce((s, p) => s + (Number(p.amount_expected) - Number(p.amount_paid)), 0);

  const allDuePayments = [
    ...travauxDue.map((x) => ({ ...x, beneficiary: x.artisan_name })),
    ...achatsDue.map((x) => ({ ...x, beneficiary: x.supplier_name })),
  ].sort((a, b) => String(a.scheduled_date).localeCompare(String(b.scheduled_date)));
  const totalAPayerMad = allDuePayments
    .filter((x) => x.currency === 'MAD')
    .reduce((s, x) => s + (Number(x.amount_total) - Number(x.amount_paid)), 0);
  const totalAPayerEur = allDuePayments
    .filter((x) => x.currency === 'EUR')
    .reduce((s, x) => s + (Number(x.amount_total) - Number(x.amount_paid)), 0);

  // ─── Zone 6 : sourcing — momentum semaine + souffrance ──────────────
  const biensSemaine = propsWeekRes.count ?? 0;
  const biensSemainePrec = propsPrevWeekRes.count ?? 0;
  const partenairesSemaine = partnersWeekRes.count ?? 0;
  const partenairesSemainePrec = partnersPrevWeekRes.count ?? 0;

  const proposalsStale = excludeLostByProject(
    (proposalsPendingRes.data ?? []) as any[],
    (r) => r.project
  );
  const projectsWithRecentProposal = new Set(
    ((proposalsRecentRes.data ?? []) as any[]).map((x) => x.project_id)
  );
  const sourcingDormant = projects.filter(
    (p) => p.current_phase === 'sourcing' && p.status === 'actif' && !projectsWithRecentProposal.has(p.id)
  );

  // ─── Zone 7 : clients sans nouvelles ─────────────────────────────────
  const lastContactByProject = new Map<string, { at: string; via: string }>();
  const bump = (projectId: string | null, at: string | null, via: string) => {
    if (!projectId || !at) return;
    const cur = lastContactByProject.get(projectId);
    if (!cur || at > cur.at) lastContactByProject.set(projectId, { at, via });
  };
  for (const e of ((emailContactsRes.data ?? []) as any[])) bump(e.project_id, e.sent_at, 'email');
  for (const n of ((noteContactsRes.data ?? []) as any[])) bump(n.project_id, n.created_at, 'note');
  for (const t of ((taskContactsRes.data ?? []) as any[])) bump(t.project_id, t.completed_at, 'tâche');

  const silentClients = projects
    .filter((p) => p.status === 'actif' && !['mise_en_location', 'termine'].includes(p.current_phase))
    .map((p) => {
      const last = lastContactByProject.get(p.id) ?? null;
      const silence = last ? daysSince(last.at) : THRESHOLDS.contactLookbackJours + 1;
      return { project: p, last, silence };
    })
    .filter((x) => x.silence > THRESHOLDS.clientSansNouvellesJours)
    .sort((a, b) => b.silence - a.silence);

  // ─── Zone 8 : complétude — top 3 manques ─────────────────────────────
  const rows = completenessRows as ProjectCompleteness[];
  const missingCounts = new Map<string, { label: string; owner: string; count: number }>();
  for (const r of rows) {
    for (const m of r.missing) {
      const cur = missingCounts.get(m.key) ?? { label: m.label, owner: m.owner, count: 0 };
      cur.count += 1;
      missingCounts.set(m.key, cur);
    }
  }
  const topMissing = [...missingCounts.values()].sort((a, b) => b.count - a.count).slice(0, 3);

  // ─── Notes du daily ──────────────────────────────────────────────────
  const allNotes = ((dailyNotesRes.data ?? []) as any[]);
  const enrichNote = (n: any): StonizDailyNote => ({
    id: n.id,
    content: n.content,
    created_at: n.created_at,
    created_by_name: n.created_by_id ? (profileMap.get(n.created_by_id) ?? null) : null,
    resolved_at: n.resolved_at,
    resolved_by_name: n.resolved_by_id ? (profileMap.get(n.resolved_by_id) ?? null) : null,
  });
  const activeNotes = allNotes.filter((n) => !n.resolved_at).map(enrichNote);
  const resolvedNotes = allNotes.filter((n) => !!n.resolved_at).map(enrichNote);
  const canDeleteNotes = user.role === 'ceo' || user.role === 'developer';

  const refreshedAt = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ─── Card générique (même pattern que le Daily Propria) ──────────────
  type CardItem = { id: string; primary: string; secondary?: string; meta?: string };
  function Card({
    title, icon: Icon, accent, count, countLabel, items, href, voirToutLabel, emptyText, redCount,
  }: {
    title: string;
    icon: any;
    accent: string;
    count: number | string;
    countLabel?: string;
    items: CardItem[];
    href: string;
    voirToutLabel?: string;
    emptyText?: string;
    redCount?: number;
  }) {
    const isZero = count === 0 || count === '0';
    return (
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className={`w-4 h-4 shrink-0 ${accent}`} />
            <span className="text-sm font-medium truncate">{title}</span>
            {redCount != null && redCount > 0 && (
              <span className="text-[10px] bg-red-100 text-red-700 border border-red-200 rounded-full px-1.5 py-0.5 shrink-0">
                {redCount} rouge{redCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className={`text-3xl font-display ${isZero ? 'text-stoniz-gray-300' : 'text-stoniz-black'}`}>
              {count}
            </span>
            {countLabel && <div className="text-[10px] text-stoniz-gray-400 -mt-1">{countLabel}</div>}
          </div>
        </div>
        {items.length === 0 ? (
          <div className="text-xs text-stoniz-gray-400 py-2">{emptyText ?? 'Rien à signaler'}</div>
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
        <Link href={href} className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
          {voirToutLabel ?? 'Voir tout'} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    );
  }

  function Trend({ current, prev }: { current: number; prev: number }) {
    if (current > prev) return <TrendingUp className="w-3.5 h-3.5 text-emerald-600" />;
    if (current < prev) return <TrendingDown className="w-3.5 h-3.5 text-red-600" />;
    return <Minus className="w-3.5 h-3.5 text-stoniz-gray-400" />;
  }

  return (
    <div className="max-w-7xl">
      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">Stoniz · Daily</div>
          <h1 className="text-2xl md:text-3xl font-display">📋 Daily Stoniz — point équipe</h1>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            Ce qui bloque → ce qui arrive → l&apos;argent → ce qui dort. Zéro oubli.
          </p>
        </div>
        <div className="inline-flex items-center gap-2 flex-wrap">
          <span className="text-xs text-stoniz-gray-500 inline-flex items-center gap-1">
            <Clock className="w-3 h-3" /> Maj {refreshedAt}
          </span>
          <form action="/daily" method="GET" className="inline-flex items-center gap-2">
            <button
              type="submit"
              className="bg-stoniz-gray-100 text-stoniz-black px-3 py-2 rounded-md text-xs hover:bg-stoniz-gray-200 inline-flex items-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Recharger
            </button>
          </form>
        </div>
      </div>

      {/* Notes du daily + reports de la veille */}
      <div className="mb-6">
        <StonizDailyNotesCard
          activeNotes={activeNotes}
          resolvedNotes={resolvedNotes}
          canDelete={canDeleteNotes}
        />
      </div>

      {/* ─── 1. Ce qui bloque ─────────────────────────────────────────── */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">1 · Ce qui bloque</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <Card
          title="🔴 Validations paiement en attente"
          icon={ShieldAlert}
          accent="text-red-600"
          count={approvals.length}
          redCount={approvalsRed.length}
          href="/validations"
          items={approvals.map((a) => ({
            id: a.id,
            primary: `${fmtEur(Number(a.amount))}${a.currency !== 'EUR' ? ` (${a.currency})` : ''} → ${a.beneficiary_name}`,
            secondary: a.description ?? (a.project ? `${a.project.code ?? a.project.reference}` : ''),
            meta: `demandé il y a ${daysSince(a.requested_at)} j · ${a.finance_status === 'pending' ? 'attente Finance' : 'attente CEO'}${a.urgency === 'urgent' ? ' · URGENT' : ''}`,
          }))}
          emptyText="Aucune validation en attente ✅"
        />
        <Card
          title="⛔ Tâches bloquées"
          icon={ShieldAlert}
          accent="text-orange-600"
          count={blockedTasks.length}
          redCount={blockedRed.length}
          href="/tasks?status=blocked"
          items={blockedTasks.map((t) => ({
            id: t.id,
            primary: t.title,
            secondary: t.project ? `${t.project.code ?? t.project.reference} · ${who(t.assigned_to)}` : who(t.assigned_to),
            meta: `bloquée depuis ${daysSince(t.updated_at)} j`,
          }))}
          emptyText="Aucune tâche bloquée ✅"
        />
      </div>

      {/* ─── 2-3. Aujourd'hui & la semaine ───────────────────────────── */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">2 · Aujourd&apos;hui et la semaine</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card
          title="⏰ Tâches en retard"
          icon={CheckSquare}
          accent="text-red-600"
          count={overdueTasks.length}
          href="/tasks?filter=overdue"
          items={overdueGroups.map(([name, n]) => ({
            id: name,
            primary: `${name} — ${n} tâche${n > 1 ? 's' : ''} en retard`,
            secondary: overdueTasks.find((t) => who(t.assigned_to) === name)?.title,
          }))}
          emptyText="Aucun retard ✅"
          voirToutLabel="Voir les tâches"
        />
        <Card
          title="📌 Tâches du jour"
          icon={CheckSquare}
          accent="text-blue-600"
          count={todayTasks.length}
          href="/tasks"
          items={todayTasks.map((t) => ({
            id: t.id,
            primary: t.title,
            secondary: t.project ? `${t.project.code ?? t.project.reference} · ${who(t.assigned_to)}` : who(t.assigned_to),
            meta: t.priority === 'urgent' || t.priority === 'high' ? `priorité ${t.priority}` : undefined,
          }))}
          emptyText="Rien d'échu aujourd'hui"
        />
        <Card
          title="📅 Jalons 7 jours"
          icon={CalendarClock}
          accent="text-violet-600"
          count={jalons.length}
          href="/projects"
          items={jalons.map((j) => ({
            id: j.id,
            primary: `${fmtDateFr(j.date)} — ${j.label}`,
            secondary: j.project,
            meta: j.owner !== '—' ? j.owner : undefined,
          }))}
          emptyText="Aucun jalon cette semaine"
          voirToutLabel="Voir les projets"
        />
      </div>

      {/* ─── 4-5. Chantiers & argent ─────────────────────────────────── */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">3 · Chantiers et argent</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <Card
          title="🏗️ Chantiers en cours"
          icon={Hammer}
          accent="text-amber-600"
          count={chantierItems.length}
          redCount={chantierItems.filter((c) => c.lotsStale > 0).length}
          href="/dashboard/travaux"
          items={chantierItems.map((c) => ({
            id: c.id,
            primary: c.label,
            secondary: `${c.lotsActifs} lot${c.lotsActifs > 1 ? 's' : ''} actif${c.lotsActifs > 1 ? 's' : ''}${c.lotsStale > 0 ? ` · ${c.lotsStale} sans avancement > ${THRESHOLDS.lotStaleJours} j` : ''}`,
            meta: c.dueMad > 0 ? `${fmtMad(c.dueMad)} à verser sous 7 j · ${c.owner}` : c.owner,
          }))}
          emptyText="Aucun chantier en phase travaux"
        />
        <Card
          title="💶 À encaisser — en retard"
          icon={Euro}
          accent="text-emerald-600"
          count={fmtEur(totalAEncaisser)}
          countLabel={`${honorairesOverdue.length} échéance${honorairesOverdue.length > 1 ? 's' : ''}`}
          href="/dashboard/financier"
          items={honorairesOverdue.map((p) => ({
            id: p.id,
            primary: `${fmtEur(Number(p.amount_expected) - Number(p.amount_paid))} — ${p.project?.client?.full_name ?? p.project?.reference ?? ''}`,
            secondary: p.label ?? p.type,
            meta: `échue le ${fmtDateFr(p.due_date)} (${daysSince(p.due_date)} j)`,
          }))}
          emptyText="Aucun encaissement en retard ✅"
          voirToutLabel="Voir le financier"
        />
        <Card
          title="🧾 À payer sous 7 jours"
          icon={Wallet}
          accent="text-orange-600"
          count={fmtMad(totalAPayerMad)}
          countLabel={totalAPayerEur > 0 ? `+ ${fmtEur(totalAPayerEur)} · ${allDuePayments.length} échéances` : `${allDuePayments.length} échéance${allDuePayments.length > 1 ? 's' : ''}`}
          href="/finance/tresorerie"
          items={allDuePayments.map((x) => ({
            id: x.id,
            primary: `${x.currency === 'MAD' ? fmtMad(Number(x.amount_total) - Number(x.amount_paid)) : fmtEur(Number(x.amount_total) - Number(x.amount_paid))} → ${x.beneficiary}`,
            secondary: projectMap.get(x.project_id) ? projLabel(projectMap.get(x.project_id)) : '',
            meta: x.scheduled_date ? `échéance ${fmtDateFr(x.scheduled_date)}${x.scheduled_date < todayIso ? ' · EN RETARD' : ''}` : undefined,
          }))}
          emptyText="Rien à payer cette semaine"
          voirToutLabel="Voir la trésorerie"
        />
      </div>

      {/* ─── 6-7-8. Ce qui dort ──────────────────────────────────────── */}
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">4 · Ce qui dort</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        {/* Sourcing : momentum semaine + souffrance */}
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-cyan-600" />
              <span className="text-sm font-medium">🔍 Sourcing</span>
            </div>
            <span className={`text-3xl font-display ${proposalsStale.length + sourcingDormant.length > 0 ? 'text-stoniz-black' : 'text-stoniz-gray-300'}`}>
              {proposalsStale.length + sourcingDormant.length}
            </span>
          </div>
          {/* Momentum semaine (lundi → dimanche) */}
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-cyan-50/50 border border-cyan-100 rounded-md p-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-display">{biensSemaine}</span>
                <Trend current={biensSemaine} prev={biensSemainePrec} />
              </div>
              <div className="text-[10px] text-stoniz-gray-500">
                biens sourcés cette semaine <span className="text-stoniz-gray-400">(vs {biensSemainePrec})</span>
              </div>
            </div>
            <div className="bg-cyan-50/50 border border-cyan-100 rounded-md p-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-display">{partenairesSemaine}</span>
                <Trend current={partenairesSemaine} prev={partenairesSemainePrec} />
              </div>
              <div className="text-[10px] text-stoniz-gray-500">
                nouveaux partenaires <span className="text-stoniz-gray-400">(vs {partenairesSemainePrec})</span>
              </div>
            </div>
          </div>
          {/* Souffrance */}
          {proposalsStale.length === 0 && sourcingDormant.length === 0 ? (
            <div className="text-xs text-stoniz-gray-400 py-1">Aucun dossier sourcing en souffrance ✅</div>
          ) : (
            <ul className="space-y-1.5 mb-2">
              {proposalsStale.slice(0, 2).map((pr) => (
                <li key={pr.id} className="text-xs border-l-2 border-stoniz-gray-200 pl-2">
                  <div className="font-medium truncate">{pr.property?.name ?? 'Bien'} — sans retour client</div>
                  <div className="text-stoniz-gray-500 truncate">
                    {pr.project ? `${pr.project.code ?? pr.project.reference}` : ''} · envoyée il y a {daysSince(pr.sent_at)} j
                  </div>
                </li>
              ))}
              {sourcingDormant.slice(0, 2).map((p) => (
                <li key={p.id} className="text-xs border-l-2 border-red-200 pl-2">
                  <div className="font-medium truncate">{projLabel(p)}</div>
                  <div className="text-stoniz-gray-500 truncate">
                    aucune proposition depuis &gt; {THRESHOLDS.sourcingSansBienJours} j
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Link href="/dashboard/sourcing" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
            Voir le sourcing <ChevronRight className="w-3 h-3" />
          </Link>
        </div>

        <Card
          title="📞 Clients sans nouvelles"
          icon={PhoneOff}
          accent="text-rose-600"
          count={silentClients.length}
          href="/projects"
          items={silentClients.map((x) => ({
            id: x.project.id,
            primary: projLabel(x.project),
            secondary: x.last
              ? `${x.silence} j sans contact · dernier : ${x.last.via} le ${fmtDateFr(x.last.at)}`
              : `${THRESHOLDS.contactLookbackJours}+ j sans contact tracé`,
            meta: who(x.project.assigned_chef_projet),
          }))}
          emptyText={`Tous les clients contactés < ${THRESHOLDS.clientSansNouvellesJours} j ✅`}
          voirToutLabel="Voir les projets"
        />
        <Card
          title="📋 Complétude — top manques"
          icon={ClipboardCheck}
          accent="text-indigo-600"
          count={topMissing.reduce((s, m) => s + m.count, 0)}
          countLabel="manques cumulés (top 3)"
          href="/admin/completude"
          items={topMissing.map((m) => ({
            id: m.label,
            primary: m.label,
            secondary: `manquant sur ${m.count} projet${m.count > 1 ? 's' : ''}`,
            meta: `responsable : ${m.owner}`,
          }))}
          emptyText="Dossiers complets ✅"
          voirToutLabel="Voir la complétude"
        />
      </div>
    </div>
  );
}
