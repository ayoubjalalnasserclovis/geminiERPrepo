'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { paymentUpdateSchema, travauxPaymentCreateSchema, stonizScheduleUpdateSchema } from '@/lib/validators/schemas';
import { getEurMadRate } from '@/lib/fx/exchange-rate';
import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';

export async function updatePaymentAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance']);
  const parsed = paymentUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();

  // Tous les rôles autorisés ci-dessus peuvent enregistrer un paiement reçu
  // (amount_paid, paid_at, mode, notes).
  //
  // Décalage d'échéance (due_date) : CEO + chef_projet + finance. Depuis le
  // 2026-07-10 le chef de projet peut aussi décaler une date pour la synchroniser
  // avec la réalité chantier — sans toucher au montant.
  //
  // Modification du MONTANT ATTENDU (amount_expected) : CEO + finance uniquement,
  // parce que c'est un acte de pilotage barème/cabinet.
  const canEditDueDate = user.role === 'ceo' || user.role === 'chef_projet' || user.role === 'finance';
  const canEditAmountExpected = user.role === 'ceo' || user.role === 'finance';

  const patch: Record<string, unknown> = {
    amount_paid: parsed.data.amount_paid,
    paid_at: parsed.data.paid_at || null,
    payment_method: parsed.data.payment_method,
    notes: parsed.data.notes,
  };

  if (canEditDueDate && parsed.data.due_date !== undefined) {
    patch.due_date = parsed.data.due_date || null;
  }

  if (canEditAmountExpected && parsed.data.amount_expected != null) {
    // Garde-fou : impossible de descendre sous le déjà encaissé pour ce payment.
    const { data: current } = await supabase
      .from('payments')
      .select('amount_paid')
      .eq('id', parsed.data.payment_id)
      .single();
    const paid = Number(current?.amount_paid ?? 0);
    if (Number(parsed.data.amount_expected) < paid) {
      return {
        ok: false,
        error: `Le montant attendu (${parsed.data.amount_expected} €) ne peut pas être inférieur au déjà encaissé (${paid} €).`,
      };
    }
    patch.amount_expected = parsed.data.amount_expected;
  }

  // Lire l'état AVANT pour le diff
  const { data: before } = await supabase
    .from('payments')
    .select('amount_paid, paid_at, payment_method, notes, due_date, amount_expected')
    .eq('id', parsed.data.payment_id)
    .single();

  const { error } = await supabase.from('payments').update(patch).eq('id', parsed.data.payment_id);
  if (error) return { ok: false, error: error.message };

  // Détection bascule planifié → reçu : amount_paid passe de 0/null à > 0
  const becamePaid = (Number((before as any)?.amount_paid ?? 0) === 0) && Number(parsed.data.amount_paid ?? 0) > 0;
  const fields = ['amount_paid','paid_at','payment_method','notes'];
  if (canEditDueDate && parsed.data.due_date !== undefined) fields.push('due_date');
  if (canEditAmountExpected && parsed.data.amount_expected != null) fields.push('amount_expected');
  const diff = computeFinanceDiff(before as any, patch as any, fields);
  if (Object.keys(diff).length > 0) {
    await logFinanceAudit({
      table: 'payments',
      recordId: parsed.data.payment_id,
      action: becamePaid ? 'status_change' : 'update',
      actorId: user.id,
      label: becamePaid
        ? `Honoraire encaissé (${parsed.data.amount_paid} €)`
        : `Honoraire modifié (${Object.keys(diff).join(', ')})`,
      payload: diff,
    });
  }
  revalidatePath('/projects', 'layout');
  return { ok: true };
}

/**
 * Crée un paiement Honoraires Stoniz pour un projet.
 * Utilisé pour les projets PROPRIA legacy où l'import a supprimé les records,
 * ou pour saisir rétroactivement un paiement passé.
 */
export async function createStonizPaymentAction(input: {
  project_id: string;
  type: string;
  amount_expected: number;
  amount_paid?: number;
  due_at_phase?: string | null;
  due_date?: string | null;
  paid_at?: string | null;
  notes?: string | null;
}) {
  const user = await assertRole(['ceo','chef_projet','finance']);
  const supabase = createClient();
  const { data: created, error } = await supabase.from('payments').insert({
    project_id: input.project_id,
    type: input.type,
    amount_expected: input.amount_expected,
    amount_paid: input.amount_paid ?? 0,
    currency: 'EUR',
    due_at_phase: input.due_at_phase ?? null,
    due_date: input.due_date ?? null,
    paid_at: input.paid_at ?? null,
    notes: input.notes ?? null,
  }).select('id').single();
  if (error) return { ok: false, error: error.message };
  if (created) {
    await logFinanceAudit({
      table: 'payments',
      recordId: (created as any).id,
      action: 'create',
      actorId: user.id,
      label: `Honoraire ${input.type} créé`,
      payload: {
        type: input.type,
        amount_expected: input.amount_expected,
        amount_paid: input.amount_paid ?? 0,
        due_date: input.due_date ?? null,
        due_at_phase: input.due_at_phase ?? null,
      },
    });
  }
  revalidatePath('/projects', 'layout');
  return { ok: true };
}

/**
 * Édition de l'échéancier honoraires Stoniz.
 * Modifie le montant attendu, la date d'échéance et le libellé de chaque
 * échéance EXISTANTE (on ne crée pas de ligne : les échéances naissent au fil
 * des événements métier, cf. upsert_milestone_payment).
 *
 * Périmètre par rôle (CEO 2026-07-10) :
 *   - CEO / finance : peuvent tout modifier (barème + dates + libellés).
 *     Finance édite parce que c'est elle qui décale les échéances pour piloter
 *     les alertes paiements (décision CEO 2026-06-05).
 *   - chef_projet : peut UNIQUEMENT décaler la date d'échéance pour aligner
 *     le planning avec la réalité chantier. amount_expected et label envoyés
 *     par le client sont ignorés côté serveur (défense en profondeur).
 */
export async function updateStonizScheduleAction(input: unknown) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance']);
  const parsed = stonizScheduleUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const canEditAmountAndLabel = user.role === 'ceo' || user.role === 'finance';

  // On ne modifie que des échéances honoraires appartenant bien à CE projet.
  // 'autre' est exclu (paiements divers, hors barème honoraires).
  const { data: existing, error: readErr } = await supabase
    .from('payments')
    .select('id, type, amount_paid, amount_expected, due_date, label')
    .eq('project_id', parsed.data.project_id)
    .is('deleted_at', null)
    .neq('type', 'autre');
  if (readErr) return { ok: false, error: readErr.message };

  const byId = new Map((existing ?? []).map(p => [p.id, p]));

  for (const item of parsed.data.items) {
    const row = byId.get(item.payment_id);
    if (!row) {
      return { ok: false, error: 'Échéance introuvable sur ce projet.' };
    }

    // Chef de projet : on force amount_expected et label à leurs valeurs
    // actuelles pour empêcher toute modification, même si le client trafique.
    const nextAmount = canEditAmountAndLabel
      ? item.amount_expected
      : Number(row.amount_expected);
    const nextLabel = canEditAmountAndLabel
      ? (item.label && item.label.trim() !== '' ? item.label.trim() : null)
      : (row.label ?? null);

    // Garde-fou : le montant attendu ne peut pas passer sous le montant déjà
    // encaissé (sinon violation de la contrainte amount_paid <= amount_expected).
    if (nextAmount < Number(row.amount_paid)) {
      return {
        ok: false,
        error: `Le montant attendu ne peut pas être inférieur au montant déjà encaissé (${Number(row.amount_paid)} €).`,
      };
    }

    const due_date = item.due_date && item.due_date !== '' ? item.due_date : null;
    const after = { amount_expected: nextAmount, due_date, label: nextLabel };

    const { error } = await supabase
      .from('payments')
      .update(after)
      .eq('id', item.payment_id)
      .eq('project_id', parsed.data.project_id);
    if (error) return { ok: false, error: error.message };

    const diff = computeFinanceDiff(row as any, after, ['amount_expected','due_date','label']);
    if (Object.keys(diff).length > 0) {
      await logFinanceAudit({
        table: 'payments',
        recordId: item.payment_id,
        action: 'update',
        actorId: user.id,
        label: `Échéancier modifié (${Object.keys(diff).join(', ')})`,
        payload: diff,
      });
    }
  }

  revalidatePath('/projects', 'layout');
  revalidatePath('/dashboard/financier');
  return { ok: true };
}

export async function createTravauxPaymentAction(input: unknown) {
  await assertRole(['ceo','chef_projet','finance']);
  const parsed = travauxPaymentCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const payload: any = { ...parsed.data };
  if (payload.exchange_rate_eur == null && payload.currency === 'MAD') {
    const { rate } = await getEurMadRate();
    payload.exchange_rate_eur = rate;
    payload.exchange_rate_at = new Date().toISOString();
  }

  const { error } = await supabase.from('travaux_payments').insert(payload);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/projects', 'layout');
  return { ok: true };
}
