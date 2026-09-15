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

export async function buildAnomaliesBrief(): Promise<{ subject: string; html: string }> {
  const admin = createAdminClient();
  const { today, labelLast } = weekWindows();
  const todayIso = isoDay(today);

  // ─── 1) Sur-encaissement client (encaisse > forfait) ─────────────────
  const surEncaissements: Array<{ label: string; ref: string; forfait: number; recu: number; ecart: number }> = [];
  try {
    const { data: projects } = await admin
      .from('projects')
      .select('id, reference, travaux_budget_mad, client:clients(full_name), status')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS);
    const projIds = ((projects ?? []) as any[]).map((p) => p.id);
    if (projIds.length > 0) {
      const { data: encs } = await admin
        .from('travaux_encaissements')
        .select('project_id, amount_mad, status')
        .is('deleted_at', null)
        .eq('status', 'recu')
        .in('project_id', projIds);
      const totalByProj = new Map<string, number>();
      for (const e of (encs ?? []) as any[]) {
        totalByProj.set(e.project_id, (totalByProj.get(e.project_id) ?? 0) + Number(e.amount_mad ?? 0));
      }
      for (const p of (projects ?? []) as any[]) {
        const forfait = Number(p.travaux_budget_mad ?? 0);
        if (!forfait) continue;
        const recu = totalByProj.get(p.id) ?? 0;
        const ecart = recu - forfait;
        if (ecart > 100) {
          surEncaissements.push({
            label: p.client?.full_name ?? '—',
            ref: p.reference ?? '',
            forfait,
            recu,
            ecart,
          });
        }
      }
      surEncaissements.sort((a, b) => b.ecart - a.ecart);
    }
  } catch {}

  // ─── 2) Sur-paiement artisan (paye > devis) ──────────────────────────
  const surPaiements: Array<{ artisan: string; project: string; paye: number; devis: number; ecart: number }> = [];
  try {
    const { data: lots } = await admin
      .from('travaux_lots')
      .select('id, artisan_name, devis_artisan_mad, project:projects(reference, client:clients(full_name), status, deleted_at)')
      .is('deleted_at', null);
    const validLots = ((lots ?? []) as any[]).filter(
      (l) => l.project && !l.project.deleted_at && l.project.status !== LOST_STATUS && Number(l.devis_artisan_mad ?? 0) > 0,
    );
    if (validLots.length > 0) {
      const lotIds = validLots.map((l) => l.id);
      const { data: payments } = await admin
        .from('travaux_payments')
        .select('artisan_name, amount_paid, project_id, project:projects(reference, client:clients(full_name))')
        .is('deleted_at', null);
      // Somme des paiements par artisan_name × project
      const payMap = new Map<string, number>();
      for (const p of (payments ?? []) as any[]) {
        const k = `${p.project_id}::${p.artisan_name}`;
        payMap.set(k, (payMap.get(k) ?? 0) + Number(p.amount_paid ?? 0));
      }
      // Somme des devis par artisan_name × project (via lots)
      const devisMap = new Map<string, { devis: number; ref: string; client: string }>();
      for (const l of validLots) {
        const projId = ((l.project as any) ?? {}).id ?? l.project_id;
        // Utilise la clé compo artisan+ref
        const ref = l.project?.reference ?? '';
        const clientName = l.project?.client?.full_name ?? '—';
        // On ne peut pas récupérer project_id sans le sélectionner. Ajout défensif.
        const k = `${projId}::${l.artisan_name}`;
        const cur = devisMap.get(k) ?? { devis: 0, ref, client: clientName };
        cur.devis += Number(l.devis_artisan_mad ?? 0);
        cur.ref = ref;
        cur.client = clientName;
        devisMap.set(k, cur);
      }
      for (const [k, { devis, ref, client }] of devisMap.entries()) {
        const paye = payMap.get(k) ?? 0;
        const ecart = paye - devis;
        if (ecart > 100 && devis > 0) {
          const artisan = k.split('::')[1] ?? '—';
          surPaiements.push({ artisan, project: `${client} · ${ref}`, paye, devis, ecart });
        }
      }
      surPaiements.sort((a, b) => b.ecart - a.ecart);
    }
  } catch {}

  // ─── 3) Projets en perte réelle (marge_brute < 0) ──────────────────
  // Approximation : forfait travaux - devis validés < 0
  const pertes: Array<{ label: string; ref: string; ecart: number }> = [];
  try {
    const { data: projects } = await admin
      .from('projects')
      .select('id, reference, travaux_budget_mad, client:clients(full_name), status')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS);
    const projIds = ((projects ?? []) as any[]).map((p) => p.id);
    if (projIds.length > 0) {
      const { data: lots } = await admin
        .from('travaux_lots')
        .select('project_id, devis_artisan_mad')
        .is('deleted_at', null)
        .in('project_id', projIds);
      const devisByProj = new Map<string, number>();
      for (const l of (lots ?? []) as any[]) {
        devisByProj.set(l.project_id, (devisByProj.get(l.project_id) ?? 0) + Number(l.devis_artisan_mad ?? 0));
      }
      for (const p of (projects ?? []) as any[]) {
        const forfait = Number(p.travaux_budget_mad ?? 0);
        if (!forfait) continue;
        const devis = devisByProj.get(p.id) ?? 0;
        const marge = forfait - devis;
        if (marge < -100 && devis > 0) {
          pertes.push({
            label: p.client?.full_name ?? '—',
            ref: p.reference ?? '',
            ecart: marge,
          });
        }
      }
      pertes.sort((a, b) => a.ecart - b.ecart);
    }
  } catch {}

  // ─── 4) Attestations fiscales expirées / à renouveler <30j ─────────
  let attestationsExpired = 0;
  let attestationsSoon = 0;
  let attestationsMissing = 0;
  try {
    const { getAllArtisansAttestationStatus, aggregateAttestationStatus } = await import(
      '@/lib/artisans/attestation-status'
    );
        const rows = await getAllArtisansAttestationStatus(admin as any, 'all');
    const agg = aggregateAttestationStatus(rows);
    attestationsExpired = agg.expired;
    attestationsSoon = agg.expiring_soon;
    attestationsMissing = agg.missing;
  } catch {}

  // ─── 5) Transactions bancaires non allouées > 14j ────────────────────
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const { data: unallocatedTx } = await admin
    .from('bank_transactions')
    .select('id, credit_mad, debit_mad, operation_date, wording')
    .lt('operation_date', isoDay(fourteenDaysAgo))
    .is('deleted_at', null)
    .eq('is_pending', false);
  let unallocatedIds: string[] = [];
  let totalUnallocated = 0;
  if ((unallocatedTx ?? []).length > 0) {
    const ids = ((unallocatedTx ?? []) as any[]).map((t) => t.id);
    const { data: allocs } = await admin
      .from('bank_transaction_allocations')
      .select('bank_transaction_id')
      .in('bank_transaction_id', ids)
      .is('deleted_at', null);
    const allocated = new Set(((allocs ?? []) as any[]).map((a) => a.bank_transaction_id));
    unallocatedIds = ((unallocatedTx ?? []) as any[])
      .filter((t) => !allocated.has(t.id))
      .map((t) => t.id);
    const unMap = new Map(((unallocatedTx ?? []) as any[]).map((t) => [t.id, t]));
    for (const id of unallocatedIds) {
      const t: any = unMap.get(id);
      if (!t) continue;
      totalUnallocated += Math.abs(Number(t.credit_mad ?? 0) - Number(t.debit_mad ?? 0));
    }
  }

  // ─── 6) Dépenses caisse Stoniz non validées > 7j ─────────────────────
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  let caisseUnvalidated = 0;
  let caisseAmount = 0;
  try {
    const { data } = await admin
      .from('stoniz_wallet_expenses')
      .select('amount_mad, is_validated, spent_at')
      .is('deleted_at', null)
      .lt('spent_at', isoDay(sevenDaysAgo))
      .eq('is_validated', false);
    for (const r of (data ?? []) as any[]) {
      caisseUnvalidated++;
      caisseAmount += Number(r.amount_mad ?? 0);
    }
  } catch {}

  // ─── 7) Validations paiement en attente > 3j ─────────────────────────
  const threeDaysAgo = new Date(today);
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  let validationsPending = 0;
  try {
    const { count } = await admin
      .from('payment_approvals')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lt('created_at', threeDaysAgo.toISOString());
    validationsPending = count ?? 0;
  } catch {}

  // ─── 8) Emails auto skippés semaine ──────────────────────────────────
  const { lastWeekStart, lastWeekEnd } = weekWindows();
  let skippedEmails = 0;
  try {
    const { count } = await admin
      .from('email_logs')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'skipped')
      .gte('created_at', isoDay(lastWeekStart))
      .lte('created_at', `${isoDay(lastWeekEnd)}T23:59:59`);
    skippedEmails = count ?? 0;
  } catch {}

  // ═══ Compose ═══
  const subject = `Semaine du ${labelLast}`;
  const subtitle = 'Anomalies & alertes';

  const kpis = kpiRow([
    kpiCard({
      label: 'Sur-encaissements',
      value: String(surEncaissements.length),
      subValue: 'projets',
      variant: surEncaissements.length > 0 ? 'warning' : 'light',
    }),
    kpiCard({
      label: 'Sur-paiements',
      value: String(surPaiements.length),
      subValue: 'artisans',
      variant: surPaiements.length > 0 ? 'warning' : 'light',
    }),
    kpiCard({
      label: 'Projets en perte',
      value: String(pertes.length),
      subValue: 'devis > forfait',
      variant: pertes.length > 0 ? 'danger' : 'light',
    }),
  ]);

  const surEncSection = surEncaissements.length === 0
    ? emptyOk('Aucun sur-encaissement client détecté.')
    : dataTable({
        headers: ['Client', 'Forfait', 'Encaissé', 'Écart'],
        rows: surEncaissements.slice(0, 10).map((s) => [
          `${esc(s.label)}<br><span style="font-size:11px;color:${COLORS.mutedSoft};">${esc(s.ref)}</span>`,
          { text: fmtMad(s.forfait), align: 'right' as const },
          { text: fmtMad(s.recu), align: 'right' as const },
          { text: `+${fmtMad(s.ecart)}`, align: 'right' as const, color: COLORS.warning, bold: true },
        ]),
      });

  const surPaySection = surPaiements.length === 0
    ? emptyOk('Aucun sur-paiement artisan détecté.')
    : dataTable({
        headers: ['Artisan', 'Projet', 'Devis', 'Payé', 'Écart'],
        rows: surPaiements.slice(0, 10).map((s) => [
          esc(s.artisan),
          esc(s.project),
          { text: fmtMad(s.devis), align: 'right' as const },
          { text: fmtMad(s.paye), align: 'right' as const },
          { text: `+${fmtMad(s.ecart)}`, align: 'right' as const, color: COLORS.warning, bold: true },
        ]),
      });

  const perteSection = pertes.length === 0
    ? emptyOk('Aucun projet en perte réelle détectée (devis validés vs forfait).')
    : dataTable({
        headers: ['Client', 'Référence', 'Marge'],
        rows: pertes.slice(0, 10).map((p) => [
          esc(p.label),
          esc(p.ref),
          { text: fmtMad(p.ecart), align: 'right' as const, color: COLORS.danger, bold: true },
        ]),
      });

  const attestationsRow = attestationsExpired + attestationsSoon + attestationsMissing;
  const attestationsSection = attestationsRow === 0
    ? emptyOk('Toutes les attestations fiscales artisans sont à jour.')
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td style="padding:8px 0;">Attestations expirées</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${attestationsExpired > 0 ? COLORS.danger : COLORS.muted};">${attestationsExpired}</td>
      </tr>
      <tr style="border-top:1px solid ${COLORS.creamBorder};">
        <td style="padding:8px 0;">À renouveler &lt;30j</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${attestationsSoon > 0 ? COLORS.warning : COLORS.muted};">${attestationsSoon}</td>
      </tr>
      <tr style="border-top:1px solid ${COLORS.creamBorder};">
        <td style="padding:8px 0;">Manquantes (jamais uploadée)</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${attestationsMissing > 0 ? COLORS.warning : COLORS.muted};">${attestationsMissing}</td>
      </tr>
    </table>`;

  const operationalRow = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="padding:8px 0;">Transactions bancaires non allouées &gt;14j</td>
      <td align="right" style="padding:8px 0;font-weight:600;color:${unallocatedIds.length > 0 ? COLORS.warning : COLORS.muted};">${unallocatedIds.length} · ${fmtMad(totalUnallocated)}</td>
    </tr>
    <tr style="border-top:1px solid ${COLORS.creamBorder};">
      <td style="padding:8px 0;">Dépenses caisse Stoniz non validées &gt;7j</td>
      <td align="right" style="padding:8px 0;font-weight:600;color:${caisseUnvalidated > 0 ? COLORS.warning : COLORS.muted};">${caisseUnvalidated} · ${fmtMad(caisseAmount)}</td>
    </tr>
    <tr style="border-top:1px solid ${COLORS.creamBorder};">
      <td style="padding:8px 0;">Validations paiement en attente &gt;3j</td>
      <td align="right" style="padding:8px 0;font-weight:600;color:${validationsPending > 0 ? COLORS.danger : COLORS.muted};">${validationsPending}</td>
    </tr>
    <tr style="border-top:1px solid ${COLORS.creamBorder};">
      <td style="padding:8px 0;">Emails auto skippés (semaine passée)</td>
      <td align="right" style="padding:8px 0;font-weight:600;color:${skippedEmails > 0 ? COLORS.warning : COLORS.muted};">${skippedEmails}</td>
    </tr>
  </table>`;

  const body =
    htmlHeader(subject, subtitle) +
    section(sectionTitle('Vue d\'ensemble') + kpis, { padding: '24px 32px 8px' }) +
    section(sectionTitle('Sur-encaissements clients') + surEncSection) +
    section(sectionTitle('Sur-paiements artisans') + surPaySection) +
    section(sectionTitle('Projets en perte réelle (devis > forfait)') + perteSection) +
    section(sectionTitle('Attestations fiscales artisans') + attestationsSection) +
    section(sectionTitle('Anomalies opérationnelles') + operationalRow) +
    htmlFooter('/dashboard', 'Ouvrir le dashboard');

  const full = `Stoniz · ${subtitle} · ${subject}`;
  return { subject: full, html: wrapPage(body, full) };
}
