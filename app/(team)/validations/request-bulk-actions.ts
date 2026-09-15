'use server';

/**
 * Demande de paiement groupée multi-source (CEO 2026-06-25 Phase B2).
 *
 * Permet à un utilisateur de sélectionner N acomptes existants (achats ou
 * travaux) et de demander leur validation en 1 SEUL email par fournisseur /
 * artisan, en attribuant un `payment_batch_id` partagé.
 *
 * Différence avec `requestBatchApprovalAction` :
 *   • Cette action crée le batch (UPDATE payment_batch_id) en plus de la
 *     demande d'approbation. `requestBatchApprovalAction` suppose que le
 *     batch existe déjà (créé par bulkPlanAchatAcomptesAction).
 *   • Elle accepte des acomptes de plusieurs fournisseurs : elle les groupe
 *     par fournisseur et crée 1 batch par groupe.
 *   • Elle marche pour achats ET travaux (symétrie BDD garantie par la
 *     migration 20260625120000_travaux_payment_batch_symmetry).
 *
 * Garde-fous :
 *   • Aucun des acomptes ne doit déjà appartenir à un batch en cours de
 *     validation (sinon doublon).
 *   • Aucun des acomptes ne doit avoir une demande individuelle active.
 *   • Fiche artisan / fournisseur payment-ready (RIB, attestations).
 *
 * Best-effort : si un groupe échoue, on log dans `skipped[]` et on continue.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit } from '@/lib/finance/audit';
import { sendPaymentApprovalRequested } from '@/lib/email/templates';
import { PAYER_ACCOUNTS, payerAccountLabel, type PayerAccount } from '@/lib/finance/payer-account';

// ─── Types publics (réutilisés par l'UI Phase B3) ──────────────────────────

export type RequestPaymentBulkInput = {
  project_id: string;
  source: 'achats' | 'travaux';
  payment_ids: string[];
  urgency: 'normal' | 'urgent';
  request_notes?: string | null;
  /** Compte payeur OBLIGATOIRE (CEO 2026-07-08) : 'personnel' | 'stz_oj'. */
  payer_account: PayerAccount;
};

export type RequestPaymentBulkBatchCreated = {
  batch_id: string;
  supplier_name: string;
  n_acomptes: number;
  total_mad: number;
  currency: string;
  approval_id: string;
};

export type RequestPaymentBulkSkipped = {
  payment_id: string;
  reason: string;
};

export type RequestPaymentBulkResult =
  | {
      ok: true;
      batches_created: RequestPaymentBulkBatchCreated[];
      skipped: RequestPaymentBulkSkipped[];
    }
  | { ok: false; error: string };

// ─── Helpers privés ────────────────────────────────────────────────────────

const URLS = {
  approval: (id: string) =>
    `${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/validations#${id}`,
};

const inputSchema = z.object({
  project_id: z.string().uuid(),
  source: z.enum(['achats', 'travaux']),
  payment_ids: z.array(z.string().uuid()).min(1, 'Aucun acompte sélectionné'),
  urgency: z.enum(['normal', 'urgent']).default('normal'),
  request_notes: z.string().optional().nullable(),
  // Compte payeur OBLIGATOIRE (CEO 2026-07-08) — s'applique à tous les
  // batches créés par cet envoi.
  payer_account: z.enum(PAYER_ACCOUNTS, {
    errorMap: () => ({ message: 'Choix du compte payeur obligatoire (compte personnel ou compte société STZ OJ).' }),
  }),
});

async function getProjectReference(admin: any, projectId: string | null) {
  if (!projectId) return null;
  const { data } = await admin.from('projects').select('reference').eq('id', projectId).single();
  return data?.reference ?? null;
}

/**
 * Construit la clé de regroupement par fournisseur. On préfère la FK
 * (`supplier_id` / `artisan_id`) — si NULL, fallback `name:<nom>`.
 */
function groupKey(payment: any, source: 'achats' | 'travaux'): string {
  if (source === 'achats') {
    return payment.supplier_id ? `id:${payment.supplier_id}` : `name:${payment.supplier_name ?? '∅'}`;
  }
  return payment.artisan_id ? `id:${payment.artisan_id}` : `name:${payment.artisan_name ?? '∅'}`;
}

function supplierLabel(payment: any, source: 'achats' | 'travaux'): string {
  return (source === 'achats' ? payment.supplier_name : payment.artisan_name) ?? 'Fournisseur inconnu';
}

function supplierFkId(payment: any, source: 'achats' | 'travaux'): string | null {
  return (source === 'achats' ? payment.supplier_id : payment.artisan_id) ?? null;
}

// ─── Action principale ────────────────────────────────────────────────────

export async function requestPaymentForExistingAcomptesAction(
  input: RequestPaymentBulkInput
): Promise<RequestPaymentBulkResult> {
  try {
    const me = await assertRole([
      'ceo', 'chef_projet', 'sourcing', 'commercial',
      'finance', 'assistante', 'achats', 'developer',
    ]);

    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message };
    }
    const d = parsed.data;

    const supabase = createClient();
    const admin = createAdminClient();

    // ─── 1. Charge les acomptes (achats ou travaux) ────────────────────────
    const table = d.source === 'achats' ? 'achats_payments' : 'travaux_payments';
    const supplierSelect = d.source === 'achats'
      ? 'id, project_id, lot_id, supplier_id, supplier_name, amount_total, currency, acompte_number, status, scheduled_date, payment_batch_id'
      : 'id, project_id, lot_id, artisan_id, artisan_name, amount_total, currency, acompte_number, status, scheduled_date, payment_batch_id';

    const { data: payments, error: payErr } = await supabase
      .from(table)
      .select(supplierSelect)
      .in('id', d.payment_ids)
      .eq('project_id', d.project_id)
      .is('deleted_at', null);

    if (payErr) return { ok: false, error: payErr.message };
    if (!payments || payments.length === 0) {
      return { ok: false, error: 'Aucun acompte trouvé pour cette sélection.' };
    }

    const skipped: RequestPaymentBulkSkipped[] = [];

    // Acomptes manquants par rapport à la sélection (ex : un acompte d'un
    // autre projet, ou supprimé) → on les marque skipped pour info UI.
    const foundIds = new Set(payments.map((p: any) => p.id));
    for (const id of d.payment_ids) {
      if (!foundIds.has(id)) {
        skipped.push({ payment_id: id, reason: 'Acompte introuvable ou rattaché à un autre projet.' });
      }
    }

    // Filtre status pending uniquement
    const pendingPayments = (payments as any[]).filter((p) => {
      if (p.status !== 'pending') {
        skipped.push({ payment_id: p.id, reason: `Statut ${p.status} — déjà traité ou non éligible.` });
        return false;
      }
      return true;
    });

    if (pendingPayments.length === 0) {
      return { ok: false, error: 'Aucun acompte éligible (tous sont déjà payés ou non pending).' };
    }

    // ─── 2. Gate doublon : acomptes déjà dans un batch actif ──────────────
    const alreadyInBatch = pendingPayments.filter((p) => p.payment_batch_id);
    if (alreadyInBatch.length > 0) {
      const batchIds = Array.from(new Set(alreadyInBatch.map((p) => p.payment_batch_id)));
      const { data: existingApprovals } = await supabase
        .from('payment_approvals')
        .select('payment_batch_id, final_status')
        .in('payment_batch_id', batchIds)
        .is('deleted_at', null);

      const activeBatchIds = new Set(
        (existingApprovals ?? [])
          .filter((a: any) => a.final_status !== 'rejected')
          .map((a: any) => a.payment_batch_id)
      );
      for (const p of alreadyInBatch) {
        if (activeBatchIds.has(p.payment_batch_id)) {
          skipped.push({
            payment_id: p.id,
            reason: 'Acompte déjà dans un batch en cours de validation.',
          });
        }
      }
    }

    // ─── 3. Gate doublon : demande individuelle active ────────────────────
    const fkCol = d.source === 'achats' ? 'achats_payment_id' : 'travaux_payment_id';
    const remainingIds = pendingPayments
      .filter((p) => !skipped.some((s) => s.payment_id === p.id))
      .map((p) => p.id);

    if (remainingIds.length > 0) {
      const { data: existingIndividual } = await supabase
        .from('payment_approvals')
        .select(`id, final_status, ${fkCol}`)
        .in(fkCol, remainingIds)
        .is('deleted_at', null);

      const activeIndividualIds = new Set(
        (existingIndividual ?? [])
          .filter((a: any) => a.final_status !== 'rejected')
          .map((a: any) => a[fkCol])
      );
      for (const id of remainingIds) {
        if (activeIndividualIds.has(id)) {
          skipped.push({
            payment_id: id,
            reason: 'Demande de validation individuelle déjà active sur cet acompte.',
          });
        }
      }
    }

    // ─── 4. Filtre les acomptes encore éligibles après garde-fous ─────────
    const skippedIds = new Set(skipped.map((s) => s.payment_id));
    const eligible = pendingPayments.filter((p) => !skippedIds.has(p.id));
    if (eligible.length === 0) {
      return { ok: false, error: 'Aucun acompte éligible après vérifications (déjà demandés ou en doublon).' };
    }

    // ─── 5. Group by supplier (FK > name fallback) ────────────────────────
    const groups = new Map<string, any[]>();
    for (const p of eligible) {
      const key = groupKey(p, d.source);
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }

    // ─── 6. Gate fiche artisan / fournisseur payment-ready ────────────────
    //
    // Vérifie une fois par fournisseur via check_artisan_payment_ready si la
    // FK est connue. Si la fiche est incomplète, on skip tout le groupe et on
    // continue les autres (best-effort).
    for (const [key, groupPayments] of Array.from(groups.entries())) {
      const supplierId = supplierFkId(groupPayments[0], d.source);
      if (supplierId) {
        const { data: check } = await admin.rpc('check_artisan_payment_ready', {
          p_artisan_id: supplierId,
        });
        if (check) {
          for (const p of groupPayments) {
            skipped.push({
              payment_id: p.id,
              reason: `Fiche ${supplierLabel(p, d.source)} incomplète : ${String(check)}`,
            });
          }
          groups.delete(key);
        }
      }
    }

    if (groups.size === 0) {
      return { ok: false, error: 'Aucun groupe éligible (fiches artisan/fournisseur incomplètes).' };
    }

    // ─── 7. Prépare le contexte projet (réutilisé pour tous les batches) ──
    const projectRef = await getProjectReference(admin, d.project_id);
    const { data: reviewers } = await admin
      .from('profiles')
      .select('id, email, full_name, role')
      .in('role', d.urgency === 'urgent' ? ['ceo', 'finance'] : ['finance', 'ceo'])
      .eq('is_active', true);

    // Récupère les numéros de lot pour enrichir la description email
    const lotIds = Array.from(new Set(eligible.map((p) => p.lot_id).filter(Boolean)));
    const lotsTable = d.source === 'achats' ? 'achats_lots' : 'travaux_lots';
    const lotsField = d.source === 'achats' ? 'numero' : 'numero';
    let lotNumByLotId = new Map<string, number>();
    if (lotIds.length > 0) {
      const { data: lotsInfo } = await admin
        .from(lotsTable)
        .select(`id, ${lotsField}`)
        .in('id', lotIds);
      lotNumByLotId = new Map<string, number>(
        (lotsInfo ?? []).map((l: any) => [l.id, l[lotsField]])
      );
    }

    // Récupère le client (pour enrichir le sujet email canon
    // [STZ-ref] · client · fournisseur · N acomptes · montant)
    const { data: projInfo } = await admin
      .from('projects')
      .select('client:clients(full_name)')
      .eq('id', d.project_id)
      .single();
    const clientName = (projInfo as any)?.client?.full_name ?? null;

    // ─── 8. Boucle sur chaque groupe (1 fournisseur = 1 batch) ────────────
    const batchesCreated: RequestPaymentBulkBatchCreated[] = [];

    for (const groupPayments of Array.from(groups.values())) {
      try {
        const first = groupPayments[0];
        const supplierName = supplierLabel(first, d.source);
        const currency = (first.currency || 'MAD') as 'EUR' | 'MAD' | 'USD';
        const amountTotal = groupPayments.reduce(
          (s, p) => s + Number(p.amount_total ?? 0),
          0
        );
        const acompteIds = groupPayments.map((p) => p.id);

        // 8.a Génère un nouveau payment_batch_id et UPDATE batch
        const newBatchId = randomUUID();
        const { error: updateErr } = await admin
          .from(table)
          .update({ payment_batch_id: newBatchId, updated_at: new Date().toISOString() })
          .in('id', acompteIds);
        if (updateErr) {
          for (const p of groupPayments) {
            skipped.push({
              payment_id: p.id,
              reason: `Échec attribution batch_id : ${updateErr.message}`,
            });
          }
          continue;
        }

        // 8.b Description enrichie
        const lotNums = groupPayments
          .map((p) => lotNumByLotId.get(p.lot_id))
          .filter((n) => n != null)
          .sort((a, b) => Number(a) - Number(b));
        const earliestSchedule = groupPayments
          .map((p) => p.scheduled_date)
          .filter(Boolean)
          .sort()[0];
        const description = [
          `${groupPayments.length} acompte${groupPayments.length > 1 ? 's' : ''} pour ${supplierName}`,
          lotNums.length > 0 ? `lots #${lotNums.join(', #')}` : null,
          earliestSchedule ? `échéance ${earliestSchedule}` : null,
        ].filter(Boolean).join(' · ');

        // 8.c Insert payment_approvals (1 ligne avec payment_batch_id)
        const { data: created, error: approvalErr } = await admin
          .from('payment_approvals')
          .insert({
            payment_batch_id: newBatchId,
            project_id: d.project_id,
            amount: amountTotal,
            currency,
            beneficiary_name: supplierName,
            description,
            urgency: d.urgency,
            requested_by: me.id,
            request_notes: d.request_notes ?? null,
            payer_account: d.payer_account,
          })
          .select('id')
          .single();

        if (approvalErr || !created) {
          // Rollback du batch_id pour libérer les acomptes
          await admin
            .from(table)
            .update({ payment_batch_id: null })
            .in('id', acompteIds);
          for (const p of groupPayments) {
            skipped.push({
              payment_id: p.id,
              reason: `Échec création demande : ${approvalErr?.message ?? 'erreur inconnue'}`,
            });
          }
          continue;
        }

        // 8.d Audit log par acompte
        const auditTable = d.source === 'achats' ? 'achats_payments' : 'travaux_payments';
        for (const p of groupPayments) {
          await logFinanceAudit({
            table: auditTable,
            recordId: p.id,
            action: 'validate',
            actorId: me.id,
            label: `Demande de validation groupée envoyée (batch ${groupPayments.length} acomptes)`,
            payload: {
              stage: 'requested',
              approval_id: created.id,
              payment_batch_id: newBatchId,
              source: d.source,
              batch_size: groupPayments.length,
              batch_amount_total: amountTotal,
              currency,
              beneficiary: supplierName,
              urgency: d.urgency,
              notes: d.request_notes ?? null,
              payer_account: d.payer_account,
            },
          });
        }

        // 8.e Email aux reviewers — sujet canon enrichi
        // [STZ-ref] · {client} · {fournisseur} · {N} acomptes · {montant} MAD
        const subjectParts = [
          projectRef ? `[${projectRef}]` : null,
          clientName,
          supplierName,
          `${groupPayments.length} acompte${groupPayments.length > 1 ? 's' : ''}`,
          `${Math.round(amountTotal).toLocaleString('fr-FR')} ${currency}`,
        ].filter(Boolean).join(' · ');

        for (const r of reviewers ?? []) {
          try {
            await sendPaymentApprovalRequested({
              to: r.email,
              reviewer_name: r.full_name,
              requester_name: me.full_name,
              amount: amountTotal,
              currency,
              beneficiary: supplierName,
              description: `${subjectParts} — ${description}`,
              urgency: d.urgency,
              payer_account_label: payerAccountLabel(d.payer_account),
              project_reference: projectRef,
              approval_url: URLS.approval(created.id),
              approval_id: created.id,
            });
          } catch (e) {
            console.warn('[email-bulk-batch-requested] échec', r.email, e);
          }
        }

        batchesCreated.push({
          batch_id: newBatchId,
          supplier_name: supplierName,
          n_acomptes: groupPayments.length,
          total_mad: amountTotal,
          currency,
          approval_id: created.id,
        });
      } catch (e: any) {
        for (const p of groupPayments) {
          skipped.push({
            payment_id: p.id,
            reason: `Erreur inattendue : ${e?.message ?? 'inconnue'}`,
          });
        }
      }
    }

    if (batchesCreated.length === 0) {
      return { ok: false, error: 'Aucun batch créé. Voir les acomptes skipped pour le détail.' };
    }

    // ─── 9. Revalidation pages ─────────────────────────────────────────────
    revalidatePath('/validations');
    revalidatePath(`/projects/${d.project_id}`);
    revalidatePath(`/projects/${d.project_id}/${d.source}`);

    return { ok: true, batches_created: batchesCreated, skipped };
  } catch (e: any) {
    const errorMessage = e?.message ?? 'Erreur inattendue';
    console.error('[requestPaymentForExistingAcomptesAction]', e);
    return { ok: false, error: errorMessage };
  }
}
