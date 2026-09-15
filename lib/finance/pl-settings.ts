import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { logFinanceAudit } from './audit';

/**
 * CRUD des réglages P&L par projet (CEO 2026-06-30).
 *
 * 3 entités gérées :
 *   • pl_phase_weights              — coefficients globaux par phase
 *   • pl_target_payroll_monthly     — masse salariale cible mensuelle
 *   • project_pl_overrides          — multiplicateur d'override par projet
 *
 * Toutes les écritures passent par `logFinanceAudit` (avec un type 'documents'
 * en attendant d'étendre l'enum FinanceAuditTable — V1 acceptable, on remappera
 * en B2 sur la page /settings/pl-config).
 */

export type PhaseWeight = {
  phase: string;
  weight: number;
  updated_at: string | null;
  updated_by: string | null;
};

export type TargetPayroll = {
  month: string; // YYYY-MM
  amount_eur: number;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

export type ProjectOverride = {
  project_id: string;
  weight_multiplier: number;
  notes: string | null;
  updated_at: string | null;
  updated_by: string | null;
};

// ─── Lecture ────────────────────────────────────────────────────────────────

export async function getPhaseWeights(): Promise<PhaseWeight[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('pl_phase_weights')
      .select('phase, weight, updated_at, updated_by')
      .order('phase');
    if (error) {
      console.warn('[pl-settings] getPhaseWeights failed', error.message);
      return [];
    }
    return ((data as any[]) ?? []).map((r) => ({
      phase: String(r.phase),
      weight: Number(r.weight),
      updated_at: r.updated_at ?? null,
      updated_by: r.updated_by ?? null,
    }));
  } catch (e: any) {
    console.warn('[pl-settings] getPhaseWeights exception', e?.message);
    return [];
  }
}

export async function getTargetPayrolls(
  fromMonth?: string,
  toMonth?: string,
): Promise<TargetPayroll[]> {
  try {
    const admin = createAdminClient();
    let q = admin
      .from('pl_target_payroll_monthly')
      .select('month, amount_eur, notes, updated_at, updated_by')
      .order('month');
    if (fromMonth) q = q.gte('month', fromMonth);
    if (toMonth) q = q.lte('month', toMonth);
    const { data, error } = await q;
    if (error) {
      console.warn('[pl-settings] getTargetPayrolls failed', error.message);
      return [];
    }
    return ((data as any[]) ?? []).map((r) => ({
      month: String(r.month),
      amount_eur: Number(r.amount_eur),
      notes: r.notes ?? null,
      updated_at: r.updated_at ?? null,
      updated_by: r.updated_by ?? null,
    }));
  } catch (e: any) {
    console.warn('[pl-settings] getTargetPayrolls exception', e?.message);
    return [];
  }
}

export async function getProjectOverrides(): Promise<ProjectOverride[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('project_pl_overrides')
      .select('project_id, weight_multiplier, notes, updated_at, updated_by');
    if (error) {
      console.warn('[pl-settings] getProjectOverrides failed', error.message);
      return [];
    }
    return ((data as any[]) ?? []).map((r) => ({
      project_id: String(r.project_id),
      weight_multiplier: Number(r.weight_multiplier),
      notes: r.notes ?? null,
      updated_at: r.updated_at ?? null,
      updated_by: r.updated_by ?? null,
    }));
  } catch (e: any) {
    console.warn('[pl-settings] getProjectOverrides exception', e?.message);
    return [];
  }
}

export async function getProjectOverride(
  projectId: string,
): Promise<ProjectOverride | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('project_pl_overrides')
      .select('project_id, weight_multiplier, notes, updated_at, updated_by')
      .eq('project_id', projectId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      project_id: String((data as any).project_id),
      weight_multiplier: Number((data as any).weight_multiplier),
      notes: (data as any).notes ?? null,
      updated_at: (data as any).updated_at ?? null,
      updated_by: (data as any).updated_by ?? null,
    };
  } catch (e: any) {
    console.warn('[pl-settings] getProjectOverride exception', e?.message);
    return null;
  }
}

// ─── Écriture (audit loggée) ────────────────────────────────────────────────

export async function setPhaseWeight(
  phase: string,
  weight: number,
  actorId: string,
): Promise<void> {
  const admin = createAdminClient();

  // Capture before pour audit diff
  const { data: before } = await admin
    .from('pl_phase_weights')
    .select('phase, weight')
    .eq('phase', phase)
    .maybeSingle();
  const beforeWeight = before ? Number((before as any).weight) : null;

  const { error } = await admin
    .from('pl_phase_weights')
    .upsert(
      { phase, weight, updated_at: new Date().toISOString(), updated_by: actorId } as any,
      { onConflict: 'phase' },
    );
  if (error) {
    console.warn('[pl-settings] setPhaseWeight failed', error.message);
    throw new Error(`Impossible de sauvegarder le coefficient: ${error.message}`);
  }

  // Audit best-effort — ID = phase comme c'est la PK
  await logFinanceAudit({
    table: 'documents', // V1 — sera remplacé par 'pl_phase_weights' en B2 quand on étendra l'enum
    recordId: phase,
    action: 'update',
    actorId,
    label: `Coefficient phase ${phase} : ${beforeWeight ?? '∅'} → ${weight}`,
    payload: { entity: 'pl_phase_weights', phase, before: beforeWeight, after: weight },
  });
}

export async function setTargetPayroll(
  month: string,
  amount: number,
  notes: string | null,
  actorId: string,
): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error(`Format de mois invalide : "${month}" (attendu YYYY-MM)`);
  }
  if (amount < 0) {
    throw new Error('Le montant doit être ≥ 0');
  }
  const admin = createAdminClient();

  const { data: before } = await admin
    .from('pl_target_payroll_monthly')
    .select('amount_eur, notes')
    .eq('month', month)
    .maybeSingle();
  const beforeAmount = before ? Number((before as any).amount_eur) : null;

  const { error } = await admin
    .from('pl_target_payroll_monthly')
    .upsert(
      {
        month,
        amount_eur: amount,
        notes,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      } as any,
      { onConflict: 'month' },
    );
  if (error) {
    console.warn('[pl-settings] setTargetPayroll failed', error.message);
    throw new Error(`Impossible de sauvegarder la cible: ${error.message}`);
  }

  await logFinanceAudit({
    table: 'documents',
    recordId: month,
    action: 'update',
    actorId,
    label: `Cible masse salariale ${month} : ${beforeAmount ?? '∅'} → ${amount} €`,
    payload: {
      entity: 'pl_target_payroll_monthly',
      month,
      before: beforeAmount,
      after: amount,
      notes,
    },
  });
}

export async function setProjectOverride(
  projectId: string,
  multiplier: number,
  notes: string | null,
  actorId: string,
): Promise<void> {
  if (multiplier < 0 || multiplier > 10) {
    throw new Error('Le multiplicateur doit être entre 0 et 10');
  }
  const admin = createAdminClient();

  const { data: before } = await admin
    .from('project_pl_overrides')
    .select('weight_multiplier, notes')
    .eq('project_id', projectId)
    .maybeSingle();
  const beforeMult = before ? Number((before as any).weight_multiplier) : null;

  const { error } = await admin
    .from('project_pl_overrides')
    .upsert(
      {
        project_id: projectId,
        weight_multiplier: multiplier,
        notes,
        updated_at: new Date().toISOString(),
        updated_by: actorId,
      } as any,
      { onConflict: 'project_id' },
    );
  if (error) {
    console.warn('[pl-settings] setProjectOverride failed', error.message);
    throw new Error(`Impossible de sauvegarder l'override: ${error.message}`);
  }

  await logFinanceAudit({
    table: 'documents',
    recordId: projectId,
    action: 'update',
    actorId,
    label: `Override projet : ${beforeMult ?? '∅'} → ${multiplier}`,
    payload: {
      entity: 'project_pl_overrides',
      project_id: projectId,
      before: beforeMult,
      after: multiplier,
      notes,
    },
  });
}

export async function deleteProjectOverride(
  projectId: string,
  actorId: string,
): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from('project_pl_overrides')
    .delete()
    .eq('project_id', projectId);
  if (error) {
    console.warn('[pl-settings] deleteProjectOverride failed', error.message);
    throw new Error(`Impossible de supprimer l'override: ${error.message}`);
  }
  await logFinanceAudit({
    table: 'documents',
    recordId: projectId,
    action: 'delete',
    actorId,
    label: 'Override projet supprimé',
    payload: { entity: 'project_pl_overrides', project_id: projectId },
  });
}
