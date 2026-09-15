'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

/**
 * Édition inline d'une date prévue (scheduled_date) ou de l'échéance honoraires
 * depuis la page Projection cashflow.
 *
 * Permet au CEO de simuler "et si je décalais ce paiement de 2 semaines ?" et de voir
 * l'effet immédiat sur la projection 30/60/90j.
 */

const SOURCES = [
  'travaux_payment',
  'achats_payment',
  'services_payment',
  'honoraires_payment',
  'travaux_encaissement',
  'achats_encaissement',
] as const;

const updateDateSchema = z.object({
  source: z.enum(SOURCES),
  id: z.string().uuid(),
  new_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide (YYYY-MM-DD)'),
});

export type UpdateDateResult = { ok: true } | { ok: false; error: string };

export async function updateScheduledDateAction(input: {
  source: string;
  id: string;
  new_date: string;
}): Promise<UpdateDateResult> {
  try {
    await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }

  let data;
  try {
    data = updateDateSchema.parse(input);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  const supabase = createClient();

  // Mappe la source vers (table, colonne).
  // INVARIANT (CEO 2026-06-18) : scheduled_date est la SEULE colonne
  // modifiable depuis une simulation projection. paid_at = date constatée
  // historique, jamais modifiée depuis le drawer (voir projection-invariants).
  const map: Record<string, { table: string; column: string }> = {
    travaux_payment: { table: 'travaux_payments', column: 'scheduled_date' },
    achats_payment: { table: 'achats_payments', column: 'scheduled_date' },
    services_payment: { table: 'services_payments', column: 'scheduled_date' },
    honoraires_payment: { table: 'payments', column: 'scheduled_date' },
    travaux_encaissement: { table: 'travaux_encaissements', column: 'received_at' },
    achats_encaissement: { table: 'achats_encaissements', column: 'received_at' },
  };

  const m = map[data.source];
  if (!m) return { ok: false, error: 'Source inconnue' };

  const { error } = await supabase
    .from(m.table)
    .update({ [m.column]: data.new_date } as any)
    .eq('id', data.id);

  if (error) {
    return { ok: false, error: `Échec mise à jour : ${error.message}` };
  }

  revalidatePath('/finance/projection');
  revalidatePath('/finance/tresorerie');
  return { ok: true };
}

// ─── Créer un acompte futur (scheduled) depuis un lot avec reste à payer ──
const createScheduledSchema = z.object({
  source: z.enum(['travaux_lot', 'achats_lot']),
  lot_id: z.string().uuid(),
  amount_mad: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Montant invalide'),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format date invalide'),
  description: z.string().optional().nullable(),
});

export type CreateScheduledResult = { ok: true; id: string } | { ok: false; error: string };

export async function createScheduledPaymentFromLotAction(input: {
  source: 'travaux_lot' | 'achats_lot';
  lot_id: string;
  amount_mad: string;
  scheduled_date: string;
  description?: string | null;
}): Promise<CreateScheduledResult> {
  try {
    await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }

  let data;
  try {
    data = createScheduledSchema.parse(input);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  const supabase = createClient();
  const amount = Number(data.amount_mad);

  // P0 fix (2026-06-19) : calculer le prochain numéro libre du lot avant
  // l'insert. Sans ça, l'acompte naît orphelin (acompte_number=NULL) et
  // l'édition côté UI échoue ("Number must be greater than or equal to 1").
  async function nextAcompteNumber(table: 'travaux_payments' | 'achats_payments', lotId: string): Promise<number> {
    const { data: maxRow } = await supabase
      .from(table)
      .select('acompte_number')
      .eq('lot_id', lotId)
      .is('deleted_at', null)
      .not('acompte_number', 'is', null)
      .order('acompte_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    return ((maxRow as any)?.acompte_number ?? 0) + 1;
  }

  if (data.source === 'travaux_lot') {
    const { data: lot } = await supabase
      .from('travaux_lots')
      .select('project_id, artisan_name, artisan_id')
      .eq('id', data.lot_id)
      .single();
    if (!lot) return { ok: false, error: 'Lot introuvable' };

    const acompte_number = await nextAcompteNumber('travaux_payments', data.lot_id);

    const { data: created, error } = await supabase
      .from('travaux_payments')
      .insert({
        project_id: (lot as any).project_id,
        lot_id: data.lot_id,
        acompte_number,
        artisan_name: (lot as any).artisan_name ?? 'Artisan',
        currency: 'MAD',
        amount_total: amount,
        amount_paid: 0,
        scheduled_date: data.scheduled_date,
        status: 'pending',
        payment_type: acompte_number === 1 ? 'acompte' : 'autre',
        notes: data.description ?? 'Acompte programmé depuis projection cashflow',
      } as any)
      .select('id')
      .single();
    if (error || !created) return { ok: false, error: `Création échouée : ${error?.message ?? 'erreur'}` };
    revalidatePath('/finance/projection');
    return { ok: true, id: (created as any).id };
  }

  if (data.source === 'achats_lot') {
    const { data: lot } = await supabase
      .from('achats_lots')
      .select('project_id, supplier_name, supplier_id')
      .eq('id', data.lot_id)
      .single();
    if (!lot) return { ok: false, error: 'Lot introuvable' };

    const acompte_number = await nextAcompteNumber('achats_payments', data.lot_id);

    const { data: created, error } = await supabase
      .from('achats_payments')
      .insert({
        project_id: (lot as any).project_id,
        lot_id: data.lot_id,
        acompte_number,
        supplier_name: (lot as any).supplier_name ?? 'Fournisseur',
        currency: 'MAD',
        amount_total: amount,
        amount_paid: 0,
        scheduled_date: data.scheduled_date,
        status: 'pending',
        notes: data.description ?? 'Acompte programmé depuis projection cashflow',
      } as any)
      .select('id')
      .single();
    if (error || !created) return { ok: false, error: `Création échouée : ${error?.message ?? 'erreur'}` };
    revalidatePath('/finance/projection');
    return { ok: true, id: (created as any).id };
  }

  return { ok: false, error: 'Source inconnue' };
}

// ─── Exclure un bénéficiaire des charges récurrentes ─────────────────────
//
// Crée (ou met à jour) un mapping bank_category_mappings qui rattache un bénéficiaire
// à une allocation_type non-cabinet (achats / travaux / intercompany / services).
// Effets :
//   1. Au prochain calcul des charges récurrentes, ce bénéficiaire est exclu (vu comme projet/intercompany)
//   2. Aux prochains imports bancaires, ses transactions sont auto-catégorisées avec ce type
//      (et auto-allouées si le type est cabinet_*, mais ici on a explicitement choisi non-cabinet)

const EXCLUDE_TYPES = [
  'achats', 'travaux', 'services', 'honoraires', 'propria', 'intercompany', 'autre',
] as const;

const excludeSchema = z.object({
  beneficiary: z.string().min(2),
  allocation_type: z.enum(EXCLUDE_TYPES),
});

export type ExcludeAllocationType = typeof EXCLUDE_TYPES[number];

export type ExcludeResult = { ok: true } | { ok: false; error: string };

export async function excludeBeneficiaryFromRecurringAction(input: {
  beneficiary: string;
  allocation_type: ExcludeAllocationType;
}): Promise<ExcludeResult> {
  let me;
  try {
    me = await assertRole(['ceo', 'finance']);
  } catch {
    return { ok: false, error: 'Permission refusée' };
  }

  let data;
  try {
    data = excludeSchema.parse(input);
  } catch (e: any) {
    return { ok: false, error: `Données invalides : ${e?.message ?? e}` };
  }

  const supabase = createClient();
  const clean = data.beneficiary.trim();

  // Upsert
  const { data: existing } = await supabase
    .from('bank_category_mappings')
    .select('id')
    .eq('bank_label_match', clean)
    .eq('match_type', 'contains')
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('bank_category_mappings')
      .update({
        allocation_type: data.allocation_type,
        category_code: 'autre',
      } as any)
      .eq('id', (existing as any).id);
    if (error) return { ok: false, error: `Échec MAJ mapping : ${error.message}` };
  } else {
    const { error } = await supabase
      .from('bank_category_mappings')
      .insert({
        bank_label_match: clean,
        match_type: 'contains',
        category_code: 'autre',
        allocation_type: data.allocation_type,
        created_by: me.id,
      } as any);
    if (error) return { ok: false, error: `Échec création mapping : ${error.message}` };
  }

  revalidatePath('/finance/projection');
  revalidatePath('/finance/synthese');
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Édit inline sur la vue projection mensuelle (CEO 2026-08-17d)
// ═══════════════════════════════════════════════════════════════════════════
//
// Nouvelle server action complémentaire pour la sous-page
// /finance/projection/mensuelle. Elle dispatche selon un préfixe id_ref
// (portée par lib/finance/projection-mensuelle.ts) pour permettre au CEO
// de changer le mois d'une ligne directement depuis le tableau.
//
// Format attendu :
//   honoraires:<project_id>:<milestone_type> → stoniz_fees_forecast
//   te:<uuid> → travaux_encaissements.scheduled_date
//   ae:<uuid> → achats_encaissements.scheduled_date
//   tp:<uuid> → travaux_payments.scheduled_date
//   ap:<uuid> → achats_payments.scheduled_date
//   sp:<uuid> → services_payments.scheduled_date
//   recurring:<month> → non éditable (estimation)
//
// L'input est un mois YYYY-MM. Pour les tables datées à la journée on
// force jour = 01. Le CEO peut aller sur la fiche projet pour dater
// plus précisément s'il veut.

const flowLineDateSchema = z.object({
  id_ref: z.string().min(3),
  forecast_month: z.string().refine((v) => v === '' || /^\d{4}-(0[1-9]|1[0-2])$/.test(v), {
    message: 'Format attendu YYYY-MM ou vide',
  }),
});

export type FlowLineDateResult = { ok: true } | { ok: false; error: string };

export async function updateFlowLineDateAction(input: {
  id_ref: string;
  forecast_month: string;
}): Promise<FlowLineDateResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = flowLineDateSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();
    const { id_ref, forecast_month } = parsed.data;

    if (id_ref.startsWith('recurring:')) {
      return { ok: false, error: 'Les charges récurrentes sont estimées automatiquement.' };
    }

    const isoDay = forecast_month === '' ? null : `${forecast_month}-01`;

    // Honoraires Stoniz → table stoniz_fees_forecast (upsert manuel car
    // UNIQUE partiel WHERE deleted_at IS NULL ne matche pas ON CONFLICT).
    if (id_ref.startsWith('honoraires:')) {
      const [, project_id, milestone_type] = id_ref.split(':');
      if (!project_id || !milestone_type) return { ok: false, error: 'id_ref honoraires invalide' };

      const { data: existing } = await supabase
        .from('stoniz_fees_forecast')
        .select('id')
        .eq('project_id', project_id)
        .eq('milestone_type', milestone_type)
        .is('deleted_at', null)
        .maybeSingle();

      if (forecast_month === '') {
        if (existing) {
          const { error } = await supabase
            .from('stoniz_fees_forecast')
            .update({ deleted_at: new Date().toISOString() } as any)
            .eq('id', (existing as any).id);
          if (error) return { ok: false, error: error.message };
        }
      } else if (existing) {
        const { error } = await supabase
          .from('stoniz_fees_forecast')
          .update({ forecast_month: isoDay, updated_by: me.id, updated_at: new Date().toISOString() } as any)
          .eq('id', (existing as any).id);
        if (error) return { ok: false, error: error.message };
      } else {
        const { error } = await supabase
          .from('stoniz_fees_forecast')
          .insert({ project_id, milestone_type, forecast_month: isoDay, updated_by: me.id } as any);
        if (error) return { ok: false, error: error.message };
      }
      revalidateProjectionAndHonoraires();
      return { ok: true };
    }

    // Encaissements + payments : on écrit scheduled_date
    const tableByPrefix: Record<string, string> = {
      te: 'travaux_encaissements',
      ae: 'achats_encaissements',
      tp: 'travaux_payments',
      ap: 'achats_payments',
      sp: 'services_payments',
    };
    const prefix = id_ref.slice(0, 2);
    const uuid = id_ref.slice(3);
    const table = tableByPrefix[prefix];
    if (!table || !uuid) {
      return { ok: false, error: `id_ref non reconnu: ${id_ref.slice(0, 20)}` };
    }
    const { error } = await supabase
      .from(table)
      .update({ scheduled_date: isoDay } as any)
      .eq('id', uuid);
    if (error) return { ok: false, error: error.message };

    revalidateProjectionAndHonoraires();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erreur inconnue' };
  }
}

function revalidateProjectionAndHonoraires() {
  revalidatePath('/finance/projection');
  revalidatePath('/finance/projection/mensuelle');
  revalidatePath('/finance/tresorerie/honoraires-a-percevoir');
}
