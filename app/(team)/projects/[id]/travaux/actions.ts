'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit, computeFinanceDiff } from '@/lib/finance/audit';
import { logDeletion } from '@/lib/audit/deletion';
import { cascadeDeallocateOnDelete } from '@/lib/finance/cascade-deallocate';

// ─── Lots ────────────────────────────────────────────────────────────────

const lotSchema = z.object({
  project_id: z.string().uuid(),
  category: z.string(),
  description: z.string().optional().nullable(),
  artisan_name: z.string().min(1),
  artisan_id: z.string().uuid().optional().nullable(),
  artisan_type: z.string().optional().nullable(),
  devis_number: z.string().optional().nullable(),
  budget_estimate_mad: z.coerce.number().min(0).optional().nullable(),
  devis_artisan_mad:   z.coerce.number().min(0).optional().nullable(),
  facture_client_mad:  z.coerce.number().min(0).optional().nullable(),
  status: z.string().default('a_planifier'),
  date_debut_estime: z.string().optional().nullable(),
  date_fin_estimee:  z.string().optional().nullable(),
  date_fin_reelle:   z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function cleanLot(raw: any) {
  const o = { ...raw };
  for (const k of ['description','artisan_type','artisan_id','devis_number','notes','date_debut_estime','date_fin_estimee','date_fin_reelle']) {
    if (o[k] === '') o[k] = null;
  }
  for (const k of ['budget_estimate_mad','devis_artisan_mad','facture_client_mad']) {
    if (o[k] === '' || o[k] == null) o[k] = null;
    else o[k] = Number(o[k]);
  }
  return o;
}

export async function createLotAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const cleaned = cleanLot(input);
  const parsed = lotSchema.safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  // Auto-incrément du numéro de lot
  const { data: maxRow } = await supabase
    .from('travaux_lots')
    .select('numero')
    .eq('project_id', parsed.data.project_id)
    .order('numero', { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (maxRow?.numero ?? 0) + 1;

  const { data: inserted, error } = await supabase.from('travaux_lots').insert({ ...parsed.data, numero }).select('id').single();
  if (error) return { ok: false, error: error.message };
  if (inserted?.id) {
    await logFinanceAudit({
      table: 'travaux_lots',
      recordId: inserted.id,
      action: 'create',
      actorId: user.id,
      label: `Lot ${numero} créé · ${(parsed.data as any).artisan_name ?? '—'}`,
      payload: { numero, artisan_name: (parsed.data as any).artisan_name, devis_artisan_mad: (parsed.data as any).devis_artisan_mad, category: (parsed.data as any).category },
    });
  }
  revalidatePath(`/projects/${parsed.data.project_id}/travaux`);
  return { ok: true };
}

// Statuts pour lesquels une facture artisan doit etre uploadee au prealable
const STATUSES_REQUIRING_FACTURE = ['demarre','en_cours','en_attente','termine'];

export async function updateLotAction(lotId: string, input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const cleaned = cleanLot(input);
  const parsed = lotSchema.partial().safeParse(cleaned);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data: existing } = await supabase
    .from('travaux_lots').select('*').eq('id', lotId).single();
  if (!existing) return { ok: false, error: 'Lot introuvable' };

  // Gate : pour passer en demarre/en_cours/en_attente/termine, exiger une facture artisan
  const newStatus = parsed.data.status;
  const wasNotActive = !STATUSES_REQUIRING_FACTURE.includes(existing.status);
  const willBeActive = newStatus && STATUSES_REQUIRING_FACTURE.includes(newStatus);

  if (wasNotActive && willBeActive) {
    const { count: factureCount } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('lot_id', lotId)
      .eq('type', 'facture_artisan')
      .is('deleted_at', null);

    if (!factureCount || factureCount === 0) {
      return {
        ok: false,
        error: `Impossible de passer ce lot en « ${newStatus} » : aucune facture artisan n'est uploadée pour ce lot. Ajoutez d'abord la facture dans le panneau du lot (section « Factures artisan »).`,
      };
    }
  }

  const { error } = await supabase.from('travaux_lots').update(parsed.data).eq('id', lotId);
  if (error) return { ok: false, error: error.message };
  // Audit : log diff
  const diff = computeFinanceDiff(existing as any, parsed.data, ['status','artisan_name','devis_artisan_mad','facture_client_mad','category','artisan_type']);
  if (Object.keys(diff).length > 0) {
    await logFinanceAudit({
      table: 'travaux_lots',
      recordId: lotId,
      action: diff.status ? 'status_change' : 'update',
      actorId: user.id,
      label: diff.status ? `Statut: ${(diff as any).status.before} → ${(diff as any).status.after}` : `Modifié (${Object.keys(diff).join(', ')})`,
      payload: diff,
    });
  }
  revalidatePath(`/projects/${existing.project_id}/travaux`);
  return { ok: true };
}

export async function deleteLotAction(lotId: string) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  const { data: lot } = await supabase.from('travaux_lots').select('*').eq('id', lotId).single();
  const { error } = await supabase.from('travaux_lots').update({ deleted_at: new Date().toISOString() }).eq('id', lotId);
  if (error) return { ok: false as const, error: error.message };
  await logDeletion({
    table: 'travaux_lots',
    recordId: lotId,
    actorId: user.id,
    label: lot ? `Lot travaux - ${(lot as any).artisan_name ?? 'inconnu'} - ${(lot as any).devis_artisan_mad ?? 0} MAD` : 'Lot travaux',
    snapshot: lot,
  });
  await logFinanceAudit({
    table: 'travaux_lots',
    recordId: lotId,
    action: 'delete',
    actorId: user.id,
    label: lot ? `Lot ${(lot as any).numero} supprimé · ${(lot as any).artisan_name ?? '—'}` : 'Lot supprimé',
    payload: lot ? { numero: (lot as any).numero, artisan_name: (lot as any).artisan_name, devis_artisan_mad: (lot as any).devis_artisan_mad } : {},
  });
  if (lot) revalidatePath(`/projects/${(lot as any).project_id}/travaux`);
  return { ok: true as const };
}

// ─── Acomptes (= travaux_payments liés à un lot) ─────────────────────────

const acompteSchema = z.object({
  lot_id: z.string().uuid(),
  acompte_number: z.coerce.number().int().min(1).max(6),
  acompte_pct: z.coerce.number().min(0).max(100).optional().nullable(),
  amount_total: z.coerce.number().min(0),
  scheduled_date: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function saveAcompteAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  if (raw.scheduled_date === '') raw.scheduled_date = null;
  if (raw.notes === '') raw.notes = null;
  if (raw.acompte_pct === '' || raw.acompte_pct == null) raw.acompte_pct = null;

  // P0 fix (2026-06-19) : si un acompte hérité d'une route d'insert qui ne
  // posait pas acompte_number arrive ici sans numéro, on calcule le prochain
  // numéro libre du lot avant validation. Évite "Number must be greater than
  // or equal to 1" sur édition d'un acompte orphelin (créé par allocation
  // banque ou projection cashflow avant le fix).
  if (raw.acompte_number == null || raw.acompte_number === '') {
    if (raw.lot_id) {
      const supabaseTmp = createClient();
      const { data: maxRow } = await supabaseTmp
        .from('travaux_payments')
        .select('acompte_number')
        .eq('lot_id', raw.lot_id)
        .is('deleted_at', null)
        .not('acompte_number', 'is', null)
        .order('acompte_number', { ascending: false })
        .limit(1)
        .maybeSingle();
      raw.acompte_number = ((maxRow as any)?.acompte_number ?? 0) + 1;
    }
  }

  const parsed = acompteSchema.safeParse(raw);
  if (!parsed.success) {
    // Message plus parlant si le min(1) saute (numéro absent malgré le fallback)
    const firstIssue = parsed.error.issues[0];
    if (firstIssue.path[0] === 'acompte_number') {
      return { ok: false, error: "Numéro d'acompte invalide. Réessaie ou contacte le support." };
    }
    return { ok: false, error: firstIssue.message };
  }

  const supabase = createClient();
  const { data: lot } = await supabase
    .from('travaux_lots')
    .select('project_id, artisan_name, artisan_type, category, devis_artisan_mad')
    .eq('id', parsed.data.lot_id)
    .single();
  if (!lot) return { ok: false, error: 'Lot introuvable' };

  // Trouve l'acompte existant (lot_id + acompte_number) ou en crée un nouveau.
  // CEO 2026-07-13 : on IGNORE les soft-deleted, sinon un acompte supprimé
  // resurgit en UPDATE alors que l'UI (qui filtre deleted_at) affiche le slot
  // comme libre. La contrainte UNIQUE partielle en BDD est justement
  // WHERE deleted_at IS NULL — on doit s'aligner en lecture.
  const { data: existing } = await supabase
    .from('travaux_payments')
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
    const { error } = await supabase.from('travaux_payments').update(after).eq('id', (existing as any).id);
    if (error) return { ok: false, error: error.message };
    const diff = computeFinanceDiff(existing as any, after, ['amount_total','acompte_pct','scheduled_date','notes']);
    if (Object.keys(diff).length > 0) {
      await logFinanceAudit({
        table: 'travaux_payments',
        recordId: (existing as any).id,
        action: 'update',
        actorId: user.id,
        label: `Acompte modifié (${Object.keys(diff).join(', ')})`,
        payload: diff,
      });
    }
  } else {
    const { data: created, error } = await supabase.from('travaux_payments').insert({
      project_id: lot.project_id,
      lot_id: parsed.data.lot_id,
      acompte_number: parsed.data.acompte_number,
      acompte_pct: parsed.data.acompte_pct,
      artisan_name: lot.artisan_name,
      artisan_type: lot.artisan_type,
      category: lot.category,
      currency: 'MAD',
      amount_total: parsed.data.amount_total,
      payment_type: parsed.data.acompte_number === 1 ? 'acompte' : 'autre',
      scheduled_date: parsed.data.scheduled_date,
      notes: parsed.data.notes,
      // Taux fixe 1 EUR = 10 MAD
      exchange_rate_eur: 10,
      exchange_rate_at: new Date().toISOString(),
    }).select('id').single();
    if (error) return { ok: false, error: error.message };
    if (created) {
      await logFinanceAudit({
        table: 'travaux_payments',
        recordId: (created as any).id,
        action: 'create',
        actorId: user.id,
        label: `Acompte n°${parsed.data.acompte_number} créé`,
        payload: {
          amount_total: parsed.data.amount_total,
          scheduled_date: parsed.data.scheduled_date,
          artisan_name: lot.artisan_name,
        },
      });
    }
  }

  revalidatePath(`/projects/${lot.project_id}/travaux`);
  return { ok: true };
}

export async function markAcomptePaidAction(paymentId: string, paid_at: string | null) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  const { data: pay } = await supabase
    .from('travaux_payments')
    .select('project_id, amount_total, status, paid_at')
    .eq('id', paymentId)
    .single();
  if (!pay) return { ok: false, error: 'Paiement introuvable' };

  const newPaidAt = paid_at ?? new Date().toISOString().slice(0, 10);
  const { error } = await supabase.from('travaux_payments').update({
    amount_paid: pay.amount_total,
    paid_at: newPaidAt,
    status: 'paid',
  }).eq('id', paymentId);
  if (error) return { ok: false, error: error.message };
  await logFinanceAudit({
    table: 'travaux_payments',
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
  revalidatePath(`/projects/${pay.project_id}/travaux`);
  return { ok: true };
}

export async function deleteAcompteAction(paymentId: string) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  const { data: pay } = await supabase.from('travaux_payments').select('*').eq('id', paymentId).single();
  // QA-BUG-035 : soft-delete (jamais de hard-delete sur une donnée financière —
  // préserve l'audit + le rapprochement bancaire qui référence ce paiement).
  await supabase.from('travaux_payments').update({ deleted_at: new Date().toISOString() }).eq('id', paymentId);
  await logFinanceAudit({
    table: 'travaux_payments',
    recordId: paymentId,
    action: 'delete',
    actorId: user.id,
    label: 'Paiement supprimé',
    payload: pay ? { amount_total: (pay as any).amount_total, artisan_name: (pay as any).artisan_name } : {},
  });
  await logDeletion({
    table: 'travaux_payments',
    recordId: paymentId,
    actorId: user.id,
    label: pay ? `Paiement artisan - ${(pay as any).artisan_name ?? 'inconnu'} - ${(pay as any).amount_total} MAD` : 'Paiement artisan',
    snapshot: pay,
  });
  // Cascade : retire les allocations banque qui pointaient sur ce paiement.
  await cascadeDeallocateOnDelete({ table: 'travaux_payments', recordId: paymentId, actorId: user.id });
  if (pay) {
    revalidatePath(`/projects/${(pay as any).project_id}/travaux`);
    revalidatePath('/finance/tresorerie');
    revalidatePath('/finance/tresorerie/reconciliation');
  }
  return { ok: true };
}

// ─── Encaissements client (travaux) ──────────────────────────────────────
//
// Deux états :
//   • 'recu'     → encaissement effectif, received_at obligatoire.
//   • 'planifie' → à encaisser, scheduled_date obligatoire (received_at null).
// Le module Projection cashflow lit scheduled_date côté planifié pour la
// visibilité tréso à 30/60/90j.

const encaissementSchema = z.object({
  project_id: z.string().uuid(),
  amount_mad: z.coerce.number().min(0),
  received_at: z.string().optional().nullable(),
  scheduled_date: z.string().optional().nullable(),
  payment_method: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

function deriveEncaissementStatus(received_at: string | null, scheduled_date: string | null) {
  if (received_at) return { status: 'recu' as const, received_at, scheduled_date: scheduled_date ?? null };
  if (scheduled_date) return { status: 'planifie' as const, received_at: null, scheduled_date };
  return null;
}

export async function addEncaissementAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  if (raw.received_at === '') raw.received_at = null;
  if (raw.scheduled_date === '') raw.scheduled_date = null;
  if (raw.payment_method === '') raw.payment_method = null;
  if (raw.notes === '') raw.notes = null;

  const parsed = encaissementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const dates = deriveEncaissementStatus(parsed.data.received_at ?? null, parsed.data.scheduled_date ?? null);
  if (!dates) {
    return { ok: false, error: 'Renseigne soit une date de réception, soit une date d’échéance prévue.' };
  }

  const supabase = createClient();
  const { data: created, error } = await supabase.from('travaux_encaissements').insert({
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
      table: 'travaux_encaissements',
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
  revalidatePath(`/projects/${parsed.data.project_id}/travaux`);
  return { ok: true };
}

const updateEncaissementSchema = encaissementSchema.extend({
  encaissement_id: z.string().uuid(),
});

export async function updateEncaissementAction(input: unknown) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const raw: any = { ...(input as any) };
  if (raw.received_at === '') raw.received_at = null;
  if (raw.scheduled_date === '') raw.scheduled_date = null;
  if (raw.payment_method === '') raw.payment_method = null;
  if (raw.notes === '') raw.notes = null;

  const parsed = updateEncaissementSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const dates = deriveEncaissementStatus(parsed.data.received_at ?? null, parsed.data.scheduled_date ?? null);
  if (!dates) {
    return { ok: false, error: 'Renseigne soit une date de réception, soit une date d’échéance prévue.' };
  }

  const supabase = createClient();
  // Lire l'état AVANT pour le diff
  const { data: before } = await supabase
    .from('travaux_encaissements')
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
  const { error } = await supabase.from('travaux_encaissements').update(after as any).eq('id', parsed.data.encaissement_id);
  if (error) return { ok: false, error: error.message };
  const diff = computeFinanceDiff(before as any, after, ['amount_mad','payment_method','notes','received_at','scheduled_date','status']);
  if (Object.keys(diff).length > 0) {
    const isStatusChange = 'status' in diff;
    await logFinanceAudit({
      table: 'travaux_encaissements',
      recordId: parsed.data.encaissement_id,
      action: isStatusChange ? 'status_change' : 'update',
      actorId: user.id,
      label: isStatusChange
        ? `Bascule ${diff.status.before} → ${diff.status.after}`
        : `Encaissement modifié (${Object.keys(diff).join(', ')})`,
      payload: diff,
    });
  }
  revalidatePath(`/projects/${parsed.data.project_id}/travaux`);
  return { ok: true };
}

export async function deleteEncaissementAction(encaissementId: string) {
  const user = await assertRole(['ceo','chef_projet','finance','achats']);
  const supabase = createClient();
  const { data: e } = await supabase.from('travaux_encaissements').select('*').eq('id', encaissementId).single();
  await supabase.from('travaux_encaissements').update({ deleted_at: new Date().toISOString() }).eq('id', encaissementId);
  await logFinanceAudit({
    table: 'travaux_encaissements',
    recordId: encaissementId,
    action: 'delete',
    actorId: user.id,
    label: 'Encaissement supprimé',
    payload: e ? { amount_mad: (e as any).amount_mad, status: (e as any).status } : {},
  });
  await logDeletion({
    table: 'travaux_encaissements',
    recordId: encaissementId,
    actorId: user.id,
    label: e ? `Encaissement travaux - ${(e as any).amount_mad} MAD (${(e as any).status})` : 'Encaissement travaux',
    snapshot: e,
  });
  // Cascade : retire les allocations banque qui pointaient sur cet encaissement.
  await cascadeDeallocateOnDelete({ table: 'travaux_encaissements', recordId: encaissementId, actorId: user.id });
  if (e) {
    revalidatePath(`/projects/${(e as any).project_id}/travaux`);
    revalidatePath('/finance/tresorerie');
    revalidatePath('/finance/tresorerie/reconciliation');
  }
  return { ok: true };
}

// ─── Settings projet (budget, marge cible, adresse chantier) ─────────────

// CEO 2026-06-19 — schéma Zod défensif :
// avant, `travaux_budget_mad: Number('')` côté UI envoyait NaN et l'INSERT
// passait sans bruit, corrompant la projection. Maintenant on coerce proprement
// avec gestion explicite des null/undefined/NaN.
const travauxSettingsSchema = z.object({
  travaux_budget_mad: z.preprocess(
    (v) => (v === '' || v == null || Number.isNaN(v as any) ? null : v),
    z.coerce.number().min(0).nullable(),
  ),
  travaux_marge_cible_pct: z.preprocess(
    (v) => (v === '' || v == null || Number.isNaN(v as any) ? null : v),
    z.coerce.number().min(0).max(100).nullable(),
  ),
  travaux_adresse_chantier: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.string().nullable(),
  ),
});

export async function updateProjectTravauxSettingsAction(
  projectId: string,
  settings: {
    travaux_budget_mad?: number | null;
    travaux_marge_cible_pct?: number | null;
    travaux_adresse_chantier?: string | null;
  },
) {
  await assertRole(['ceo','chef_projet']);
  const parsed = travauxSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }
  const supabase = createClient();
  // On envoie SEULEMENT les champs explicitement fournis (undefined = pas touché)
  const payload: any = {};
  if ('travaux_budget_mad' in settings) payload.travaux_budget_mad = parsed.data.travaux_budget_mad;
  if ('travaux_marge_cible_pct' in settings) payload.travaux_marge_cible_pct = parsed.data.travaux_marge_cible_pct;
  if ('travaux_adresse_chantier' in settings) payload.travaux_adresse_chantier = parsed.data.travaux_adresse_chantier;

  const { error } = await supabase.from('projects').update(payload).eq('id', projectId);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/projects/${projectId}/travaux`);
  return { ok: true };
}

// ─── Bulk actions sur N lots travaux (CEO 2026-06-10) ──────────────────

const bulkAttachQuoteSchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1),
  doc_id: z.string().uuid(),
});

/**
 * Attache un devis (vendor_documents type='devis') à N lots travaux.
 * Le devis lui-même se crée via `createVendorDocumentAction`.
 */
export async function bulkAttachTravauxQuoteAction(input: unknown) {
  const user = await assertRole(['ceo', 'finance', 'assistante', 'chef_projet']);
  const parsed = bulkAttachQuoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { lot_ids, doc_id } = parsed.data;
  const supabase = createClient();

  const { error } = await supabase
    .from('travaux_lots')
    .update({ quote_doc_id: doc_id } as any)
    .in('id', lot_ids);
  if (error) return { ok: false as const, error: error.message };

  for (const id of lot_ids) {
    await logFinanceAudit({
      table: 'travaux_lots',
      recordId: id,
      action: 'attach_doc',
      actorId: user.id,
      label: 'Devis attaché en masse',
      payload: { doc_id, doc_role: 'quote', bulk_size: lot_ids.length },
    });
  }

  const { data: lots } = await supabase.from('travaux_lots').select('project_id').in('id', lot_ids);
  for (const l of new Set((lots ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${l}/travaux`);
  }
  return { ok: true as const, count: lot_ids.length };
}

/**
 * Attache une facture (vendor_documents type='facture') à N acomptes travaux.
 * Plusieurs acomptes du même artisan peuvent partager la même facture.
 */
const bulkAttachTravauxInvoiceSchema = z.object({
  payment_ids: z.array(z.string().uuid()).min(1, 'Aucun acompte sélectionné'),
  doc_id: z.string().uuid('Document invalide'),
});

export async function bulkAttachTravauxInvoiceAction(input: { payment_ids: string[]; doc_id: string }) {
  const user = await assertRole(['ceo', 'finance', 'assistante', 'chef_projet']);
  // CEO 2026-06-18 : validation Zod (manquait, doc_id pouvait être null/undefined
  // et casser silencieusement la FK invoice_doc_id).
  const parsed = bulkAttachTravauxInvoiceSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { payment_ids: ids, doc_id } = parsed.data;
  const supabase = createClient();
  const { error } = await supabase
    .from('travaux_payments')
    .update({ invoice_doc_id: doc_id } as any)
    .in('id', ids)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };

  for (const id of ids) {
    await logFinanceAudit({
      table: 'travaux_payments',
      recordId: id,
      action: 'attach_doc',
      actorId: user.id,
      label: 'Facture attachée en masse',
      payload: { doc_id: input.doc_id, doc_role: 'invoice', bulk_size: ids.length },
    });
  }

  const { data: pmts } = await supabase.from('travaux_payments').select('project_id').in('id', ids);
  for (const p of new Set((pmts ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${p}/travaux`);
  }
  return { ok: true as const, count: ids.length };
}

const bulkAssignArtisanSchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1),
  artisan_id: z.string().uuid(),
});

/** Affecte le même artisan à N lots travaux. Écrase le précédent. */
export async function bulkAssignTravauxArtisanAction(input: unknown) {
  const user = await assertRole(['ceo', 'finance', 'assistante', 'chef_projet']);
  const parsed = bulkAssignArtisanSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { lot_ids, artisan_id } = parsed.data;
  const supabase = createClient();

  const { data: artisan } = await supabase
    .from('artisans')
    .select('name, type')
    .eq('id', artisan_id)
    .single();
  const name = (artisan as any)?.name ?? null;
  const type = (artisan as any)?.type ?? null;

  const { error } = await supabase
    .from('travaux_lots')
    .update({
      artisan_id,
      ...(name ? { artisan_name: name } : {}),
      ...(type ? { artisan_type: type } : {}),
    } as any)
    .in('id', lot_ids);
  if (error) return { ok: false as const, error: error.message };

  for (const id of lot_ids) {
    await logFinanceAudit({
      table: 'travaux_lots',
      recordId: id,
      action: 'bulk_update',
      actorId: user.id,
      label: `Artisan réaffecté en masse${name ? ` → ${name}` : ''}`,
      payload: { artisan_id, artisan_name: name, artisan_type: type, bulk_size: lot_ids.length },
    });
  }

  const { data: lots } = await supabase.from('travaux_lots').select('project_id').in('id', lot_ids);
  for (const l of new Set((lots ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${l}/travaux`);
  }
  return { ok: true as const, count: lot_ids.length };
}

/** Change le statut de N lots travaux d'un coup. */
const bulkChangeStatusSchema = z.object({
  lot_ids: z.array(z.string().uuid()).min(1),
  status: z.string().min(1),
});
export async function bulkChangeTravauxStatusAction(input: unknown) {
  const user = await assertRole(['ceo', 'finance', 'assistante', 'chef_projet']);
  const parsed = bulkChangeStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { lot_ids, status } = parsed.data;
  const supabase = createClient();

  // Gate : pour passer en demarre/en_cours/en_attente/termine, exiger une facture artisan sur chaque lot
  if (STATUSES_REQUIRING_FACTURE.includes(status)) {
    const { data: lotsToCheck } = await supabase
      .from('travaux_lots')
      .select('id, numero, artisan_name, status')
      .in('id', lot_ids)
      .is('deleted_at', null);

    for (const lot of (lotsToCheck ?? []) as any[]) {
      const wasNotActive = !STATUSES_REQUIRING_FACTURE.includes(lot.status);
      if (wasNotActive) {
        const { count: factureCount } = await supabase
          .from('documents')
          .select('id', { count: 'exact', head: true })
          .eq('lot_id', lot.id)
          .eq('type', 'facture_artisan')
          .is('deleted_at', null);

        if (!factureCount || factureCount === 0) {
          return {
            ok: false as const,
            error: `Impossible de passer le lot #${lot.numero} (${lot.artisan_name ?? 'artisan'}) en « ${status} » : aucune facture artisan n'est uploadée pour ce lot. Ajoutez d'abord la facture dans le panneau du lot.`,
          };
        }
      }
    }
  }

  const { error } = await supabase
    .from('travaux_lots')
    .update({ status } as any)
    .in('id', lot_ids)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };

  for (const id of lot_ids) {
    await logFinanceAudit({
      table: 'travaux_lots',
      recordId: id,
      action: 'status_change',
      actorId: user.id,
      label: `Statut → ${status} (en masse)`,
      payload: { status, bulk_size: lot_ids.length },
    });
  }

  const { data: lots } = await supabase.from('travaux_lots').select('project_id').in('id', lot_ids);
  for (const l of new Set((lots ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${l}/travaux`);
  }
  return { ok: true as const, count: lot_ids.length };
}

/** Soft-delete N lots travaux. Validation CEO via /propria/suppressions. */
export async function bulkSoftDeleteTravauxLotsAction(input: { lot_ids: string[] }) {
  const user = await assertRole(['ceo', 'finance', 'assistante', 'chef_projet']);
  const ids = (input.lot_ids ?? []).filter(Boolean);
  if (ids.length === 0) return { ok: false as const, error: 'Aucun lot sélectionné' };
  const supabase = createClient();

  const { data: lotsBefore } = await supabase
    .from('travaux_lots')
    .select('id, project_id, numero, artisan_name, devis_artisan_mad, category')
    .in('id', ids)
    .is('deleted_at', null);

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('travaux_lots')
    .update({ deleted_at: now } as any)
    .in('id', ids)
    .is('deleted_at', null);
  if (error) return { ok: false as const, error: error.message };

  for (const lot of (lotsBefore ?? []) as any[]) {
    await logFinanceAudit({
      table: 'travaux_lots',
      recordId: lot.id,
      action: 'delete',
      actorId: user.id,
      label: `Lot travaux #${lot.numero ?? '?'} supprimé en masse · ${lot.artisan_name ?? '—'}`,
      payload: {
        bulk_size: ids.length,
        numero: lot.numero,
        artisan_name: lot.artisan_name,
        devis_artisan_mad: lot.devis_artisan_mad,
        category: lot.category,
      },
    });
  }

  for (const p of new Set((lotsBefore ?? []).map((x: any) => x.project_id))) {
    revalidatePath(`/projects/${p}/travaux`);
  }
  revalidatePath('/dashboard/travaux');
  return { ok: true as const, count: ids.length };
}
