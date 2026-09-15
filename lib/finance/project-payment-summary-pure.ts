import { STONIZ_FEE_SCHEDULE, standardAmountForType } from '@/lib/finance/stoniz-fees';

/**
 * Helpers purs d'agrégation des paiements Stoniz d'un projet.
 *
 * Ce fichier ne dépend d'aucun client/server runtime — il peut être importé
 * depuis un composant client (StonizFeesCard, etc.) OU un composant server
 * (les pages projets). Le helper async qui interroge Supabase vit dans
 * `project-payment-summary.ts` (qui est `server-only`).
 *
 * --- Voir le commentaire en tête de project-payment-summary.ts pour le
 * --- contexte historique : cas Boutira / régression doublons par type.
 */

export type ProjectPaymentSummaryByType = {
  type: string;
  expected: number;
  paid: number;
  remaining: number;
  status: 'paid' | 'partial' | 'pending' | 'overdue';
  dueDate: string | null;
  paymentIds: string[];
  hasDuplicates: boolean;
};

export type ProjectPaymentSummary = {
  totalExpected: number;
  totalPaid: number;
  remaining: number;
  byType: ProjectPaymentSummaryByType[];
  hasDuplicates: boolean;
};

export type PaymentRowForSummary = {
  id: string;
  type: string;
  amount_expected: number | string | null;
  amount_paid: number | string | null;
  due_date?: string | null;
};

function toNumber(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : 0;
}

function deriveStatus(
  expected: number,
  paid: number,
  dueDate: string | null,
  today: string,
): 'paid' | 'partial' | 'pending' | 'overdue' {
  if (expected > 0 && paid >= expected) return 'paid';
  if (paid > 0 && paid < expected) {
    if (dueDate && dueDate < today) return 'overdue';
    return 'partial';
  }
  // paid === 0
  if (dueDate && dueDate < today && expected > 0) return 'overdue';
  return 'pending';
}

/**
 * Agrégation pure — SUM par type, traite les doublons comme des "vraies"
 * lignes (les expose au lieu de les cacher). 5 jalons canoniques en premier,
 * puis 'autre' / types custom à la fin.
 */
export function aggregatePaymentSummary(
  rows: PaymentRowForSummary[],
  todayISO?: string,
): ProjectPaymentSummary {
  const today = todayISO ?? new Date().toISOString().slice(0, 10);

  const groups = new Map<string, PaymentRowForSummary[]>();
  for (const row of rows) {
    const list = groups.get(row.type) ?? [];
    list.push(row);
    groups.set(row.type, list);
  }

  const canonicalTypes = STONIZ_FEE_SCHEDULE.map(m => m.type);
  const byType: ProjectPaymentSummaryByType[] = [];

  for (const type of canonicalTypes) {
    const list = groups.get(type) ?? [];
    if (list.length === 0) {
      byType.push({
        type,
        expected: standardAmountForType(type),
        paid: 0,
        remaining: standardAmountForType(type),
        status: 'pending',
        dueDate: null,
        paymentIds: [],
        hasDuplicates: false,
      });
      continue;
    }

    const expected = list.reduce((s, p) => s + toNumber(p.amount_expected), 0);
    const paid = list.reduce((s, p) => s + toNumber(p.amount_paid), 0);
    const remaining = Math.max(0, expected - paid);
    const dueDates = list.map(p => p.due_date ?? null).filter((d): d is string => !!d).sort();
    const dueDate = dueDates[0] ?? null;

    byType.push({
      type,
      expected,
      paid,
      remaining,
      status: deriveStatus(expected, paid, dueDate, today),
      dueDate,
      paymentIds: list.map(p => p.id),
      hasDuplicates: list.length > 1,
    });

    groups.delete(type);
  }

  // Autres types ('autre' ou customs)
  for (const [type, list] of groups.entries()) {
    const expected = list.reduce((s, p) => s + toNumber(p.amount_expected), 0);
    const paid = list.reduce((s, p) => s + toNumber(p.amount_paid), 0);
    const remaining = Math.max(0, expected - paid);
    const dueDates = list.map(p => p.due_date ?? null).filter((d): d is string => !!d).sort();
    const dueDate = dueDates[0] ?? null;

    byType.push({
      type,
      expected,
      paid,
      remaining,
      status: deriveStatus(expected, paid, dueDate, today),
      dueDate,
      paymentIds: list.map(p => p.id),
      hasDuplicates: list.length > 1,
    });
  }

  const totalExpected = byType.reduce((s, p) => s + p.expected, 0);
  const totalPaid = byType.reduce((s, p) => s + p.paid, 0);
  const remaining = Math.max(0, totalExpected - totalPaid);
  const hasDuplicates = byType.some(p => p.hasDuplicates);

  return { totalExpected, totalPaid, remaining, byType, hasDuplicates };
}
