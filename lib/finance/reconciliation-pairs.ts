import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Réconciliation banque ↔ Stoniz — vue côte-à-côte (P2.B 2026-06-24).
 *
 * Construit deux listes alignées pour la page `/finance/tresorerie/reconciliation` :
 *   - Colonne GAUCHE = paiements ATTENDUS (4 sources : honoraires, travaux, achats, services)
 *   - Colonne DROITE = transactions BANQUE (déjà importées, non pending, hors soft-delete)
 *
 * Un item est "matché" s'il existe ≥1 ligne dans `bank_transaction_allocations`
 * (active = deleted_at IS NULL) qui le relie à l'autre côté.
 *
 * Les FKs côté allocations :
 *   - `payment_id`          → payments (honoraires)
 *   - `travaux_payment_id`  → travaux_payments
 *   - `achats_payment_id`   → achats_payments
 *   - `services_payment_id` → services_payments
 *
 * Approche :
 *   1. Fetch transactions banque dans la fenêtre + leurs allocations
 *   2. Fetch chaque source de paiements attendus (filtre date via scheduled_date / due_date),
 *      avec join allocations pour repérer le matching
 *   3. Mappage par FK pour relier expected ↔ bank, calcul stats
 *   4. Filtrage final côté JS (source, matchStatus)
 *
 * Volumes typiques BDD 2026-06-24 : 210 honoraires + 63 travaux + 256 achats + 18 services
 * → tient largement en mémoire pour <500 items typiques sur 3 mois.
 *
 * `services_payments` : peut ne pas exister en preview / dev — try/catch gracieux
 * retourne [] pour cette source si la table manque.
 *
 * @see lib/finance/bank-reconciliation.ts — scoring heuristique (auto-match V2)
 * @see lib/finance/project-payment-summary.ts — agrégation honoraires par projet
 */

// ─── Types publics ──────────────────────────────────────────────────────────

export type ExpectedPaymentSource = 'honoraires' | 'travaux' | 'achats' | 'services';

export type ExpectedPayment = {
  id: string;
  source: ExpectedPaymentSource;
  /** "Boutira — Honoraires livraison" / "Lot peinture — Acompte 2 — Karim Zaidi" */
  label: string;
  /** Montant attendu (MAD) */
  amount: number;
  /** Déjà payé (MAD) */
  paidAmount: number;
  /** Restant = amount - paidAmount, clampé à 0 */
  remaining: number;
  /** YYYY-MM-DD ou null */
  dueDate: string | null;
  /** ≥1 allocation active pointe sur cet expected */
  matched: boolean;
  /** IDs des transactions banque liées */
  bankTransactionIds: string[];
  context?: {
    projectId?: string;
    projectRef?: string;
    clientName?: string;
    vendorName?: string;
  };
};

export type BankPair = {
  id: string;
  operationDate: string;
  label: string;
  beneficiary: string | null;
  /** Positif = crédit (encaissement), négatif = débit (décaissement) */
  amount: number;
  category: string | null;
  /** Au moins une allocation pointe vers un paiement projet (FK paiement renseignée) */
  matched: boolean;
  /**
   * Au moins une allocation ACTIVE (avec ou sans FK paiement projet).
   * Distingue 3 cas :
   *   - matched && hasAllocation   = paire avec un paiement projet (vert)
   *   - !matched && hasAllocation  = catégorisée cabinet (frais_bancaire, salaires,
   *                                   DGI/CNSS…) — pas à recoller à un projet (gris)
   *   - !matched && !hasAllocation = vraiment orpheline, à allouer (orange)
   *
   * 588/668 allocations actives sont des catégorisations cabinet sans FK projet
   * par design (charges hors-projet). Sans ce flag, elles étaient comptées en
   * "orphelines bank" — faussement, car déjà traitées.
   */
  hasAllocation: boolean;
  /** Type "métier" libre (allocation_type) de la première allocation, pour affichage badge */
  allocationType: string | null;
  /** Reste à allouer (MAD positif) */
  remaining: number;
  /** IDs des expected liés (toutes sources confondues) */
  expectedIds: string[];
};

export type ReconciliationStats = {
  expectedTotal: number;
  expectedMatched: number;
  expectedOrphan: number;
  bankTotal: number;
  /** Transactions banque appariées à un paiement projet */
  bankMatched: number;
  /** Transactions banque catégorisées cabinet (frais/salaires/DGI…) — pas à allouer projet */
  bankCategorizedOnly: number;
  /** Transactions banque vraiment orphelines = aucune allocation active */
  bankOrphan: number;
  /** Total MAD apparié (sum allocations actives sur paiements projet) */
  amountMatched: number;
  /** MAD catégorisés cabinet (= ni à recoller projet, ni vraiment orphelin) */
  amountCategorizedOnly: number;
  /** MAD attendus restants (paiements orphelins ou partiellement matchés) */
  amountOrphanExpected: number;
  /** MAD bancaires vraiment non alloués (= aucune allocation) */
  amountOrphanBank: number;
};

export type ReconciliationFilters = {
  fromDate?: string | null;
  toDate?: string | null;
  accountId?: string | null;
  source?: ExpectedPaymentSource | 'all';
  matchStatus?: 'all' | 'matched' | 'orphan';
};

// ─── Labels (cohérents avec overdue-payments.ts) ────────────────────────────

const HONORAIRES_TYPE_LABELS: Record<string, string> = {
  acompte_stoniz: 'Acompte Stoniz',
  honoraires_compromis: 'Honoraires compromis',
  honoraires_3d: 'Honoraires design 3D',
  honoraires_chantier: 'Honoraires chantier',
  honoraires_livraison: 'Honoraires livraison',
  autre: 'Autre',
};

function honorairesLabel(type: string | null | undefined, customLabel: string | null | undefined): string {
  if (customLabel) return customLabel;
  if (!type) return 'Honoraires';
  return HONORAIRES_TYPE_LABELS[type] ?? type;
}

function truncate(s: string | null | undefined, max = 60): string {
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// ─── Helper principal ───────────────────────────────────────────────────────

export async function getReconciliationPairs(filters: ReconciliationFilters): Promise<{
  expected: ExpectedPayment[];
  bank: BankPair[];
  stats: ReconciliationStats;
}> {
  const supabase = createClient();

  const fromDate = filters.fromDate ?? null;
  const toDate = filters.toDate ?? null;
  const accountId = filters.accountId ?? null;
  const source: ExpectedPaymentSource | 'all' = filters.source ?? 'all';
  const matchStatus: 'all' | 'matched' | 'orphan' = filters.matchStatus ?? 'all';

  // ─── 1. Transactions banque ──────────────────────────────────────────────
  let bankQuery = supabase
    .from('bank_transactions')
    .select(`
      id, operation_date, label, beneficiary, debit_mad, credit_mad, category_code,
      allocations:bank_transaction_allocations(
        id, amount_mad, deleted_at, allocation_type,
        payment_id, travaux_payment_id, achats_payment_id, services_payment_id
      )
    `)
    .eq('is_pending', false)
    .is('deleted_at', null)
    .order('operation_date', { ascending: false })
    .limit(800);

  if (fromDate) bankQuery = bankQuery.gte('operation_date', fromDate);
  if (toDate) bankQuery = bankQuery.lte('operation_date', toDate);
  if (accountId) bankQuery = bankQuery.eq('account_id', accountId);

  const { data: bankRaw } = await bankQuery;
  const bankRows = (bankRaw ?? []) as any[];

  // Index allocations actives par paiement attendu
  // Map<expectedId, Set<bankTxId>>
  const expectedToBankMap = new Map<string, Set<string>>();
  // Map<bankTxId, Set<expectedId>>
  const bankToExpectedMap = new Map<string, Set<string>>();
  // Map<bankTxId, totalAllocatedMad>
  const bankAllocatedMad = new Map<string, number>();
  // Map<bankTxId, hasAnyActiveAllocation> — distinction matched vs categorized cabinet
  const bankHasAllocation = new Map<string, boolean>();
  // Map<bankTxId, firstAllocationType> — pour badge UI (frais_bancaire, cabinet_charge…)
  const bankAllocationType = new Map<string, string | null>();

  for (const tx of bankRows) {
    const allocs = (tx.allocations ?? []).filter((a: any) => a.deleted_at == null);
    let allocated = 0;
    const expectedSet = new Set<string>();
    let firstType: string | null = null;
    for (const a of allocs) {
      allocated += Math.abs(Number(a.amount_mad ?? 0));
      if (firstType == null && a.allocation_type) firstType = a.allocation_type as string;
      const expectedId =
        a.payment_id ?? a.travaux_payment_id ?? a.achats_payment_id ?? a.services_payment_id ?? null;
      if (!expectedId) continue;
      expectedSet.add(expectedId);
      let bankSet = expectedToBankMap.get(expectedId);
      if (!bankSet) {
        bankSet = new Set<string>();
        expectedToBankMap.set(expectedId, bankSet);
      }
      bankSet.add(tx.id);
    }
    bankToExpectedMap.set(tx.id, expectedSet);
    bankAllocatedMad.set(tx.id, allocated);
    bankHasAllocation.set(tx.id, allocs.length > 0);
    bankAllocationType.set(tx.id, firstType);
  }

  // ─── 2. Paiements attendus par source ────────────────────────────────────
  const expected: ExpectedPayment[] = [];

  const shouldFetch = (s: ExpectedPaymentSource) => source === 'all' || source === s;

  // Note : on filtre date sur scheduled_date / due_date. Si null, le paiement
  // est inclus quoi qu'il arrive (on ne sait pas quand il est dû).
  if (shouldFetch('honoraires')) {
    let q = supabase
      .from('payments')
      .select(`
        id, type, label, amount_expected, amount_paid, due_date, project_id,
        project:projects(reference, status, deleted_at,
          client:clients(full_name)
        )
      `)
      .is('deleted_at', null)
      .limit(500);
    if (fromDate) q = q.or(`due_date.gte.${fromDate},due_date.is.null`);
    if (toDate) q = q.or(`due_date.lte.${toDate},due_date.is.null`);
    const { data } = await q;
    for (const p of (data ?? []) as any[]) {
      // Exclure projets perdus / supprimés (mémoire stoniz_projects_perdu_exclusion)
      if (p.project && (p.project.status === 'perdu' || p.project.deleted_at != null)) continue;
      const amount = Number(p.amount_expected ?? 0);
      const paidAmount = Number(p.amount_paid ?? 0);
      const remaining = Math.max(0, amount - paidAmount);
      const bankSet = expectedToBankMap.get(p.id) ?? new Set<string>();
      const clientName = p.project?.client?.full_name ?? null;
      expected.push({
        id: p.id,
        source: 'honoraires',
        label:
          (clientName ? `${clientName} — ` : '') +
          honorairesLabel(p.type, p.label),
        amount,
        paidAmount,
        remaining,
        dueDate: p.due_date ?? null,
        matched: bankSet.size > 0,
        bankTransactionIds: Array.from(bankSet),
        context: {
          projectId: p.project_id ?? undefined,
          projectRef: p.project?.reference ?? undefined,
          clientName: clientName ?? undefined,
        },
      });
    }
  }

  if (shouldFetch('travaux')) {
    let q = supabase
      .from('travaux_payments')
      .select(`
        id, project_id, lot_id, artisan_name, amount_total, amount_paid,
        scheduled_date, paid_at, acompte_number,
        lot:travaux_lots(category, numero, artisan_name,
          artisan:artisans(name)
        ),
        project:projects(reference, status, deleted_at,
          client:clients(full_name)
        )
      `)
      .is('deleted_at', null)
      .limit(500);
    if (fromDate) q = q.or(`scheduled_date.gte.${fromDate},scheduled_date.is.null`);
    if (toDate) q = q.or(`scheduled_date.lte.${toDate},scheduled_date.is.null`);
    const { data } = await q;
    for (const p of (data ?? []) as any[]) {
      if (p.project && (p.project.status === 'perdu' || p.project.deleted_at != null)) continue;
      const amount = Number(p.amount_total ?? 0);
      const paidAmount = Number(p.amount_paid ?? 0);
      const remaining = Math.max(0, amount - paidAmount);
      const bankSet = expectedToBankMap.get(p.id) ?? new Set<string>();
      const vendorName =
        p.lot?.artisan?.name ?? p.lot?.artisan_name ?? p.artisan_name ?? null;
      const lotLabel = p.lot?.category
        ? `Lot ${p.lot?.numero ? `#${p.lot.numero} ` : ''}${p.lot.category}`
        : 'Travaux';
      const clientName = p.project?.client?.full_name ?? null;
      const label =
        [
          clientName,
          lotLabel,
          p.acompte_number ? `Acompte ${p.acompte_number}` : null,
          vendorName,
        ]
          .filter(Boolean)
          .join(' — ');
      expected.push({
        id: p.id,
        source: 'travaux',
        label: label || 'Travaux',
        amount,
        paidAmount,
        remaining,
        dueDate: p.scheduled_date ?? p.paid_at ?? null,
        matched: bankSet.size > 0,
        bankTransactionIds: Array.from(bankSet),
        context: {
          projectId: p.project_id ?? undefined,
          projectRef: p.project?.reference ?? undefined,
          clientName: clientName ?? undefined,
          vendorName: vendorName ?? undefined,
        },
      });
    }
  }

  if (shouldFetch('achats')) {
    let q = supabase
      .from('achats_payments')
      .select(`
        id, project_id, lot_id, supplier_name, amount_total, amount_paid,
        scheduled_date, paid_at, acompte_number,
        lot:achats_lots(category, numero, supplier_name,
          supplier:artisans(name)
        ),
        project:projects(reference, status, deleted_at,
          client:clients(full_name)
        )
      `)
      .is('deleted_at', null)
      .limit(500);
    if (fromDate) q = q.or(`scheduled_date.gte.${fromDate},scheduled_date.is.null`);
    if (toDate) q = q.or(`scheduled_date.lte.${toDate},scheduled_date.is.null`);
    const { data } = await q;
    for (const p of (data ?? []) as any[]) {
      if (p.project && (p.project.status === 'perdu' || p.project.deleted_at != null)) continue;
      const amount = Number(p.amount_total ?? 0);
      const paidAmount = Number(p.amount_paid ?? 0);
      const remaining = Math.max(0, amount - paidAmount);
      const bankSet = expectedToBankMap.get(p.id) ?? new Set<string>();
      const vendorName =
        p.lot?.supplier?.name ?? p.lot?.supplier_name ?? p.supplier_name ?? null;
      const lotLabel = p.lot?.category
        ? `Lot ${p.lot?.numero ? `#${p.lot.numero} ` : ''}${p.lot.category}`
        : 'Achats';
      const clientName = p.project?.client?.full_name ?? null;
      const label =
        [
          clientName,
          lotLabel,
          p.acompte_number ? `Acompte ${p.acompte_number}` : null,
          vendorName,
        ]
          .filter(Boolean)
          .join(' — ');
      expected.push({
        id: p.id,
        source: 'achats',
        label: label || 'Achats',
        amount,
        paidAmount,
        remaining,
        dueDate: p.scheduled_date ?? p.paid_at ?? null,
        matched: bankSet.size > 0,
        bankTransactionIds: Array.from(bankSet),
        context: {
          projectId: p.project_id ?? undefined,
          projectRef: p.project?.reference ?? undefined,
          clientName: clientName ?? undefined,
          vendorName: vendorName ?? undefined,
        },
      });
    }
  }

  if (shouldFetch('services')) {
    // Gracieux si la table n'existe pas (préview / branche sans la migration)
    try {
      let q = supabase
        .from('services_payments')
        .select(`
          id, project_id, lot_id, provider_id, amount_total, amount_paid,
          scheduled_date, paid_at, acompte_index, description,
          lot:services_lots(service_category, description,
            provider:artisans(name)
          ),
          project:projects(reference, status, deleted_at,
            client:clients(full_name)
          )
        `)
        .is('deleted_at', null)
        .limit(500);
      if (fromDate) q = q.or(`scheduled_date.gte.${fromDate},scheduled_date.is.null`);
      if (toDate) q = q.or(`scheduled_date.lte.${toDate},scheduled_date.is.null`);
      const { data, error } = await q;
      if (!error) {
        for (const p of (data ?? []) as any[]) {
          if (p.project && (p.project.status === 'perdu' || p.project.deleted_at != null)) continue;
          const amount = Number(p.amount_total ?? 0);
          const paidAmount = Number(p.amount_paid ?? 0);
          const remaining = Math.max(0, amount - paidAmount);
          const bankSet = expectedToBankMap.get(p.id) ?? new Set<string>();
          const providerName = p.lot?.provider?.name ?? null;
          const cat = p.lot?.service_category ?? null;
          const clientName = p.project?.client?.full_name ?? null;
          const label =
            [
              clientName,
              cat ? `Service ${cat}` : 'Service',
              p.acompte_index ? `Acompte ${p.acompte_index}` : null,
              providerName,
            ]
              .filter(Boolean)
              .join(' — ');
          expected.push({
            id: p.id,
            source: 'services',
            label: label || 'Services',
            amount,
            paidAmount,
            remaining,
            dueDate: p.scheduled_date ?? p.paid_at ?? null,
            matched: bankSet.size > 0,
            bankTransactionIds: Array.from(bankSet),
            context: {
              projectId: p.project_id ?? undefined,
              projectRef: p.project?.reference ?? undefined,
              clientName: clientName ?? undefined,
              vendorName: providerName ?? undefined,
            },
          });
        }
      }
    } catch {
      // Table absente ou colonne manquante → ignore silencieusement
    }
  }

  // ─── 3. Pairs côté banque ────────────────────────────────────────────────
  const bank: BankPair[] = bankRows.map((tx: any): BankPair => {
    const debit = Number(tx.debit_mad ?? 0);
    const credit = Number(tx.credit_mad ?? 0);
    // Convention : crédit = positif, débit = négatif
    const signedAmount = credit > 0 ? credit : -debit;
    const absAmount = Math.abs(signedAmount);
    const allocated = bankAllocatedMad.get(tx.id) ?? 0;
    const remaining = Math.max(0, absAmount - allocated);
    const expectedSet = bankToExpectedMap.get(tx.id) ?? new Set<string>();
    return {
      id: tx.id,
      operationDate: tx.operation_date,
      label: tx.label,
      beneficiary: tx.beneficiary ?? null,
      amount: signedAmount,
      category: tx.category_code ?? null,
      matched: expectedSet.size > 0,
      hasAllocation: bankHasAllocation.get(tx.id) ?? false,
      allocationType: bankAllocationType.get(tx.id) ?? null,
      remaining,
      expectedIds: Array.from(expectedSet),
    };
  });

  // ─── 4. Filtres finaux côté JS ───────────────────────────────────────────
  const filteredExpected =
    matchStatus === 'all'
      ? expected
      : expected.filter((e) => (matchStatus === 'matched' ? e.matched : !e.matched));

  // Côté banque : 'orphan' = VRAIMENT orpheline (aucune allocation active).
  // Les transactions catégorisées cabinet (frais_bancaire, cabinet_charge…)
  // ont une allocation active mais sans FK paiement projet — elles ne sont
  // PAS "à allouer projet", on les exclut du filtre orphan.
  const filteredBank =
    matchStatus === 'all'
      ? bank
      : bank.filter((b) =>
          matchStatus === 'matched'
            ? b.matched || (b.hasAllocation && !b.matched)
            : !b.hasAllocation,
        );

  // Tri : expected par due_date asc (null en dernier), bank par operation_date desc
  filteredExpected.sort((a, b) => {
    if (a.dueDate == null && b.dueDate == null) return 0;
    if (a.dueDate == null) return 1;
    if (b.dueDate == null) return -1;
    return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
  });
  filteredBank.sort((a, b) =>
    a.operationDate < b.operationDate ? 1 : a.operationDate > b.operationDate ? -1 : 0,
  );

  // ─── 5. Stats sur la vue COMPLÈTE (avant matchStatus filter)
  // → l'utilisateur doit toujours voir "3 matchés / 12 orphelins" même si
  //   le filtre actif cache une catégorie.
  const expectedAll = expected;
  const bankAll = bank;
  const expectedMatched = expectedAll.filter((e) => e.matched).length;
  const expectedOrphan = expectedAll.length - expectedMatched;

  // Côté banque, 3 statuts mutuellement exclusifs :
  //  - matched           = appariée à un paiement projet
  //  - categorizedOnly   = a une allocation cabinet (frais/charges) mais pas projet
  //  - orphan            = aucune allocation active
  const bankMatched = bankAll.filter((b) => b.matched).length;
  const bankCategorizedOnly = bankAll.filter((b) => !b.matched && b.hasAllocation).length;
  const bankOrphan = bankAll.filter((b) => !b.hasAllocation).length;

  const amountMatched = bankAll
    .filter((b) => b.matched)
    .reduce((s, b) => s + (Math.abs(b.amount) - b.remaining), 0);
  const amountCategorizedOnly = bankAll
    .filter((b) => !b.matched && b.hasAllocation)
    .reduce((s, b) => s + Math.abs(b.amount), 0);
  const amountOrphanExpected = expectedAll
    .filter((e) => !e.matched)
    .reduce((s, e) => s + e.remaining, 0);
  const amountOrphanBank = bankAll
    .filter((b) => !b.hasAllocation)
    .reduce((s, b) => s + Math.abs(b.amount), 0);

  const stats: ReconciliationStats = {
    expectedTotal: expectedAll.length,
    expectedMatched,
    expectedOrphan,
    bankTotal: bankAll.length,
    bankMatched,
    bankCategorizedOnly,
    bankOrphan,
    amountMatched,
    amountCategorizedOnly,
    amountOrphanExpected,
    amountOrphanBank,
  };

  return { expected: filteredExpected, bank: filteredBank, stats };
}

// ─── Helpers exposés pour le composant ──────────────────────────────────────

export const SOURCE_LABELS: Record<ExpectedPaymentSource, string> = {
  honoraires: 'Honoraires',
  travaux: 'Travaux',
  achats: 'Achats',
  services: 'Services',
};

export function expectedShortLabel(e: ExpectedPayment): string {
  return truncate(e.label, 80);
}
