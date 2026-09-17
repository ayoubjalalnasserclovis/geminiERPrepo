'use server';

/**
 * Actions en bulk sur les ACOMPTES existants (CEO 2026-07-08).
 *
 * Depuis les panneaux "Actions en bulk" (achats / travaux) et le panneau
 * services, l'utilisateur sélectionne des lots puis applique en un coup sur
 * leurs acomptes NON payés :
 *   • supprimer      (soft-delete + deletion log + désallocation banque)
 *   • modifier date  (scheduled_date commune)
 *   • modifier montant (% du devis du lot OU montant MAD fixe)
 *
 * Ciblage : tous les acomptes pending des lots sélectionnés, ou uniquement
 * l'acompte n°N de chaque lot (décision CEO 2026-07-08).
 *
 * Garde-fous (best-effort, mêmes règles que le drawer "Demander paiement") :
 *   • Acomptes payés / partiels / annulés → jamais touchés (hors requête).
 *   • Acomptes dans un batch de validation actif → skippés avec raison.
 *   • Acomptes avec demande de validation individuelle active → skippés.
 *   • Mode % sans devis sur le lot → skippés avec raison.
 * Un skip n'interrompt pas l'opération : on continue sur les autres et on
 * renvoie la liste des skippés pour affichage UI.
 *
 * Symétrie 3 modules via CONFIG — services n'a ni %, ni batch, ni workflow
 * de validation (services_payments hors payment_approvals).
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole, type Role } from '@/lib/auth/require';
import { logFinanceAudit } from '@/lib/finance/audit';
import { logDeletion } from '@/lib/audit/deletion';
import { cascadeDeallocateOnDelete } from '@/lib/finance/cascade-deallocate';

// ─── Types publics (consommés par l'UI) ────────────────────────────────────

export type BulkAcomptesSource = 'achats' | 'travaux' | 'services';

export type BulkAcomptesInput = {
  project_id: string;
  source: BulkAcomptesSource;
  lot_ids: string[];
  /** null = tous les acomptes pending des lots ; 1..6 = uniquement ce n°. */
  acompte_number?: number | null;
  op: 'delete' | 'set_date' | 'set_amount' | 'mark_paid';
  /** op=set_date : nouvelle échéance (YYYY-MM-DD) ou null pour effacer. */
  scheduled_date?: string | null;
  /** op=set_amount */
  amount_mode?: 'pct' | 'fixed';
  amount_value?: number;
};

export type BulkAcomptesSkipped = { payment_id: string; reason: string };

export type BulkAcomptesResult =
  | { ok: true; affected: number; skipped: BulkAcomptesSkipped[] }
  | { ok: false; error: string };

// ─── Config par module — colonnes lues depuis les migrations, jamais supposées ──

const CONFIG = {
  achats: {
    allowedRoles: ['ceo', 'chef_projet', 'finance', 'achats'] as readonly Role[],
    payTable: 'achats_payments',
    lotTable: 'achats_lots',
    numCol: 'acompte_number',
    devisCol: 'devis_fournisseur_mad',
    pendingStatuses: ['pending'],
    paidStatus: 'paid',
    hasPct: true,
    hasApprovals: true,
    financeAudit: 'achats_payments' as const,
    cascade: 'achats_payments' as const,
    approvalFk: 'achats_payment_id',
    pathSuffix: 'achats',
    label: 'fournisseur',
  },
  travaux: {
    allowedRoles: ['ceo', 'chef_projet', 'finance'] as readonly Role[],
    payTable: 'travaux_payments',
    lotTable: 'travaux_lots',
    numCol: 'acompte_number',
    devisCol: 'devis_artisan_mad',
    pendingStatuses: ['pending'],
    paidStatus: 'paid',
    hasPct: true,
    hasApprovals: true,
    financeAudit: 'travaux_payments' as const,
    cascade: 'travaux_payments' as const,
    approvalFk: 'travaux_payment_id',
    pathSuffix: 'travaux',
    label: 'artisan',
  },
  services: {
    allowedRoles: ['ceo', 'chef_projet', 'finance'] as readonly Role[],
    payTable: 'services_payments',
    lotTable: 'services_lots',
    numCol: 'acompte_index',
    devisCol: 'devis_prestataire_mad',
    pendingStatuses: ['planifie'],
    paidStatus: 'paye',
    hasPct: false, // pas de colonne acompte_pct sur services_payments
    hasApprovals: false, // services_payments hors workflow payment_approvals
    financeAudit: null,
    cascade: 'services_payments' as const,
    approvalFk: null,
    pathSuffix: 'services',
    label: 'prestataire',
  },
} as const;

const inputSchema = z
  .object({
    project_id: z.string().uuid(),
    source: z.enum(['achats', 'travaux', 'services']),
    lot_ids: z.array(z.string().uuid()).min(1, 'Aucun lot sélectionné'),
    acompte_number: z.coerce.number().int().min(1).max(6).optional().nullable(),
    op: z.enum(['delete', 'set_date', 'set_amount', 'mark_paid']),
    scheduled_date: z.string().optional().nullable(),
    amount_mode: z.enum(['pct', 'fixed']).optional(),
    amount_value: z.coerce.number().optional(),
  })
  .superRefine((d, ctx) => {
    if (d.op === 'set_amount') {
      if (!d.amount_mode) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount_mode'], message: 'Mode requis : % du devis ou montant fixe.' });
      }
      if (d.amount_value == null || d.amount_value <= 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount_value'], message: 'Valeur strictement positive requise.' });
      }
      if (d.amount_mode === 'pct' && d.amount_value != null && d.amount_value > 100) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['amount_value'], message: 'Un acompte ne peut pas dépasser 100 % du devis.' });
      }
    }
  });

// ─── Action principale ──────────────────────────────────────────────────────

export async function bulkManageAcomptesAction(input: BulkAcomptesInput): Promise<BulkAcomptesResult> {
  try {
    // Mêmes rôles que les actions acomptes unitaires des 3 modules.
    const me = await assertRole(['ceo', 'chef_projet', 'finance', 'achats']);

    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const d = parsed.data;
    const cfg = CONFIG[d.source];

    if (!cfg.allowedRoles.includes(me.role)) {
      return { ok: false, error: 'Permission refusée pour ce module' };
    }

    const supabase = createClient();
    const skipped: BulkAcomptesSkipped[] = [];

    // ── 1. Charge les acomptes pending des lots ciblés ──────────────────────
    let q = supabase
      .from(cfg.payTable)
      .select('*')
      .eq('project_id', d.project_id)
      .in('lot_id', d.lot_ids)
      .in('status', [...cfg.pendingStatuses])
      .is('deleted_at', null);
    if (d.acompte_number != null) q = q.eq(cfg.numCol, d.acompte_number);

    const { data: payments, error: payErr } = await q;
    if (payErr) return { ok: false, error: payErr.message };
    if (!payments || payments.length === 0) {
      return {
        ok: false,
        error: d.acompte_number != null
          ? `Aucun acompte n°${d.acompte_number} non payé sur les lots sélectionnés.`
          : 'Aucun acompte non payé sur les lots sélectionnés.',
      };
    }

    // ── 2. Garde-fous validation active (achats / travaux uniquement) ───────
    let eligible = payments as any[];
    if (cfg.hasApprovals) {
      const ids = eligible.map((p) => p.id);

      // 2.a Batch actif
      const batchIds = Array.from(new Set(eligible.map((p) => p.payment_batch_id).filter(Boolean)));
      const activeBatchIds = new Set<string>();
      if (batchIds.length > 0) {
        const { data: batchApprovals } = await supabase
          .from('payment_approvals')
          .select('payment_batch_id, final_status')
          .in('payment_batch_id', batchIds)
          .is('deleted_at', null);
        for (const a of (batchApprovals ?? []) as any[]) {
          if (a.final_status !== 'rejected') activeBatchIds.add(a.payment_batch_id);
        }
      }

      // 2.b Demande individuelle active
      const activeIndividualIds = new Set<string>();
      const { data: individual } = await supabase
        .from('payment_approvals')
        .select(`${cfg.approvalFk}, final_status`)
        .in(cfg.approvalFk!, ids)
        .is('deleted_at', null);
      for (const a of (individual ?? []) as any[]) {
        if (a.final_status !== 'rejected') activeIndividualIds.add(a[cfg.approvalFk!]);
      }

      eligible = eligible.filter((p) => {
        if (p.payment_batch_id && activeBatchIds.has(p.payment_batch_id)) {
          skipped.push({ payment_id: p.id, reason: `Acompte ${p[cfg.numCol] ?? '?'} — batch de validation en cours (fais-le rejeter d'abord).` });
          return false;
        }
        if (activeIndividualIds.has(p.id)) {
          skipped.push({ payment_id: p.id, reason: `Acompte ${p[cfg.numCol] ?? '?'} — demande de validation individuelle active.` });
          return false;
        }
        return true;
      });
    }

    if (eligible.length === 0) {
      return { ok: false, error: 'Tous les acomptes ciblés sont en validation active — rien à modifier.' };
    }

    // ── 3. Exécute l'opération (best-effort, acompte par acompte) ───────────
    let affected = 0;

    if (d.op === 'delete') {
      for (const p of eligible) {
        const { error } = await supabase
          .from(cfg.payTable)
          .update({ deleted_at: new Date().toISOString() } as any)
          .eq('id', p.id);
        if (error) {
          skipped.push({ payment_id: p.id, reason: `Échec suppression : ${error.message}` });
          continue;
        }
        if (cfg.financeAudit) {
          await logFinanceAudit({
            table: cfg.financeAudit,
            recordId: p.id,
            action: 'delete',
            actorId: me.id,
            label: `Acompte supprimé (action bulk, ${eligible.length} ciblés)`,
            payload: { bulk: true, amount_total: p.amount_total, [cfg.numCol]: p[cfg.numCol] },
          });
        }
        await logDeletion({
          table: cfg.payTable as any,
          recordId: p.id,
          actorId: me.id,
          label: `Acompte ${cfg.label} - ${p.amount_total ?? '?'} MAD (bulk)`,
          snapshot: p,
        });
        await cascadeDeallocateOnDelete({ table: cfg.cascade, recordId: p.id, actorId: me.id });
        affected++;
      }
    }

    if (d.op === 'set_date') {
      const scheduled = d.scheduled_date && d.scheduled_date !== '' ? d.scheduled_date : null;
      for (const p of eligible) {
        if (p.scheduled_date === scheduled) { affected++; continue; }
        const { error } = await supabase
          .from(cfg.payTable)
          .update({ scheduled_date: scheduled } as any)
          .eq('id', p.id);
        if (error) {
          skipped.push({ payment_id: p.id, reason: `Échec date : ${error.message}` });
          continue;
        }
        if (cfg.financeAudit) {
          await logFinanceAudit({
            table: cfg.financeAudit,
            recordId: p.id,
            action: 'update',
            actorId: me.id,
            label: 'Échéance modifiée (action bulk)',
            payload: { bulk: true, scheduled_date: { before: p.scheduled_date, after: scheduled } },
          });
        }
        affected++;
      }
    }

    if (d.op === 'set_amount') {
      // Devis par lot — nécessaire en mode % (canon : montant dérivé du devis).
      const { data: lots } = await supabase
        .from(cfg.lotTable)
        .select(`id, ${cfg.devisCol}`)
        .in('id', d.lot_ids)
        .is('deleted_at', null);
      const devisByLot = new Map<string, number | null>(
        ((lots ?? []) as any[]).map((l) => [l.id, l[cfg.devisCol] != null ? Number(l[cfg.devisCol]) : null])
      );

      for (const p of eligible) {
        let newAmount: number;
        if (d.amount_mode === 'pct') {
          const devis = devisByLot.get(p.lot_id) ?? null;
          if (devis == null || devis <= 0) {
            skipped.push({ payment_id: p.id, reason: `Acompte ${p[cfg.numCol] ?? '?'} — pas de devis sur le lot, mode % impossible.` });
            continue;
          }
          newAmount = Math.round(devis * (d.amount_value! / 100) * 100) / 100;
        } else {
          newAmount = d.amount_value!;
        }

        const patch: any = { amount_total: newAmount };
        if (cfg.hasPct) patch.acompte_pct = d.amount_mode === 'pct' ? d.amount_value : null;

        const { error } = await supabase.from(cfg.payTable).update(patch).eq('id', p.id);
        if (error) {
          skipped.push({ payment_id: p.id, reason: `Échec montant : ${error.message}` });
          continue;
        }
        if (cfg.financeAudit) {
          await logFinanceAudit({
            table: cfg.financeAudit,
            recordId: p.id,
            action: 'update',
            actorId: me.id,
            label: `Montant modifié (action bulk, ${d.amount_mode === 'pct' ? `${d.amount_value}% du devis` : 'montant fixe'})`,
            payload: {
              bulk: true,
              amount_total: { before: p.amount_total, after: newAmount },
              mode: d.amount_mode,
              value: d.amount_value,
            },
          });
        }
        affected++;
      }
    }

    if (d.op === 'mark_paid') {
      // Marque payé : status → paid/paye, paid_at=now, amount_paid=amount_total.
      // Chadi 2026-09-16 : permet de marquer plusieurs lots × acompte n°N
      // comme payés en un clic après un virement groupé.
      const nowIso = new Date().toISOString();
      for (const p of eligible) {
        const patch: any = {
          status: cfg.paidStatus,
          paid_at: nowIso,
          amount_paid: p.amount_total,
        };
        const { error } = await supabase.from(cfg.payTable).update(patch).eq('id', p.id);
        if (error) {
          skipped.push({ payment_id: p.id, reason: `Échec mark-paid : ${error.message}` });
          continue;
        }
        if (cfg.financeAudit) {
          await logFinanceAudit({
            table: cfg.financeAudit,
            recordId: p.id,
            action: 'update',
            actorId: me.id,
            label: `Acompte ${p[cfg.numCol] ?? '?'} marqué payé (action bulk)`,
            payload: {
              bulk: true,
              op: 'mark_paid',
              amount: p.amount_total,
              [cfg.numCol]: p[cfg.numCol],
            },
          });
        }
        affected++;
      }
    }

    if (affected === 0) {
      return { ok: false, error: 'Aucun acompte modifié — voir le détail des acomptes ignorés.' };
    }

    // ── 4. Revalidation ─────────────────────────────────────────────────────
    revalidatePath(`/projects/${d.project_id}/${cfg.pathSuffix}`);
    revalidatePath(`/projects/${d.project_id}`);
    if (d.op === 'delete' || d.op === 'mark_paid') {
      revalidatePath('/finance/tresorerie');
      revalidatePath('/finance/tresorerie/reconciliation');
    }

    return { ok: true, affected, skipped };
  } catch (e: any) {
    console.error('[bulkManageAcomptesAction]', e);
    return { ok: false, error: e?.message ?? 'Erreur inattendue' };
  }
}
