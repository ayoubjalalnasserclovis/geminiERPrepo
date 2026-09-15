import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { LOST_STATUS } from '@/lib/projects/lost';
import {
  wrapPage,
  htmlHeader,
  htmlFooter,
  kpiCard,
  kpiRow,
  section,
  sectionTitle,
  alertBox,
  dataTable,
  emptyOk,
  fmtDate,
  fmtPct,
  weekWindows,
  isoDay,
  esc,
  daysAgo,
  COLORS,
} from './brief-common';

export async function buildSourcingBrief(): Promise<{ subject: string; html: string }> {
  const admin = createAdminClient();
  const { lastWeekStart, lastWeekEnd, today, labelLast } = weekWindows();
  const fromIso = isoDay(lastWeekStart);
  const toIso = isoDay(lastWeekEnd);

  // S-1 borne
  const prevStart = new Date(lastWeekStart);
  prevStart.setDate(prevStart.getDate() - 7);
  const prevEnd = new Date(lastWeekEnd);
  prevEnd.setDate(prevEnd.getDate() - 7);
  const prevFrom = isoDay(prevStart);
  const prevTo = isoDay(prevEnd);

  // ─── 1) Biens sourcés cette semaine ──────────────────────────────────
  const [{ count: newPropsThis }, { count: newPropsPrev }] = await Promise.all([
    admin
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', fromIso)
      .lte('created_at', `${toIso}T23:59:59`)
      .is('deleted_at', null),
    admin
      .from('properties')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', prevFrom)
      .lte('created_at', `${prevTo}T23:59:59`)
      .is('deleted_at', null),
  ]);
  const delta = (newPropsThis ?? 0) - (newPropsPrev ?? 0);
  const deltaPct = (newPropsPrev ?? 0) > 0
    ? ((delta / (newPropsPrev ?? 1)) * 100)
    : (newPropsThis ?? 0) > 0
      ? 100
      : 0;

  // ─── 2) Partenaires activés + nouveaux partenaires ──────────────────
  const { data: newPartners } = await admin
    .from('partners')
    .select('id, agency_name, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', `${toIso}T23:59:59`)
    .is('deleted_at', null);

  const { count: activePartnersCount } = await admin
    .from('partners')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'actif')
    .is('deleted_at', null);

  // ─── 3) Propositions envoyées + sans retour > 5 jours ───────────────
  const { data: sentThisWeek } = await admin
    .from('property_proposals')
    .select('id, sent_at, client_response')
    .gte('sent_at', fromIso)
    .lte('sent_at', `${toIso}T23:59:59`);

  const fiveDaysAgo = new Date(today);
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const { data: noResponse } = await admin
    .from('property_proposals')
    // FIX CEO 2026-08-31 : la table `properties` n'a PAS de colonne
    // `reference` — le libellé d'un bien c'est `name`. PostgREST renvoyait une
    // erreur sur la colonne inconnue, `data` était null, et la section
    // affichait à tort "Toutes les propositions ont eu un retour dans les 5j"
    // alors que 9 propositions attendaient depuis plus de 5 jours.
    .select('id, sent_at, client_response, project:projects(reference, client:clients(full_name)), property:properties(name, address)')
    .eq('client_response', 'pending')
    .lt('sent_at', fiveDaysAgo.toISOString())
    .order('sent_at', { ascending: true })
    .limit(20);

  // ─── 4) Sourcing sans bien identifié > 14j (projets phase sourcing bloqués) ──
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const { data: sourcingBloques } = await admin
    .from('projects')
    .select('id, reference, activated_at, created_at, client:clients(full_name)')
    .eq('current_phase', 'sourcing')
    // Canon : un projet en pause bloqué en sourcing doit aussi remonter.
    .neq('status', LOST_STATUS)
    .is('deleted_at', null);

  // Filtrer ceux qui n'ont aucune proposition acceptée
  const stuckIds: string[] = [];
  for (const p of (sourcingBloques ?? []) as any[]) {
    const ref = p.activated_at ? new Date(p.activated_at) : new Date(p.created_at);
    if (ref < fourteenDaysAgo) stuckIds.push(p.id);
  }
  let projetsStuckSourcing: any[] = ((sourcingBloques ?? []) as any[]).filter((p) => stuckIds.includes(p.id));
  if (projetsStuckSourcing.length > 0) {
    const { data: acceptedProps } = await admin
      .from('property_proposals')
      .select('project_id')
      .in('project_id', stuckIds)
      .eq('client_response', 'accepted');
    const withAccepted = new Set(((acceptedProps ?? []) as any[]).map((p) => p.project_id));
    projetsStuckSourcing = projetsStuckSourcing.filter((p) => !withAccepted.has(p.id));
  }

  // ─── 5) Nouveaux clients onboardés cette semaine ─────────────────────
  const { data: newClients } = await admin
    .from('clients')
    .select('id, full_name, created_at')
    .gte('created_at', fromIso)
    .lte('created_at', `${toIso}T23:59:59`)
    .is('deleted_at', null);

  // ─── 6) Compromis signés cette semaine + à signer semaine prochaine ─
  const nextStart = new Date(today);
  const nextEnd = new Date(today);
  nextEnd.setDate(nextEnd.getDate() + 6);
  const { data: compromisSemaine } = await admin
    .from('projects')
    .select('id, reference, compromis_date, client:clients(full_name)')
    .gte('compromis_date', fromIso)
    .lte('compromis_date', toIso)
    .is('deleted_at', null);
  const { data: compromisPrev } = await admin
    .from('projects')
    .select('id, reference, compromis_date, client:clients(full_name)')
    .gte('compromis_date', isoDay(nextStart))
    .lte('compromis_date', isoDay(nextEnd))
    .is('deleted_at', null);

  // ─── 7) Complétude partenaires ────────────────────────────────────────
  const { data: partnersAll } = await admin
    .from('partners')
    .select('id, agency_name, phone, email, contract_signed, contract_date')
    .eq('status', 'actif')
    .is('deleted_at', null);
  const incompletePartners = ((partnersAll ?? []) as any[])
    .map((p) => {
      const missing: string[] = [];
      if (!p.phone) missing.push('téléphone');
      if (!p.email) missing.push('email');
      if (!p.contract_signed) missing.push('contrat');
      return { ...p, missing };
    })
    .filter((p) => p.missing.length > 0)
    .sort((a, b) => b.missing.length - a.missing.length);

  // ═══ Compose ═══
  const subject = `Semaine du ${labelLast}`;
  const subtitle = 'Sourcing biens & partenaires';

  const deltaLabel = delta === 0 ? 'stable' : (delta > 0 ? `+${delta} vs S-1 (${fmtPct(deltaPct)})` : `${delta} vs S-1 (${fmtPct(deltaPct)})`);
  const kpis = kpiRow([
    kpiCard({
      label: 'Biens sourcés',
      value: String(newPropsThis ?? 0),
      subValue: deltaLabel,
      variant: (delta ?? 0) >= 0 ? 'emerald' : 'warning',
    }),
    kpiCard({
      label: 'Nouveaux partenaires',
      value: String((newPartners ?? []).length),
      subValue: `${activePartnersCount ?? 0} actifs au total`,
      variant: 'dark',
    }),
    kpiCard({
      label: 'Propositions envoyées',
      value: String((sentThisWeek ?? []).length),
      subValue: 'cette semaine',
      variant: 'light',
    }),
  ]);

  const noResponseSection = (noResponse ?? []).length === 0
    ? emptyOk('Toutes les propositions envoyées ont eu un retour dans les 5j.')
    : dataTable({
        headers: ['Client', 'Bien', 'Envoyée le', 'Attente'],
        rows: ((noResponse ?? []) as any[]).slice(0, 10).map((p) => [
          `${esc(p.project?.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(p.project?.reference ?? '')}</span>`,
          esc(p.property?.name ?? p.property?.address ?? '—'),
          { text: fmtDate(p.sent_at), align: 'left' as const },
          {
            text: `${daysAgo(p.sent_at)} j`,
            align: 'right' as const,
            color: daysAgo(p.sent_at) > 10 ? COLORS.danger : COLORS.warning,
            bold: true,
          },
        ]),
      });

  const stuckSection = projetsStuckSourcing.length === 0
    ? emptyOk('Aucun projet bloqué en sourcing > 14j.')
    : dataTable({
        headers: ['Client', 'Référence', 'En sourcing depuis'],
        rows: projetsStuckSourcing.slice(0, 10).map((p: any) => [
          esc(p.client?.full_name ?? '—'),
          esc(p.reference ?? ''),
          {
            text: `${daysAgo(p.activated_at ?? p.created_at)} j`,
            align: 'right' as const,
            color: COLORS.warning,
            bold: true,
          },
        ]),
      });

  const clientsSection = (newClients ?? []).length === 0
    ? emptyOk('Aucun nouveau client onboardé cette semaine.')
    : dataTable({
        headers: ['Client', 'Créé le'],
        rows: ((newClients ?? []) as any[]).map((c) => [
          esc(c.full_name ?? '—'),
          { text: fmtDate(c.created_at), align: 'right' as const },
        ]),
      });

  const compromisSection = `
    <div style="font-size:13px;color:${COLORS.muted};margin-bottom:8px;">
      Signés cette semaine : <strong>${(compromisSemaine ?? []).length}</strong> · À signer semaine prochaine : <strong>${(compromisPrev ?? []).length}</strong>
    </div>
    ${(compromisSemaine ?? []).length > 0
      ? dataTable({
          headers: ['Client', 'Référence', 'Date compromis'],
          rows: ((compromisSemaine ?? []) as any[]).map((p) => [
            esc(p.client?.full_name ?? '—'),
            esc(p.reference ?? ''),
            { text: fmtDate(p.compromis_date), align: 'right' as const },
          ]),
        })
      : ''}`;

  const completudeSection = incompletePartners.length === 0
    ? emptyOk('Toutes les fiches partenaires actives sont complètes.')
    : dataTable({
        headers: ['Partenaire', 'Manque'],
        rows: incompletePartners.slice(0, 5).map((p) => [
          esc(p.agency_name),
          {
            text: p.missing.map((m: string) => `<span style="background:${COLORS.warningBg};color:${COLORS.warningText};padding:2px 6px;border-radius:4px;font-size:11px;">${esc(m)}</span>`).join(' '),
            align: 'right' as const,
          },
        ]),
      });

  const body =
    htmlHeader(subject, subtitle) +
    section(sectionTitle('Vue d\'ensemble') + kpis, { padding: '24px 32px 8px' }) +
    section(sectionTitle('Propositions sans retour > 5j') + noResponseSection) +
    section(sectionTitle('Projets sans bien identifié > 14j') + stuckSection) +
    section(sectionTitle('Nouveaux clients onboardés') + clientsSection) +
    section(sectionTitle('Compromis') + compromisSection) +
    section(sectionTitle('Top 5 partenaires à compléter') + completudeSection) +
    htmlFooter('/properties', 'Ouvrir les biens');

  const full = `Stoniz · ${subtitle} · ${subject}`;
  return { subject: full, html: wrapPage(body, full) };
}
