import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { LOST_STATUS } from '@/lib/projects/lost';
import { STONIZ_FEE_SCHEDULE } from '@/lib/finance/stoniz-fees';
import { getActiveRecurringMonthly } from '@/lib/finance/recurring-detector';
import {
  wrapPage,
  htmlHeader,
  htmlFooter,
  kpiCard,
  kpiRow,
  sectionTitle,
  section,
  alertBox,
  dataTable,
  fmtMad,
  fmtEur,
  fmtDate,
  weekWindows,
  isoDay,
  esc,
  daysAgo,
  emptyOk,
  COLORS,
} from './brief-common';

const MAD_PER_EUR = 10;

/**
 * Brief FINANCE — hebdomadaire.
 * Reproduit la maquette validée (CEO 2026-08-19) avec données dynamiques :
 *   - solde consolidé + variation semaine
 *   - soldes prévisionnels (fin de mois + J+30)
 *   - pipeline honoraires (complet + confirmé)
 *   - cash semaine écoulée (entrées/sorties/top 3)
 *   - prévisions semaine à venir (décaissements planifiés)
 *   - encaissements honoraires en retard (top 10)
 *   - caisses Stoniz — dépenses non validées
 */
export async function buildFinanceBrief(): Promise<{ subject: string; html: string }> {
  const admin = createAdminClient();
  const { lastWeekStart, lastWeekEnd, nextWeekStart, nextWeekEnd, today, labelLast, labelNext } =
    weekWindows();

  // ─── 1) Solde consolidé actuel ────────────────────────────────────────
  let currentBalance = 0;
  try {
    const { data } = await admin
      .from('v_bank_account_current_balance')
      .select('*')
      .eq('is_active', true);
    currentBalance = (data ?? []).reduce(
      (s: number, b: any) => s + Number(b.current_balance ?? 0),
      0,
    );
  } catch {}

  // ─── 2) Cash semaine écoulée ──────────────────────────────────────────
  const { data: weekTxs } = await admin
    .from('bank_transactions')
    .select('id, credit_mad, debit_mad, operation_date, wording, category_code')
    .gte('operation_date', isoDay(lastWeekStart))
    .lte('operation_date', isoDay(lastWeekEnd))
    .eq('is_pending', false)
    .is('deleted_at', null);

  let weekIn = 0;
  let weekOut = 0;
  const outflowsList: Array<{ label: string; amount: number }> = [];
  for (const t of (weekTxs ?? []) as any[]) {
    const credit = Number(t.credit_mad ?? 0);
    const debit = Number(t.debit_mad ?? 0);
    weekIn += credit;
    weekOut += debit;
    if (debit > 0) {
      outflowsList.push({ label: String(t.wording ?? '—').slice(0, 60), amount: debit });
    }
  }
  const nbTx = (weekTxs ?? []).length;
  const top3Out = outflowsList.sort((a, b) => b.amount - a.amount).slice(0, 3);

  // Variation vs semaine passée : cash net semaine = weekIn - weekOut
  const netWeek = weekIn - weekOut;

  // ─── 3) Soldes prévisionnels (fin de mois + J+30) ─────────────────────
  const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const j30 = new Date(today);
  j30.setDate(j30.getDate() + 30);

  const projection = await computeProjectionSlots(admin, today, [endOfMonth, j30]);
  const balEndOfMonth = currentBalance + projection.slots[0].net;
  const balJ30 = currentBalance + projection.slots[1].net;

  // ─── 4) Pipeline honoraires (complet + confirmé) ──────────────────────
  const pipeline = await computeHonorairesPipeline(admin);

  // ─── 5) Prévisions semaine à venir : décaissements planifiés ──────────
  const nextWeekOut = await computePlannedOutflows(
    admin,
    isoDay(nextWeekStart),
    isoDay(nextWeekEnd),
  );

  // ─── 6) Encaissements honoraires en retard ────────────────────────────
  const overduePayments = await computeOverdueHonoraires(admin, today);

  // ─── 7) Caisses Stoniz — dépenses non validées ───────────────────────
  const caisses = await computeCaissesStoniz(admin);

  // ═══ Compose HTML ═══════════════════════════════════════════════════════
  const subject = `Semaine du ${labelLast}`;
  const subtitle = 'Pilotage finance';

  const soldePrincipal = `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${COLORS.black};border-radius:10px;">
      <tr><td style="padding:20px 24px;">
        <div style="font-size:11px;color:rgba(255,255,255,0.7);text-transform:uppercase;letter-spacing:0.08em;">Solde consolidé (tous comptes actifs)</div>
        <div style="margin-top:6px;font-family:'Manrope',sans-serif;font-size:32px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;">
          ${fmtMad(currentBalance)}
        </div>
        <div style="margin-top:4px;font-size:13px;color:${netWeek < 0 ? '#f5c4b3' : '#c4f5d5'};">
          ${netWeek < 0 ? '&#9660;' : '&#9650;'} ${fmtMad(Math.abs(netWeek))} sur la semaine (net entrées − sorties)
        </div>
      </td></tr>
    </table>`;

  const soldesPrev = `
    <div style="font-size:11px;color:${COLORS.muted};text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;">
      Soldes prévisionnels
    </div>
    ${kpiRow([
      kpiCard({
        label: `Fin du mois · ${endOfMonth.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`,
        value: fmtMad(balEndOfMonth),
        subValue: `Entrées prévues +${fmtMad(projection.slots[0].in)} · Sorties −${fmtMad(projection.slots[0].out)}`,
        variant: balEndOfMonth >= currentBalance ? 'emerald' : 'danger',
      }),
      kpiCard({
        label: `Dans 30 jours · ${j30.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`,
        value: fmtMad(balJ30),
        subValue: `Entrées prévues +${fmtMad(projection.slots[1].in)} · Sorties −${fmtMad(projection.slots[1].out)}`,
        variant: balJ30 >= currentBalance ? 'emerald' : 'danger',
      }),
    ])}
    <div style="margin-top:8px;font-size:11px;color:${COLORS.mutedSoft};text-align:center;">
      Basé sur honoraires + travaux/achats planifiés + récurrents moyens 3 mois.
    </div>`;

  const pipelineHonoraires = kpiRow([
    kpiCard({
      label: 'Pipeline complet',
      value: fmtMad(pipeline.total_mad),
      subValue: `${pipeline.nb_projects} projets actifs · ${fmtEur(pipeline.total_eur)}`,
      variant: 'light',
    }),
    kpiCard({
      label: 'CA confirmé',
      value: fmtMad(pipeline.confirmed_mad),
      subValue: `${pipeline.nb_confirmed} projets cochés · ${
        pipeline.total_mad > 0
          ? Math.round((pipeline.confirmed_mad / pipeline.total_mad) * 100)
          : 0
      } % du pipeline`,
      variant: 'emerald',
    }),
  ]);

  const cashSemaine = `
    ${kpiRow([
      kpiCard({ label: 'Entrées', value: fmtMad(weekIn), variant: 'light' }),
      kpiCard({ label: 'Sorties', value: fmtMad(weekOut), variant: 'light' }),
      kpiCard({ label: 'Nb transactions', value: String(nbTx), variant: 'light' }),
    ])}
    <div style="margin-top:14px;font-size:12px;color:${COLORS.muted};">Top 3 sorties de la semaine</div>
    ${
      top3Out.length === 0
        ? emptyOk('Aucune sortie sur la semaine.')
        : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin-top:6px;font-size:13px;">
      ${top3Out
        .map(
          (o, i) => `<tr style="${i < top3Out.length - 1 ? `border-bottom:1px solid ${COLORS.creamBorder};` : ''}">
        <td style="padding:8px 0;">${esc(o.label)}</td>
        <td align="right" style="padding:8px 0;font-weight:600;color:${COLORS.danger};">−${fmtMad(o.amount)}</td>
      </tr>`,
        )
        .join('')}
    </table>`
    }`;

  const prevSemaine =
    nextWeekOut.total === 0
      ? alertBox({
          level: 'warning',
          content: `&#8505; Aucun décaissement planifié dans le module travaux/achats/services cette semaine. Prévoir les paiements récurrents (CNSS/IAM/DGI + salaires actifs).`,
        })
      : `<div style="font-size:13px;color:${COLORS.muted};margin-bottom:8px;">${nextWeekOut.count} paiements planifiés · ${fmtMad(nextWeekOut.total)} au total</div>
        ${dataTable({
          headers: ['Bénéficiaire / projet', 'Date', 'Montant'],
          rows: nextWeekOut.rows.slice(0, 10).map((r) => [
            { text: esc(r.label), align: 'left' as const },
            { text: fmtDate(r.date), align: 'left' as const },
            { text: fmtMad(r.amount), align: 'right' as const, bold: true },
          ]),
        })}`;

  const overdueSection =
    overduePayments.length === 0
      ? emptyOk('Aucun encaissement honoraires en retard, bravo.')
      : `<div style="margin-top:4px;font-size:12px;color:${COLORS.muted};">${overduePayments.length} échéances · ${fmtEur(
          overduePayments.reduce((s, p) => s + p.amount_eur, 0),
        )} à percevoir</div>
       <div style="margin-top:10px;"></div>
       ${dataTable({
         headers: ['Client / projet', 'Échéance', 'Retard', 'Montant'],
         rows: overduePayments.slice(0, 10).map((p) => [
           {
             text: `${esc(p.client)} <span style="color:${COLORS.mutedSoft};">· ${esc(p.reference)}</span><br><span style="font-size:11px;color:${COLORS.muted};">${esc(p.milestone_label)}</span>`,
             align: 'left' as const,
           },
           { text: fmtDate(p.due_date), align: 'left' as const },
           {
             text: `${p.days_overdue} j`,
             align: 'right' as const,
             color: p.days_overdue > 7 ? COLORS.danger : COLORS.warning,
             bold: true,
           },
           { text: fmtEur(p.amount_eur), align: 'right' as const, bold: true },
         ]),
       })}`;

  const caissesSection =
    caisses.count === 0
      ? emptyOk('Toutes les caisses sont à jour, aucune dépense en attente de validation.')
      : alertBox({
          level: 'warning',
          content: `<strong>${caisses.count} dépenses en attente de validation</strong> · ${fmtMad(caisses.total)} au total.<br>Rendez-vous sur <a href="https://studio.stoniz.co/caisse-stoniz" style="color:${COLORS.warningText};text-decoration:underline;">/caisse-stoniz</a> pour valider.`,
        });

  const body =
    htmlHeader(subject, subtitle) +
    section(soldePrincipal, { padding: '24px 32px 8px' }) +
    section(soldesPrev, { padding: '8px 32px' }) +
    section(pipelineHonoraires, { padding: '8px 32px' }) +
    section(sectionTitle('Cash de la semaine') + cashSemaine) +
    section(sectionTitle(`Prévisions semaine à venir (${labelNext})`) + prevSemaine) +
    section(sectionTitle('Encaissements honoraires en retard') + overdueSection) +
    section(sectionTitle('Caisses Stoniz') + caissesSection) +
    htmlFooter('/finance/tresorerie', 'Ouvrir la trésorerie');

  const html = wrapPage(body, `Stoniz · ${subtitle} · ${subject}`);
  return { subject: `Stoniz · ${subtitle} · ${subject}`, html };
}

// ─── Sous-helpers de calcul ───────────────────────────────────────────────

async function computeProjectionSlots(
  admin: ReturnType<typeof createAdminClient>,
  today: Date,
  horizons: Date[],
): Promise<{ slots: Array<{ in: number; out: number; net: number }> }> {
  const todayIso = isoDay(today);

  // Récurrents (moyenne 3 mois) — approx par jour × horizon.
  // CEO 2026-09-02 : ajoute les SALARIÉS actifs via helper canon (Nabil,
  // Zineb, Chakib, Habiba…). Auparavant le brief ne comptait QUE
  // DGI/CNSS/télécom/banque → sous-estimation cashflow de ~50 k MAD/mois.
  const start3m = new Date(today);
  start3m.setDate(start3m.getDate() - 90);
  const { data: recentTxs } = await admin
    .from('bank_transactions')
    .select('debit_mad')
    .gte('operation_date', isoDay(start3m))
    .lt('operation_date', todayIso)
    .is('deleted_at', null)
    .eq('is_pending', false)
    .in('category_code', ['dgi', 'cnss', 'maroc_telecom', 'frais_bancaire']);
  const institutionalPerMonth =
    Math.round(
      ((recentTxs ?? []) as any[]).reduce((s, t) => s + Number(t.debit_mad ?? 0), 0) / 3,
    ) || 0;
  const salariesInfo = await getActiveRecurringMonthly();
  const recurringPerMonth = institutionalPerMonth + salariesInfo.total_per_month;

  // Encaissements planifiés
  const [travauxEnc, achatsEnc] = await Promise.all([
    admin
      .from('travaux_encaissements')
      .select('amount_mad, scheduled_date, status, project:projects(status, deleted_at)')
      .is('deleted_at', null)
      .eq('status', 'planifie')
      .gte('scheduled_date', todayIso),
    admin
      .from('achats_encaissements')
      .select('amount_mad, scheduled_date, status, project:projects(status, deleted_at)')
      .is('deleted_at', null)
      .eq('status', 'planifie')
      .gte('scheduled_date', todayIso),
  ]);

  const [travauxPay, achatsPay, servicesPay] = await Promise.all([
    admin
      .from('travaux_payments')
      .select('amount_total, amount_paid, scheduled_date, status, project:projects(status, deleted_at)')
      .is('deleted_at', null)
      .gte('scheduled_date', todayIso),
    admin
      .from('achats_payments')
      .select('amount_total, amount_paid, scheduled_date, status, project:projects(status, deleted_at)')
      .is('deleted_at', null)
      .gte('scheduled_date', todayIso),
    admin
      .from('services_payments')
      .select('amount_total, amount_paid, scheduled_date, status, project:projects(status, deleted_at)')
      .is('deleted_at', null)
      .gte('scheduled_date', todayIso),
  ]);

  // Honoraires prévus (via forecast_month) — inclus dans horizon si mois <= mois horizon
  const [{ data: projects }, { data: payments }, { data: forecasts }] = await Promise.all([
    admin
      .from('projects')
      .select('id, current_phase, stoniz_reduction, service_type, status')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
    admin
      .from('payments')
      .select('project_id, type, amount_expected, amount_paid')
      .is('deleted_at', null)
      .neq('type', 'autre'),
    admin
      .from('stoniz_fees_forecast')
      .select('project_id, milestone_type, forecast_month')
      .is('deleted_at', null),
  ]);

  const paymentsByProj = new Map<string, any[]>();
  for (const p of (payments ?? []) as any[]) {
    const arr = paymentsByProj.get(p.project_id) ?? [];
    arr.push(p);
    paymentsByProj.set(p.project_id, arr);
  }
  const forecastsByProj = new Map<string, Record<string, string>>();
  for (const f of (forecasts ?? []) as any[]) {
    const cur = forecastsByProj.get(f.project_id) ?? {};
    cur[f.milestone_type] = String(f.forecast_month).slice(0, 7);
    forecastsByProj.set(f.project_id, cur);
  }

  type HonorLine = { date: string; amount: number };
  const honorLines: HonorLine[] = [];
  for (const p of (projects ?? []) as any[]) {
    if (p.service_type === 'coaching') continue;
    if (p.current_phase === 'termine') continue;
    const rawFees = (paymentsByProj.get(p.id) ?? []).filter((x: any) => x.type !== 'autre');
    const byType = new Map<string, { amount_expected: number; amount_paid: number }>();
    for (const f of rawFees) {
      const cur = byType.get(f.type) ?? { amount_expected: 0, amount_paid: 0 };
      cur.amount_expected += Number(f.amount_expected ?? 0);
      cur.amount_paid += Number(f.amount_paid ?? 0);
      byType.set(f.type, cur);
    }
    const missing = STONIZ_FEE_SCHEDULE.filter((m) => !byType.has(m.type));
    const totalMissing = missing.reduce((s, m) => s + m.amount, 0);
    const reduction = Number(p.stoniz_reduction ?? 0);
    const fcs = forecastsByProj.get(p.id) ?? {};
    for (const m of STONIZ_FEE_SCHEDULE) {
      const agg = byType.get(m.type);
      let target: number;
      if (agg) target = agg.amount_expected;
      else {
        const share = totalMissing > 0 ? reduction * (m.amount / totalMissing) : 0;
        target = Math.max(0, m.amount - share);
      }
      const reste = Math.max(0, target - (agg?.amount_paid ?? 0));
      if (reste <= 0.01) continue;
      const fm = fcs[m.type];
      if (!fm) continue;
      honorLines.push({ date: `${fm}-15`, amount: reste * MAD_PER_EUR });
    }
  }

  function isActiveProj(x: any) {
    return x?.project && !x.project.deleted_at && x.project.status !== 'perdu';
  }

  const slots = horizons.map((horizonDate) => {
    const hIso = isoDay(horizonDate);
    let ins = 0;
    let outs = 0;

    for (const e of (travauxEnc.data ?? []) as any[]) {
      if (!isActiveProj(e)) continue;
      if (String(e.scheduled_date) <= hIso) ins += Number(e.amount_mad ?? 0);
    }
    for (const e of (achatsEnc.data ?? []) as any[]) {
      if (!isActiveProj(e)) continue;
      if (String(e.scheduled_date) <= hIso) ins += Number(e.amount_mad ?? 0);
    }
    for (const l of honorLines) {
      if (l.date <= hIso) ins += l.amount;
    }
    for (const p of (travauxPay.data ?? []) as any[]) {
      if (!isActiveProj(p)) continue;
      if (p.status === 'paid' || p.status === 'paye') continue;
      const remaining = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
      if (remaining <= 0) continue;
      if (String(p.scheduled_date) <= hIso) outs += remaining;
    }
    for (const p of (achatsPay.data ?? []) as any[]) {
      if (!isActiveProj(p)) continue;
      if (p.status === 'paid' || p.status === 'paye') continue;
      const remaining = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
      if (remaining <= 0) continue;
      if (String(p.scheduled_date) <= hIso) outs += remaining;
    }
    for (const p of (servicesPay.data ?? []) as any[]) {
      if (!isActiveProj(p)) continue;
      if (p.status === 'paid' || p.status === 'paye') continue;
      const remaining = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
      if (remaining <= 0) continue;
      if (String(p.scheduled_date) <= hIso) outs += remaining;
    }

    // Récurrents estimés : proportionnel au nombre de mois d'ici horizon
    const days = Math.max(1, Math.floor((horizonDate.getTime() - today.getTime()) / 86400000));
    outs += (recurringPerMonth * days) / 30;

    return { in: ins, out: outs, net: ins - outs };
  });

  return { slots };
}

async function computeHonorairesPipeline(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{
  total_mad: number;
  total_eur: number;
  nb_projects: number;
  confirmed_mad: number;
  nb_confirmed: number;
}> {
  const [{ data: projects }, { data: payments }] = await Promise.all([
    admin
      .from('projects')
      .select('id, current_phase, stoniz_reduction, service_type, status, honoraires_confirmed')
      .is('deleted_at', null)
      // Canon : exclusion = « pas perdu » (on garde pause et termine).
      // Le .eq('status','actif') qui restait ici annulait le correctif.
      .neq('status', LOST_STATUS),
    admin
      .from('payments')
      .select('project_id, type, amount_expected, amount_paid')
      .is('deleted_at', null)
      .neq('type', 'autre'),
  ]);

  const paymentsByProj = new Map<string, any[]>();
  for (const p of (payments ?? []) as any[]) {
    const arr = paymentsByProj.get(p.project_id) ?? [];
    arr.push(p);
    paymentsByProj.set(p.project_id, arr);
  }

  let total_eur = 0;
  let confirmed_eur = 0;
  let nb_projects = 0;
  let nb_confirmed = 0;
  for (const p of (projects ?? []) as any[]) {
    if (p.service_type === 'coaching') continue;
    if (p.current_phase === 'termine') continue;
    const rawFees = (paymentsByProj.get(p.id) ?? []).filter((x: any) => x.type !== 'autre');
    const byType = new Map<string, { amount_expected: number; amount_paid: number }>();
    for (const f of rawFees) {
      const cur = byType.get(f.type) ?? { amount_expected: 0, amount_paid: 0 };
      cur.amount_expected += Number(f.amount_expected ?? 0);
      cur.amount_paid += Number(f.amount_paid ?? 0);
      byType.set(f.type, cur);
    }
    const missing = STONIZ_FEE_SCHEDULE.filter((m) => !byType.has(m.type));
    const totalMissing = missing.reduce((s, m) => s + m.amount, 0);
    const reduction = Number(p.stoniz_reduction ?? 0);
    let reste = 0;
    for (const m of STONIZ_FEE_SCHEDULE) {
      const agg = byType.get(m.type);
      let target: number;
      if (agg) target = agg.amount_expected;
      else {
        const share = totalMissing > 0 ? reduction * (m.amount / totalMissing) : 0;
        target = Math.max(0, m.amount - share);
      }
      reste += Math.max(0, target - (agg?.amount_paid ?? 0));
    }
    if (reste <= 0.01) continue;
    total_eur += reste;
    nb_projects++;
    if (p.honoraires_confirmed) {
      confirmed_eur += reste;
      nb_confirmed++;
    }
  }
  return {
    total_eur,
    total_mad: total_eur * MAD_PER_EUR,
    nb_projects,
    confirmed_mad: confirmed_eur * MAD_PER_EUR,
    nb_confirmed,
  };
}

async function computePlannedOutflows(
  admin: ReturnType<typeof createAdminClient>,
  fromIso: string,
  toIso: string,
): Promise<{
  total: number;
  count: number;
  rows: Array<{ label: string; date: string; amount: number }>;
}> {
  const [travauxPay, achatsPay, servicesPay] = await Promise.all([
    admin
      .from('travaux_payments')
      .select('amount_total, amount_paid, scheduled_date, artisan_name, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .gte('scheduled_date', fromIso)
      .lte('scheduled_date', toIso),
    admin
      .from('achats_payments')
      .select('amount_total, amount_paid, scheduled_date, supplier_name, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .gte('scheduled_date', fromIso)
      .lte('scheduled_date', toIso),
    admin
      .from('services_payments')
      .select('amount_total, amount_paid, scheduled_date, description, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .gte('scheduled_date', fromIso)
      .lte('scheduled_date', toIso),
  ]);

  const rows: Array<{ label: string; date: string; amount: number }> = [];
  const push = (p: any, who: string) => {
    if (!p.project || p.project.deleted_at || p.project.status === 'perdu') return;
    if (p.status === 'paid' || p.status === 'paye') return;
    const remaining = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
    if (remaining <= 0) return;
    rows.push({
      label: `${who} — ${p.project?.client?.full_name ?? p.project?.reference ?? '—'}`,
      date: p.scheduled_date,
      amount: remaining,
    });
  };
  for (const p of (travauxPay.data ?? []) as any[]) push(p, p.artisan_name ?? 'Artisan');
  for (const p of (achatsPay.data ?? []) as any[]) push(p, p.supplier_name ?? 'Fournisseur');
  for (const p of (servicesPay.data ?? []) as any[])
    push(p, `Service ${p.description ?? ''}`.trim());

  rows.sort((a, b) => b.amount - a.amount);
  return {
    total: rows.reduce((s, r) => s + r.amount, 0),
    count: rows.length,
    rows,
  };
}

async function computeOverdueHonoraires(
  admin: ReturnType<typeof createAdminClient>,
  today: Date,
): Promise<
  Array<{
    client: string;
    reference: string;
    milestone_label: string;
    due_date: string;
    days_overdue: number;
    amount_eur: number;
  }>
> {
  const todayIso = isoDay(today);
  const { data: paymentsRaw } = await admin
    .from('payments')
    .select(
      'id, project_id, type, amount_expected, amount_paid, due_date, project:projects(reference, status, deleted_at, current_phase, service_type, client:clients(full_name))',
    )
    .is('deleted_at', null)
    .not('due_date', 'is', null)
    .lt('due_date', todayIso)
    .neq('type', 'autre');

  const LABELS: Record<string, string> = {};
  for (const m of STONIZ_FEE_SCHEDULE) LABELS[m.type] = m.label;

  const rows = [] as Array<{
    client: string;
    reference: string;
    milestone_label: string;
    due_date: string;
    days_overdue: number;
    amount_eur: number;
  }>;
  for (const p of (paymentsRaw ?? []) as any[]) {
    if (!p.project || p.project.deleted_at) continue;
    if (p.project.status === LOST_STATUS) continue;
    if (p.project.service_type === 'coaching') continue;
    if (p.project.current_phase === 'termine') continue;
    const reste = Number(p.amount_expected ?? 0) - Number(p.amount_paid ?? 0);
    if (reste <= 0.01) continue;
    rows.push({
      client: p.project?.client?.full_name ?? '—',
      reference: p.project?.reference ?? '—',
      milestone_label: LABELS[p.type] ?? p.type,
      due_date: p.due_date,
      days_overdue: daysAgo(p.due_date),
      amount_eur: reste,
    });
  }
  rows.sort((a, b) => b.days_overdue - a.days_overdue);
  return rows;
}

async function computeCaissesStoniz(
  admin: ReturnType<typeof createAdminClient>,
): Promise<{ count: number; total: number }> {
  try {
    const { data } = await admin
      .from('stoniz_wallet_expenses')
      .select('amount_mad, status, deleted_at')
      .is('deleted_at', null)
      .eq('status', 'pending');
    const rows = (data ?? []) as any[];
    return {
      count: rows.length,
      total: rows.reduce((s, r) => s + Number(r.amount_mad ?? 0), 0),
    };
  } catch {
    return { count: 0, total: 0 };
  }
}
