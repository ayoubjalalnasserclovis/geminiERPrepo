import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ArrowLeft, AlertTriangle, CheckCircle, LayoutGrid, List } from 'lucide-react';
import { CATEGORY_LABELS } from '@/lib/finance/bank-categorizer';
import { TransactionsBulkTable } from '../transactions-bulk-table';
import { TresorerieToolbar } from '@/components/finance/tresorerie-toolbar';
import { RecurringBeneficiariesBanner } from '@/components/finance/recurring-beneficiaries-banner';
import { resolvePeriodRange } from '@/lib/finance/period-helpers';
import { ReconciliationSideBySide } from '@/components/finance/reconciliation-side-by-side';
import {
  getReconciliationPairs,
  type ExpectedPaymentSource,
} from '@/lib/finance/reconciliation-pairs';
import { cn } from '@/lib/utils/cn';

/**
 * Écran de rapprochement global : montre les transactions bancaires importées
 * qui n'ont PAS encore été allouées à un projet / poste Stoniz.
 *
 * Pour chaque ligne, on indique :
 *   - Date, libellé, catégorie auto, montant
 *   - Montant déjà alloué / restant
 *   - Lien vers la fiche de rapprochement
 *
 * Filtres : période, compte, catégorie, type (débit/crédit), statut (alloué / partiel / non alloué)
 */

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

// Next.js 14 : searchParams = { [k]: string | string[] | undefined }
type SearchParams = { [key: string]: string | string[] | undefined };

const PAGE_SIZE = 50;
const SORT_COLUMNS: Record<string, string> = {
  date: 'operation_date',
  debit: 'debit_mad',
  credit: 'credit_mad',
  category: 'category_code',
  account: 'account_id',
};

function spString(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function ReconciliationPage({ searchParams }: { searchParams: SearchParams }) {
  const me = await requireRole(['ceo', 'finance', 'developer']);
  const canWrite = me.role === 'ceo' || me.role === 'finance';
  const supabase = createClient();

  const spStatus = spString(searchParams, 'status');
  const spPeriod = spString(searchParams, 'period');
  const spType = spString(searchParams, 'type');
  const spSort = spString(searchParams, 'sort');
  const spDir = spString(searchParams, 'dir');
  const spPage = spString(searchParams, 'page');
  const spAccountId = spString(searchParams, 'account_id');
  const spCategory = spString(searchParams, 'category');
  const spQ = spString(searchParams, 'q');
  const spMin = spString(searchParams, 'min');
  const spMax = spString(searchParams, 'max');
  const spFrom = spString(searchParams, 'from');
  const spTo = spString(searchParams, 'to');
  // P2.B 2026-06-24 : nouveau toggle vue côte-à-côte / liste plate
  const spView = spString(searchParams, 'view');
  const spMatchStatus = spString(searchParams, 'matchStatus');
  const spSource = spString(searchParams, 'source');
  // CEO 2026-06-24 : défaut sur 'split'. Le diagnostic initial laissait penser
  // qu'un backfill des FK bank_transaction_allocations était nécessaire (602/668
  // sans payment_id), mais l'analyse a montré que 588 d'entre elles sont des
  // catégorisations cabinet (frais_bancaire, cabinet_charge, fiscal, social…)
  // *par design* hors-projet. Le helper a été étendu pour les exposer comme
  // "Cabinet (hors projet)" — pas comme "orphelin". 14 honoraires composites
  // restent à ventiler manuellement (cas ambigus, à valider CEO).
  const view: 'split' | 'list' = spView === 'list' ? 'list' : 'split';
  const matchStatus: 'all' | 'matched' | 'orphan' =
    spMatchStatus === 'matched' || spMatchStatus === 'orphan' ? spMatchStatus : 'all';
  const source: ExpectedPaymentSource | 'all' =
    spSource === 'honoraires' || spSource === 'travaux' || spSource === 'achats' || spSource === 'services'
      ? spSource
      : 'all';

  const status: 'all' | 'unallocated' | 'partial' | 'allocated' =
    spStatus === 'all' || spStatus === 'unallocated' || spStatus === 'partial' || spStatus === 'allocated'
      ? spStatus : 'unallocated';
  // CEO 2026-06-23 P0.2 : défaut serveur aligné sur 'last_3_months' (était déjà OK ici)
  const period = spPeriod ?? 'last_3_months';
  const filterType: 'debit' | 'credit' | 'all' = spType === 'debit' || spType === 'credit' ? spType : 'all';
  const sortKey = (spSort && SORT_COLUMNS[spSort]) ? spSort : 'date';
  const sortDir: 'asc' | 'desc' = spDir === 'asc' ? 'asc' : 'desc';
  const currentPage = Math.max(1, parseInt(spPage ?? '1', 10) || 1);
  // CEO 2026-06-23 P0.3 : si dates custom (from/to) → IGNORE le preset period.
  const hasCustomRange = !!(spFrom || spTo);
  const { fromDate: presetFrom, toDate: presetTo } = resolvePeriodRange(period);
  const dateFrom = hasCustomRange ? (spFrom ?? null) : presetFrom;
  const dateTo = hasCustomRange ? (spTo ?? null) : presetTo;
  const minAmount = spMin ? Number(spMin) : null;
  const maxAmount = spMax ? Number(spMax) : null;

  // Récupère toutes les transactions non-pending dans la période
  // (on fetch large car le filtre status est appliqué côté JS après calcul)
  let query = supabase
    .from('bank_transactions')
    .select(`
      id, operation_date, label, reference, debit_mad, credit_mad,
      category_code, beneficiary, is_pending,
      account:bank_accounts(account_label, bank_label,
        company:bank_companies(name)
      ),
      allocations:bank_transaction_allocations(amount_mad, deleted_at)
    `)
    .eq('is_pending', false)
    .is('deleted_at', null)
    .limit(1000);

  // Priorité au date range custom sur la période preset (P0.3)
  if (dateFrom) query = query.gte('operation_date', dateFrom);
  if (dateTo) query = query.lte('operation_date', dateTo);

  if (spAccountId) {
    query = query.eq('account_id', spAccountId);
  }
  if (spCategory) {
    query = query.eq('category_code', spCategory);
  }
  // Recherche multi-champ (CEO 2026-06-16) : on split sur espace et on AND les tokens.
  // Chaque token est cherché dans label, beneficiary, reference ET montant (en texte).
  if (spQ) {
    const tokens = spQ.trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const safe = tok.replace(/[%_,()]/g, ' ').trim();
      if (!safe) continue;
      // Pour les nombres, on cherche aussi sur debit/credit (cast en texte)
      const orParts = [
        `label.ilike.%${safe}%`,
        `beneficiary.ilike.%${safe}%`,
        `reference.ilike.%${safe}%`,
      ];
      if (/^\d+(\.\d+)?$/.test(safe)) {
        orParts.push(`debit_mad.eq.${safe}`);
        orParts.push(`credit_mad.eq.${safe}`);
      }
      query = query.or(orParts.join(','));
    }
  }
  if (minAmount != null && !isNaN(minAmount)) {
    // ≥ min sur le débit OU le crédit (selon ce qui est rempli)
    query = query.or(`debit_mad.gte.${minAmount},credit_mad.gte.${minAmount}`);
  }
  if (maxAmount != null && !isNaN(maxAmount)) {
    query = query.or(`debit_mad.lte.${maxAmount},credit_mad.lte.${maxAmount}`);
  }
  if (filterType === 'debit') {
    query = query.gt('debit_mad', 0);
  } else if (filterType === 'credit') {
    query = query.gt('credit_mad', 0);
  }

  // Tri SQL principal (NULLS LAST pour debit/credit)
  const sortColumn = SORT_COLUMNS[sortKey] ?? 'operation_date';
  query = query.order(sortColumn, { ascending: sortDir === 'asc', nullsFirst: false });
  if (sortColumn !== 'operation_date') {
    query = query.order('operation_date', { ascending: false });
  }

  const { data: transactions } = await query;
  const txs = (transactions ?? []) as any[];

  // Calculer le statut d'allocation pour chaque transaction
  const enriched = txs.map((t) => {
    const amount = Math.abs(Number(t.debit_mad ?? t.credit_mad ?? 0));
    const allocs = (t.allocations ?? []).filter((a: any) => a.deleted_at == null);
    const allocated = allocs.reduce((s: number, a: any) => s + Math.abs(Number(a.amount_mad)), 0);
    const remaining = Math.max(0, amount - allocated);
    let statusCode: 'unallocated' | 'partial' | 'allocated' = 'unallocated';
    if (allocated === 0) statusCode = 'unallocated';
    else if (remaining < 0.01) statusCode = 'allocated';
    else statusCode = 'partial';
    return { ...t, amount, allocated, remaining, statusCode };
  });

  // Filtre statut
  const filtered = status === 'all' ? enriched : enriched.filter(t => t.statusCode === status);

  // Pagination
  const filteredTotal = filtered.length;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const offset = (currentPage - 1) * PAGE_SIZE;
  const paged = filtered.slice(offset, offset + PAGE_SIZE);

  // Stats globales (sur les transactions non-pending toutes catégories)
  const allTxsCount = enriched.length;
  const unallocatedCount = enriched.filter(t => t.statusCode === 'unallocated').length;
  const partialCount = enriched.filter(t => t.statusCode === 'partial').length;
  const allocatedCount = enriched.filter(t => t.statusCode === 'allocated').length;

  // Total MAD non-alloué (impact business)
  const totalUnallocatedMad = enriched
    .filter(t => t.statusCode !== 'allocated')
    .reduce((s, t) => s + t.remaining, 0);

  // Liste des comptes pour le filtre
  const { data: accounts } = await supabase
    .from('bank_accounts')
    .select('id, account_label, bank_label, company:bank_companies(name)')
    .is('deleted_at', null)
    .order('account_label');

  // CEO 2026-06-23 P0.1 : buildHref clone TOUS les query params puis override
  // sélectivement. L'ancienne version recopiait ad hoc (period/type/status/...)
  // mais laissait tomber from, to, min, max → cassait pagination + tri quand
  // ces filtres étaient actifs.
  function buildHref(overrides: Record<string, string | number | null | undefined>): string {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((item) => sp.append(k, item));
      else sp.set(k, v);
    }
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === undefined || v === '') sp.delete(k);
      else sp.set(k, String(v));
    }
    const qs = sp.toString();
    return `/finance/tresorerie/reconciliation${qs ? `?${qs}` : ''}`;
  }

  function buildSortHref(targetSort: 'date' | 'debit' | 'credit' | 'category' | 'account') {
    const nextDir = sortKey === targetSort ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    return buildHref({ sort: targetSort, dir: nextDir, page: 1 });
  }

  // ─── Vue côte-à-côte (P2.B 2026-06-24) ────────────────────────────────────
  // Récupère expected ↔ bank pairs uniquement quand on est sur la vue split.
  // Réutilise le même filtre période/compte que la vue liste.
  const splitData =
    view === 'split'
      ? await getReconciliationPairs({
          fromDate: dateFrom,
          toDate: dateTo,
          accountId: spAccountId ?? null,
          source,
          matchStatus,
        })
      : null;

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/finance/tresorerie"
            className="inline-flex items-center gap-2 text-sm text-stoniz-gray-500 hover:text-stoniz-black mb-2"
          >
            <ArrowLeft className="w-4 h-4" />
            Retour à la trésorerie
          </Link>
          <PageHeader
            title="Rapprochement banque ↔ Stoniz"
            description="Identifie les transactions bancaires qui n'ont pas encore été rattachées à un projet ou poste Stoniz. Clique sur une ligne pour l'allouer."
          />
        </div>
        {/* Toggle vue (split par défaut) */}
        <div className="inline-flex shrink-0 rounded-md border border-stoniz-gray-300 bg-white p-0.5 text-xs">
          <Link
            href={buildHref({ view: null, page: null })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors',
              view === 'split'
                ? 'bg-stoniz-black text-cream'
                : 'text-stoniz-gray-600 hover:bg-stoniz-gray-50',
            )}
            title="Vue côte-à-côte attendus ↔ banque"
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Côte-à-côte
          </Link>
          <Link
            href={buildHref({ view: 'list', page: null, matchStatus: null, source: null })}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-3 py-1.5 font-medium transition-colors',
              view === 'list'
                ? 'bg-stoniz-black text-cream'
                : 'text-stoniz-gray-600 hover:bg-stoniz-gray-50',
            )}
            title="Liste plate des transactions"
          >
            <List className="h-3.5 w-3.5" />
            Liste plate
          </Link>
        </div>
      </div>

      {/* Toolbar unifiée CEO 2026-06-16 : recherche auto-apply + filtres chips + ⌘K
          Cachée en vue split : la split a ses propres filtres rapides (matchStatus + source).
          Seuls période / dates custom / compte / search s'appliquent en split (lus par
          getReconciliationPairs). */}
      <Card>
        <TresorerieToolbar
          accounts={(accounts ?? []).map((a: any) => ({
            id: a.id,
            label: `${a.company?.name ?? ''} · ${a.bank_label ?? ''}`.replace(/^ · /, '').trim() || a.account_label,
          }))}
          categories={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label: label as string }))}
          moduleKey="tresorerie:reconciliation"
        />
      </Card>

      {view === 'split' && splitData ? (
        <ReconciliationSideBySide
          expected={splitData.expected}
          bank={splitData.bank}
          stats={splitData.stats}
          activeFilters={{ matchStatus, source }}
          buildHref={(overrides) => buildHref({ ...overrides, page: null })}
        />
      ) : (
        <>
      {/* Stats globales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Total transactions</div>
          <div className="text-3xl font-display">{allTxsCount}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">Importées (hors pending)</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Non allouées</div>
          <div className="text-3xl font-display text-orange-700">{unallocatedCount}</div>
          <div className="text-xs text-orange-700 mt-1">À rattacher</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Partiellement allouées</div>
          <div className="text-3xl font-display text-amber-700">{partialCount}</div>
          <div className="text-xs text-amber-700 mt-1">Compléter l'allocation</div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Totalement allouées</div>
          <div className="text-3xl font-display text-emerald-700">{allocatedCount}</div>
          <div className="text-xs text-emerald-700 mt-1">Rattachées Stoniz</div>
        </Card>
      </div>

      {/* Impact business */}
      <div className="bg-orange-50 border border-orange-200 rounded-md p-4 text-sm text-orange-900">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <div>
            <strong>{fmtMad(totalUnallocatedMad)}</strong> de flux bancaires ne sont pas encore rattachés à un projet ou poste.
            Cela rend impossible de calculer précisément la rentabilité par projet jusqu'à ce que ce soit alloué.
          </div>
        </div>
      </div>

      {/* Bandeau de groupement intelligent — détecte les bénéficiaires récurrents
          non alloués et propose une allocation en bloc en 1 clic (CEO 2026-06-16) */}
      <RecurringBeneficiariesBanner
        transactions={enriched
          .filter((t: any) => t.statusCode !== 'allocated')
          .map((t: any) => ({
            id: t.id,
            beneficiary: t.beneficiary,
            label: t.label,
            amount: t.amount,
            operation_date: t.operation_date,
          }))}
      />

      {/* Tableau */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-display">
            {filteredTotal} transaction{filteredTotal > 1 ? 's' : ''} {status === 'all' ? 'au total' : status === 'unallocated' ? 'non allouée(s)' : status === 'partial' ? 'partiellement allouée(s)' : 'totalement allouée(s)'}
            <span className="text-stoniz-gray-500 text-sm font-normal"> · page {currentPage} / {totalPages}</span>
          </h2>
        </div>

        {paged.length === 0 ? (
          <div className="text-center py-12">
            <CheckCircle className="w-12 h-12 mx-auto text-emerald-600 mb-3" />
            <p className="text-sm text-stoniz-gray-600">
              {status === 'unallocated' ? 'Tout est alloué dans ce périmètre — bravo !' : 'Aucune transaction dans ce filtre.'}
            </p>
          </div>
        ) : (
          <>
            <TransactionsBulkTable
              canWrite={canWrite}
              sortKey={sortKey as 'date' | 'debit' | 'credit' | 'category' | 'account'}
              sortDir={sortDir as 'asc' | 'desc'}
              sortHrefs={{
                date: buildSortHref('date'),
                debit: buildSortHref('debit'),
                credit: buildSortHref('credit'),
                category: buildSortHref('category'),
                account: buildSortHref('account'),
              }}
              transactions={paged.map((t: any) => ({
                id: t.id,
                operation_date: t.operation_date,
                label: t.label,
                category_code: t.category_code,
                debit_mad: t.debit_mad,
                credit_mad: t.credit_mad,
                is_pending: t.is_pending,
                account: t.account,
                _statusLabel: t.statusCode,
                _remaining: t.remaining,
              }))}
            />

            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t text-xs">
                <div className="text-stoniz-gray-500">
                  Page {currentPage} sur {totalPages} · {filteredTotal} transaction{filteredTotal > 1 ? 's' : ''}
                </div>
                <div className="flex items-center gap-2">
                  {currentPage > 1 ? (
                    <Link href={buildHref({ page: currentPage - 1 === 1 ? null : currentPage - 1 })}
                      className="px-3 py-1.5 border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50">← Précédent</Link>
                  ) : (
                    <span className="px-3 py-1.5 border border-stoniz-gray-200 rounded text-stoniz-gray-300 cursor-not-allowed">← Précédent</span>
                  )}
                  {currentPage < totalPages ? (
                    <Link href={buildHref({ page: currentPage + 1 })}
                      className="px-3 py-1.5 border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50">Suivant →</Link>
                  ) : (
                    <span className="px-3 py-1.5 border border-stoniz-gray-200 rounded text-stoniz-gray-300 cursor-not-allowed">Suivant →</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Card>
        </>
      )}
    </div>
  );
}
