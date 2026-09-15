import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LOST_STATUS } from '@/lib/projects/lost';
import {
  STONIZ_FEE_SCHEDULE,
  STONIZ_FEES_TOTAL,
} from '@/lib/finance/stoniz-fees';
import { getActiveRecurringMonthly } from '@/lib/finance/recurring-detector';

/**
 * Projection cashflow mois par mois (CEO 2026-08-17d).
 *
 * Nouvel onglet complémentaire à la projection 30/60/90 jours existante.
 * Objectif : voir le solde évoluer mois par mois en croisant les
 * encaissements attendus (honoraires + travaux/achats) et les décaissements
 * (payments artisans/fournisseurs/services + charges récurrentes moyennes).
 *
 * Décisions CEO 2026-08-17d :
 *   - Devise : TOUT en MAD. Les honoraires stockés en EUR sont convertis
 *     au taux fixe historisé 1 EUR = 10 MAD (cf. canon travaux).
 *   - Solde de départ : consolidé sur tous les comptes actifs.
 *   - Toggle "Inclure honoraires Stoniz" : par défaut on inclut, mais le
 *     CEO peut décocher pour voir la projection sans le CA prévisionnel
 *     du cabinet (utile pour stresser le pire cas).
 *   - Décaissements : payments planifiés + récurrents estimés (moyenne
 *     des 3 derniers mois pour cabinet + salaires détectés).
 *
 * Chaque ligne LineDetail garde son id + kind pour permettre l'édit inline
 * de la date (mois pour honoraires, date exacte pour les autres) — cf.
 * server actions dans app/(team)/finance/projection/actions.ts.
 */

const MAD_PER_EUR = 10; // canon Stoniz (1 EUR = 10 MAD, fixe)

/**
 * Type unifié pour toute ligne de flux affichée dans le tableau projection
 * mensuelle. Le champ `id_ref` porte l'ID de la ligne source (payment,
 * encaissement, ou milestone) qui sert de clé pour l'édit inline.
 */
export type FlowKind =
  | 'honoraires_stoniz'
  | 'travaux_encaissement'
  | 'achats_encaissement'
  | 'travaux_payment'
  | 'achats_payment'
  | 'services_payment'
  | 'recurring'; // récurrent estimé (pas d'id_ref éditable)

export type FlowLine = {
  id_ref: string;              // id source (ou 'recurring:XX' pour récurrents)
  kind: FlowKind;
  direction: 'in' | 'out';
  /** YYYY-MM courant (utilisé pour agrégation) */
  month: string;
  /** Date d'origine si applicable (YYYY-MM-DD ou null) */
  raw_date: string | null;
  amount_mad: number;
  label: string;
  /** Uniquement pour honoraires : type milestone canon (pour édit inline) */
  milestone_type?: string;
  /** Uniquement pour honoraires : project_id (pour édit inline) */
  project_id?: string;
  /** Utile pour lien fiche projet dans l'UI */
  project_ref?: string | null;
};

export type MonthBucket = {
  month: string;                    // YYYY-MM
  inflows: FlowLine[];
  outflows: FlowLine[];
  total_in: number;
  total_out: number;
  net: number;                      // in - out
  ending_balance: number;           // solde cumulé à la fin du mois
};

export type ProjectionMensuelleDataset = {
  starting_balance: number;
  starting_balance_date: string;    // date snapshot du solde
  include_honoraires: boolean;
  months: MonthBucket[];
  /** Lignes sans date (honoraires sans forecast_month) — pour rappel UX. */
  undated: {
    inflows: FlowLine[];
    outflows: FlowLine[];
    total_in: number;
    total_out: number;
  };
  recurring_estimate_per_month: number;
  /**
   * Total pipeline TOUTES lignes datées confondues (utile pour KPI global).
   */
  totals: {
    grand_total_in: number;
    grand_total_out: number;
    grand_net: number;
    /** Solde en fin de période affichée (dernier mois du tableau) */
    ending_balance: number;
  };
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Retourne la liste ordonnée des N prochains mois YYYY-MM à partir du mois
 * en cours (inclus). N=12 par défaut → une année de projection.
 */
function nextMonths(n = 12): string[] {
  const out: string[] = [];
  const now = new Date();
  now.setDate(1);
  for (let i = 0; i < n; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

export async function collectProjectionMensuelle(options: {
  includeHonoraires: boolean;
  monthsAhead?: number;
}): Promise<ProjectionMensuelleDataset> {
  const supabase = createClient();
  const monthsAhead = options.monthsAhead ?? 12;
  const today = todayIso();
  const horizonMonths = new Set(nextMonths(monthsAhead));

  // ─── 1) Solde de départ ────────────────────────────────────────────────
  const { data: balances } = await supabase
    .from('v_bank_account_current_balance')
    .select('*')
    .eq('is_active', true);
  const starting_balance = ((balances ?? []) as any[]).reduce(
    (s, b) => s + Number(b.current_balance ?? 0),
    0,
  );
  // Date du snapshot le plus récent (pour info affichée en haut)
  const starting_balance_date = ((balances ?? []) as any[])
    .map((b) => b.balance_date as string)
    .filter(Boolean)
    .sort()
    .pop() ?? today;

  // ─── 2) Encaissements — Honoraires Stoniz (via forecast_month) ─────────
  const inflows: FlowLine[] = [];
  const undatedInflows: FlowLine[] = [];
  const outflows: FlowLine[] = [];
  const undatedOutflows: FlowLine[] = [];

  if (options.includeHonoraires) {
    // On réutilise la logique de la page Honoraires à percevoir : source de
    // vérité BDD (amount_expected − amount_paid) par milestone, ajusté par
    // forecast_month s'il est saisi.
    const [
      { data: projects },
      { data: payments },
      { data: forecasts },
    ] = await Promise.all([
      supabase
        .from('projects')
        .select('id, reference, status, current_phase, stoniz_reduction, service_type, client:clients(full_name)')
        .is('deleted_at', null)
        .neq('status', LOST_STATUS),
      supabase
        .from('payments')
        .select('id, project_id, type, amount_expected, amount_paid')
        .is('deleted_at', null)
        .neq('type', 'autre'),
      supabase
        .from('stoniz_fees_forecast')
        .select('project_id, milestone_type, forecast_month')
        .is('deleted_at', null),
    ]);

    const paymentsByProject = new Map<string, any[]>();
    for (const p of (payments ?? []) as any[]) {
      const arr = paymentsByProject.get(p.project_id) ?? [];
      arr.push(p);
      paymentsByProject.set(p.project_id, arr);
    }
    const forecastsByProject = new Map<string, Record<string, string>>();
    for (const f of (forecasts ?? []) as any[]) {
      const cur = forecastsByProject.get(f.project_id) ?? {};
      cur[f.milestone_type] = String(f.forecast_month).slice(0, 7);
      forecastsByProject.set(f.project_id, cur);
    }

    for (const p of (projects ?? []) as any[]) {
      // Exclure coaching + phase termine (comme la page honoraires-a-percevoir)
      if (p.service_type === 'coaching') continue;
      if (p.current_phase === 'termine') continue;

      const rawFees = (paymentsByProject.get(p.id) ?? []).filter((x: any) => x.type !== 'autre');
      const forecastsForProject = forecastsByProject.get(p.id) ?? {};

      // Agrégation par type comme dans stoniz-fees-a-venir
      type Agg = { amount_expected: number; amount_paid: number };
      const byType = new Map<string, Agg>();
      for (const f of rawFees) {
        const cur = byType.get(f.type) ?? { amount_expected: 0, amount_paid: 0 };
        cur.amount_expected += Number(f.amount_expected ?? 0);
        cur.amount_paid += Number(f.amount_paid ?? 0);
        byType.set(f.type, cur);
      }
      const missingMilestones = STONIZ_FEE_SCHEDULE.filter((m) => !byType.has(m.type));
      const totalBaremeMissing = missingMilestones.reduce((s, m) => s + m.amount, 0);
      const reduction = Number(p.stoniz_reduction ?? 0);

      for (const m of STONIZ_FEE_SCHEDULE) {
        const agg = byType.get(m.type);
        let target_amount: number;
        if (agg) {
          target_amount = agg.amount_expected;
        } else {
          const reduction_share = totalBaremeMissing > 0
            ? reduction * (m.amount / totalBaremeMissing)
            : 0;
          target_amount = Math.max(0, m.amount - reduction_share);
        }
        const paid = agg?.amount_paid ?? 0;
        const reste_eur = Math.max(0, target_amount - paid);
        if (reste_eur <= 0.01) continue;

        const amount_mad = Math.round(reste_eur * MAD_PER_EUR * 100) / 100;
        const forecast_month = forecastsForProject[m.type] ?? null;

        const line: FlowLine = {
          id_ref: `honoraires:${p.id}:${m.type}`,
          kind: 'honoraires_stoniz',
          direction: 'in',
          month: forecast_month ?? '',
          raw_date: forecast_month ? `${forecast_month}-01` : null,
          amount_mad,
          label: `Honoraires ${m.label} — ${p.client?.full_name ?? p.reference ?? '—'}`,
          milestone_type: m.type,
          project_id: p.id,
          project_ref: p.reference ?? null,
        };
        if (forecast_month && horizonMonths.has(forecast_month)) inflows.push(line);
        else undatedInflows.push(line);
      }
    }
  }

  // ─── 3) Encaissements — Travaux + Achats clients ───────────────────────
  const [travauxEnc, achatsEnc] = await Promise.all([
    supabase
      .from('travaux_encaissements')
      .select('id, amount_mad, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .eq('status', 'planifie'),
    supabase
      .from('achats_encaissements')
      .select('id, amount_mad, scheduled_date, status, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null)
      .eq('status', 'planifie'),
  ]);

  for (const e of (travauxEnc.data ?? []) as any[]) {
    if (!e.project || e.project.deleted_at || e.project.status === 'perdu') continue;
    const line: FlowLine = {
      id_ref: `te:${e.id}`,
      kind: 'travaux_encaissement',
      direction: 'in',
      month: e.scheduled_date ? monthOf(e.scheduled_date) : '',
      raw_date: e.scheduled_date ?? null,
      amount_mad: Number(e.amount_mad ?? 0),
      label: `Encaissement travaux — ${e.project?.client?.full_name ?? e.project?.reference ?? '—'}`,
      project_ref: e.project?.reference ?? null,
    };
    if (e.scheduled_date && horizonMonths.has(monthOf(e.scheduled_date))) inflows.push(line);
    else if (e.scheduled_date) inflows.push({ ...line }); // hors horizon → ignoré silencieusement
    else undatedInflows.push(line);
  }
  for (const e of (achatsEnc.data ?? []) as any[]) {
    if (!e.project || e.project.deleted_at || e.project.status === 'perdu') continue;
    const line: FlowLine = {
      id_ref: `ae:${e.id}`,
      kind: 'achats_encaissement',
      direction: 'in',
      month: e.scheduled_date ? monthOf(e.scheduled_date) : '',
      raw_date: e.scheduled_date ?? null,
      amount_mad: Number(e.amount_mad ?? 0),
      label: `Encaissement achats — ${e.project?.client?.full_name ?? e.project?.reference ?? '—'}`,
      project_ref: e.project?.reference ?? null,
    };
    if (e.scheduled_date && horizonMonths.has(monthOf(e.scheduled_date))) inflows.push(line);
    else if (!e.scheduled_date) undatedInflows.push(line);
  }

  // ─── 4) Décaissements — Travaux + Achats + Services ────────────────────
  const [travauxPay, achatsPay, servicesPay] = await Promise.all([
    supabase
      .from('travaux_payments')
      .select('id, amount_total, amount_paid, scheduled_date, status, artisan_name, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null),
    supabase
      .from('achats_payments')
      .select('id, amount_total, amount_paid, scheduled_date, status, supplier_name, lot_id, lot:achats_lots(status), project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null),
    supabase
      .from('services_payments')
      .select('id, amount_total, amount_paid, scheduled_date, status, description, project:projects(reference, status, deleted_at, client:clients(full_name))')
      .is('deleted_at', null),
  ]);

  function isFutureUnpaid(p: any): boolean {
    if (!p.project || p.project.deleted_at) return false;
    if (p.project.status === 'perdu') return false;
    if (p.status === 'paid' || p.status === 'paye') return false;
    return Number(p.amount_total ?? 0) > Number(p.amount_paid ?? 0);
  }

  for (const p of (travauxPay.data ?? []) as any[]) {
    if (!isFutureUnpaid(p)) continue;
    const amount = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
    const line: FlowLine = {
      id_ref: `tp:${p.id}`,
      kind: 'travaux_payment',
      direction: 'out',
      month: p.scheduled_date ? monthOf(p.scheduled_date) : '',
      raw_date: p.scheduled_date ?? null,
      amount_mad: amount,
      label: `${p.artisan_name ?? 'Artisan'} — ${p.project?.client?.full_name ?? p.project?.reference ?? '—'}`,
      project_ref: p.project?.reference ?? null,
    };
    if (p.scheduled_date && horizonMonths.has(monthOf(p.scheduled_date))) outflows.push(line);
    else if (!p.scheduled_date) undatedOutflows.push(line);
  }

  const EXCLUDED_LOT_STATUSES = new Set(['a_commander', 'annule']);
  for (const p of (achatsPay.data ?? []) as any[]) {
    if (!isFutureUnpaid(p)) continue;
    if (p.lot && EXCLUDED_LOT_STATUSES.has(p.lot.status)) continue;
    const amount = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
    const line: FlowLine = {
      id_ref: `ap:${p.id}`,
      kind: 'achats_payment',
      direction: 'out',
      month: p.scheduled_date ? monthOf(p.scheduled_date) : '',
      raw_date: p.scheduled_date ?? null,
      amount_mad: amount,
      label: `${p.supplier_name ?? 'Fournisseur'} — ${p.project?.client?.full_name ?? p.project?.reference ?? '—'}`,
      project_ref: p.project?.reference ?? null,
    };
    if (p.scheduled_date && horizonMonths.has(monthOf(p.scheduled_date))) outflows.push(line);
    else if (!p.scheduled_date) undatedOutflows.push(line);
  }

  for (const p of (servicesPay.data ?? []) as any[]) {
    if (!isFutureUnpaid(p)) continue;
    const amount = Number(p.amount_total ?? 0) - Number(p.amount_paid ?? 0);
    const line: FlowLine = {
      id_ref: `sp:${p.id}`,
      kind: 'services_payment',
      direction: 'out',
      month: p.scheduled_date ? monthOf(p.scheduled_date) : '',
      raw_date: p.scheduled_date ?? null,
      amount_mad: amount,
      label: `Service ${p.description ?? ''} — ${p.project?.client?.full_name ?? p.project?.reference ?? '—'}`,
      project_ref: p.project?.reference ?? null,
    };
    if (p.scheduled_date && horizonMonths.has(monthOf(p.scheduled_date))) outflows.push(line);
    else if (!p.scheduled_date) undatedOutflows.push(line);
  }

  // ─── 5) Récurrents (moyenne mensuelle 3 derniers mois) ─────────────────
  // CEO 2026-09-02 : détection stricte "même montant chaque mois >= 3 mois"
  // via helper centralisé lib/finance/recurring-detector.ts. Cumul :
  //   - Charges institutionnelles (DGI/CNSS/télécom/frais bancaires) sur 3m
  //   - Salaires actifs (bénéficiaires payés au même montant fixe sur ≥ 3 mois
  //     et encore actifs dans les 2 derniers mois disponibles)
  const RECURRING_CATEGORIES = ['dgi', 'cnss', 'maroc_telecom', 'frais_bancaire'];
  const start3m = new Date();
  start3m.setDate(start3m.getDate() - 90);
  const { data: recentInst } = await supabase
    .from('bank_transactions')
    .select('debit_mad, category_code')
    .gte('operation_date', start3m.toISOString().slice(0, 10))
    .lt('operation_date', today)
    .is('deleted_at', null).eq('is_pending', false)
    .in('category_code', RECURRING_CATEGORIES)
    .limit(3000);
  const institutional_3m = ((recentInst ?? []) as any[])
    .reduce((s, t) => s + Number(t.debit_mad ?? 0), 0);
  const institutional_per_month = institutional_3m / 3;

  const salariesInfo = await getActiveRecurringMonthly();

  const recurring_estimate_per_month = Math.round(
    institutional_per_month + salariesInfo.total_per_month,
  );

  // ─── 6) Ventilation par mois + solde cumulé ────────────────────────────
  const monthOrder = nextMonths(monthsAhead);
  const buckets = new Map<string, MonthBucket>();
  for (const m of monthOrder) {
    buckets.set(m, {
      month: m,
      inflows: [],
      outflows: [],
      total_in: 0,
      total_out: 0,
      net: 0,
      ending_balance: 0,
    });
  }
  for (const line of inflows) {
    const b = buckets.get(line.month);
    if (!b) continue;
    b.inflows.push(line);
    b.total_in += line.amount_mad;
  }
  for (const line of outflows) {
    const b = buckets.get(line.month);
    if (!b) continue;
    b.outflows.push(line);
    b.total_out += line.amount_mad;
  }
  // Ajouter les récurrents comme lignes dans chaque mois (pour visibilité)
  if (recurring_estimate_per_month > 0) {
    for (const m of monthOrder) {
      const b = buckets.get(m)!;
      const recLine: FlowLine = {
        id_ref: `recurring:${m}`,
        kind: 'recurring',
        direction: 'out',
        month: m,
        raw_date: null,
        amount_mad: recurring_estimate_per_month,
        label: 'Charges récurrentes (moyenne 3 mois : DGI, CNSS, Telecom, banque, salaires/prestataires récurrents)',
      };
      b.outflows.push(recLine);
      b.total_out += recurring_estimate_per_month;
    }
  }

  // Solde cumulé progressif
  let running = starting_balance;
  const months: MonthBucket[] = [];
  for (const m of monthOrder) {
    const b = buckets.get(m)!;
    b.net = b.total_in - b.total_out;
    running += b.net;
    b.ending_balance = running;
    // Tri interne des lignes par montant desc (les plus gros en premier)
    b.inflows.sort((a, b) => b.amount_mad - a.amount_mad);
    b.outflows.sort((a, b) => b.amount_mad - a.amount_mad);
    months.push(b);
  }

  const grand_total_in = months.reduce((s, m) => s + m.total_in, 0);
  const grand_total_out = months.reduce((s, m) => s + m.total_out, 0);

  return {
    starting_balance,
    starting_balance_date,
    include_honoraires: options.includeHonoraires,
    months,
    undated: {
      inflows: undatedInflows.sort((a, b) => b.amount_mad - a.amount_mad),
      outflows: undatedOutflows.sort((a, b) => b.amount_mad - a.amount_mad),
      total_in: undatedInflows.reduce((s, l) => s + l.amount_mad, 0),
      total_out: undatedOutflows.reduce((s, l) => s + l.amount_mad, 0),
    },
    recurring_estimate_per_month,
    totals: {
      grand_total_in,
      grand_total_out,
      grand_net: grand_total_in - grand_total_out,
      ending_balance: months[months.length - 1]?.ending_balance ?? starting_balance,
    },
  };
}
