import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAD_PER_EUR } from './fx-fixed';

/**
 * Allocation de la masse salariale Stoniz par projet (CEO 2026-06-30 Phase B1).
 *
 * ─── Modèle d'allocation ────────────────────────────────────────────────────
 * Masse salariale réelle = somme des transactions bancaires catégorisées
 * `cabinet_charge` + `cabinet_fiscal` + `cabinet_social` par mois.
 *
 * Période active d'un projet :
 *   début = onboarding_date | created_at
 *   fin   = lost_at  (si status=perdu)
 *         | livraison_date (si renseignée)
 *         | now()   (si actif)
 *
 * Deux modes de répartition coexistants (le caller choisit avec `mode`) :
 *
 *   • `weighted`  — poids projet = pl_phase_weights[phase] × override
 *     Le mois M reçoit : (masse_M / Σ poids_actifs_M) × poids_projet_P
 *     C'est le mode par défaut, plus juste car les phases consomment
 *     différemment les ressources cabinet.
 *
 *   • `flat`      — masse_M / nb_projets_actifs_M uniformément
 *     Mode de contrôle / comparaison ("et si on allouait à plat ?").
 *
 * ⚠️ Approximation V1 : on utilise `current_phase` (phase actuelle) pour
 * déterminer le poids du projet sur TOUT son historique. Pas d'historique
 * de phase encore. C'est documenté et accepté (CEO 2026-06-30) — la
 * précision est suffisante pour piloter le P&L à 5 % près.
 *
 * Devise : conversion MAD → EUR au taux fixe 10 (lib/finance/fx-fixed.ts).
 * ──────────────────────────────────────────────────────────────────────────
 */

export type AllocationMode = 'weighted' | 'flat';

export type ProjectAllocation = {
  project_id: string;
  total_weighted_eur: number;
  total_flat_eur: number;
  by_month: Array<{
    month: string;     // YYYY-MM
    weighted: number;  // EUR alloué ce mois en mode pondéré
    flat: number;      // EUR alloué ce mois en mode plat
  }>;
};

export type SalaryAllocationOptions = {
  /** Si fourni, ne calcule que ce mode. Sinon calcule les deux. */
  mode?: AllocationMode;
  /** Borne inférieure incluse (YYYY-MM). Défaut : aucune. */
  fromMonth?: string;
  /** Borne supérieure incluse (YYYY-MM). Défaut : mois courant. */
  toMonth?: string;
  /** Inclure les projets perdus dans l'allocation (défaut TRUE — canon CEO). */
  includeLost?: boolean;
  /** Inclure les projets en préparation (défaut FALSE — pas de vrai onboarding). */
  includePreparation?: boolean;
};

// ─── Helpers internes ───────────────────────────────────────────────────────

function toMonthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

function parseDateMaybe(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Itère sur tous les mois entre start et end (inclus), au format YYYY-MM. */
function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  const stop = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
  while (cur.getTime() <= stop.getTime()) {
    out.push(toMonthKey(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

// ─── Données d'entrée typées (rangées en mémoire) ───────────────────────────

type PayrollRow = { month: string; mad: number };
type ProjectRow = {
  id: string;
  current_phase: string | null;
  status: string | null;
  onboarding_date: string | null;
  created_at: string | null;
  lost_at: string | null;
  livraison_date: string | null;
  is_preparation: boolean | null;
};

// ─── Cœur du calcul ─────────────────────────────────────────────────────────

/**
 * Calcule l'allocation de masse salariale par projet sur la période demandée.
 *
 * Performance : 3 SELECT au total (allocations cabinet_*, transactions, projets).
 * Le calcul mois × projet se fait en mémoire avec des Map.
 */
export async function calculateSalaryAllocationByProject(
  opts: SalaryAllocationOptions = {},
): Promise<Map<string, ProjectAllocation>> {
  const includeLost = opts.includeLost ?? true;
  const includePreparation = opts.includePreparation ?? false;
  const admin = createAdminClient();

  // ─── 1. Masse salariale par mois (MAD) ────────────────────────────────
  // On JOIN allocations × transactions pour avoir la date opération.
  // Filtres allocation_type IN ('cabinet_charge','cabinet_fiscal','cabinet_social').
  const payrollByMonth = new Map<string, number>();
  try {
    const { data: allocations, error } = await admin
      .from('bank_transaction_allocations')
      .select('amount_mad, transaction_id, bank_transactions!inner(operation_date)')
      .is('deleted_at', null)
      .in('allocation_type', ['cabinet_charge', 'cabinet_fiscal', 'cabinet_social']);

    if (error) {
      console.warn('[salary-allocation] payroll fetch failed', error.message);
      return new Map();
    }

    for (const row of (allocations as any[]) ?? []) {
      const opDate: string | null = row?.bank_transactions?.operation_date ?? null;
      if (!opDate) continue;
      const d = parseDateMaybe(opDate);
      if (!d) continue;
      const month = toMonthKey(d);
      payrollByMonth.set(month, (payrollByMonth.get(month) ?? 0) + Number(row.amount_mad ?? 0));
    }
  } catch (e: any) {
    console.warn('[salary-allocation] payroll exception', e?.message);
    return new Map();
  }

  // ─── 1bis. Fallback masse salariale cible (CEO 2026-06-30) ──────────
  // Charge la table pl_target_payroll_monthly (saisie CEO dans /settings/pl-config).
  // Utilisé quand la masse réelle bancaire d'un mois est à 0 (trou dans les
  // données historiques, transactions non catégorisées, paiements cash non
  // rapprochés, etc.). Le réel gagne toujours quand il est > 0 — la cible
  // n'est qu'un filet de sécurité.
  // Format table : { month: 'YYYY-MM', amount_eur: number }
  const targetPayrollByMonth = new Map<string, number>();  // en MAD (× MAD_PER_EUR)
  try {
    const { data: targets } = await admin
      .from('pl_target_payroll_monthly')
      .select('month, amount_eur');
    for (const t of (targets as any[]) ?? []) {
      const eur = Number(t.amount_eur ?? 0);
      if (eur > 0) {
        targetPayrollByMonth.set(t.month, eur * MAD_PER_EUR);
      }
    }
  } catch (e: any) {
    console.warn('[salary-allocation] target payroll fetch failed', e?.message);
  }

  // Applique le fallback : pour chaque mois qui a une cible mais aucun réel,
  // on injecte la cible dans payrollByMonth.
  for (const [month, targetMad] of targetPayrollByMonth) {
    const realMad = payrollByMonth.get(month) ?? 0;
    if (realMad <= 0 && targetMad > 0) {
      payrollByMonth.set(month, targetMad);
    }
  }

  if (payrollByMonth.size === 0) return new Map();

  // ─── 2. Projets candidats à l'allocation ─────────────────────────────
  let projects: ProjectRow[] = [];
  try {
    let q = admin
      .from('projects')
      .select('id, current_phase, status, onboarding_date, created_at, lost_at, livraison_date, is_preparation')
      .is('deleted_at', null);
    if (!includeLost) q = q.neq('status', 'perdu');
    if (!includePreparation) q = q.or('is_preparation.is.null,is_preparation.eq.false');
    const { data, error } = await q;
    if (error) {
      console.warn('[salary-allocation] projects fetch failed', error.message);
      return new Map();
    }
    projects = (data as any[]) ?? [];
  } catch (e: any) {
    console.warn('[salary-allocation] projects exception', e?.message);
    return new Map();
  }

  // ─── 3. Coefficients de phase + overrides ─────────────────────────────
  const phaseWeights = new Map<string, number>();
  const overrides = new Map<string, number>();
  try {
    const [{ data: weights }, { data: ovr }] = await Promise.all([
      admin.from('pl_phase_weights').select('phase, weight'),
      admin.from('project_pl_overrides').select('project_id, weight_multiplier'),
    ]);
    for (const w of (weights as any[]) ?? []) {
      phaseWeights.set(w.phase, Number(w.weight ?? 1));
    }
    for (const o of (ovr as any[]) ?? []) {
      overrides.set(o.project_id, Number(o.weight_multiplier ?? 1));
    }
  } catch (e: any) {
    console.warn('[salary-allocation] settings exception', e?.message);
  }

  // ─── 4. Calcul de la période active par projet ────────────────────────
  // Fournit aussi une fonction utilitaire isActiveAt(month) par projet.
  type Active = { id: string; phaseWeight: number; override: number; months: Set<string> };
  const actives: Active[] = [];
  const now = new Date();
  const nowMonth = toMonthKey(now);

  for (const p of projects) {
    const startDateRaw = p.onboarding_date ?? p.created_at;
    const startDate = parseDateMaybe(startDateRaw);
    if (!startDate) continue;

    // Fin = lost_at (perdu) | livraison_date | now
    let endDate: Date | null = null;
    if (p.status === 'perdu' && p.lost_at) endDate = parseDateMaybe(p.lost_at);
    else if (p.livraison_date) endDate = parseDateMaybe(p.livraison_date);
    if (!endDate) endDate = now;

    if (endDate.getTime() < startDate.getTime()) endDate = startDate;

    const months = new Set(monthsBetween(startDate, endDate));
    // Borner sur la fenêtre demandée si présente
    if (opts.fromMonth) for (const m of Array.from(months)) if (m < opts.fromMonth) months.delete(m);
    if (opts.toMonth)   for (const m of Array.from(months)) if (m > opts.toMonth)   months.delete(m);
    if (months.size === 0) continue;

    const phase = p.current_phase ?? 'sourcing';
    const phaseWeight = phaseWeights.get(phase) ?? 1.0;
    const override = overrides.get(p.id) ?? 1.0;

    actives.push({ id: p.id, phaseWeight, override, months });
  }

  // ─── 5. Initialiser le résultat ────────────────────────────────────────
  const result = new Map<string, ProjectAllocation>();
  for (const a of actives) {
    result.set(a.id, {
      project_id: a.id,
      total_weighted_eur: 0,
      total_flat_eur: 0,
      by_month: [],
    });
  }

  // ─── 6. Distribution mois par mois ─────────────────────────────────────
  // On itère sur la masse salariale (mois où il y a un coût) plutôt que
  // sur tous les mois théoriques — évite les boucles inutiles.
  const allMonths = Array.from(payrollByMonth.keys()).sort();
  for (const month of allMonths) {
    if (opts.fromMonth && month < opts.fromMonth) continue;
    if (opts.toMonth && month > opts.toMonth) continue;
    if (month > nowMonth) continue; // pas d'allocation dans le futur

    const payrollMad = payrollByMonth.get(month) ?? 0;
    if (payrollMad <= 0) continue;
    const payrollEur = payrollMad / MAD_PER_EUR;

    const activeThisMonth = actives.filter((a) => a.months.has(month));
    if (activeThisMonth.length === 0) continue;

    // Mode pondéré : somme des poids ce mois
    const sumWeights = activeThisMonth.reduce(
      (s, a) => s + a.phaseWeight * a.override,
      0,
    );

    // Mode plat : 1 / nb_projets
    const nbActive = activeThisMonth.length;

    for (const a of activeThisMonth) {
      const projectWeight = a.phaseWeight * a.override;
      const weightedShare = sumWeights > 0
        ? (projectWeight / sumWeights) * payrollEur
        : payrollEur / nbActive; // garde-fou : tous à 0 → fallback plat
      const flatShare = payrollEur / nbActive;

      const acc = result.get(a.id)!;
      acc.total_weighted_eur += weightedShare;
      acc.total_flat_eur += flatShare;
      acc.by_month.push({
        month,
        weighted: weightedShare,
        flat: flatShare,
      });
    }
  }

  // ─── 7. Arrondir à 2 décimales ─────────────────────────────────────────
  for (const acc of result.values()) {
    acc.total_weighted_eur = Math.round(acc.total_weighted_eur * 100) / 100;
    acc.total_flat_eur = Math.round(acc.total_flat_eur * 100) / 100;
    acc.by_month = acc.by_month.map((m) => ({
      month: m.month,
      weighted: Math.round(m.weighted * 100) / 100,
      flat: Math.round(m.flat * 100) / 100,
    }));
  }

  return result;
}

/**
 * Récupère la masse salariale réelle par mois (EUR), utile pour la page
 * /settings/pl-config pour comparer avec la cible saisie par le CEO.
 */
export async function getActualPayrollByMonth(opts: {
  fromMonth?: string;
  toMonth?: string;
} = {}): Promise<Array<{ month: string; amount_eur: number; nb_lines: number }>> {
  const admin = createAdminClient();
  try {
    const { data, error } = await admin
      .from('bank_transaction_allocations')
      .select('amount_mad, transaction_id, bank_transactions!inner(operation_date)')
      .is('deleted_at', null)
      .in('allocation_type', ['cabinet_charge', 'cabinet_fiscal', 'cabinet_social']);

    if (error) {
      console.warn('[salary-allocation] actual payroll fetch failed', error.message);
      return [];
    }

    const agg = new Map<string, { mad: number; nb: number }>();
    for (const row of (data as any[]) ?? []) {
      const opDate: string | null = row?.bank_transactions?.operation_date ?? null;
      if (!opDate) continue;
      const d = parseDateMaybe(opDate);
      if (!d) continue;
      const month = toMonthKey(d);
      if (opts.fromMonth && month < opts.fromMonth) continue;
      if (opts.toMonth && month > opts.toMonth) continue;
      const cur = agg.get(month) ?? { mad: 0, nb: 0 };
      cur.mad += Number(row.amount_mad ?? 0);
      cur.nb += 1;
      agg.set(month, cur);
    }

    const out: Array<{ month: string; amount_eur: number; nb_lines: number }> = [];
    for (const [month, v] of agg) {
      out.push({
        month,
        amount_eur: Math.round((v.mad / MAD_PER_EUR) * 100) / 100,
        nb_lines: v.nb,
      });
    }
    out.sort((a, b) => a.month.localeCompare(b.month));
    return out;
  } catch (e: any) {
    console.warn('[salary-allocation] actual payroll exception', e?.message);
    return [];
  }
}
