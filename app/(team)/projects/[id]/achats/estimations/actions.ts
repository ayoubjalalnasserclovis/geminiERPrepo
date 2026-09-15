'use server';

// ─── Estimations achats (CEO 2026-08-19, session B roadmap évolutions) ─────
//
// Cloisonnement TOTAL : ces actions n'écrivent dans le suivi réel QUE via
// convertEstimationToLotAction (création explicite d'un lot réel, verrouillage
// de la ligne source). Aucun KPI réel ne lit achats_estimations.
//
// Décision CEO 2026-08-19 : à la conversion, prix_estime_mad pré-remplit le
// DEVIS PRÉVISIONNEL (budget_estimate_mad) du lot réel — le devis fournisseur
// reste vide jusqu'au vrai devis signé.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';
import { logDeletion } from '@/lib/audit/deletion';

const ROLES = ['ceo', 'chef_projet', 'finance', 'achats'] as const;

const estimationSchema = z.object({
  project_id: z.string().uuid(),
  category: z.string(),
  description: z.string().optional().nullable(),
  supplier_name: z.string().optional().nullable(), // optionnel : fournisseur pas toujours connu
  supplier_id: z.string().uuid().optional().nullable(),
  quantity: z.coerce.number().min(0).optional().nullable(),
  unit_price_mad: z.coerce.number().min(0).optional().nullable(),
  prix_estime_mad: z.coerce.number().min(0).optional().nullable(),
  propria_unit_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function cleanEstimation(raw: any) {
  const o = { ...raw };
  for (const k of ['description', 'supplier_name', 'notes', 'supplier_id', 'propria_unit_id']) {
    if (o[k] === '') o[k] = null;
  }
  for (const k of ['quantity', 'unit_price_mad', 'prix_estime_mad']) {
    if (o[k] === '' || o[k] == null) o[k] = null;
    else o[k] = Number(o[k]);
  }
  return o;
}

export async function createEstimationAction(input: unknown) {
  const user = await assertRole([...ROLES]);
  const parsed = estimationSchema.safeParse(cleanEstimation(input));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: maxRow } = await supabase
    .from('achats_estimations')
    .select('numero')
    .eq('project_id', parsed.data.project_id)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (maxRow?.numero ?? 0) + 1;

  const { data: inserted, error } = await supabase
    .from('achats_estimations')
    .insert({ ...parsed.data, numero, status: 'estime', created_by: user.id })
    .select('id')
    .single();
  if (error) return { ok: false as const, error: error.message };

  if (inserted?.id) {
    await logFinanceAudit({
      table: 'achats_estimations',
      recordId: inserted.id,
      action: 'create',
      actorId: user.id,
      label: `Estimation #${numero} créée · ${parsed.data.description ?? parsed.data.category} · ${parsed.data.prix_estime_mad ?? 0} MAD`,
      payload: {
        numero,
        category: parsed.data.category,
        supplier_name: parsed.data.supplier_name,
        prix_estime_mad: parsed.data.prix_estime_mad,
      },
    });
  }

  revalidatePath(`/projects/${parsed.data.project_id}/achats/estimations`);
  return { ok: true as const };
}

export async function updateEstimationAction(estimationId: string, input: unknown) {
  const user = await assertRole([...ROLES]);
  const parsed = estimationSchema.partial().safeParse(cleanEstimation(input));
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('achats_estimations').select('*').eq('id', estimationId).single();
  if (!existing) return { ok: false as const, error: 'Estimation introuvable' };
  if ((existing as any).status === 'converti') {
    return { ok: false as const, error: 'Estimation convertie en lot réel — verrouillée. Modifie le lot réel directement.' };
  }

  const { error } = await supabase
    .from('achats_estimations').update(parsed.data).eq('id', estimationId);
  if (error) return { ok: false as const, error: error.message };

  const diff = computeFinanceDiff(existing as any, parsed.data as any, [
    'category', 'description', 'supplier_name', 'supplier_id',
    'quantity', 'unit_price_mad', 'prix_estime_mad', 'propria_unit_id', 'notes',
  ]);
  if (Object.keys(diff).length > 0) {
    await logFinanceAudit({
      table: 'achats_estimations',
      recordId: estimationId,
      action: 'update',
      actorId: user.id,
      label: `Estimation #${(existing as any).numero} modifiée (${Object.keys(diff).join(', ')})`,
      payload: diff,
    });
  }

  revalidatePath(`/projects/${(existing as any).project_id}/achats/estimations`);
  return { ok: true as const };
}

/** Basculer estime ↔ abandonne (une estimation convertie est verrouillée). */
export async function setEstimationStatusAction(estimationId: string, status: 'estime' | 'abandonne') {
  const user = await assertRole([...ROLES]);
  const supabase = createClient();
  const { data: existing } = await supabase
    .from('achats_estimations').select('id, project_id, numero, status').eq('id', estimationId).single();
  if (!existing) return { ok: false as const, error: 'Estimation introuvable' };
  if ((existing as any).status === 'converti') {
    return { ok: false as const, error: 'Estimation convertie — verrouillée.' };
  }
  if ((existing as any).status === status) return { ok: true as const };

  const { error } = await supabase
    .from('achats_estimations').update({ status }).eq('id', estimationId).neq('status', 'converti');
  if (error) return { ok: false as const, error: error.message };

  await logFinanceAudit({
    table: 'achats_estimations',
    recordId: estimationId,
    action: 'status_change',
    actorId: user.id,
    label: `Estimation #${(existing as any).numero} : ${(existing as any).status} → ${status}`,
    payload: { status: { before: (existing as any).status, after: status } },
  });

  revalidatePath(`/projects/${(existing as any).project_id}/achats/estimations`);
  return { ok: true as const };
}

export async function deleteEstimationAction(estimationId: string) {
  const user = await assertRole([...ROLES]);
  const supabase = createClient();
  const { data: est } = await supabase
    .from('achats_estimations').select('*').eq('id', estimationId).single();
  if (!est) return { ok: false as const, error: 'Estimation introuvable' };
  if ((est as any).status === 'converti') {
    return { ok: false as const, error: 'Estimation convertie — verrouillée (trace de la conversion). Abandonne plutôt les lignes non converties.' };
  }

  const { error } = await supabase
    .from('achats_estimations')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', estimationId);
  if (error) return { ok: false as const, error: error.message };

  await logDeletion({
    table: 'achats_estimations',
    recordId: estimationId,
    actorId: user.id,
    label: `Estimation achats #${(est as any).numero} - ${(est as any).description ?? (est as any).category} - ${(est as any).prix_estime_mad ?? 0} MAD`,
    snapshot: est,
  });
  await logFinanceAudit({
    table: 'achats_estimations',
    recordId: estimationId,
    action: 'delete',
    actorId: user.id,
    label: `Estimation #${(est as any).numero} supprimée`,
    payload: { numero: (est as any).numero, prix_estime_mad: (est as any).prix_estime_mad },
  });

  revalidatePath(`/projects/${(est as any).project_id}/achats/estimations`);
  return { ok: true as const };
}

/**
 * Convertit une estimation en lot réel :
 *   1. Crée le lot dans achats_lots (numero max+1, statut a_commander,
 *      budget_estimate_mad = prix_estime_mad, devis fournisseur VIDE).
 *   2. Verrouille la ligne source : status='converti' + converted_lot_id
 *      (UNIQUE en BDD = double conversion impossible même en course).
 *
 * L'update de verrouillage est conditionné à status='estime' : si 2 clics
 * simultanés arrivent, le 2e ne matche plus aucune ligne → le lot créé par le
 * 2e est soft-deleté (rollback) et l'action échoue proprement.
 */
export async function convertEstimationToLotAction(estimationId: string) {
  const user = await assertRole([...ROLES]);
  const supabase = createClient();

  const { data: est } = await supabase
    .from('achats_estimations').select('*').eq('id', estimationId).is('deleted_at', null).single();
  if (!est) return { ok: false as const, error: 'Estimation introuvable' };
  if ((est as any).status !== 'estime') {
    return {
      ok: false as const,
      error: (est as any).status === 'converti'
        ? 'Déjà convertie en lot réel — pas de double conversion.'
        : 'Estimation abandonnée — réactive-la avant de la convertir.',
    };
  }

  // 1. Créer le lot réel
  const { data: maxRow } = await supabase
    .from('achats_lots')
    .select('numero')
    .eq('project_id', (est as any).project_id)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (maxRow?.numero ?? 0) + 1;

  const { data: lot, error: lotErr } = await supabase
    .from('achats_lots')
    .insert({
      project_id: (est as any).project_id,
      numero,
      category: (est as any).category,
      description: (est as any).description,
      // achats_lots.supplier_name est NOT NULL — repli explicite si le
      // fournisseur n'était pas encore connu à l'estimation.
      supplier_name: (est as any).supplier_name ?? 'À définir',
      supplier_id: (est as any).supplier_id,
      budget_estimate_mad: (est as any).prix_estime_mad, // ← décision CEO : prévisionnel seul
      quantity: (est as any).quantity,
      unit_price_mad: (est as any).unit_price_mad,
      propria_unit_id: (est as any).propria_unit_id,
      notes: (est as any).notes,
      status: 'a_commander',
      collaborator_id: user.id,
    })
    .select('id')
    .single();
  if (lotErr || !lot) return { ok: false as const, error: lotErr?.message ?? 'Échec de création du lot' };

  // 2. Verrouiller la ligne source (conditionné à status='estime')
  const { data: locked, error: lockErr } = await supabase
    .from('achats_estimations')
    .update({
      status: 'converti',
      converted_lot_id: lot.id,
      converted_at: new Date().toISOString(),
      converted_by: user.id,
    })
    .eq('id', estimationId)
    .eq('status', 'estime')
    .select('id');

  if (lockErr || !locked || locked.length === 0) {
    // Course perdue ou contrainte : rollback du lot créé (soft-delete canon)
    await supabase.from('achats_lots').update({ deleted_at: new Date().toISOString() }).eq('id', lot.id);
    return { ok: false as const, error: lockErr?.message ?? 'Conversion déjà effectuée par ailleurs — lot annulé.' };
  }

  await logFinanceAudit({
    table: 'achats_lots',
    recordId: lot.id,
    action: 'create',
    actorId: user.id,
    label: `Lot achats #${numero} créé par conversion de l'estimation #${(est as any).numero}`,
    payload: {
      from_estimation_id: estimationId,
      from_estimation_numero: (est as any).numero,
      budget_estimate_mad: (est as any).prix_estime_mad,
    },
  });
  await logFinanceAudit({
    table: 'achats_estimations',
    recordId: estimationId,
    action: 'status_change',
    actorId: user.id,
    label: `Estimation #${(est as any).numero} convertie → lot réel #${numero}`,
    payload: { status: { before: 'estime', after: 'converti' }, converted_lot_id: lot.id },
  });

  revalidatePath(`/projects/${(est as any).project_id}/achats/estimations`);
  revalidatePath(`/projects/${(est as any).project_id}/achats`);
  return { ok: true as const, lotNumero: numero };
}
