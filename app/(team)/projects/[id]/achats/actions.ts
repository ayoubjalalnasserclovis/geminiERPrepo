'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';
import { logDeletion } from '@/lib/audit/deletion';
import { cascadeDeallocateOnDelete } from '@/lib/finance/cascade-deallocate';

// ─── Lots achats ─────────────────────────────────────────────────────────

const lotSchema = z.object({
  project_id: z.string().uuid(),
  category: z.string(),
  description: z.string().optional().nullable(),
  supplier_name: z.string().min(1),
  supplier_id: z.string().uuid().optional().nullable(),
  devis_number: z.string().optional().nullable(),
  budget_estimate_mad:    z.coerce.number().min(0).optional().nullable(),
  devis_fournisseur_mad:  z.coerce.number().min(0).optional().nullable(),
  facture_client_mad:     z.coerce.number().min(0).optional().nullable(),
  // Quantité commandée + prix unitaire fournisseur (info commerciale, pas la
  // source de vérité du devis qui reste devis_fournisseur_mad — voir canon).
  quantity:               z.coerce.number().min(0).optional().nullable(),
  unit_price_mad:         z.coerce.number().min(0).optional().nullable(),
  status: z.string().default('a_commander'),
  date_commande:           z.string().optional().nullable(),
  date_livraison_estimee:  z.string().optional().nullable(),
  date_livraison_reelle:   z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  propria_unit_id: z.string().uuid().optional().nullable(),
});

function cleanLot(raw: any) {
  const o = { ...raw };
  for (const k of ['description','devis_number','notes','date_commande','date_livraison_estimee','date_livraison_reelle','supplier_id','propria_unit_id']) {
    if (o[k] === '') o[k] = null;
  }
  for (const k of ['budget_estimate_mad','devis_fournisseur_mad','facture_client_mad','quantity','unit_price_mad']) {
    if (o[k] === '' || o[k] == null) o[k] = null;
    else o[k] = Number(o[k]);
  }
  return o;
}

export async function createAchatLotAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const cleaned = cleanLot(input);
  const parsed = lotSchema.safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: maxRow } = await supabase
    .from('achats_lots')
    .select('numero')
    .eq('project_id', parsed.data.project_id)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (maxRow?.numero ?? 0) + 1;

  const { data: inserted, error } = await supabase
    .from('achats_lots')
    .insert({ ...parsed.data, numero })
    .select('id')
    .single();
  if (error) return { ok: false, error: error.message };

  if (inserted?.id) {
    await logFinanceAudit({
      table: 'achats_lots',
      recordId: inserted.id,
      action: 'create',
      actorId: user.id,
      label: `Lot achats #${numero} créé · ${parsed.data.supplier_name}`,
      payload: {
        numero,
        category: parsed.data.category,
        supplier_name: parsed.data.supplier_name,
        devis_fournisseur_mad: parsed.data.devis_fournisseur_mad,
        facture_client_mad: parsed.data.facture_client_mad,
      },
    });
  }

  revalidatePath(`/projects/${parsed.data.project_id}/achats`);
  return { ok: true };
}

export async function updateAchatLotAction(lotId: string, input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const cleaned = cleanLot(input);
  const parsed = lotSchema.partial().safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: existing } = await supabase.from('achats_lots').select('*').eq('id', lotId).single();
  if (!existing) return { ok: false, error: 'Lot introuvable' };

  const { error } = await supabase.from('achats_lots').update(parsed.data).eq('id', lotId);
  if (error) return { ok: false, error: error.message };

  const diff = computeFinanceDiff(existing as any, parsed.data as any, [
    'category','description','supplier_name','supplier_id','devis_number',
    'budget_estimate_mad','devis_fournisseur_mad','facture_client_mad',
    'quantity','unit_price_mad','status',
    'date_commande','date_livraison_estimee','date_livraison_reelle',
    'notes','propria_unit_id',
  ]);
  if (Object.keys(diff).length > 0) {
    const fields = Object.keys(diff);
    const isStatus = 'status' in diff && fields.length === 1;
    await logFinanceAudit({
      table: 'achats_lots',
      recordId: lotId,
      action: isStatus ? 'status_change' : 'update',
      actorId: user.id,
      label: isStatus
        ? `Statut : ${(diff as any).status.before ?? '—'} → ${(diff as any).status.after ?? '—'}`
        : `Lot achats modifié (${fields.join(', ')})`,
      payload: diff,
    });
  }

  revalidatePath(`/projects/${(existing as any).project_id}/achats`);
  return { ok: true };
}

export async function deleteAchatLotAction(lotId: string) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  // Snapshot complet AVANT suppression (pour la corbeille admin)
  const { data: lot } = await supabase.from('achats_lots').select('*').eq('id', lotId).single();
  const { error } = await supabase.from('achats_lots').update({ deleted_at: new Date().toISOString() }).eq('id', lotId);
  if (error) return { ok: false as const, error: error.message };
  await logDeletion({
    table: 'achats_lots',
    recordId: lotId,
    actorId: user.id,
    label: lot ? `Lot achats - ${(lot as any).supplier_name ?? 'inconnu'} - ${(lot as any).devis_fournisseur_mad ?? 0} MAD` : 'Lot achats',
    snapshot: lot,
  });
  await logFinanceAudit({
    table: 'achats_lots',
    recordId: lotId,
    action: 'delete',
    actorId: user.id,
    label: lot ? `Lot achats #${(lot as any).numero ?? '?'} supprimé · ${(lot as any).supplier_name ?? '—'}` : 'Lot achats supprimé',
    payload: lot ? {
      numero: (lot as any).numero,
      supplier_name: (lot as any).supplier_name,
      devis_fournisseur_mad: (lot as any).devis_fournisseur_mad,
      category: (lot as any).category,
    } : {},
  });
  if (lot) revalidatePath(`/projects/${(lot as any).project_id}/achats`);
  return { ok: true as const };
}

// ─── Acomptes fournisseurs ───────────────────────────────────────────────

const acompteSchema = z.object({
  lot_id: z.string().uuid(),
  acompte_number: z.coerce.number().int().min(1).max(6),
  acompte_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  amount_total: z.coerce.number().min(0),
  scheduled_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Bulk : planifier 1..N acomptes (échelonnés) d'un coup pour plusieurs lots
// du même fournisseur.
//
// CEO 2026-06-18 (chantier C1) : refonte du schéma : on remplace la date
// unique par un tableau d'installments[]. Chaque installment a sa propre date
// et son propre % ou montant fixe. Permet de saisir "30% à J+0, 40% à J+30,
// 30% à J+60" en UN clic au lieu de 3 passes.
const installmentSchema = z.object({
  amount_mode: z.enum(['pct', 'fixed']),
  amount_value: z.coerce.number().min(0),
  scheduled_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date YYYY-MM-DD requise'),
});

const bulkPlanSchema = z.object({
  project_id: z.string().uuid(),
  lot_ids: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un lot'),
  installments: z.array(installmentSchema).min(1, 'Au moins un jalon requis'),
  notes: z.string().optional().nullable(),
});

/**
 * Crée N acomptes « planifiés » (status=pending, scheduled_date rempli,
 * paid_at null) sur chaque lot sélectionné, en respectant :
 *   - le prochain numéro d'acompte libre par lot (1..6)
 *   - les jalons fournis (ordre chronologique respecté)
 *
 * Les lots qui n'ont plus assez de slots libres pour TOUS les jalons sont
 * ignorés intégralement (rapportés dans skipped). On ne crée pas d'acomptes
 * partiels — soit on crée tous les jalons sur le lot, soit aucun.
 *
 * Le batch_id est partagé pour tous les acomptes (même lot ou non) → 1 seule
 * demande de validation au CEO via requestBatchApprovalAction.
 */
export async function bulkPlanAchatAcomptesAction(input: unknown) {
  await assertRole(['ceo','chef_projet','finance','achats']);
  const parsed = bulkPlanSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const { project_id, lot_ids, installments, notes } = parsed.data;
  const supabase = createClient();

  // Charge les lots sélectionnés (garde-fou : doivent appartenir au projet
  // et ne pas être supprimés).
  const { data: lots, error: lotsErr } = await supabase
    .from('achats_lots')
    .select('id, project_id, supplier_id, supplier_name, category, devis_fournisseur_mad, deleted_at')
    .in('id', lot_ids)
    .eq('project_id', project_id)
    .is('deleted_at', null);
  if (lotsErr) return { ok: false as const, error: lotsErr.message };
  if (!lots || lots.length === 0) return { ok: false as const, error: 'Aucun lot valide trouvé.' };

  // Garde-fou métier : tous les lots doivent appartenir au MÊME fournisseur
  // (sinon la planification "par fournisseur" perd son sens).
  // CEO 2026-06-18 : fix legacy. Si certains lots ont supplier_id et d'autres
  // non (legacy import sans FK), on compare PAR supplier_id quand il existe,
  // sinon par supplier_name. Avant : Set hétérogène → refus à tort.
  const supplierIds = new Set(lots.map((l: any) => l.supplier_id).filter(Boolean));
  const supplierNames = new Set(lots.map((l: any) => (l.supplier_name ?? '').trim().toLowerCase()).filter(Boolean));
  if (supplierIds.size > 1 || (supplierIds.size === 0 && supplierNames.size > 1)) {
    return { ok: false as const, error: 'Les lots sélectionnés doivent appartenir au même fournisseur.' };
  }

  // Récupère les acomptes existants pour calculer le prochain n° libre par lot
  const { data: existing } = await supabase
    .from('achats_payments')
    .select('lot_id, acompte_number')
    .in('lot_id', lot_ids)
    .is('deleted_at', null);
  const takenByLot = new Map<string, Set<number>>();
  ((existing ?? []) as any[]).forEach((p) => {
    if (!p.lot_id || p.acompte_number == null) return;
    if (!takenByLot.has(p.lot_id)) takenByLot.set(p.lot_id, new Set());
    takenByLot.get(p.lot_id)!.add(Number(p.acompte_number));
  });

  const created: string[] = [];
  const skipped: { lot_id: string; reason: string }[] = [];
  const rowsToInsert: any[] = [];

  // ─── Batch ID partagé ────────────────────────────────────────────────
  // Tous les acomptes générés en une fois reçoivent le MÊME payment_batch_id.
  // Ce batch_id permet ensuite à requestBatchApprovalAction (cf
  // validations/actions.ts) de créer UNE SEULE demande de validation =
  // UN SEUL mail au CEO/finance pour ces N acomptes.
  const batchId = crypto.randomUUID();

  // Tri jalons par date pour assigner les numéros d'acompte dans l'ordre
  // chronologique (1er jalon = acompte le plus précoce).
  const orderedInstallments = [...installments].sort((a, b) =>
    a.scheduled_date.localeCompare(b.scheduled_date),
  );

  for (const lot of lots as any[]) {
    const taken = takenByLot.get(lot.id) ?? new Set<number>();
    // Calcule la liste des numéros libres dans l'ordre
    const freeNumbers: number[] = [];
    for (let i = 1; i <= 6; i++) {
      if (!taken.has(i)) freeNumbers.push(i);
    }
    if (freeNumbers.length === 0) {
      skipped.push({ lot_id: lot.id, reason: 'Tous les acomptes (6/6) sont déjà créés.' });
      continue;
    }
    if (freeNumbers.length < orderedInstallments.length) {
      skipped.push({
        lot_id: lot.id,
        reason: `Seulement ${freeNumbers.length} acompte(s) libre(s) restant(s), ${orderedInstallments.length} jalons demandés.`,
      });
      continue;
    }

    const devis = Number(lot.devis_fournisseur_mad ?? 0);
    let pctRequiringDevis = false;
    for (const inst of orderedInstallments) {
      if (inst.amount_mode === 'pct' && devis <= 0) { pctRequiringDevis = true; break; }
    }
    if (pctRequiringDevis) {
      skipped.push({ lot_id: lot.id, reason: 'Pas de devis fournisseur — impossible de calculer un % sur ce lot.' });
      continue;
    }

    // Crée 1 ligne par jalon, avec son propre scheduled_date
    for (let idx = 0; idx < orderedInstallments.length; idx++) {
      const inst = orderedInstallments[idx];
      const nextNum = freeNumbers[idx];
      let amount = 0;
      let pct: number | null = null;
      if (inst.amount_mode === 'pct') {
        amount = Math.round(devis * (inst.amount_value / 100) * 100) / 100;
        pct = inst.amount_value;
      } else {
        amount = inst.amount_value;
      }
      rowsToInsert.push({
        project_id,
        lot_id: lot.id,
        acompte_number: nextNum,
        acompte_pct: pct,
        supplier_name: lot.supplier_name,
        supplier_id: lot.supplier_id,
        category: lot.category,
        currency: 'MAD',
        amount_total: amount,
        payment_type: nextNum === 1 ? 'acompte' : 'autre',
        scheduled_date: inst.scheduled_date,
        notes: notes ?? null,
        exchange_rate_eur: 10,
        exchange_rate_at: new Date().toISOString(),
        payment_batch_id: batchId,
      });
    }
    created.push(lot.id);
  }

  if (rowsToInsert.length === 0) {
    return { ok: false as const, error: 'Aucun acompte n’a pu être créé.', skipped };
  }

  const { error: insErr } = await supabase
    .from('achats_payments')
    .insert(rowsToInsert);
  if (insErr) return { ok: false as const, error: insErr.message, skipped };

  revalidatePath(`/projects/${project_id}/achats`);
  return {
    ok: true as const,
    createdCount: created.length,
    skipped,
    batchId, // ← Renvoyé pour permettre à l'UI d'enchaîner sur la demande de validation groupée
  };
}

// ─── Bulk update : statut + livraison sur N lots d'un même fournisseur ─
//
// Cas d'usage : tu as sélectionné 4 lots Driss dans le panneau bulk, ils
// passent tous en "commandé" cette semaine avec la même date de livraison
// estimée. Au lieu de 4 modales individuelles, un seul appel met à jour
// les 4 lots.
//
// Règle métier : on n'écrase un champ que s'il est explicitement renseigné
// dans l'input. Si l'utilisateur laisse status='' et date_livraison_estimee='',
// l'action est un no-op (et on renvoie une erreur explicite).

const bulkUpdateLotsSchema = z.object({
  project_id: z.string().uuid(),
  lot_ids: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un lot'),
  status: z.string().optional().nullable(),
  date_livraison_estimee: z.string().optional().nullable(),
  date_livraison_reelle: z.string().optional().nullable(),
});

export async function bulkUpdateAchatLotsAction(input: unknown) {
  await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  for (const k of ['status','date_livraison_estimee','date_livraison_reelle']) {
    if (raw[k] === '') raw[k] = null;
  }
  const parsed = bulkUpdateLotsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const { project_id, lot_ids, status, date_livraison_estimee, date_livraison_reelle } = parsed.data;

  // Garde-fou : au moins un champ à mettre à jour
  const update: any = {};
  if (status) update.status = status;
  if (date_livraison_estimee) update.date_livraison_estimee = date_livraison_estimee;
  if (date_livraison_reelle) update.date_livraison_reelle = date_livraison_reelle;
  if (Object.keys(update).length === 0) {
    return { ok: false as const, error: 'Renseigne au moins un champ à mettre à jour.' };
  }

  const supabase = createClient();
  // Sécurise le scope projet + non-supprimés (au cas où le client triche)
  const { error, count } = await supabase
    .from('achats_lots')
    .update(update, { count: 'exact' })
    .in('id', lot_ids)
    .eq('project_id', project_id)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };

  revalidatePath(`/projects/${project_id}/achats`);
  return { ok: true as const, updatedCount: count ?? 0 };
}

export async function saveAchatAcompteAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  if (raw.scheduled_date === '') raw.scheduled_date = null;
  if (raw.notes === '') raw.notes = null;
  if (raw.acompte_pct === '' || raw.acompte_pct == null) raw.acompte_pct = null;

  const parsed = acompteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: lot } = await supabase
    .from('achats_lots')
    .select('project_id, supplier_name, supplier_id, category')
    .eq('id', parsed.data.lot_id)
    .single();
  if (!lot) return { ok: false, error: 'Lot introuvable' };

  // CEO 2026-07-13 : filtre deleted_at pour ne pas resusciter un acompte
  // soft-deleted en UPDATE (l'UI affiche le slot comme libre, cf. bug Chadi
  // sur lot faux plafond TELKI Ihlam).
  const { data: existing } = await supabase
    .from('achats_payments')
    .select('id, amount_total, acompte_pct, scheduled_date, notes')
    .eq('lot_id', parsed.data.lot_id)
    .eq('acompte_number', parsed.data.acompte_number)
    .is('deleted_at', null)
    .maybeSingle();

  if (existing) {
    const after = {
      amount_total: parsed.data.amount_total,
      acompte_pct: parsed.data.acompte_pct,
      scheduled_date: parsed.data.scheduled_date,
      notes: parsed.data.notes,
    };
    const { error } = await supabase.from('achats_payments').update(after).eq('id', (existing as any).id);
    if (error) return { ok: false, error: error.message };
    const diff = computeFinanceDiff(existing as any, after, ['amount_total','acompte_pct','scheduled_date','notes']);
    if (Object.keys(diff).length > 0) {
      await logFinanceAudit({
        table: 'achats_payments',
        recordId: (existing as any).id,
        action: 'update',
        actorId: user.id,
        label: `Acompte modifié (${Object.keys(diff).join(', ')})`,
        payload: diff,
      });
    }
  } else {
    const { data: created, error } = await supabase.from('achats_payments').insert({
      project_id: lot.project_id,
      lot_id: parsed.data.lot_id,
      acompte_number: parsed.data.acompte_number,
      acompte_pct: parsed.data.acompte_pct,
      supplier_name: lot.supplier_name,
      supplier_id: lot.supplier_id,
      category: lot.category,
      currency: 'MAD',
      amount_total: parsed.data.amount_total,
      payment_type: parsed.data.acompte_number === 1 ? 'acompte' : 'autre',
      scheduled_date: parsed.data.scheduled_date,
      notes: parsed.data.notes,
      exchange_rate_eur: 10,
      exchange_rate_at: new Date().toISOString(),
    }).select('id').single();
    if (error) return { ok: false, error: error.message };
    if (created) {
      await logFinanceAudit({
        table: 'achats_payments',
        recordId: (created as any).id,
        action: 'create',
        actorId: user.id,
        label: `Acompte n°${parsed.data.acompte_number} créé`,
        payload: {
          amount_total: parsed.data.amount_total,
          scheduled_date: parsed.data.scheduled_date,
          supplier_name: lot.supplier_name,
        },
      });
    }
  }

  revalidatePath(`/projects/${lot.project_id}/achats`);
  return { ok: true };
}

/**
 * Met à jour la date d'échéance prévue d'un acompte achats, et — sur demande —
 * la propage à tous les autres acomptes du MÊME FOURNISSEUR sur le MÊME PROJET
 * qui sont encore en attente (status='pending').
 *
 * Cas d'usage : « Driss Boutira me facture pour 4 lots, on s'est mis d'accord
 * sur le 15/07 ». Tu édites le 1er acompte, coches "Appliquer aussi aux X
 * autres", tu enregistres → tous les acomptes pending de Driss prennent
 * cette date d'échéance en une seule action.
 */
export async function setAchatAcompteSchedulingAction(input: {
  acompte_id: string;
  scheduled_date: string | null;
  also_apply_to_supplier?: boolean;
}) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();

  // Récupère l'acompte pour identifier le lot/projet/fournisseur
  const { data: acompte } = await supabase
    .from('achats_payments')
    .select('id, lot_id, project_id, status, scheduled_date')
    .eq('id', input.acompte_id)
    .single();
  if (!acompte) return { ok: false as const, error: 'Acompte introuvable' };

  const scheduled = input.scheduled_date && input.scheduled_date !== '' ? input.scheduled_date : null;

  // 1) MAJ de l'acompte principal
  const { error: errMain } = await supabase
    .from('achats_payments')
    .update({ scheduled_date: scheduled } as any)
    .eq('id', input.acompte_id);
  if (errMain) return { ok: false as const, error: errMain.message };

  if ((acompte as any).scheduled_date !== scheduled) {
    await logFinanceAudit({
      table: 'achats_payments',
      recordId: input.acompte_id,
      action: 'update',
      actorId: user.id,
      label: 'Échéance planifiée modifiée',
      payload: { scheduled_date: { before: (acompte as any).scheduled_date, after: scheduled } },
    });
  }

  let bulkUpdated = 0;
  if (input.also_apply_to_supplier) {
    // Récupère le fournisseur via le lot de l'acompte principal
    const { data: lot } = await supabase
      .from('achats_lots')
      .select('supplier_id, supplier_name')
      .eq('id', (acompte as any).lot_id)
      .single();

    if (lot && ((lot as any).supplier_id || (lot as any).supplier_name)) {
      // Trouve tous les autres lots du même fournisseur sur le même projet
      let lotsQuery = supabase
        .from('achats_lots')
        .select('id')
        .eq('project_id', (acompte as any).project_id)
        .is('deleted_at', null);
      if ((lot as any).supplier_id) {
        lotsQuery = lotsQuery.eq('supplier_id', (lot as any).supplier_id);
      } else {
        lotsQuery = lotsQuery.eq('supplier_name', (lot as any).supplier_name);
      }
      const { data: siblingLots } = await lotsQuery;
      const lotIds = (siblingLots ?? []).map((l: any) => l.id);

      if (lotIds.length > 0) {
        // MAJ scheduled_date sur tous les acomptes pending de ces lots,
        // sauf celui qu'on vient déjà de mettre à jour.
        const { error: errBulk, count } = await supabase
          .from('achats_payments')
          .update({ scheduled_date: scheduled } as any, { count: 'exact' })
          .in('lot_id', lotIds)
          .eq('status', 'pending')
          .neq('id', input.acompte_id)
          .is('deleted_at', null);
        if (errBulk) return { ok: false as const, error: errBulk.message };
        bulkUpdated = count ?? 0;
      }
    }
  }

  revalidatePath(`/projects/${(acompte as any).project_id}/achats`);
  return { ok: true as const, bulkUpdated };
}

export async function markAchatAcomptePaidAction(paymentId: string, paid_at: string | null) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  const { data: pay } = await supabase
    .from('achats_payments')
    .select('project_id, amount_total, status, paid_at')
    .eq('id', paymentId)
    .single();
  if (!pay) return { ok: false, error: 'Paiement introuvable' };

  const newPaidAt = paid_at ?? new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from('achats_payments').update({
    amount_paid: pay.amount_total,
    paid_at: newPaidAt,
    status: 'paid',
  }).eq('id', paymentId);
  if (error) return { ok: false, error: error.message };
  await logFinanceAudit({
    table: 'achats_payments',
    recordId: paymentId,
    action: 'status_change',
    actorId: user.id,
    label: `Paiement marqué payé`,
    payload: {
      status: { before: (pay as any).status, after: 'paid' },
      paid_at: { before: (pay as any).paid_at, after: newPaidAt },
      amount_paid: { before: null, after: pay.amount_total },
    },
  });
  revalidatePath(`/projects/${pay.project_id}/achats`);
  return { ok: true };
}

export async function deleteAchatAcompteAction(paymentId: string) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  // Snapshot complet AVANT suppression
  const { data: pay } = await supabase.from('achats_payments').select('*').eq('id', paymentId).single();
  // QA-BUG-035 : soft-delete (jamais de hard-delete sur une donnée financière).
  await supabase.from('achats_payments').update({ deleted_at: new Date().toISOString() }).eq('id', paymentId);
  await logFinanceAudit({
    table: 'achats_payments',
    recordId: paymentId,
    action: 'delete',
    actorId: user.id,
    label: `Paiement supprimé`,
    payload: pay ? { amount_total: (pay as any).amount_total, supplier_name: (pay as any).supplier_name } : {},
  });
  await logDeletion({
    table: 'achats_payments',
    recordId: paymentId,
    actorId: user.id,
    label: pay ? `Paiement fournisseur - ${(pay as any).supplier_name ?? 'inconnu'} - ${(pay as any).amount_total} MAD` : 'Paiement fournisseur',
    snapshot: pay,
  });
  await cascadeDeallocateOnDelete({ table: 'achats_payments', recordId: paymentId, actorId: user.id });
  if (pay) {
    revalidatePath(`/projects/${(pay as any).project_id}/achats`);
    revalidatePath('/finance/tresorerie');
    revalidatePath('/finance/tresorerie/reconciliation');
  }
  return { ok: true };
}

// ─── Encaissements client (achats) ───────────────────────────────────────
//
// Mêmes règles que travaux_encaissements : 'recu' = reçu (received_at requis),
// 'planifie' = à encaisser (scheduled_date requis). Permet de piloter la
// tréso à 30/60/90j en intégrant les rentrées futures.

const encaissementSchema = z.object({
  project_id: z.string().uuid(),
  amount_mad: z.coerce.number().min(0),
  received_at: z.string().optional().nullable(),
  scheduled_date: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function deriveAchatEncaissementStatus(received_at: string | null, scheduled_date: string | null) {
  if (received_at) return { status: 'recu' as const, received_at, scheduled_date: scheduled_date ?? null };
  if (scheduled_date) return { status: 'planifie' as const, received_at: null, scheduled_date };
  return null;
}

export async function addAchatEncaissementAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  if (raw.received_at === '') raw.received_at = null;
  if (raw.scheduled_date === '') raw.scheduled_date = null;
  if (raw.payment_method === '') raw.payment_method = null;
  if (raw.notes === '') raw.notes = null;

  const parsed = encaissementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const dates = deriveAchatEncaissementStatus(parsed.data.received_at ?? null, parsed.data.scheduled_date ?? null);
  if (!dates) {
    return { ok: false, error: 'Renseigne soit une date de réception, soit une date d’échéance prévue.' };
  }

  const supabase = createClient();
  const { data: created, error } = await supabase.from('achats_encaissements').insert({
    project_id: parsed.data.project_id,
    amount_mad: parsed.data.amount_mad,
    payment_method: parsed.data.payment_method,
    notes: parsed.data.notes,
    received_at: dates.received_at,
    scheduled_date: dates.scheduled_date,
    status: dates.status,
  } as any).select('id').single();
  if (error) return { ok: false, error: error.message };
  if (created) {
    await logFinanceAudit({
      table: 'achats_encaissements',
      recordId: (created as any).id,
      action: 'create',
      actorId: user.id,
      label: dates.status === 'recu' ? 'Encaissement reçu créé' : 'Encaissement planifié créé',
      payload: {
        amount_mad: parsed.data.amount_mad,
        status: dates.status,
        received_at: dates.received_at,
        scheduled_date: dates.scheduled_date,
        payment_method: parsed.data.payment_method,
      },
    });
  }
  revalidatePath(`/projects/${parsed.data.project_id}/achats`);
  return { ok: true };
}

const updateAchatEncaissementSchema = encaissementSchema.extend({
  encaissement_id: z.string().uuid(),
});

export async function updateAchatEncaissementAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  if (raw.received_at === '') raw.received_at = null;
  if (raw.scheduled_date === '') raw.scheduled_date = null;
  if (raw.payment_method === '') raw.payment_method = null;
  if (raw.notes === '') raw.notes = null;

  const parsed = updateAchatEncaissementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const dates = deriveAchatEncaissementStatus(parsed.data.received_at ?? null, parsed.data.scheduled_date ?? null);
  if (!dates) {
    return { ok: false, error: 'Renseigne soit une date de réception, soit une date d’échéance prévue.' };
  }

  const supabase = createClient();
  // Lire l'état AVANT pour le diff
  const { data: before } = await supabase
    .from('achats_encaissements')
    .select('amount_mad, payment_method, notes, received_at, scheduled_date, status')
    .eq('id', parsed.data.encaissement_id)
    .single();
  const after = {
    amount_mad: parsed.data.amount_mad,
    payment_method: parsed.data.payment_method,
    notes: parsed.data.notes,
    received_at: dates.received_at,
    scheduled_date: dates.scheduled_date,
    status: dates.status,
  };
  const { error } = await supabase.from('achats_encaissements').update(after as any).eq('id', parsed.data.encaissement_id);
  if (error) return { ok: false, error: error.message };
  const diff = computeFinanceDiff(before as any, after, ['amount_mad','payment_method','notes','received_at','scheduled_date','status']);
  if (Object.keys(diff).length > 0) {
    const isStatusChange = 'status' in diff;
    await logFinanceAudit({
      table: 'achats_encaissements',
      recordId: parsed.data.encaissement_id,
      action: isStatusChange ? 'status_change' : 'update',
      actorId: user.id,
      label: isStatusChange
        ? `Bascule ${diff.status.before} → ${diff.status.after}`
        : `Encaissement modifié (${Object.keys(diff).join(', ')})`,
      payload: diff,
    });
  }
  revalidatePath(`/projects/${parsed.data.project_id}/achats`);
  return { ok: true };
}

export async function deleteAchatEncaissementAction(encaissementId: string) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  const { data: e } = await supabase.from('achats_encaissements').select('*').eq('id', encaissementId).single();
  await supabase.from('achats_encaissements').update({ deleted_at: new Date().toISOString() }).eq('id', encaissementId);
  await logFinanceAudit({
    table: 'achats_encaissements',
    recordId: encaissementId,
    action: 'delete',
    actorId: user.id,
    label: 'Encaissement supprimé',
    payload: e ? { amount_mad: (e as any).amount_mad, status: (e as any).status } : {},
  });
  await logDeletion({
    table: 'achats_encaissements',
    recordId: encaissementId,
    actorId: user.id,
    label: e ? `Encaissement achats - ${(e as any).amount_mad} MAD (${(e as any).status})` : 'Encaissement achats',
    snapshot: e,
  });
  await cascadeDeallocateOnDelete({ table: 'achats_encaissements', recordId: encaissementId, actorId: user.id });
  if (e) {
    revalidatePath(`/projects/${(e as any).project_id}/achats`);
    revalidatePath('/finance/tresorerie');
    revalidatePath('/finance/tresorerie/reconciliation');
  }
  return { ok: true };
}

// ─── Settings projet (budget achats, marge cible, adresse livraison) ─────

export async function updateProjectAchatsSettingsAction(
  projectId: string,
  settings: {
    achats_budget_mad?: number | null;
    achats_marge_cible_pct?: number | null;
    achats_adresse_livraison?: string | null;
  },
) {
  await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const payload: any = {};
  if (settings.achats_budget_mad != null) payload.achats_budget_mad = settings.achats_budget_mad;
  if (settings.achats_marge_cible_pct != null) payload.achats_marge_cible_pct = settings.achats_marge_cible_pct;
  if (settings.achats_adresse_livraison !== undefined) payload.achats_adresse_livraison = settings.achats_adresse_livraison || null;

  const { error } = await supabase.from('projects').update(payload).eq('id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/achats`);
  return { ok: true };
}

// ─── Bulk actions sur N lots achats (CEO 2026-06-10) ────────────────────

const bulkAttachDocSchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1),
  doc_id: z.string().uuid(),
  doc_role: z.enum(['invoice', 'quote', 'purchase_order']),
});

/**
 * Attache un document (facture, devis ou bon de commande) à N lots achats
 * d'un coup. CEO 2026-06-18 (B4) : ajout du bon de commande comme 3e type
 * de document distinct (purchase_order_doc_id).
 */
export async function bulkAttachAchatDocAction(input: unknown) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'assistante', 'achats']);
  const parsed = bulkAttachDocSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { lot_ids, doc_id, doc_role } = parsed.data;
  const supabase = createClient();

  const update: any = {};
  if (doc_role === 'invoice') update.invoice_doc_id = doc_id;
  else if (doc_role === 'quote') update.quote_doc_id = doc_id;
  else update.purchase_order_doc_id = doc_id;

  const { error } = await supabase.from('achats_lots').update(update).in('id', lot_ids);
  if (error) return { ok: false as const, error: error.message };

  // Audit log par lot (best-effort)
  const docLabel = doc_role === 'invoice' ? 'facture'
    : doc_role === 'quote' ? 'devis'
    : 'bon de commande';
  for (const id of lot_ids) {
    await logFinanceAudit({
      table: 'achats_lots',
      recordId: id,
      action: 'attach_doc',
      actorId: user.id,
      label: `Document ${docLabel} attaché en masse`,
      payload: { doc_id, doc_role, bulk_size: lot_ids.length },
    });
  }

  // Best-effort revalidate sur tous les projets concernés
  const { data: lots } = await supabase.from('achats_lots').select('project_id').in('id', lot_ids);
  for (const l of new Set((lots ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${l}/achats`);
  }
  revalidatePath('/dashboard/achats');
  return { ok: true as const, count: lot_ids.length };
}

// ─── Attacher / détacher un document sur UN seul lot achats (CEO 2026-06-18 B5)
// Utilisé depuis la fiche lot (panel dépliable) — alternative à l'action bulk
// pour l'opération courante "je gère un seul lot".
const attachOneSchema = z.object({
  lot_id: z.string().uuid(),
  doc_id: z.string().uuid().nullable(), // null = détacher
  doc_role: z.enum(['invoice', 'quote', 'purchase_order']),
});

export async function attachAchatDocAction(input: unknown) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'assistante', 'achats']);
  const parsed = attachOneSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { lot_id, doc_id, doc_role } = parsed.data;
  const supabase = createClient();

  const update: any = {};
  if (doc_role === 'invoice') update.invoice_doc_id = doc_id;
  else if (doc_role === 'quote') update.quote_doc_id = doc_id;
  else update.purchase_order_doc_id = doc_id;

  const { data: existing } = await supabase.from('achats_lots').select('project_id').eq('id', lot_id).single();
  const { error } = await supabase.from('achats_lots').update(update).eq('id', lot_id);
  if (error) return { ok: false as const, error: error.message };

  const docLabel = doc_role === 'invoice' ? 'facture' : doc_role === 'quote' ? 'devis' : 'bon de commande';
  await logFinanceAudit({
    table: 'achats_lots',
    recordId: lot_id,
    action: doc_id ? 'attach_doc' : 'update',
    actorId: user.id,
    label: doc_id ? `${docLabel} attaché` : `${docLabel} détaché`,
    payload: { doc_id, doc_role },
  });

  if (existing) revalidatePath(`/projects/${(existing as any).project_id}/achats`);
  return { ok: true as const };
}

const bulkAssignSupplierSchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1),
  supplier_id: z.string().uuid(),
});

/** Affecte le même fournisseur à N lots achats. Écrase le précédent. */
export async function bulkAssignAchatSupplierAction(input: unknown) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'assistante', 'achats']);
  const parsed = bulkAssignSupplierSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { lot_ids, supplier_id } = parsed.data;
  const supabase = createClient();

  // CEO 2026-06-18 B1 : FK achats_lots.supplier_id → artisans.id (pas partners).
  // L'ancien code lisait partners (agences immobilières) → toujours name=null.
  const { data: sup } = await supabase.from('artisans').select('name').eq('id', supplier_id).single();
  const name = (sup as any)?.name ?? null;

  const { error } = await supabase
    .from('achats_lots')
    .update({ supplier_id, ...(name ? { supplier_name: name } : {}) } as any)
    .in('id', lot_ids);
  if (error) return { ok: false as const, error: error.message };

  for (const id of lot_ids) {
    await logFinanceAudit({
      table: 'achats_lots',
      recordId: id,
      action: 'bulk_update',
      actorId: user.id,
      label: `Fournisseur réaffecté en masse${name ? ` → ${name}` : ''}`,
      payload: { supplier_id, supplier_name: name, bulk_size: lot_ids.length },
    });
  }

  const { data: lots } = await supabase.from('achats_lots').select('project_id').in('id', lot_ids);
  for (const l of new Set((lots ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${l}/achats`);
  }
  return { ok: true as const, count: lot_ids.length };
}

/** Soft-delete N lots achats. Validation CEO via /propria/suppressions. */
export async function bulkSoftDeleteAchatLotsAction(input: { lot_ids: string[] }) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'assistante', 'achats']);
  const ids = (input.lot_ids ?? []).filter(Boolean);
  if (ids.length === 0) return { ok: false as const, error: 'Aucun lot sélectionné' };
  const supabase = createClient();

  // Snapshot AVANT suppression pour audit
  const { data: lotsBefore } = await supabase
    .from('achats_lots')
    .select('id, project_id, numero, supplier_name, devis_fournisseur_mad, category')
    .in('id', ids)
    .is('deleted_at', null);

  const now = new Date().toISOString();
  const { error: delErr } = await supabase
    .from('achats_lots')
    .update({ deleted_at: now } as any)
    .in('id', ids)
    .is('deleted_at', null);
  if (delErr) return { ok: false as const, error: delErr.message };

  for (const lot of (lotsBefore ?? []) as any[]) {
    await logFinanceAudit({
      table: 'achats_lots',
      recordId: lot.id,
      action: 'delete',
      actorId: user.id,
      label: `Lot achats #${lot.numero ?? '?'} supprimé en masse · ${lot.supplier_name ?? '—'}`,
      payload: {
        bulk_size: ids.length,
        numero: lot.numero,
        supplier_name: lot.supplier_name,
        devis_fournisseur_mad: lot.devis_fournisseur_mad,
        category: lot.category,
      },
    });
  }

  const projectIds = new Set((lotsBefore ?? []).map((x: any) => x.project_id));
  for (const p of projectIds) revalidatePath(`/projects/${p}/achats`);
  revalidatePath('/dashboard/achats');
  return { ok: true as const, count: ids.length };
}

// ─── Bulk : modifier le prix des lots (CEO 2026-08-19, session A roadmap) ──
//
// Besoin : "4 suites, chacune son micro-ondes → changer le prix une fois pour
// les 4 lignes". L'utilisateur choisit LE champ à modifier (les 3 montants du
// lot + le prix unitaire sont des champs SOURCES du canon — jamais de dérivé
// stocké, donc aucune valeur calculée n'est touchée ici) et le mode :
//   - set   : valeur unique appliquée à tous les lots
//   - pct   : ajustement relatif en % (ex +5, -10) sur la valeur actuelle
//   - delta : ajustement absolu en MAD (ex +150, -200) sur la valeur actuelle
//
// Règles :
//   - pct/delta sur un lot dont le champ est vide → lot SKIPPÉ (raison
//     rapportée), on n'invente pas une base de calcul.
//   - Résultat négatif → lot SKIPPÉ (un prix négatif n'existe pas).
//   - Le champ unit_price_mad ne recalcule PAS budget_estimate_mad (le
//     pré-remplissage Q×PU est un confort de saisie du formulaire, pas une
//     règle de dérivation — voir migration 20260530140000).
//   - Audit logFinanceAudit par lot avec before/after (rollback lisible).

const bulkUpdatePricesSchema = z.object({
  project_id: z.string().uuid(),
  lot_ids: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un lot'),
  field: z.enum(['budget_estimate_mad', 'devis_fournisseur_mad', 'facture_client_mad', 'unit_price_mad']),
  mode: z.enum(['set', 'pct', 'delta']),
  value: z.coerce.number(),
});

const PRICE_FIELD_LABELS: Record<string, string> = {
  budget_estimate_mad: 'Devis prévisionnel',
  devis_fournisseur_mad: 'Devis fournisseur',
  facture_client_mad: 'Facture client',
  unit_price_mad: 'Prix unitaire',
};

export async function bulkUpdateAchatPricesAction(input: unknown) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'achats']);
  const parsed = bulkUpdatePricesSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const { project_id, lot_ids, field, mode, value } = parsed.data;
  if (mode === 'set' && value < 0) {
    return { ok: false as const, error: 'Un prix ne peut pas être négatif.' };
  }
  if (mode === 'pct' && value <= -100) {
    return { ok: false as const, error: 'Un ajustement de −100% ou plus ferait un prix négatif ou nul partout — utilise plutôt une valeur unique.' };
  }

  const supabase = createClient();
  const { data: lots, error: lotsErr } = await supabase
    .from('achats_lots')
    .select(`id, numero, supplier_name, category, description, ${field}`)
    .in('id', lot_ids)
    .eq('project_id', project_id)
    .is('deleted_at', null);
  if (lotsErr) return { ok: false as const, error: lotsErr.message };
  if (!lots || lots.length === 0) return { ok: false as const, error: 'Aucun lot valide trouvé.' };

  const skipped: { numero: number; reason: string }[] = [];
  let updated = 0;

  for (const lot of lots as any[]) {
    const current: number | null = lot[field] == null ? null : Number(lot[field]);

    let next: number;
    if (mode === 'set') {
      next = value;
    } else {
      if (current == null) {
        skipped.push({ numero: lot.numero, reason: `${PRICE_FIELD_LABELS[field]} non renseigné — un ajustement relatif n'a pas de base` });
        continue;
      }
      next = mode === 'pct'
        ? Math.round(current * (1 + value / 100) * 100) / 100
        : Math.round((current + value) * 100) / 100;
    }
    if (next < 0) {
      skipped.push({ numero: lot.numero, reason: `Résultat négatif (${next.toFixed(2)} MAD)` });
      continue;
    }
    if (current != null && next === current) {
      skipped.push({ numero: lot.numero, reason: 'Valeur inchangée' });
      continue;
    }

    const { error } = await supabase
      .from('achats_lots')
      .update({ [field]: next })
      .eq('id', lot.id)
      .eq('project_id', project_id)
      .is('deleted_at', null);
    if (error) {
      skipped.push({ numero: lot.numero, reason: error.message });
      continue;
    }
    updated += 1;

    await logFinanceAudit({
      table: 'achats_lots',
      recordId: lot.id,
      action: 'update',
      actorId: user.id,
      label: `${PRICE_FIELD_LABELS[field]} : ${current ?? '—'} → ${next} MAD (modif prix en bulk)`,
      payload: {
        [field]: { before: current, after: next },
        bulk_price_update: { mode, value, bulk_size: lot_ids.length },
      },
    });
  }

  revalidatePath(`/projects/${project_id}/achats`);
  return { ok: true as const, updatedCount: updated, skipped };
}

// ─── Bulk : dupliquer des lots (CEO 2026-08-19, session A roadmap) ─────────
//
// Besoin : électroménager / literie identiques pour plusieurs suites.
// 2 modes exclusifs :
//   - copies : N copies de chaque lot sélectionné (même suite que la source)
//   - suites : 1 copie de chaque lot sélectionné PAR suite cible cochée
//     (propria_unit_id = la suite cible)
//
// La copie reprend : catégorie, description, fournisseur, n° devis, les 3
// montants, quantité, prix unitaire, notes, collaborateur. Elle repart au
// statut 'a_commander', sans dates de commande/livraison ni documents liés
// (devis/facture/BC appartiennent à la commande d'origine).
//
// Option copy_acomptes : recrée sur chaque copie les acomptes NON PAYÉS
// (status='pending') du lot source — mêmes montants, %, dates, numéros.
// Les acomptes payés/partiels ne sont JAMAIS copiés (un règlement versé
// appartient à sa commande).
//
// Numérotation : max(numero)+1 séquentiel (contrainte UNIQUE project+numero,
// même mécanique que createAchatLotAction).

const bulkDuplicateSchema = z.object({
  project_id: z.string().uuid(),
  lot_ids: z.array(z.string().uuid()).min(1, 'Sélectionnez au moins un lot'),
  mode: z.enum(['copies', 'suites']),
  copies: z.coerce.number().int().min(1).max(10).optional(),
  target_unit_ids: z.array(z.string().uuid()).optional(),
  copy_acomptes: z.boolean().default(false),
});

export async function bulkDuplicateAchatLotsAction(input: unknown) {
  const user = await assertRole(['ceo', 'chef_projet', 'finance', 'achats']);
  const parsed = bulkDuplicateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };

  const { project_id, lot_ids, mode, copies, target_unit_ids, copy_acomptes } = parsed.data;
  if (mode === 'copies' && !copies) {
    return { ok: false as const, error: 'Indique le nombre de copies (1 à 10).' };
  }
  if (mode === 'suites' && (!target_unit_ids || target_unit_ids.length === 0)) {
    return { ok: false as const, error: 'Sélectionne au moins une suite cible.' };
  }

  const supabase = createClient();

  // Garde-fou : les suites cibles doivent appartenir au bien du projet.
  let validUnitIds: string[] = [];
  if (mode === 'suites') {
    const { data: project } = await supabase
      .from('projects').select('id, property_id').eq('id', project_id).single();
    if (!project?.property_id) {
      return { ok: false as const, error: 'Ce projet n\'a pas de bien rattaché — impossible de cibler des suites.' };
    }
    const { data: units, error: unitsErr } = await supabase
      .from('propria_units')
      .select('id')
      .eq('property_id', project.property_id)
      .in('id', target_unit_ids!)
      .is('deleted_at', null);
    if (unitsErr) return { ok: false as const, error: unitsErr.message };
    validUnitIds = (units ?? []).map((u: any) => u.id);
    if (validUnitIds.length !== target_unit_ids!.length) {
      return { ok: false as const, error: 'Une des suites ciblées n\'appartient pas au bien de ce projet.' };
    }
  }

  const { data: sources, error: srcErr } = await supabase
    .from('achats_lots')
    .select('*')
    .in('id', lot_ids)
    .eq('project_id', project_id)
    .is('deleted_at', null)
    .order('numero');
  if (srcErr) return { ok: false as const, error: srcErr.message };
  if (!sources || sources.length === 0) return { ok: false as const, error: 'Aucun lot valide trouvé.' };

  const { data: maxRow } = await supabase
    .from('achats_lots')
    .select('numero')
    .eq('project_id', project_id)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextNumero = (maxRow?.numero ?? 0) + 1;

  // Construit les copies : [{ row, sourceId }]
  const toInsert: { row: any; sourceId: string; sourceNumero: number }[] = [];
  for (const src of sources as any[]) {
    const base = {
      project_id,
      category: src.category,
      description: src.description,
      supplier_name: src.supplier_name,
      supplier_id: src.supplier_id,
      devis_number: src.devis_number,
      budget_estimate_mad: src.budget_estimate_mad,
      devis_fournisseur_mad: src.devis_fournisseur_mad,
      facture_client_mad: src.facture_client_mad,
      quantity: src.quantity,
      unit_price_mad: src.unit_price_mad,
      notes: src.notes,
      collaborator_id: src.collaborator_id,
      status: 'a_commander',
      // Dates et documents (invoice/quote/po) volontairement NON copiés.
    };
    if (mode === 'copies') {
      for (let i = 0; i < copies!; i++) {
        toInsert.push({
          row: { ...base, propria_unit_id: src.propria_unit_id, numero: nextNumero++ },
          sourceId: src.id,
          sourceNumero: src.numero,
        });
      }
    } else {
      for (const unitId of validUnitIds) {
        toInsert.push({
          row: { ...base, propria_unit_id: unitId, numero: nextNumero++ },
          sourceId: src.id,
          sourceNumero: src.numero,
        });
      }
    }
  }

  const { data: inserted, error: insErr } = await supabase
    .from('achats_lots')
    .insert(toInsert.map((t) => t.row))
    .select('id, numero, supplier_name, propria_unit_id');
  if (insErr) return { ok: false as const, error: insErr.message };

  // Retrouve la source de chaque ligne insérée via le numero (unique projet).
  const byNumero = new Map<number, { sourceId: string; sourceNumero: number }>();
  for (const t of toInsert) byNumero.set(t.row.numero, { sourceId: t.sourceId, sourceNumero: t.sourceNumero });

  // Option : copier les acomptes NON payés des lots sources.
  let acomptesCopied = 0;
  if (copy_acomptes) {
    const { data: pendingAcomptes, error: acErr } = await supabase
      .from('achats_payments')
      .select('lot_id, supplier_name, supplier_id, category, description, currency, amount_total, payment_type, acompte_number, acompte_pct, scheduled_date, notes')
      .in('lot_id', lot_ids)
      .eq('project_id', project_id)
      .eq('status', 'pending')
      .is('deleted_at', null);
    if (acErr) return { ok: false as const, error: `Lots créés, mais échec de lecture des acomptes : ${acErr.message}` };

    const bySource = new Map<string, any[]>();
    for (const a of pendingAcomptes ?? []) {
      const arr = bySource.get((a as any).lot_id) ?? [];
      arr.push(a);
      bySource.set((a as any).lot_id, arr);
    }

    const acomptesToInsert: any[] = [];
    for (const newLot of inserted ?? []) {
      const ref = byNumero.get((newLot as any).numero);
      if (!ref) continue;
      for (const a of bySource.get(ref.sourceId) ?? []) {
        acomptesToInsert.push({
          project_id,
          lot_id: (newLot as any).id,
          supplier_name: (a as any).supplier_name,
          supplier_id: (a as any).supplier_id,
          category: (a as any).category,
          description: (a as any).description,
          currency: (a as any).currency ?? 'MAD',
          amount_total: (a as any).amount_total,
          amount_paid: 0,
          payment_type: (a as any).payment_type,
          status: 'pending',
          acompte_number: (a as any).acompte_number,
          acompte_pct: (a as any).acompte_pct,
          scheduled_date: (a as any).scheduled_date,
          notes: (a as any).notes,
        });
      }
    }
    if (acomptesToInsert.length > 0) {
      const { error: acInsErr, count } = await supabase
        .from('achats_payments')
        .insert(acomptesToInsert, { count: 'exact' });
      if (acInsErr) return { ok: false as const, error: `Lots créés, mais échec de copie des acomptes : ${acInsErr.message}` };
      acomptesCopied = count ?? acomptesToInsert.length;
    }
  }

  // Audit : 1 entrée par lot créé, avec la référence du lot source.
  for (const newLot of inserted ?? []) {
    const ref = byNumero.get((newLot as any).numero);
    await logFinanceAudit({
      table: 'achats_lots',
      recordId: (newLot as any).id,
      action: 'create',
      actorId: user.id,
      label: `Lot achats #${(newLot as any).numero} créé par duplication du #${ref?.sourceNumero ?? '?'} · ${(newLot as any).supplier_name}`,
      payload: {
        duplicated_from_lot_id: ref?.sourceId ?? null,
        duplicated_from_numero: ref?.sourceNumero ?? null,
        mode,
        copy_acomptes,
        bulk_size: toInsert.length,
      },
    });
  }

  revalidatePath(`/projects/${project_id}/achats`);
  return { ok: true as const, createdCount: (inserted ?? []).length, acomptesCopied };
}
