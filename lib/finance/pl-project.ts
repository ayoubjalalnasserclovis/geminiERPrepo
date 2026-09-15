import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { MAD_PER_EUR } from './fx-fixed';
import { calculateTravauxKPIs } from './travaux-calc';
import { calculateAchatsKPIs } from './achats-calc';
import { calculateSalaryAllocationByProject, type ProjectAllocation } from './salary-allocation';

/**
 * P&L par projet — consolidation honoraires + travaux + achats + salaires alloués
 * (CEO 2026-06-30 Phase B1).
 *
 * ─── Structure ────────────────────────────────────────────────────────────
 * 4 colonnes par projet :
 *
 *   1. Honoraires (cabinet Stoniz) — EUR
 *      revenus = somme payments.amount_paid (status paid/partial)
 *      charges_services = somme services_payments.amount_paid
 *      charges_salaires = allocation calculée (weighted ou flat) sur la
 *                         période active du projet
 *      marge = revenus − services − salaires
 *
 *   2. Travaux — MAD (canon travaux-calc.ts)
 *      forfait_vendu, devis_artisans, marge réelle, trésorerie
 *
 *   3. Achats — MAD (canon achats-calc.ts)
 *      forfait_vendu, devis_fournisseurs, marge réelle
 *
 *   4. Total
 *      marge_totale = honoraires.marge + travaux.marge_eur + achats.marge_eur
 *      (travaux + achats convertis en EUR au taux 10)
 *
 * Devise : EUR partout pour le total + la part honoraires.
 *          MAD conservé pour travaux + achats (canon historique), avec
 *          marges converties en EUR pour la somme finale.
 *
 * Perdus : inclus mais marqués `status='perdu'` — le caller décide
 * d'afficher ou pas (étiquette "investissement perdu" attendue en UI).
 * ─────────────────────────────────────────────────────────────────────────
 */

export type PLProjectSummary = {
  project_id: string;
  project_reference: string;
  client_name: string | null;
  current_phase: string | null;
  status: string | null;
  is_lost: boolean;

  // ─── Honoraires (cabinet Stoniz) — EUR ────────────────────────────────
  honoraires: {
    revenus_eur: number;
    charges_services_eur: number;
    charges_salaires_weighted_eur: number;
    charges_salaires_flat_eur: number;
    marge_weighted_eur: number;
    marge_flat_eur: number;
    marge_weighted_pct: number;
    marge_flat_pct: number;
  };

  // ─── Travaux — MAD (avec conversion EUR pour totalisation) ─────────────
  travaux: {
    forfait_vendu_mad: number;
    devis_artisans_mad: number;
    marge_mad: number;
    marge_pct: number;
    tresorerie_mad: number;
    marge_eur: number; // marge_mad ÷ 10
  };

  // ─── Achats — MAD ──────────────────────────────────────────────────────
  achats: {
    forfait_vendu_mad: number;
    devis_fournisseurs_mad: number;
    marge_mad: number;
    marge_pct: number;
    marge_eur: number;
  };

  // ─── Total — EUR ───────────────────────────────────────────────────────
  marge_totale_weighted_eur: number;
  marge_totale_flat_eur: number;
};

export type PLProjectFilters = {
  phase?: string;
  client_id?: string;
  /** 'actif' | 'termine' | 'perdu' | 'pause' | 'all' (défaut: all) */
  status?: string;
  /** Inclure les projets de préparation (défaut: false). */
  includePreparation?: boolean;
};

// ─── Helpers internes ───────────────────────────────────────────────────────

function safeNum(v: any): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function pct(num: number, denom: number): number {
  if (denom <= 0) return 0;
  return Math.round((num / denom) * 1000) / 10;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─── Cœur du calcul ─────────────────────────────────────────────────────────

/**
 * Construit un PLProjectSummary à partir des données déjà chargées en
 * mémoire (pour éviter N+1 en mode batch). Utilisé par `getPLAllProjects`
 * et `getPLProject` (qui n'est qu'un cas particulier à 1 projet).
 */
function buildSummary(
  project: any,
  honorairesPayments: any[],   // payments du projet (honoraires)
  servicesPayments: any[],     // services_payments du projet
  travauxLots: any[],
  travauxPayments: any[],
  travauxEncaissements: any[],
  achatsLots: any[],
  achatsPayments: any[],
  achatsEncaissements: any[],
  allocation: ProjectAllocation | undefined,
): PLProjectSummary {
  // ─── Honoraires — revenus = sum(amount_paid) status paid/partial ─────
  const revenus_eur = honorairesPayments
    .filter((p) => p.status === 'paid' || p.status === 'partial')
    .reduce((s, p) => s + safeNum(p.amount_paid), 0);

  // Charges services (architecte, géomètre, etc.) — MAD → EUR
  const charges_services_mad = servicesPayments.reduce(
    (s, p) => s + safeNum(p.amount_paid),
    0,
  );
  const charges_services_eur = charges_services_mad / MAD_PER_EUR;

  const charges_salaires_weighted_eur = allocation?.total_weighted_eur ?? 0;
  const charges_salaires_flat_eur = allocation?.total_flat_eur ?? 0;

  const marge_weighted_eur =
    revenus_eur - charges_services_eur - charges_salaires_weighted_eur;
  const marge_flat_eur =
    revenus_eur - charges_services_eur - charges_salaires_flat_eur;

  // ─── Travaux ─────────────────────────────────────────────────────────
  const travauxKpis = calculateTravauxKPIs({
    lots: travauxLots.map((l) => ({
      id: l.id,
      budget_estimate_mad: l.budget_estimate_mad,
      devis_artisan_mad: l.devis_artisan_mad,
      facture_client_mad: l.facture_client_mad,
      status: l.status,
    })),
    payments: travauxPayments
      .filter((p) => p.lot_id) // canon dashboard : on exclut les rattachements null
      .map((p) => ({ lot_id: p.lot_id, amount_paid: p.amount_paid })),
    encaissements: travauxEncaissements.map((e) => ({
      amount_mad: e.amount_mad,
      status: e.status,
    })),
    budgetVenduClient: safeNum(project.travaux_budget_mad),
    margeCiblePct: safeNum(project.travaux_marge_cible_pct) || 30,
  });

  // ─── Achats ──────────────────────────────────────────────────────────
  const achatsKpis = calculateAchatsKPIs({
    lots: achatsLots.map((l) => ({
      id: l.id,
      budget_estimate_mad: l.budget_estimate_mad,
      devis_fournisseur_mad: l.devis_fournisseur_mad,
      facture_client_mad: l.facture_client_mad,
      status: l.status,
    })),
    payments: achatsPayments
      .filter((p) => p.lot_id)
      .map((p) => ({ lot_id: p.lot_id, amount_paid: p.amount_paid })),
    encaissements: achatsEncaissements.map((e) => ({
      amount_mad: e.amount_mad,
      status: e.status,
    })),
    budgetVenduClient: safeNum(project.achats_budget_mad),
    margeCiblePct: safeNum(project.achats_marge_cible_pct) || 25,
  });

  const travaux_marge_eur = travauxKpis.marge_reelle / MAD_PER_EUR;
  const achats_marge_eur = achatsKpis.marge_reelle / MAD_PER_EUR;

  const marge_totale_weighted_eur =
    marge_weighted_eur + travaux_marge_eur + achats_marge_eur;
  const marge_totale_flat_eur =
    marge_flat_eur + travaux_marge_eur + achats_marge_eur;

  return {
    project_id: project.id,
    project_reference: project.reference ?? '',
    client_name:
      project.client?.full_name ??
      (project.client?.first_name || project.client?.last_name
        ? `${project.client?.first_name ?? ''} ${project.client?.last_name ?? ''}`.trim()
        : null),
    current_phase: project.current_phase ?? null,
    status: project.status ?? null,
    is_lost: project.status === 'perdu',

    honoraires: {
      revenus_eur: round2(revenus_eur),
      charges_services_eur: round2(charges_services_eur),
      charges_salaires_weighted_eur: round2(charges_salaires_weighted_eur),
      charges_salaires_flat_eur: round2(charges_salaires_flat_eur),
      marge_weighted_eur: round2(marge_weighted_eur),
      marge_flat_eur: round2(marge_flat_eur),
      marge_weighted_pct: pct(marge_weighted_eur, revenus_eur),
      marge_flat_pct: pct(marge_flat_eur, revenus_eur),
    },

    travaux: {
      forfait_vendu_mad: round2(travauxKpis.reference_client_mad),
      devis_artisans_mad: round2(travauxKpis.devis_artisans_total),
      marge_mad: round2(travauxKpis.marge_reelle),
      marge_pct: travauxKpis.marge_pct,
      tresorerie_mad: round2(travauxKpis.tresorerie_a_date),
      marge_eur: round2(travaux_marge_eur),
    },

    achats: {
      forfait_vendu_mad: round2(achatsKpis.reference_client_mad),
      devis_fournisseurs_mad: round2(achatsKpis.devis_fournisseurs_total),
      marge_mad: round2(achatsKpis.marge_reelle),
      marge_pct: achatsKpis.marge_pct,
      marge_eur: round2(achats_marge_eur),
    },

    marge_totale_weighted_eur: round2(marge_totale_weighted_eur),
    marge_totale_flat_eur: round2(marge_totale_flat_eur),
  };
}

// ─── API publique ───────────────────────────────────────────────────────────

/**
 * P&L détaillé d'un seul projet.
 * Charge la donnée projet + lots + paiements + allocation salaires.
 */
export async function getPLProject(projectId: string): Promise<PLProjectSummary | null> {
  const admin = createAdminClient();

  try {
    // Projet + client en une requête
    const { data: project, error: projErr } = await admin
      .from('projects')
      .select(
        'id, reference, current_phase, status, onboarding_date, created_at, lost_at, livraison_date, travaux_budget_mad, achats_budget_mad, travaux_marge_cible_pct, achats_marge_cible_pct, client:clients(id, full_name, first_name, last_name)',
      )
      .eq('id', projectId)
      .is('deleted_at', null)
      .maybeSingle();
    if (projErr || !project) {
      if (projErr) console.warn('[pl-project] getPLProject project fetch', projErr.message);
      return null;
    }

    const [
      payRes,
      svcPayRes,
      tvxLotsRes,
      tvxPayRes,
      tvxEncRes,
      achLotsRes,
      achPayRes,
      achEncRes,
      allocations,
    ] = await Promise.all([
      admin.from('payments').select('amount_paid, status, type').eq('project_id', projectId).is('deleted_at', null),
      admin.from('services_payments').select('amount_paid').eq('project_id', projectId).is('deleted_at', null),
      admin.from('travaux_lots').select('id, budget_estimate_mad, devis_artisan_mad, facture_client_mad, status').eq('project_id', projectId).is('deleted_at', null),
      admin.from('travaux_payments').select('lot_id, amount_paid').eq('project_id', projectId).is('deleted_at', null),
      admin.from('travaux_encaissements').select('amount_mad, status').eq('project_id', projectId).is('deleted_at', null),
      admin.from('achats_lots').select('id, budget_estimate_mad, devis_fournisseur_mad, facture_client_mad, status').eq('project_id', projectId).is('deleted_at', null),
      admin.from('achats_payments').select('lot_id, amount_paid').eq('project_id', projectId).is('deleted_at', null),
      admin.from('achats_encaissements').select('amount_mad, status').eq('project_id', projectId).is('deleted_at', null),
      calculateSalaryAllocationByProject(),
    ]);

    return buildSummary(
      project,
      (payRes.data as any[]) ?? [],
      (svcPayRes.data as any[]) ?? [],
      (tvxLotsRes.data as any[]) ?? [],
      (tvxPayRes.data as any[]) ?? [],
      (tvxEncRes.data as any[]) ?? [],
      (achLotsRes.data as any[]) ?? [],
      (achPayRes.data as any[]) ?? [],
      (achEncRes.data as any[]) ?? [],
      allocations.get(projectId),
    );
  } catch (e: any) {
    console.warn('[pl-project] getPLProject exception', e?.message);
    return null;
  }
}

/**
 * P&L de tous les projets (avec filtres optionnels).
 * Pattern dashboard : 1 SELECT par table + jointures en mémoire.
 */
export async function getPLAllProjects(
  filters: PLProjectFilters = {},
): Promise<PLProjectSummary[]> {
  const admin = createAdminClient();

  try {
    // Build query projets avec filtres
    let q = admin
      .from('projects')
      .select(
        'id, reference, current_phase, status, onboarding_date, created_at, lost_at, livraison_date, travaux_budget_mad, achats_budget_mad, travaux_marge_cible_pct, achats_marge_cible_pct, client_id, client:clients(id, full_name, first_name, last_name), is_preparation',
      )
      .is('deleted_at', null);
    if (filters.phase) q = q.eq('current_phase', filters.phase);
    if (filters.client_id) q = q.eq('client_id', filters.client_id);
    if (filters.status && filters.status !== 'all') q = q.eq('status', filters.status);
    if (!filters.includePreparation) {
      q = q.or('is_preparation.is.null,is_preparation.eq.false');
    }

    const { data: projects, error: projErr } = await q;
    if (projErr) {
      console.warn('[pl-project] getPLAllProjects projects fetch', projErr.message);
      return [];
    }
    const projectIds = (projects ?? []).map((p: any) => p.id);
    if (projectIds.length === 0) return [];

    // Pré-charger TOUT en parallèle (1 SELECT par table, filtré sur project_id IN (...))
    const [
      payRes,
      svcPayRes,
      tvxLotsRes,
      tvxPayRes,
      tvxEncRes,
      achLotsRes,
      achPayRes,
      achEncRes,
      allocations,
    ] = await Promise.all([
      admin.from('payments').select('project_id, amount_paid, status, type').in('project_id', projectIds).is('deleted_at', null),
      admin.from('services_payments').select('project_id, amount_paid').in('project_id', projectIds).is('deleted_at', null),
      admin.from('travaux_lots').select('id, project_id, budget_estimate_mad, devis_artisan_mad, facture_client_mad, status').in('project_id', projectIds).is('deleted_at', null),
      admin.from('travaux_payments').select('project_id, lot_id, amount_paid').in('project_id', projectIds).is('deleted_at', null),
      admin.from('travaux_encaissements').select('project_id, amount_mad, status').in('project_id', projectIds).is('deleted_at', null),
      admin.from('achats_lots').select('id, project_id, budget_estimate_mad, devis_fournisseur_mad, facture_client_mad, status').in('project_id', projectIds).is('deleted_at', null),
      admin.from('achats_payments').select('project_id, lot_id, amount_paid').in('project_id', projectIds).is('deleted_at', null),
      admin.from('achats_encaissements').select('project_id, amount_mad, status').in('project_id', projectIds).is('deleted_at', null),
      calculateSalaryAllocationByProject(),
    ]);

    // Indexer par project_id pour boucler en O(N)
    const indexBy = <T extends { project_id: string }>(rows: T[] | null | undefined) => {
      const m = new Map<string, T[]>();
      for (const r of rows ?? []) {
        const arr = m.get(r.project_id);
        if (arr) arr.push(r);
        else m.set(r.project_id, [r]);
      }
      return m;
    };

    const payMap = indexBy((payRes.data as any[]) ?? []);
    const svcMap = indexBy((svcPayRes.data as any[]) ?? []);
    const tvxLotsMap = indexBy((tvxLotsRes.data as any[]) ?? []);
    const tvxPayMap = indexBy((tvxPayRes.data as any[]) ?? []);
    const tvxEncMap = indexBy((tvxEncRes.data as any[]) ?? []);
    const achLotsMap = indexBy((achLotsRes.data as any[]) ?? []);
    const achPayMap = indexBy((achPayRes.data as any[]) ?? []);
    const achEncMap = indexBy((achEncRes.data as any[]) ?? []);

    const out: PLProjectSummary[] = [];
    for (const project of projects as any[]) {
      const summary = buildSummary(
        project,
        payMap.get(project.id) ?? [],
        svcMap.get(project.id) ?? [],
        tvxLotsMap.get(project.id) ?? [],
        tvxPayMap.get(project.id) ?? [],
        tvxEncMap.get(project.id) ?? [],
        achLotsMap.get(project.id) ?? [],
        achPayMap.get(project.id) ?? [],
        achEncMap.get(project.id) ?? [],
        allocations.get(project.id),
      );
      out.push(summary);
    }
    return out;
  } catch (e: any) {
    console.warn('[pl-project] getPLAllProjects exception', e?.message);
    return [];
  }
}
