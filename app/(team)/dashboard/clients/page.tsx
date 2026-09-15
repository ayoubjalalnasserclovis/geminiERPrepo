import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KpiGrid, DashboardSection, HorizontalBar } from '@/components/dashboard/kpi-card';
import { KpiDrawerCard, type KpiDrawerRow } from '@/components/dashboard/kpi-drawer';
import { formatPhase, formatDate, formatStatus } from '@/lib/utils/format';
import { OverduePaymentsAlert } from '@/components/finance/overdue-payments-alert';
import { listOverduePayments } from '@/lib/finance/overdue-payments';
import {
  computeStuck,
  computePhaseAvgDurations,
  type StuckInput,
} from '@/lib/projects/lifecycle-kpis';

const PHASE_COLORS: Record<string, string> = {
  onboarding: 'var(--phase-onboarding)',
  sourcing: 'var(--phase-sourcing)',
  design: 'var(--phase-design)',
  travaux: 'var(--phase-travaux)',
  livraison: 'var(--phase-livraison)',
  mise_en_location: 'var(--phase-mise_en_location)',
  termine: 'var(--phase-termine)',
};

const OPERATIONAL_PHASES = [
  'onboarding', 'sourcing', 'design', 'travaux', 'livraison', 'mise_en_location',
] as const;

const PAUSE_REASON_LABEL: Record<string, string> = {
  financement_attendu: 'Financement attendu',
  sourcing_bloque: 'Sourcing bloqué',
  client_indisponible: 'Client indisponible',
  litige_partenaire: 'Litige partenaire',
  autre: 'Autre',
};

export default async function ClientsDashboardPage() {
  await requireRole(['ceo', 'chef_projet', 'developer', 'commercial', 'finance']);
  const supabase = createClient();
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [clientsRes, projectsRes, projectsAllRes, proposalsRes, phaseHistoryRes, overduePayments] =
    await Promise.all([
      supabase.from('clients').select('id, full_name, profile_id, created_at')
        .is('deleted_at', null),
      // Stats projets : projets perdus exclus (règle métier permanente). On GARDE
      // actif + pause + termine (filtre = != 'perdu', jamais = 'actif').
      supabase.from('projects').select(
        'id, reference, client_id, current_phase, status, created_at, ' +
        'onboarding_date, compromis_date, acte_authentique_date, ' +
        'travaux_start_date, travaux_end_date, livraison_date, ' +
        'legacy_imported, paused_at, expected_resume_at, phase_at_lifecycle_change, pause_reason_code_v, ' +
        'client:clients(full_name), chef:profiles!projects_assigned_chef_projet_fkey(full_name)')
        .is('deleted_at', null)
        .neq('status', 'perdu'),
      // Liste auxiliaire (TOUS projets, perdus inclus) — sert UNIQUEMENT à identifier
      // les clients qui n'ont VRAIMENT aucun projet (vs ceux dont tous les projets sont perdus).
      supabase.from('projects').select('client_id')
        .is('deleted_at', null),
      supabase.from('property_proposals').select('id, project_id, sent_at, client_response, client_response_at')
        .order('sent_at', { ascending: false }),
      // Historique de phase : alimenté par init_new_project + advance_phase.
      // Ligne ouverte (completed_at NULL) = entrée dans la phase courante.
      supabase.from('project_phases_history').select('project_id, phase, started_at, completed_at, duration_days'),
      listOverduePayments(),
    ]);

  const clients = clientsRes.data ?? [];
  const projects = projectsRes.data ?? [];
  const projectsAll = projectsAllRes.data ?? [];
  const proposals = proposalsRes.data ?? [];
  const phaseHistory = phaseHistoryRes.data ?? [];

  // Map des projets non-perdus (référence pour filtrer l'historique de phase).
  const projectById = new Map<string, any>(projects.map((p: any) => [p.id, p]));
  const nonLegacyIds = new Set(projects.filter((p: any) => !p.legacy_imported).map((p: any) => p.id));

  // ─── Bloc 1 — Où intervenir maintenant ─────────────────────────────────
  // Projets en pause (portefeuille gelé).
  const paused = projects.filter((p: any) => p.status === 'pause');
  // Reprise prévue dépassée (engagement de date non tenu → rouge).
  const expiredResume = paused.filter(
    (p: any) => p.expected_resume_at && String(p.expected_resume_at) < todayStr,
  );

  // Projets bloqués : entrée dans la phase courante via la ligne phase_history
  // ouverte. Legacy exclu des durées (décision CEO).
  const openByProject = new Map<string, { phase: string; started_at: string }>();
  phaseHistory.forEach((h: any) => {
    if (h.completed_at == null && projectById.has(h.project_id)) {
      openByProject.set(h.project_id, { phase: h.phase, started_at: h.started_at });
    }
  });
  const stuckInput: StuckInput[] = projects
    .filter((p: any) => p.status === 'actif' && !p.legacy_imported && openByProject.has(p.id))
    .map((p: any) => ({
      id: p.id,
      phase: p.current_phase,
      startedAt: openByProject.get(p.id)!.started_at,
      label: p.client?.full_name ?? '—',
      sublabel: p.reference,
      chef: p.chef?.full_name ?? null,
    }));
  const stuck = computeStuck(stuckInput, now);
  const stuckRed = stuck.filter((s) => s.level === 'red').length;

  // ─── Durée réelle par phase (phases franchies, perdus + legacy exclus) ──
  const phaseDurations = computePhaseAvgDurations(
    phaseHistory
      .filter((h: any) => h.completed_at != null && nonLegacyIds.has(h.project_id))
      .map((h: any) => ({ phase: h.phase, duration_days: h.duration_days })),
  );
  const maxDur = Math.max(...phaseDurations.map((d) => d.avgDays ?? 0), 1);

  // ─── Pipeline par phase (actif + pause, perdus exclus) ──────────────────
  const byPhaseActif: Record<string, number> = {};
  const byPhasePause: Record<string, number> = {};
  projects.forEach((p: any) => {
    if (p.status === 'actif') byPhaseActif[p.current_phase] = (byPhaseActif[p.current_phase] ?? 0) + 1;
    else if (p.status === 'pause') byPhasePause[p.current_phase] = (byPhasePause[p.current_phase] ?? 0) + 1;
  });
  const totalByPhase = (ph: string) => (byPhaseActif[ph] ?? 0) + (byPhasePause[ph] ?? 0);
  const projetsTermines = projects.filter((p: any) => p.status === 'termine').length;
  const maxPhase = Math.max(...OPERATIONAL_PHASES.map(totalByPhase), 1);

  // ─── Vélocité de clôture (date de référence = livraison_date) ───────────
  const last12 = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (11 - i), 1);
    return {
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleDateString('fr-FR', { month: 'short' }),
    };
  });
  const livraisonByMonth: Record<string, number> = {};
  projects.forEach((p: any) => {
    if (p.livraison_date) {
      const k = String(p.livraison_date).slice(0, 7);
      livraisonByMonth[k] = (livraisonByMonth[k] ?? 0) + 1;
    }
  });
  const currentMonthKey = last12[11].key;
  const deliveredThisMonth = livraisonByMonth[currentMonthKey] ?? 0;
  const maxLivr = Math.max(...last12.map((m) => livraisonByMonth[m.key] ?? 0), 1);

  // ─── Nouveaux clients ce mois ───────────────────────────────────────
  const newClientsMonth = clients.filter((c) => c.created_at >= startOfMonth).length;
  const newClientsPrev = clients.filter((c) => c.created_at >= startOfPrevMonth && c.created_at < startOfMonth).length;
  const newDelta = newClientsPrev > 0
    ? Math.round(((newClientsMonth - newClientsPrev) / newClientsPrev) * 100)
    : (newClientsMonth > 0 ? 100 : 0);

  // ─── Clients sans projet ────────────────────────────────────────────
  const clientsWithAnyProject = new Set(projectsAll.map((p: any) => p.client_id));
  const clientsNoProject = clients.filter((c) => !clientsWithAnyProject.has(c.id));

  // ─── Taux invitation ────────────────────────────────────────────────
  const invited = clients.filter((c) => c.profile_id).length;
  const invitationRate = clients.length > 0 ? Math.round((invited / clients.length) * 100) : 0;

  // ─── Propositions ───────────────────────────────────────────────────
  const proposalsMonth = proposals.filter((p) => p.sent_at >= startOfMonth);
  const acceptanceRate = (() => {
    const responded = proposals.filter((p) => p.client_response !== 'pending');
    if (responded.length === 0) return 0;
    const accepted = proposals.filter((p) => p.client_response === 'accepted').length;
    return Math.round((accepted / responded.length) * 100);
  })();
  const pendingOld = proposals.filter((p) => p.client_response === 'pending' && p.sent_at < sevenDaysAgo);
  const delayDays = (() => {
    const responded = proposals.filter((p) => p.client_response_at && p.sent_at);
    if (responded.length === 0) return null;
    const sum = responded.reduce((s, p) => {
      const d1 = new Date(p.sent_at).getTime();
      const d2 = new Date(p.client_response_at!).getTime();
      return s + (d2 - d1) / 86_400_000;
    }, 0);
    return Math.round(sum / responded.length);
  })();

  // ─── Délais clés (en jours) ─────────────────────────────────────────
  const avgBetween = (fromKey: string, toKey: string): number | null => {
    const filtered = projects.filter((p: any) => p[fromKey] && p[toKey]);
    if (filtered.length === 0) return null;
    const sum = filtered.reduce((s, p: any) => {
      const d1 = new Date(p[fromKey]).getTime();
      const d2 = new Date(p[toKey]).getTime();
      return s + (d2 - d1) / 86_400_000;
    }, 0);
    return Math.round(sum / filtered.length);
  };

  const delaiCompromis = avgBetween('onboarding_date', 'compromis_date');
  const delaiActe = avgBetween('compromis_date', 'acte_authentique_date');
  const delaiActeChantier = avgBetween('acte_authentique_date', 'travaux_start_date');
  const delaiChantier = avgBetween('travaux_start_date', 'travaux_end_date');
  const delaiChantierLivraison = avgBetween('travaux_end_date', 'livraison_date');

  // ─── Lignes de détail (drill-down) — aucune donnée recalculée ──────────
  type ClientRow = (typeof clients)[number];
  const clientRows = (list: ClientRow[]): KpiDrawerRow[] =>
    list.map((c) => ({
      id: c.id,
      label: c.full_name,
      sublabel: c.profile_id ? 'Portail actif' : 'Non invité',
      date: c.created_at ? formatDate(c.created_at) : undefined,
      href: `/clients/${c.id}`,
    }));

  const phaseProjectRows = (phase: string): KpiDrawerRow[] =>
    projects
      .filter((p: any) => (p.status === 'actif' || p.status === 'pause') && p.current_phase === phase)
      .map((p: any) => ({
        id: p.id,
        label: p.client?.full_name ?? '—',
        sublabel: `${p.reference}${p.status === 'pause' ? ' · en pause' : ''}`,
        href: `/projects/${p.id}`,
      }));

  const terminesRows: KpiDrawerRow[] = projects
    .filter((p: any) => p.status === 'termine')
    .map((p: any) => ({ id: p.id, label: p.client?.full_name ?? '—', sublabel: p.reference, href: `/projects/${p.id}` }));

  const stuckRows: KpiDrawerRow[] = stuck.map((s) => ({
    id: s.id,
    label: s.label,
    sublabel: `${s.sublabel} · ${formatPhase(s.phase)} · ${s.chef ?? 'non assigné'}`,
    amount: `${s.days} j`,
    tone: s.level === 'red' ? 'negative' : 'default',
    href: `/projects/${s.id}`,
  }));

  const pauseRows: KpiDrawerRow[] = paused
    .map((p: any) => ({
      p,
      days: p.paused_at ? Math.max(0, Math.floor((now.getTime() - new Date(p.paused_at).getTime()) / 86_400_000)) : null,
    }))
    .sort((a, b) => (b.days ?? 0) - (a.days ?? 0))
    .map(({ p, days }) => ({
      id: p.id,
      label: p.client?.full_name ?? '—',
      sublabel: `${p.reference} · ${PAUSE_REASON_LABEL[p.pause_reason_code_v] ?? 'Raison non précisée'} · ${formatPhase(p.phase_at_lifecycle_change ?? p.current_phase)}`,
      amount: days != null ? `${days} j` : undefined,
      href: `/projects/${p.id}`,
    }));

  const expiredRows: KpiDrawerRow[] = expiredResume.map((p: any) => ({
    id: p.id,
    label: p.client?.full_name ?? '—',
    sublabel: `${p.reference} · reprise prévue ${formatDate(p.expected_resume_at)}`,
    tone: 'negative',
    href: `/projects/${p.id}`,
  }));

  const deliveredRows: KpiDrawerRow[] = projects
    .filter((p: any) => p.livraison_date && String(p.livraison_date).slice(0, 7) === currentMonthKey)
    .map((p: any) => ({
      id: p.id,
      label: p.client?.full_name ?? '—',
      sublabel: p.reference,
      date: formatDate(p.livraison_date),
      href: `/projects/${p.id}`,
    }));

  const delayRows = (fromKey: string, toKey: string): KpiDrawerRow[] =>
    projects
      .filter((p: any) => p[fromKey] && p[toKey])
      .map((p: any) => ({
        p,
        days: Math.round((new Date(p[toKey]).getTime() - new Date(p[fromKey]).getTime()) / 86_400_000),
      }))
      .sort((a, b) => b.days - a.days)
      .map(({ p, days }) => ({
        id: p.id,
        label: p.client?.full_name ?? '—',
        sublabel: p.reference,
        amount: `${days} j`,
        href: `/projects/${p.id}`,
      }));

  type ProposalRow = (typeof proposals)[number];
  const proposalRows = (list: ProposalRow[], showDelay = false): KpiDrawerRow[] =>
    list.map((p: any) => {
      let amount: string | undefined;
      if (showDelay && p.client_response_at && p.sent_at) {
        const days = Math.round((new Date(p.client_response_at).getTime() - new Date(p.sent_at).getTime()) / 86_400_000);
        amount = `${days} j`;
      }
      return {
        id: p.id,
        label: 'Proposition',
        sublabel: p.client_response && p.client_response !== 'pending' ? formatStatus(p.client_response) : 'En attente',
        date: p.sent_at ? formatDate(p.sent_at) : undefined,
        amount,
        href: `/projects/${p.project_id}/proposals`,
      };
    });

  const respondedProposals = proposals.filter((p: any) => p.client_response && p.client_response !== 'pending');

  return (
    <div className="space-y-8">
      <PageHeader title="Dashboard clients" description="Pilotage du cycle de vie et engagement clients" />

      {overduePayments.length > 0 && (
        <OverduePaymentsAlert payments={overduePayments} variant="global" />
      )}

      <DashboardSection title="Où intervenir maintenant" description="Projets à débloquer en priorité">
        <KpiGrid cols={3}>
          <KpiDrawerCard label="Projets bloqués" value={stuck.length}
            hint={stuck.length > 0 ? (stuckRed > 0 ? `${stuckRed} en alerte rouge` : 'au-delà du seuil de phase') : 'tout avance'}
            variant={stuckRed > 0 ? 'danger' : stuck.length > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Projets bloqués dans leur phase',
              subtitle: 'Projets actifs stagnant au-delà du seuil (legacy exclus)',
              rows: stuckRows,
              emptyLabel: 'Aucun projet ne stagne au-delà de son seuil.',
              note: 'Seuils (j) : onboarding 7 · sourcing 30 · design 21 · travaux 90 · livraison 14 · location 10. Rouge = au-delà de 1,5× le seuil.',
            }} />
          <KpiDrawerCard label="Projets en pause" value={paused.length}
            hint={paused.length > 0 ? 'portefeuille gelé' : 'aucune pause'}
            variant={paused.length > 0 ? 'warning' : 'default'}
            detail={{
              title: 'Projets en pause',
              subtitle: 'Portefeuille gelé — raison et durée de pause',
              rows: pauseRows,
              emptyLabel: 'Aucun projet en pause.',
            }} />
          {expiredResume.length > 0 && (
            <KpiDrawerCard label="Reprise dépassée" value={expiredResume.length}
              hint="date de reprise passée" variant="danger"
              detail={{
                title: 'Reprise prévue dépassée',
                subtitle: 'Projets en pause dont la date de reprise est passée — décision requise',
                rows: expiredRows,
                emptyLabel: 'Aucune reprise dépassée.',
              }} />
          )}
        </KpiGrid>
      </DashboardSection>

      <DashboardSection title="Volume & activation">
        <KpiGrid>
          <KpiDrawerCard label="Total clients" value={clients.length}
            detail={{
              title: 'Total clients',
              subtitle: 'Tous les clients actifs',
              rows: clientRows([...clients].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))),
              emptyLabel: 'Aucun client.',
            }} />
          <KpiDrawerCard label="Nouveaux ce mois" value={newClientsMonth}
            trend={{ value: newDelta, positive: newDelta >= 0 }}
            hint={`vs ${newClientsPrev} le mois dernier`}
            detail={{
              title: 'Nouveaux clients ce mois',
              subtitle: 'Clients créés depuis le 1er du mois',
              rows: clientRows(clients.filter((c) => c.created_at >= startOfMonth)),
              emptyLabel: 'Aucun nouveau client ce mois.',
            }} />
          <KpiDrawerCard label="Taux d'invitation" value={`${invitationRate}%`}
            hint={`${invited}/${clients.length} portail actif`}
            variant={invitationRate >= 80 ? 'success' : 'warning'}
            detail={{
              title: 'Clients non invités',
              subtitle: 'Clients sans accès au portail — à inviter',
              headline: `${invitationRate}%`,
              rows: clientRows(clients.filter((c) => !c.profile_id)),
              emptyLabel: 'Tous les clients ont un accès portail.',
              note: `${invited} clients sur ${clients.length} ont un portail actif.`,
            }} />
          <KpiDrawerCard label="Sans projet" value={clientsNoProject.length}
            hint="à activer" variant={clientsNoProject.length > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Clients sans projet',
              subtitle: 'Aucun projet en base — à activer',
              rows: clientRows(clientsNoProject),
              emptyLabel: 'Tous les clients ont au moins un projet.',
            }} />
        </KpiGrid>
      </DashboardSection>

      <DashboardSection title="Projets par phase" description="Projets actifs et en pause (perdus exclus)">
        <KpiGrid>
          {(['onboarding', 'sourcing', 'design', 'travaux'] as const).map((phase) => (
            <KpiDrawerCard key={phase} label={formatPhase(phase)} value={byPhaseActif[phase] ?? 0}
              hint={(byPhasePause[phase] ?? 0) > 0 ? `+${byPhasePause[phase]} en pause` : undefined}
              variant={(byPhasePause[phase] ?? 0) > 0 ? 'warning' : 'default'}
              detail={{
                title: `Phase ${formatPhase(phase)}`,
                subtitle: 'Projets actifs et en pause dans cette phase',
                rows: phaseProjectRows(phase),
                emptyLabel: 'Aucun projet dans cette phase.',
              }} />
          ))}
        </KpiGrid>
        <div className="mt-4">
          <KpiGrid cols={3}>
            <KpiDrawerCard label="Livraison" value={byPhaseActif['livraison'] ?? 0}
              hint={(byPhasePause['livraison'] ?? 0) > 0 ? `+${byPhasePause['livraison']} en pause` : undefined}
              variant={(byPhasePause['livraison'] ?? 0) > 0 ? 'warning' : 'default'}
              detail={{
                title: 'Phase Livraison',
                subtitle: 'Projets actifs et en pause dans cette phase',
                rows: phaseProjectRows('livraison'),
                emptyLabel: 'Aucun projet dans cette phase.',
              }} />
            <KpiDrawerCard label="Mise en location" value={byPhaseActif['mise_en_location'] ?? 0}
              hint={(byPhasePause['mise_en_location'] ?? 0) > 0 ? `+${byPhasePause['mise_en_location']} en pause` : undefined}
              variant={(byPhasePause['mise_en_location'] ?? 0) > 0 ? 'warning' : 'default'}
              detail={{
                title: 'Phase Mise en location',
                subtitle: 'Projets actifs et en pause dans cette phase',
                rows: phaseProjectRows('mise_en_location'),
                emptyLabel: 'Aucun projet dans cette phase.',
              }} />
            <KpiDrawerCard label="Terminés" value={projetsTermines} variant="success"
              detail={{
                title: 'Projets terminés',
                subtitle: 'Projets clôturés (status terminé)',
                rows: terminesRows,
                emptyLabel: 'Aucun projet terminé.',
              }} />
          </KpiGrid>
        </div>
        <Card className="mt-4">
          <div className="space-y-2">
            {OPERATIONAL_PHASES.map((phase) => (
              <HorizontalBar key={phase}
                label={formatPhase(phase)}
                value={totalByPhase(phase)}
                max={maxPhase}
                color={PHASE_COLORS[phase]} />
            ))}
          </div>
        </Card>
      </DashboardSection>

      <DashboardSection title="Durée réelle par phase" description="Moyenne sur les phases franchies (perdus + legacy exclus)">
        <Card>
          <div className="space-y-2">
            {phaseDurations.map((d) => (
              <HorizontalBar key={d.phase}
                label={`${formatPhase(d.phase)}${d.count > 0 ? ` (n=${d.count})` : ''}`}
                value={d.avgDays ?? 0}
                max={maxDur}
                color={PHASE_COLORS[d.phase]} />
            ))}
          </div>
          <p className="mt-4 border-t border-grey-line pt-3 text-xs text-stoniz-gray-500">
            Durée moyenne en jours, calculée depuis l'historique de phase. n = nombre de projets ayant franchi la phase.
          </p>
        </Card>
      </DashboardSection>

      <DashboardSection title="Délais moyens projet" description="Calculés sur les projets ayant les dates renseignées">
        <KpiGrid cols={3}>
          <KpiDrawerCard label="Onboarding → Compromis"
            value={delaiCompromis != null ? `${delaiCompromis} j` : '—'}
            hint="Temps moyen pour signer le compromis"
            detail={{
              title: 'Onboarding → Compromis',
              subtitle: 'Délai par projet (du plus long au plus court)',
              headline: delaiCompromis != null ? `${delaiCompromis} j en moyenne` : '—',
              rows: delayRows('onboarding_date', 'compromis_date'),
              emptyLabel: 'Aucun projet avec ces deux dates renseignées.',
            }} />
          <KpiDrawerCard label="Compromis → Acte authentique"
            value={delaiActe != null ? `${delaiActe} j` : '—'}
            hint="Délai administratif moyen"
            detail={{
              title: 'Compromis → Acte authentique',
              subtitle: 'Délai par projet (du plus long au plus court)',
              headline: delaiActe != null ? `${delaiActe} j en moyenne` : '—',
              rows: delayRows('compromis_date', 'acte_authentique_date'),
              emptyLabel: 'Aucun projet avec ces deux dates renseignées.',
            }} />
          <KpiDrawerCard label="Acte → Lancement chantier"
            value={delaiActeChantier != null ? `${delaiActeChantier} j` : '—'}
            hint="Délai avant le démarrage des travaux"
            detail={{
              title: 'Acte authentique → Lancement chantier',
              subtitle: 'Délai par projet (du plus long au plus court)',
              headline: delaiActeChantier != null ? `${delaiActeChantier} j en moyenne` : '—',
              rows: delayRows('acte_authentique_date', 'travaux_start_date'),
              emptyLabel: 'Aucun projet avec ces deux dates renseignées.',
            }} />
          <KpiDrawerCard label="Durée moyenne chantier"
            value={delaiChantier != null ? `${delaiChantier} j` : '—'}
            hint="Lancement → fin chantier"
            detail={{
              title: 'Durée chantier',
              subtitle: 'Lancement → fin chantier, par projet',
              headline: delaiChantier != null ? `${delaiChantier} j en moyenne` : '—',
              rows: delayRows('travaux_start_date', 'travaux_end_date'),
              emptyLabel: 'Aucun projet avec ces deux dates renseignées.',
            }} />
          <KpiDrawerCard label="Fin chantier → Livraison"
            value={delaiChantierLivraison != null ? `${delaiChantierLivraison} j` : '—'}
            hint="Délai de réception/livraison"
            detail={{
              title: 'Fin chantier → Livraison',
              subtitle: 'Délai par projet (du plus long au plus court)',
              headline: delaiChantierLivraison != null ? `${delaiChantierLivraison} j en moyenne` : '—',
              rows: delayRows('travaux_end_date', 'livraison_date'),
              emptyLabel: 'Aucun projet avec ces deux dates renseignées.',
            }} />
        </KpiGrid>
      </DashboardSection>

      <DashboardSection title="Vélocité de clôture" description="Projets livrés (date de référence : livraison)">
        <KpiGrid cols={3}>
          <KpiDrawerCard label="Livrés ce mois" value={deliveredThisMonth}
            detail={{
              title: 'Projets livrés ce mois',
              subtitle: 'Date de livraison dans le mois en cours',
              rows: deliveredRows,
              emptyLabel: 'Aucun projet livré ce mois.',
            }} />
        </KpiGrid>
        <Card className="mt-4">
          <div className="space-y-2">
            {last12.map((m) => (
              <HorizontalBar key={m.key}
                label={m.label}
                value={livraisonByMonth[m.key] ?? 0}
                max={maxLivr}
                color="var(--phase-termine)" />
            ))}
          </div>
        </Card>
      </DashboardSection>

      <DashboardSection title="Activité propositions">
        <KpiGrid cols={3}>
          <KpiDrawerCard label="Envoyées ce mois" value={proposalsMonth.length}
            detail={{
              title: 'Propositions envoyées ce mois',
              subtitle: 'Depuis le 1er du mois',
              rows: proposalRows(proposalsMonth),
              emptyLabel: 'Aucune proposition envoyée ce mois.',
            }} />
          <KpiDrawerCard label="Taux d'acceptation" value={`${acceptanceRate}%`}
            variant={acceptanceRate >= 50 ? 'success' : 'warning'}
            detail={{
              title: 'Propositions traitées',
              subtitle: 'Acceptées et refusées (hors en attente)',
              headline: `${acceptanceRate}%`,
              rows: proposalRows(respondedProposals),
              emptyLabel: 'Aucune réponse pour le moment.',
              note: 'Taux = acceptées ÷ propositions ayant reçu une réponse.',
            }} />
          <KpiDrawerCard label="Délai moyen réponse"
            value={delayDays != null ? `${delayDays} j` : '—'}
            hint="sent → response"
            detail={{
              title: 'Délai de réponse',
              subtitle: 'Envoi → réponse, par proposition',
              headline: delayDays != null ? `${delayDays} j en moyenne` : '—',
              rows: proposalRows(respondedProposals, true),
              emptyLabel: 'Aucune réponse pour le moment.',
            }} />
        </KpiGrid>
      </DashboardSection>

      {pendingOld.length > 0 && (
        <DashboardSection title="⚠️ Propositions en attente >7 jours" description="À relancer">
          <Card className="border-orange-200">
            <ul className="divide-y text-sm">
              {pendingOld.slice(0, 10).map((p: any) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <Link href={`/projects/${p.project_id}/proposals`} className="hover:underline">
                    Proposition envoyée {formatDate(p.sent_at)}
                  </Link>
                  <Badge variant="warning">En attente</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </DashboardSection>
      )}

      {clientsNoProject.length > 0 && (
        <DashboardSection title="Clients sans projet à activer">
          <Card>
            <ul className="divide-y text-sm">
              {clientsNoProject.slice(0, 10).map((c) => (
                <li key={c.id} className="py-2 flex items-center justify-between">
                  <Link href={`/clients/${c.id}`} className="hover:underline font-medium">{c.full_name}</Link>
                  <Badge>{c.profile_id ? 'Portail actif' : 'Non invité'}</Badge>
                </li>
              ))}
            </ul>
          </Card>
        </DashboardSection>
      )}
    </div>
  );
}
