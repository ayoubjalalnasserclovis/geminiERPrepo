'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit, type FinanceAuditTable } from '@/lib/finance/audit';
import {
  sendPaymentApprovalRequested,
  sendPaymentApprovalDecision,
  sendPaymentMarkedPaid,
  sendPaymentReceivedToClient,
} from '@/lib/email/templates';
import { PAYER_ACCOUNTS, payerAccountLabel } from '@/lib/finance/payer-account';

// Helper : mappe source enum → table finance_audit_log
function sourceToAuditTable(source: 'payment' | 'travaux_payment' | 'achats_payment'): FinanceAuditTable {
  return source === 'payment' ? 'payments'
       : source === 'travaux_payment' ? 'travaux_payments'
       : 'achats_payments';
}

// Helper : récupère la table cible depuis une approval row (couvre les 4 FK)
function approvalTargets(a: any): Array<{ table: FinanceAuditTable; id: string }> {
  const t: Array<{ table: FinanceAuditTable; id: string }> = [];
  if (a.payment_id) t.push({ table: 'payments', id: a.payment_id });
  if (a.travaux_payment_id) t.push({ table: 'travaux_payments', id: a.travaux_payment_id });
  if (a.achats_payment_id) t.push({ table: 'achats_payments', id: a.achats_payment_id });
  return t;
}

const PAYMENT_LABELS: Record<string, string> = {
  acompte_stoniz: 'Acompte initial Stoniz',
  honoraires_compromis: 'Signature compromis',
  honoraires_3d: 'Présentation 3D & lots techniques',
  honoraires_chantier: 'Lancement chantier',
  honoraires_livraison: 'Livraison',
  autre: 'Honoraires',
};

const URLS = {
  approval: (id: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/validations#${id}`,
};

const requestSchema = z.object({
  source: z.enum(['payment','travaux_payment','achats_payment']),
  source_id: z.string().uuid(),
  amount: z.coerce.number().min(0),
  currency: z.enum(['EUR','MAD','USD']).default('EUR'),
  beneficiary_name: z.string().min(1),
  description: z.string().optional().nullable(),
  urgency: z.enum(['normal','urgent']).default('normal'),
  request_notes: z.string().optional().nullable(),
  project_id: z.string().uuid().optional().nullable(),
  // Compte payeur (CEO 2026-07-08) : OBLIGATOIRE pour achats/travaux,
  // non concerné pour les honoraires Stoniz (source 'payment').
  payer_account: z.enum(PAYER_ACCOUNTS).optional().nullable(),
}).superRefine((d, ctx) => {
  if (d.source !== 'payment' && !d.payer_account) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['payer_account'],
      message: 'Choix du compte payeur obligatoire (compte personnel ou compte société STZ OJ).',
    });
  }
});

// ─── 1. Demander une validation ─────────────────────────────────────────
export async function requestApprovalAction(input: unknown) {
  const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante']);
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const d = parsed.data;

  const supabase = createClient();
  const admin = createAdminClient();

  // Empêche les doublons : 1 demande active par paiement source
  const fkCol = d.source === 'payment' ? 'payment_id'
              : d.source === 'travaux_payment' ? 'travaux_payment_id'
              : 'achats_payment_id';

  const { data: existing } = await supabase.from('payment_approvals')
    .select('id, final_status')
    .eq(fkCol, d.source_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (existing && existing.final_status !== 'rejected') {
    return { ok: false, error: 'Une demande de validation existe déjà pour ce paiement.' };
  }

  // Gate batch : si c'est un acompte achats OU travaux appartenant à un batch
  // déjà demandé en validation groupée, on refuse la demande individuelle.
  if (d.source === 'achats_payment' || d.source === 'travaux_payment') {
    const batchTable = d.source === 'achats_payment' ? 'achats_payments' : 'travaux_payments';
    const { data: payInBatch } = await supabase
      .from(batchTable)
      .select('payment_batch_id')
      .eq('id', d.source_id)
      .maybeSingle();
    const batchId = (payInBatch as any)?.payment_batch_id;
    if (batchId) {
      const { data: batchApproval } = await supabase
        .from('payment_approvals')
        .select('id, final_status')
        .eq('payment_batch_id', batchId)
        .is('deleted_at', null)
        .maybeSingle();
      if (batchApproval && batchApproval.final_status !== 'rejected') {
        return {
          ok: false,
          error: 'Cet acompte fait partie d’un batch déjà soumis en validation groupée.',
        };
      }
    }
  }

  // ─── Gate fiche artisan complète pour les paiements artisans/fournisseurs ──
  // Si le paiement est lié à un artisan (travaux_payment ou achats_payment via lot),
  // on vérifie que la fiche artisan a tout ce qu'il faut (banque, RIB, attestations).
  if (d.source === 'travaux_payment' || d.source === 'achats_payment') {
    const table = d.source === 'travaux_payment' ? 'travaux_payments' : 'achats_payments';
    const lotTable = d.source === 'travaux_payment' ? 'travaux_lots' : 'achats_lots';
    const artisanField = d.source === 'travaux_payment' ? 'artisan_id' : 'supplier_id';

    const { data: pay } = await admin.from(table)
      .select(`lot_id, lot:${lotTable}(${artisanField})`)
      .eq('id', d.source_id).single();

    const artisanId = (pay as any)?.lot?.[artisanField] as string | null | undefined;
    if (artisanId) {
      const { data: check } = await admin.rpc('check_artisan_payment_ready', {
        p_artisan_id: artisanId,
      });
      if (check) {
        // La fonction renvoie un string si incomplet, null sinon. On renvoie
        // artisanId pour que l'UI puisse afficher un lien direct vers la fiche.
        return {
          ok: false,
          error: String(check) + ' — complétez la fiche artisan avant de demander la validation.',
          artisanId,
        };
      }
    }
  }

  const payload: any = {
    [fkCol]: d.source_id,
    project_id: d.project_id ?? null,
    amount: d.amount,
    currency: d.currency,
    beneficiary_name: d.beneficiary_name,
    description: d.description ?? null,
    urgency: d.urgency,
    requested_by: me.id,
    request_notes: d.request_notes ?? null,
    payer_account: d.payer_account ?? null,
  };

  const { data: created, error } = await supabase
    .from('payment_approvals').insert(payload).select('id').single();
  if (error) return { ok: false, error: error.message };

  // Audit log : trace la demande sur le paiement source
  await logFinanceAudit({
    table: sourceToAuditTable(d.source),
    recordId: d.source_id,
    action: 'validate',
    actorId: me.id,
    label: `Demande de validation envoyée (${d.amount.toLocaleString('fr-FR')} ${d.currency})`,
    payload: {
      stage: 'requested',
      approval_id: created.id,
      amount: d.amount,
      currency: d.currency,
      beneficiary: d.beneficiary_name,
      urgency: d.urgency,
      notes: d.request_notes ?? null,
      payer_account: d.payer_account ?? null,
    },
  });

  // Email : prévenir Finance et CEO
  const { data: reviewers } = await admin
    .from('profiles')
    .select('id, email, full_name, role')
    .in('role', d.urgency === 'urgent' ? ['ceo','finance'] : ['finance','ceo'])
    .eq('is_active', true);

  const projectRef = await getProjectReference(admin, d.project_id ?? null);

  for (const r of reviewers ?? []) {
    try {
      await sendPaymentApprovalRequested({
        to: r.email,
        reviewer_name: r.full_name,
        requester_name: me.full_name,
        amount: d.amount,
        currency: d.currency,
        beneficiary: d.beneficiary_name,
        description: d.description ?? '—',
        urgency: d.urgency,
        payer_account_label: payerAccountLabel(d.payer_account),
        project_reference: projectRef,
        approval_url: URLS.approval(created.id),
        approval_id: created.id,
      });
    } catch (e) { console.warn('[email-approval-requested] echec', r.email, e); }
  }

  revalidatePath('/validations');
  if (d.project_id) revalidatePath(`/projects/${d.project_id}`);
  return { ok: true, id: created.id };
}

// ─── 1bis. Demande de validation GROUPÉE (batch d'acomptes achats) ──────
//
// Permet d'envoyer 1 SEULE demande au CEO/finance pour N acomptes d'un même
// fournisseur, au lieu de N demandes = N mails. Le batch_id est créé par
// bulkPlanAchatAcomptesAction et partagé entre tous les acomptes du batch.
//
// Garde-fous :
//   • Tous les acomptes du batch doivent appartenir au même fournisseur
//     (logique métier — sinon le mail récap n'a pas de sens).
//   • Aucun des acomptes du batch ne doit avoir une demande active déjà
//     (cas : l'utilisateur a déjà demandé validation individuelle pour l'un
//     d'eux). Pas de doublon.
//   • Le batch lui-même ne doit pas avoir une demande active.
//   • La fiche artisan/fournisseur doit être payment-ready (RIB, attestations).

const batchRequestSchema = z.object({
  payment_batch_id: z.string().uuid(),
  urgency: z.enum(['normal','urgent']).default('normal'),
  request_notes: z.string().optional().nullable(),
  // Compte payeur OBLIGATOIRE (batch = toujours achats, donc concerné).
  payer_account: z.enum(PAYER_ACCOUNTS, {
    errorMap: () => ({ message: 'Choix du compte payeur obligatoire (compte personnel ou compte société STZ OJ).' }),
  }),
});

export async function requestBatchApprovalAction(input: unknown) {
  const me = await assertRole(['ceo','chef_projet','sourcing','commercial','finance','assistante','achats']);
  const parsed = batchRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0].message };
  const { payment_batch_id, urgency, request_notes, payer_account } = parsed.data;

  const supabase = createClient();
  const admin = createAdminClient();

  // 1) Charge les acomptes du batch (pending, non supprimés)
  const { data: payments, error: payErr } = await supabase
    .from('achats_payments')
    .select('id, project_id, lot_id, supplier_id, supplier_name, amount_total, currency, acompte_number, status, scheduled_date')
    .eq('payment_batch_id', payment_batch_id)
    .is('deleted_at', null);
  if (payErr) return { ok: false as const, error: payErr.message };
  if (!payments || payments.length === 0) {
    return { ok: false as const, error: 'Batch introuvable ou vide.' };
  }
  const pendingPayments = payments.filter((p: any) => p.status === 'pending');
  if (pendingPayments.length === 0) {
    return { ok: false as const, error: 'Tous les acomptes de ce batch sont déjà payés ou non éligibles.' };
  }

  // 2) Garde-fou : un seul fournisseur dans le batch
  const supplierKeys = new Set(pendingPayments.map((p: any) => p.supplier_id ?? `name:${p.supplier_name}`));
  if (supplierKeys.size > 1) {
    return { ok: false as const, error: 'Le batch contient plusieurs fournisseurs — démarche groupée impossible.' };
  }

  // 3) Gate doublon : aucune demande active pour ce batch OU pour l'un des acomptes
  const acompteIds = pendingPayments.map((p: any) => p.id);
  const { data: existingForBatch } = await supabase.from('payment_approvals')
    .select('id, final_status').eq('payment_batch_id', payment_batch_id)
    .is('deleted_at', null).maybeSingle();
  if (existingForBatch && existingForBatch.final_status !== 'rejected') {
    return { ok: false as const, error: 'Une demande de validation existe déjà pour ce batch.' };
  }
  const { data: existingForAcomptes } = await supabase.from('payment_approvals')
    .select('id, achats_payment_id, final_status')
    .in('achats_payment_id', acompteIds)
    .is('deleted_at', null);
  const activeIndividual = (existingForAcomptes ?? []).filter((a: any) => a.final_status !== 'rejected');
  if (activeIndividual.length > 0) {
    return {
      ok: false as const,
      error: `${activeIndividual.length} acompte${activeIndividual.length > 1 ? 's' : ''} du batch a${activeIndividual.length > 1 ? 'ont' : ''} déjà une demande individuelle active. Annulez-la avant de re-demander en groupe.`,
    };
  }

  // 4) Gate fiche artisan complète (même règle que requestApprovalAction)
  const firstPayment: any = pendingPayments[0];
  const supplierId = firstPayment.supplier_id as string | null;
  if (supplierId) {
    const { data: check } = await admin.rpc('check_artisan_payment_ready', {
      p_artisan_id: supplierId,
    });
    if (check) {
      return {
        ok: false as const,
        error: String(check) + ' — complétez la fiche fournisseur avant de demander la validation groupée.',
        artisanId: supplierId,
      };
    }
  }

  // 5) Construit la description et la somme
  const amountTotal = pendingPayments.reduce((s: number, p: any) => s + Number(p.amount_total), 0);
  const currency = (firstPayment.currency || 'MAD') as 'EUR'|'MAD'|'USD';
  const supplierName = firstPayment.supplier_name as string;
  const projectId = firstPayment.project_id as string;

  // Récupère les numéros de lot (pour la description)
  const lotIds = Array.from(new Set(pendingPayments.map((p: any) => p.lot_id).filter(Boolean)));
  const { data: lotsInfo } = await admin
    .from('achats_lots')
    .select('id, numero, description')
    .in('id', lotIds);
  const lotNumsByLotId = new Map<string, number>((lotsInfo ?? []).map((l: any) => [l.id, l.numero]));
  const lotNums = pendingPayments
    .map((p: any) => lotNumsByLotId.get(p.lot_id))
    .filter((n) => n != null)
    .sort((a, b) => Number(a) - Number(b));

  const earliestSchedule = pendingPayments
    .map((p: any) => p.scheduled_date)
    .filter(Boolean)
    .sort()[0];

  const description = [
    `${pendingPayments.length} acompte${pendingPayments.length > 1 ? 's' : ''} pour ${supplierName}`,
    lotNums.length > 0 ? `lots #${lotNums.join(', #')}` : null,
    earliestSchedule ? `échéance ${earliestSchedule}` : null,
  ].filter(Boolean).join(' · ');

  // 6) Insère 1 SEULE demande payment_approvals avec payment_batch_id
  const payload: any = {
    payment_batch_id,
    project_id: projectId,
    amount: amountTotal,
    currency,
    beneficiary_name: supplierName,
    description,
    urgency,
    requested_by: me.id,
    request_notes: request_notes ?? null,
    payer_account,
  };

  const { data: created, error } = await supabase
    .from('payment_approvals').insert(payload).select('id').single();
  if (error) return { ok: false as const, error: error.message };

  // Audit log : trace la demande groupée sur chaque acompte du batch
  for (const p of pendingPayments as any[]) {
    await logFinanceAudit({
      table: 'achats_payments',
      recordId: p.id,
      action: 'validate',
      actorId: me.id,
      label: `Demande de validation groupée envoyée (batch ${pendingPayments.length} acomptes)`,
      payload: {
        stage: 'requested',
        approval_id: created.id,
        payment_batch_id,
        batch_size: pendingPayments.length,
        batch_amount_total: amountTotal,
        currency,
        beneficiary: supplierName,
        urgency,
        payer_account,
      },
    });
  }

  // 7) Email aux reviewers (template existant, 1 seul mail par reviewer)
  const { data: reviewers } = await admin
    .from('profiles')
    .select('id, email, full_name, role')
    .in('role', urgency === 'urgent' ? ['ceo','finance'] : ['finance','ceo'])
    .eq('is_active', true);

  const projectRef = await getProjectReference(admin, projectId);

  for (const r of reviewers ?? []) {
    try {
      await sendPaymentApprovalRequested({
        to: r.email,
        reviewer_name: r.full_name,
        requester_name: me.full_name,
        amount: amountTotal,
        currency,
        beneficiary: supplierName,
        description,
        urgency,
        payer_account_label: payerAccountLabel(payer_account),
        project_reference: projectRef,
        approval_url: URLS.approval(created.id),
        approval_id: created.id,
      });
    } catch (e) { console.warn('[email-batch-requested] echec', r.email, e); }
  }

  revalidatePath('/validations');
  revalidatePath(`/projects/${projectId}/achats`);
  return {
    ok: true as const,
    id: created.id,
    count: pendingPayments.length,
    amount: amountTotal,
  };
}

// ─── 2. Décision Finance ────────────────────────────────────────────────
export async function financeReviewAction(approvalId: string, decision: 'approved'|'rejected', notes?: string) {
  const me = await assertRole(['ceo','finance']);
  const supabase = createClient();
  const admin = createAdminClient();

  const { data: a } = await supabase.from('payment_approvals')
    .select('id, finance_status, requested_by, amount, currency, beneficiary_name, project_id, payment_id, travaux_payment_id, achats_payment_id, payment_batch_id')
    .eq('id', approvalId).single();
  if (!a) return { ok: false, error: 'Demande introuvable' };
  if (a.finance_status !== 'pending') return { ok: false, error: 'Cette demande a déjà été examinée' };

  const updatePayload: any = {
    finance_status: decision,
    finance_reviewer: me.id,
    finance_reviewed_at: new Date().toISOString(),
    finance_notes: notes ?? null,
  };
  // Si rejet : soft-delete pour liberer le slot et permettre une re-demande
  if (decision === 'rejected') {
    updatePayload.deleted_at = new Date().toISOString();
  }
  const { error } = await supabase.from('payment_approvals').update(updatePayload).eq('id', approvalId);
  if (error) return { ok: false, error: error.message };

  // Audit log : trace la décision Finance sur les cibles (paiement direct ou
  // chaque acompte d'un batch)
  const auditCommon = {
    actorId: me.id,
    label: `Finance ${decision === 'approved' ? 'a approuvé' : 'a rejeté'} la demande`,
    payload: {
      stage: 'finance_review',
      decision,
      approval_id: approvalId,
      reviewer_role: 'Finance',
      reviewer_name: me.full_name,
      notes: notes ?? null,
    },
  };
  const targets = approvalTargets(a);
  if (targets.length === 0 && (a as any).payment_batch_id) {
    // Batch : on logge sur chaque acompte du batch (achats OU travaux)
    const batchId = (a as any).payment_batch_id;
    const { data: batchAchatsPays } = await admin
      .from('achats_payments')
      .select('id')
      .eq('payment_batch_id', batchId)
      .is('deleted_at', null);
    for (const p of (batchAchatsPays ?? []) as any[]) {
      targets.push({ table: 'achats_payments', id: p.id });
    }
    if (targets.length === 0) {
      const { data: batchTravauxPays } = await admin
        .from('travaux_payments')
        .select('id')
        .eq('payment_batch_id', batchId)
        .is('deleted_at', null);
      for (const p of (batchTravauxPays ?? []) as any[]) {
        targets.push({ table: 'travaux_payments', id: p.id });
      }
    }
  }
  for (const t of targets) {
    await logFinanceAudit({ table: t.table, recordId: t.id, action: 'validate', ...auditCommon });
  }

  // Notifier le demandeur
  await notifyDecision(admin, approvalId, a, 'Finance', me.full_name, decision, notes);

  // Si approuvé, notifier le CEO (sauf si c'est lui qui a validé)
  if (decision === 'approved' && me.role !== 'ceo') {
    const { data: ceos } = await admin.from('profiles')
      .select('id, email, full_name').eq('role', 'ceo').eq('is_active', true);
    const projectRef = await getProjectReference(admin, a.project_id);
    for (const c of ceos ?? []) {
      try {
        await sendPaymentApprovalRequested({
          to: c.email,
          reviewer_name: c.full_name,
          requester_name: `${me.full_name} (validation Finance OK)`,
          amount: Number(a.amount),
          currency: a.currency as any,
          beneficiary: a.beneficiary_name,
          description: '(Finance a déjà approuvé — votre validation finale est requise)',
          urgency: 'normal',
          project_reference: projectRef,
          approval_url: URLS.approval(approvalId),
          approval_id: approvalId,
        });
      } catch (e) { console.warn('[email-ceo-notify] echec', c.email, e); }
    }
  }

  revalidatePath('/validations');
  return { ok: true };
}

// ─── 3. Décision CEO (finale) ───────────────────────────────────────────
export async function ceoApproveAction(approvalId: string, decision: 'approved'|'rejected', notes?: string) {
  const me = await assertRole(['ceo']);
  const supabase = createClient();
  const admin = createAdminClient();

  const { data: a } = await supabase.from('payment_approvals')
    .select('id, ceo_status, finance_status, requested_by, amount, currency, beneficiary_name, project_id, payment_id, travaux_payment_id, achats_payment_id, payment_batch_id')
    .eq('id', approvalId).single();
  if (!a) return { ok: false, error: 'Demande introuvable' };
  if (a.ceo_status !== 'pending') return { ok: false, error: 'Cette demande a déjà été statuée' };

  const update: any = {
    ceo_status: decision,
    ceo_reviewer: me.id,
    ceo_reviewed_at: new Date().toISOString(),
    ceo_notes: notes ?? null,
  };
  // Si CEO statue sans que Finance ait vu : marquer Finance comme "skipped"
  if (a.finance_status === 'pending') {
    update.finance_status = 'skipped';
  }
  // Si rejet : soft-delete pour permettre une re-demande
  if (decision === 'rejected') {
    update.deleted_at = new Date().toISOString();
  }

  const { error } = await supabase.from('payment_approvals').update(update).eq('id', approvalId);
  if (error) return { ok: false, error: error.message };

  // Audit log : trace la décision CEO sur les cibles
  const auditCommon = {
    actorId: me.id,
    label: `CEO ${decision === 'approved' ? 'a approuvé' : 'a rejeté'} la demande`,
    payload: {
      stage: 'ceo_review',
      decision,
      approval_id: approvalId,
      reviewer_role: 'CEO',
      reviewer_name: me.full_name,
      notes: notes ?? null,
      finance_skipped: (a as any).finance_status === 'pending',
    },
  };
  const targets = approvalTargets(a);
  if (targets.length === 0 && (a as any).payment_batch_id) {
    // Batch : achats OU travaux
    const batchId = (a as any).payment_batch_id;
    const { data: batchAchatsPays } = await admin
      .from('achats_payments')
      .select('id')
      .eq('payment_batch_id', batchId)
      .is('deleted_at', null);
    for (const p of (batchAchatsPays ?? []) as any[]) {
      targets.push({ table: 'achats_payments', id: p.id });
    }
    if (targets.length === 0) {
      const { data: batchTravauxPays } = await admin
        .from('travaux_payments')
        .select('id')
        .eq('payment_batch_id', batchId)
        .is('deleted_at', null);
      for (const p of (batchTravauxPays ?? []) as any[]) {
        targets.push({ table: 'travaux_payments', id: p.id });
      }
    }
  }
  for (const t of targets) {
    await logFinanceAudit({ table: t.table, recordId: t.id, action: 'validate', ...auditCommon });
  }

  // Notifier le demandeur
  await notifyDecision(admin, approvalId, a, 'CEO', me.full_name, decision, notes);

  revalidatePath('/validations');
  return { ok: true };
}

// ─── 4. Marquer comme payé + preuve virement ────────────────────────────
const markPaidSchema = z.object({
  payment_method: z.string().optional().nullable(),
  payment_reference: z.string().optional().nullable(),
});

export async function markApprovalAsPaidAction(approvalId: string, formData: FormData) {
  const me = await assertRole(['ceo','finance']);
  const supabase = createClient();
  const admin = createAdminClient();

  const { data: a } = await supabase.from('payment_approvals')
    .select('*').eq('id', approvalId).single();
  if (!a) return { ok: false, error: 'Demande introuvable' };
  if (a.final_status !== 'approved') {
    return { ok: false, error: 'La demande doit d\'abord être approuvée par le CEO' };
  }
  if (a.paid_at) return { ok: false, error: 'Déjà marqué comme payé' };

  const parsed = markPaidSchema.safeParse({
    payment_method: formData.get('payment_method'),
    payment_reference: formData.get('payment_reference'),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  // Optionnel : upload preuve de virement
  const proofFile = formData.get('proof_file') as File | null;
  let proofDocId: string | null = null;
  if (proofFile && proofFile.size > 0) {
    if (proofFile.size > 25 * 1024 * 1024) return { ok: false, error: 'Preuve > 25 MB' };
    const ext = proofFile.name.split('.').pop();
    const path = `approvals/${approvalId}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await admin.storage.from('documents')
      .upload(path, proofFile, { contentType: proofFile.type, upsert: false });
    if (upErr) return { ok: false, error: `Upload preuve : ${upErr.message}` };

    const { data: doc, error: docErr } = await admin.from('documents').insert({
      project_id: a.project_id,
      name: proofFile.name,
      type: 'preuve_virement',
      uploaded_by: me.id,
      uploaded_by_role: 'stoniz',
      storage_path: path,
      size_bytes: proofFile.size,
      mime_type: proofFile.type,
      is_visible_to_client: false,
      status: 'recu',
    }).select('id').single();
    if (docErr) return { ok: false, error: docErr.message };
    proofDocId = doc.id;
  }

  // Update approbation
  const { error } = await supabase.from('payment_approvals').update({
    paid_at: new Date().toISOString(),
    paid_by: me.id,
    payment_method: parsed.data.payment_method,
    payment_reference: parsed.data.payment_reference,
    proof_doc_id: proofDocId,
  }).eq('id', approvalId);
  if (error) return { ok: false, error: error.message };

  // Met à jour le paiement source (amount_paid, status, paid_at)
  await syncSourcePaymentAsPaid(admin, a);

  // Audit log : trace la bascule "marqué payé" sur la cible (paiement direct
  // ou chaque acompte d'un batch)
  const auditCommon = {
    actorId: me.id,
    label: `Marqué payé via workflow validation${parsed.data.payment_method ? ` (${parsed.data.payment_method})` : ''}`,
    payload: {
      stage: 'marked_paid',
      approval_id: approvalId,
      amount: Number(a.amount),
      currency: a.currency,
      payment_method: parsed.data.payment_method ?? null,
      payment_reference: parsed.data.payment_reference ?? null,
      proof_doc_id: proofDocId,
    },
  };
  const targets = approvalTargets(a);
  if (targets.length === 0 && (a as any).payment_batch_id) {
    // Batch : achats OU travaux
    const batchId = (a as any).payment_batch_id;
    const { data: batchAchatsPays } = await admin
      .from('achats_payments')
      .select('id')
      .eq('payment_batch_id', batchId)
      .is('deleted_at', null);
    for (const p of (batchAchatsPays ?? []) as any[]) {
      targets.push({ table: 'achats_payments', id: p.id });
    }
    if (targets.length === 0) {
      const { data: batchTravauxPays } = await admin
        .from('travaux_payments')
        .select('id')
        .eq('payment_batch_id', batchId)
        .is('deleted_at', null);
      for (const p of (batchTravauxPays ?? []) as any[]) {
        targets.push({ table: 'travaux_payments', id: p.id });
      }
    }
  }
  for (const t of targets) {
    await logFinanceAudit({ table: t.table, recordId: t.id, action: 'status_change', ...auditCommon });
  }

  // Email au demandeur
  const { data: requester } = await admin.from('profiles')
    .select('email, full_name').eq('id', a.requested_by).single();
  if (requester?.email) {
    try {
      await sendPaymentMarkedPaid({
        to: requester.email,
        requester_name: requester.full_name,
        amount: Number(a.amount),
        currency: a.currency,
        beneficiary: a.beneficiary_name,
        payment_method: parsed.data.payment_method ?? null,
        payment_reference: parsed.data.payment_reference ?? null,
        approval_url: URLS.approval(approvalId),
        approval_id: approvalId,
      });
    } catch (e) { console.warn('[email-paid] echec', e); }
  }

  // Si source = payment (honoraires Stoniz EUR), notifier aussi le client
  if (a.payment_id && a.project_id) {
    try {
      const [{ data: pay }, { data: proj }] = await Promise.all([
        admin.from('payments').select('type').eq('id', a.payment_id).single(),
        admin.from('projects').select('client:clients(email, full_name)').eq('id', a.project_id).single(),
      ]);
      const client = (proj as any)?.client;
      if (client?.email) {
        await sendPaymentReceivedToClient({
          to: client.email,
          client_name: client.full_name,
          amount_eur: Number(a.amount),
          payment_label: PAYMENT_LABELS[(pay as any)?.type] ?? 'Honoraires Stoniz',
          portal_url: `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/client/projects/${a.project_id}`,
          project_id: a.project_id,
        });
      }
    } catch (e) { console.warn('[email-payment-received-client] echec', e); }
  }

  revalidatePath('/validations');
  if (a.project_id) revalidatePath(`/projects/${a.project_id}/payments`);
  return { ok: true };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function getProjectReference(admin: any, projectId: string | null) {
  if (!projectId) return null;
  const { data } = await admin.from('projects').select('reference').eq('id', projectId).single();
  return data?.reference ?? null;
}

async function notifyDecision(admin: any, approvalId: string, approval: any,
                              reviewerRole: 'Finance' | 'CEO',
                              reviewerName: string, decision: 'approved'|'rejected', notes?: string) {
  const { data: requester } = await admin.from('profiles')
    .select('email, full_name').eq('id', approval.requested_by).single();
  if (!requester?.email) return;
  try {
    await sendPaymentApprovalDecision({
      to: requester.email,
      requester_name: requester.full_name,
      decision,
      reviewer_role: reviewerRole,
      reviewer_name: reviewerName,
      reviewer_notes: notes ?? null,
      amount: Number(approval.amount),
      currency: approval.currency,
      beneficiary: approval.beneficiary_name,
      approval_url: URLS.approval(approvalId),
      approval_id: approvalId,
    });
  } catch (e) { console.warn('[email-decision] echec', e); }
}

async function syncSourcePaymentAsPaid(admin: any, approval: any) {
  const now = new Date().toISOString();
  const today = now.slice(0, 10);
  if (approval.payment_id) {
    await admin.from('payments').update({
      amount_paid: approval.amount,
      paid_at: today,
      status: 'paid',
    }).eq('id', approval.payment_id);
  } else if (approval.travaux_payment_id) {
    await admin.from('travaux_payments').update({
      amount_paid: approval.amount,
      paid_at: today,
      status: 'paid',
    }).eq('id', approval.travaux_payment_id);
  } else if (approval.achats_payment_id) {
    await admin.from('achats_payments').update({
      amount_paid: approval.amount,
      paid_at: today,
      status: 'paid',
    }).eq('id', approval.achats_payment_id);
  } else if (approval.payment_batch_id) {
    // Cas batch : marquer comme payés TOUS les acomptes du batch (achats OU
    // travaux), chacun avec son propre amount_total (pas l'amount global de
    // l'approval, qui est la somme). On filtre sur status='pending' pour ne
    // pas réécrire des acomptes déjà reclassés manuellement. On essaie
    // d'abord achats, puis travaux si rien — un batch_id est globalement
    // unique (uuid v4), donc impossible qu'il existe dans les deux tables.
    const { data: achatsBatch } = await admin
      .from('achats_payments')
      .select('id, amount_total')
      .eq('payment_batch_id', approval.payment_batch_id)
      .eq('status', 'pending')
      .is('deleted_at', null);
    if ((achatsBatch ?? []).length > 0) {
      for (const p of (achatsBatch ?? []) as any[]) {
        await admin.from('achats_payments').update({
          amount_paid: p.amount_total,
          paid_at: today,
          status: 'paid',
        }).eq('id', p.id);
      }
    } else {
      const { data: travauxBatch } = await admin
        .from('travaux_payments')
        .select('id, amount_total')
        .eq('payment_batch_id', approval.payment_batch_id)
        .eq('status', 'pending')
        .is('deleted_at', null);
      for (const p of (travauxBatch ?? []) as any[]) {
        await admin.from('travaux_payments').update({
          amount_paid: p.amount_total,
          paid_at: today,
          status: 'paid',
        }).eq('id', p.id);
      }
    }
  }
}
