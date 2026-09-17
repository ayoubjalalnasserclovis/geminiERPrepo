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
  fmtMad,
  weekWindows,
  isoDay,
  esc,
  daysAgo,
  COLORS,
} from './brief-common';

const SOUS_PHASE_LABELS: Record<string, string> = {
  gros_oeuvre: 'Gros œuvre',
  second_oeuvre: 'Second œuvre',
  finitions: 'Finitions',
  livre: 'Livré',
};

export async function buildTravauxBrief(): Promise<{ subject: string; html: string }> {
  const admin = createAdminClient();
  const { lastWeekStart, lastWeekEnd, nextWeekStart, nextWeekEnd, today, labelLast, labelNext } =
    weekWindows();
  const fromIso = isoDay(lastWeekStart);
  const toIso = isoDay(lastWeekEnd);
  const nextFromIso = isoDay(nextWeekStart);
  const nextToIso = isoDay(nextWeekEnd);
  const todayIso = isoDay(today);

  // ─── 1) Projets phase travaux — dates chantier manquantes ────────────
  const { data: projetsTravaux } = await admin
    .from('projects')
    .select('id, reference, current_phase, status, travaux_start_date, travaux_end_date, service_type, client:clients(full_name), chef:profiles!projects_assigned_chef_projet_fkey(full_name)')
    .is('deleted_at', null)
    .neq('status', LOST_STATUS)
    .eq('current_phase', 'travaux');

  // La query exclut déjà les perdus : re-filtrer sur 'actif' écartait les
  // chantiers en pause, qui ont eux aussi besoin de leurs dates.
  const projetsActifs = ((projetsTravaux ?? []) as any[]).filter(
    (p) => p.status !== 'termine' && p.service_type !== 'coaching',
  );

  const datesManquantes = projetsActifs.filter(
    (p) => !p.travaux_start_date || !p.travaux_end_date,
  );

  // Sous-phases : le champ chantier_sous_phase n'est pas encore alimenté.
  // On groupe simplement pour l'affichage TODO.
  const bySousPhase: Record<string, any[]> = {
    gros_oeuvre: [],
    second_oeuvre: [],
    finitions: [],
    livre: [],
  };
  const sansSousPhase: any[] = [];
  for (const p of projetsActifs) {
    const sp = (p as any).chantier_sous_phase as string | undefined;
    if (sp && bySousPhase[sp]) bySousPhase[sp].push(p);
    else sansSousPhase.push(p);
  }

  // ─── 2) Acomptes artisans à payer semaine prochaine ──────────────────
  const { data: acomptesSemaineProchaine } = await admin
    .from('travaux_payments')
    .select('id, artisan_name, amount_total, amount_paid, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .is('deleted_at', null)
    .gte('scheduled_date', nextFromIso)
    .lte('scheduled_date', nextToIso);

  const acomptesToPay = ((acomptesSemaineProchaine ?? []) as any[]).filter(
    (p) => p.project && !p.project.deleted_at && p.project.status !== LOST_STATUS && p.status !== 'paid' && p.status !== 'paye',
  );

  // ─── 3) Acomptes en retard de paiement ───────────────────────────────
  const { data: acomptesEnRetard } = await admin
    .from('travaux_payments')
    .select('id, artisan_name, amount_total, amount_paid, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .is('deleted_at', null)
    .lt('scheduled_date', todayIso)
    .in('status', ['pending', 'partial']);
  const enRetard = ((acomptesEnRetard ?? []) as any[]).filter(
    (p) => p.project && !p.project.deleted_at && p.project.status !== LOST_STATUS,
  );

  // ─── 4) Encaissements clients travaux semaine ────────────────────────
  const { data: encaissementsSemaine } = await admin
    .from('travaux_encaissements')
    .select('id, amount_mad, received_at, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .is('deleted_at', null)
    .eq('status', 'recu')
    .gte('received_at', fromIso)
    .lte('received_at', toIso);
  const totalEncaissementsSem = ((encaissementsSemaine ?? []) as any[])
    .filter((e) => e.project && !e.project.deleted_at)
    .reduce((s, e) => s + Number(e.amount_mad ?? 0), 0);

  const { data: encaissementsPlanifies } = await admin
    .from('travaux_encaissements')
    .select('id, amount_mad, scheduled_date, project:projects(reference, status, deleted_at, client:clients(full_name))')
    .is('deleted_at', null)
    .eq('status', 'planifie')
    .gte('scheduled_date', nextFromIso)
    .lte('scheduled_date', nextToIso);
  const totalEncPrev = ((encaissementsPlanifies ?? []) as any[])
    .filter((e) => e.project && !e.project.deleted_at && e.project.status !== LOST_STATUS)
    .reduce((s, e) => s + Number(e.amount_mad ?? 0), 0);

  // ─── 5) Retards chantier ─────────────────────────────────────────────
  const retardsChantier = projetsActifs.filter(
    (p) => p.travaux_end_date && new Date(p.travaux_end_date) < today,
  );

  // ─── 6) Anomalies lots ───────────────────────────────────────────────
  const { data: lots } = await admin
    .from('travaux_lots')
    .select('id, quote_doc_id, invoice_doc_id, devis_artisan_mad, project:projects(status, deleted_at)')
    .is('deleted_at', null);
  const activeLots = ((lots ?? []) as any[]).filter(
    (l) => l.project && !l.project.deleted_at && l.project.status !== LOST_STATUS,
  );
  const sansDevis = activeLots.filter((l) => !l.quote_doc_id && !Number(l.devis_artisan_mad ?? 0)).length;
  const sansFacture = activeLots.filter((l) => !l.invoice_doc_id).length;

  // ─── 7) Attestations artisans expirées / manquantes ─────────────────
  let attestationsIssues = 0;
  try {
    const { getAllArtisansAttestationStatus, aggregateAttestationStatus } = await import(
      '@/lib/artisans/attestation-status'
    );
    const rows = await getAllArtisansAttestationStatus(admin as any, 'all');
    const agg = aggregateAttestationStatus(rows);
    attestationsIssues = agg.expired + agg.expiring_soon + agg.missing;
  } catch {}

  // ═══ Compose HTML ═══
  const subject = `Semaine du ${labelLast}`;
  const subtitle = 'Chantiers en cours';

  const missingDatesAlert = datesManquantes.length > 0
    ? alertBox({
        level: 'danger',
        content: `<strong>${datesManquantes.length} chantier(s)</strong> sans travaux_start_date ou travaux_end_date en BDD — le suivi automatique est cassé. Compléter les dates sur /projects/[id]/travaux.`,
      })
    : '';

  // CEO 2026-08-19c : migration appliquée + sélecteur en place sur
  // /projects/[id]/travaux (ChantierTimeline). Les projets sans sous-phase
  // renseignée apparaissent dans le bloc "sans sous-phase" en bas.
  const sousPhasesTodo = '';

  const kpis = kpiRow([
    kpiCard({ label: 'Chantiers actifs', value: String(projetsActifs.length), variant: 'dark' }),
    kpiCard({
      label: 'Encaissé semaine',
      value: fmtMad(totalEncaissementsSem),
      variant: 'emerald',
    }),
    kpiCard({
      label: 'À payer artisans',
      value: fmtMad(
        acomptesToPay.reduce((s, p) => s + (Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0)), 0),
      ),
      subValue: 'semaine à venir',
      variant: acomptesToPay.length > 0 ? 'warning' : 'light',
    }),
  ]);

  const renderProjetsList = (arr: any[], label: string) => {
    if (arr.length === 0) return `<div style="font-size:12px;color:${COLORS.mutedSoft};margin:8px 0 16px;">${esc(label)} — aucun</div>`;
    return `<div style="margin:8px 0 4px;font-size:12px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:0.04em;">${esc(label)} (${arr.length})</div>
    ${dataTable({
      headers: ['Client', 'Projet', 'Dates chantier', 'Chef'],
      rows: arr.slice(0, 10).map((p) => [
        esc(p.client?.full_name ?? '—'),
        esc(p.reference ?? ''),
        {
          text: `${fmtDate(p.travaux_start_date)} → ${fmtDate(p.travaux_end_date)}`,
          align: 'left' as const,
        },
        { text: esc(p.chef?.full_name ?? '—'), align: 'right' as const },
      ]),
    })}`;
  };

  const sousPhaseSections = (['gros_oeuvre', 'second_oeuvre', 'finitions'] as const)
    .map((sp) => renderProjetsList(bySousPhase[sp], SOUS_PHASE_LABELS[sp]))
    .join('');
  const sansSousPhaseSection = renderProjetsList(sansSousPhase, 'Sans sous-phase renseignée');

  const acomptesAPayerSection =
    acomptesToPay.length === 0
      ? emptyOk('Aucun acompte artisan à payer cette semaine.')
      : dataTable({
          headers: ['Artisan', 'Projet', 'Date', 'Montant'],
          rows: acomptesToPay.slice(0, 10).map((p: any) => [
            esc(p.artisan_name ?? '—'),
            esc(p.project?.client?.full_name ?? p.project?.reference ?? '—'),
            { text: fmtDate(p.scheduled_date), align: 'left' as const },
            {
              text: fmtMad(Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0)),
              align: 'right' as const,
              bold: true,
            },
          ]),
        });

  const enRetardSection =
    enRetard.length === 0
      ? emptyOk('Aucun acompte artisan en retard.')
      : dataTable({
          headers: ['Artisan', 'Projet', 'Échéance', 'Retard', 'Reste dû'],
          rows: enRetard.slice(0, 10).map((p: any) => [
            esc(p.artisan_name ?? '—'),
            esc(p.project?.client?.full_name ?? '—'),
            { text: fmtDate(p.scheduled_date), align: 'left' as const },
            {
              text: `${daysAgo(p.scheduled_date)} j`,
              align: 'left' as const,
              color: COLORS.danger,
              bold: true,
            },
            {
              text: fmtMad(Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0)),
              align: 'right' as const,
              bold: true,
            },
          ]),
        });

  const encaissementsPrevSection = totalEncPrev === 0
    ? emptyOk('Aucun encaissement travaux planifié semaine prochaine.')
    : alertBox({
        level: 'info',
        content: `<strong>${fmtMad(totalEncPrev)}</strong> · ${(encaissementsPlanifies ?? []).length} encaissement(s) client planifié(s) semaine prochaine.`,
      });

  const retardsSection = retardsChantier.length === 0
    ? emptyOk('Aucun chantier en retard sur date fin prévue.')
    : dataTable({
        headers: ['Client', 'Fin prévue', 'Retard', 'Chef'],
        rows: retardsChantier.slice(0, 10).map((p: any) => [
          `${esc(p.client?.full_name ?? '—')}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(p.reference ?? '')}</span>`,
          { text: fmtDate(p.travaux_end_date), align: 'left' as const },
          { text: `${daysAgo(p.travaux_end_date)} j`, align: 'left' as const, color: COLORS.danger, bold: true },
          { text: esc(p.chef?.full_name ?? '—'), align: 'right' as const },
        ]),
      });

  const anomaliesSection =
    sansDevis === 0 && sansFacture === 0 && attestationsIssues === 0
      ? emptyOk('Aucune anomalie documentaire, tout est en règle.')
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:8px 0;">Lots sans devis</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${sansDevis > 0 ? COLORS.warning : COLORS.muted};">${sansDevis}</td>
      </tr>
      <tr style="border-top:1px solid ${COLORS.creamBorder};">
        <td style="padding:8px 0;">Lots sans facture attachée</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${sansFacture > 0 ? COLORS.warning : COLORS.muted};">${sansFacture}</td>
      </tr>
      <tr style="border-top:1px solid ${COLORS.creamBorder};">
        <td style="padding:8px 0;">Attestations fiscales artisans à renouveler (&lt;30j)</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${attestationsIssues > 0 ? COLORS.danger : COLORS.muted};">${attestationsIssues}</td>
      </tr>
    </table>`;

  const body =
    htmlHeader(subject, subtitle) +
    (missingDatesAlert ? section(missingDatesAlert, { padding: '20px 32px 8px' }) : '') +
    section(sectionTitle('Vue d\'ensemble') + kpis, { padding: '16px 32px 8px' }) +
    section(sectionTitle('Chantiers par sous-phase') + sousPhasesTodo + sousPhaseSections + sansSousPhaseSection) +
    section(sectionTitle('Acomptes artisans à payer (semaine à venir)') + acomptesAPayerSection) +
    section(sectionTitle('Acomptes en retard de paiement') + enRetardSection) +
    section(sectionTitle('Encaissements clients travaux') + `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:8px;">Semaine écoulée : <strong>${fmtMad(totalEncaissementsSem)}</strong></div>` + encaissementsPrevSection) +
    section(sectionTitle('Retards chantier (date fin dépassée)') + retardsSection) +
    section(sectionTitle('Anomalies documentaires') + anomaliesSection) +
    htmlFooter('/dashboard/travaux', 'Ouvrir dashboard travaux');

  const full = `Stoniz · ${subtitle} · ${subject}`;
  return { subject: full, html: wrapPage(body, full) };
}
