import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Building2, Landmark, Wallet, TrendingUp, AlertCircle, FileUp, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { RecordBalanceForm } from './record-balance-form';
import { AddAccountForm } from './add-account-form';
import { CATEGORY_LABELS } from '@/lib/finance/bank-categorizer';
import { TransactionsBulkTable } from './transactions-bulk-table';
import { TresorerieToolbar } from '@/components/finance/tresorerie-toolbar';
import { AlertThresholdCell } from './alert-threshold-cell';
import { resolvePeriodRange } from '@/lib/finance/period-helpers';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';
import { FinanceSectionAuditTimeline } from '@/components/finance/finance-section-audit-timeline';

/**
 * Page Trésorerie — Vue consolidée par compte + saisie manuelle du solde.
 *
 * Permissions :
 *   - Lecture : CEO + finance + developer
 *   - Saisie de solde / ajout de compte : CEO + finance
 *   - Désactivation de compte : CEO seul
 *
 * V1 (Chantier 1) : saisie manuelle uniquement. L'import XLSX/CSV viendra
 * au Chantier 2.
 */

function fmtMoney(amount: number | null | undefined, currency = 'MAD'): string {
  if (amount == null) return '—';
  const formatted = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(amount);
  return `${formatted} ${currency}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

// Next.js 14 — searchParams arrive { [key: string]: string | string[] | undefined }
type SearchParams = { [key: string]: string | string[] | undefined };

const PAGE_SIZE = 50;

const SORT_COLUMNS: Record<string, string> = {
  date: 'operation_date',
  debit: 'debit_mad',
  credit: 'credit_mad',
  category: 'category_code',
  account: 'account_id',
};

const SOLDE_SORT_KEYS = ['company', 'bank', 'balance'] as const;
type SoldeSortKey = typeof SOLDE_SORT_KEYS[number];

function spString(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  if (Array.isArray(v)) return v[0];
  return v;
}

export default async function TresoreriePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const me = await requireRole(['ceo', 'finance', 'developer']);
  const canWrite = me.role === 'ceo' || me.role === 'finance';
  const supabase = createClient();

  const spType = spString(searchParams, 'type');
  const spStatus = spString(searchParams, 'status');
  const spSort = spString(searchParams, 'sort');
  const spDir = spString(searchParams, 'dir');
  const spPage = spString(searchParams, 'page');
  const spSoldeSort = spString(searchParams, 'soldeSort');
  const spSoldeDir = spString(searchParams, 'soldeDir');

  const filterType: 'debit' | 'credit' | 'all' = spType === 'debit' || spType === 'credit' ? spType : 'all';
  const filterStatus: 'unallocated' | 'partial' | 'allocated' | 'all' =
    spStatus === 'unallocated' || spStatus === 'partial' || spStatus === 'allocated' ? spStatus : 'all';
  const sortKey = (spSort && SORT_COLUMNS[spSort]) ? spSort : 'date';
  const sortDir: 'asc' | 'desc' = spDir === 'asc' ? 'asc' : 'desc';
  const currentPage = Math.max(1, parseInt(spPage ?? '1', 10) || 1);

  // CEO 2026-06-23 — buildHref fix P0.1 :
  // CLONE TOUS les query params actuels puis overrider sélectivement.
  // L'ancienne version recopiait seulement type/status/sort/dir/page → faisait perdre
  // q, period, from, to, account_id, category, min, max à la pagination/tri.
  function buildHref(overrides: Record<string, string | number | null | undefined>): string {
    const sp = new URLSearchParams();
    // 1. clone TOUS les params actuels
    for (const [k, v] of Object.entries(searchParams)) {
      if (v == null) continue;
      if (Array.isArray(v)) v.forEach((item) => sp.append(k, item));
      else sp.set(k, v);
    }
    // 2. override sélectif
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === undefined || v === '') sp.delete(k);
      else sp.set(k, String(v));
    }
    const qs = sp.toString();
    return `/finance/tresorerie${qs ? `?${qs}` : ''}`;
  }

  // Build l'URL pour cliquer sur une colonne triable :
  // - si déjà triée dans ce sens → inverse la direction
  // - sinon → trie sur cette colonne en DESC (utile : gros montants d'abord)
  function buildSortHref(targetSort: 'date' | 'debit' | 'credit' | 'category' | 'account') {
    const nextDir = sortKey === targetSort ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
    return buildHref({ sort: targetSort, dir: nextDir, page: 1 });
  }

  // Tri du tableau Soldes — params indépendants (soldeSort/soldeDir)
  const soldeSortKey: SoldeSortKey = (SOLDE_SORT_KEYS as readonly string[]).includes(spSoldeSort ?? '')
    ? (spSoldeSort as SoldeSortKey) : 'company';
  const soldeSortDir: 'asc' | 'desc' = spSoldeDir === 'desc' ? 'desc' : 'asc';
  function buildSoldeSortHref(target: SoldeSortKey): string {
    const nextDir = soldeSortKey === target ? (soldeSortDir === 'asc' ? 'desc' : 'asc') : 'asc';
    return buildHref({ soldeSort: target, soldeDir: nextDir });
  }

  // Sociétés actives
  const { data: companies } = await supabase
    .from('bank_companies')
    .select('id, code, name, business_unit, currency, country_code, is_active, notes')
    .is('deleted_at', null)
    .order('business_unit')
    .order('name');

  // Soldes courants par compte (depuis la vue helper)
  const { data: balances } = await supabase
    .from('v_bank_account_current_balance')
    .select('*')
    .eq('is_active', true)
    .order('company_name')
    .order('bank_label');

  const allCompanies = companies ?? [];
  const allBalances = (balances ?? []) as any[];

  // Tous les comptes (même sans solde encore saisi) — inclut le seuil d'alerte
  const { data: accounts } = await supabase
    .from('bank_accounts')
    .select('id, company_id, bank_code, bank_label, account_label, currency, is_active, alert_threshold_mad')
    .is('deleted_at', null)
    .eq('is_active', true)
    .order('account_label');

  // Compte des comptes en alerte (solde < seuil)
  const accountsById = new Map((accounts ?? []).map((a: any) => [a.id, a]));
  const accountsInAlert = allBalances.filter((b: any) => {
    const acc = accountsById.get(b.account_id) as any;
    const threshold = acc?.alert_threshold_mad;
    return threshold != null && Number(b.current_balance) < Number(threshold);
  });

  // Historique des derniers soldes (15 derniers)
  const { data: history } = await supabase
    .from('bank_balances')
    .select(`
      id, balance_date, balance_amount, currency, source, notes, recorded_at,
      account:bank_accounts(id, account_label, bank_label,
        company:bank_companies(name, business_unit)
      ),
      recorder:profiles(full_name)
    `)
    .order('balance_date', { ascending: false })
    .order('recorded_at', { ascending: false })
    .limit(15);

  // Transactions importées avec filtres + pagination.
  // Le filtre type (débit/crédit) est exécuté côté SQL.
  // Le filtre status (allocation) est appliqué côté JS sur les résultats fetched
  // car il dépend d'un calcul (somme des allocations vs montant).
  // Pour conserver une pagination cohérente quand un filtre status est actif,
  // on fetch large (jusqu'à 500), filtre, puis slice côté JS.
  const needsStatusFilter = filterStatus !== 'all';
  const wantedOffset = (currentPage - 1) * PAGE_SIZE;

  let txQuery = supabase
    .from('bank_transactions')
    .select(`
      id, operation_date, value_date, label, reference,
      debit_mad, credit_mad, category_code, beneficiary, is_pending, imported_at,
      account:bank_accounts(account_label, bank_label,
        company:bank_companies(name)
      ),
      allocations:bank_transaction_allocations(amount_mad, deleted_at)
    `, { count: 'exact' })
    .is('deleted_at', null);

  if (filterType === 'debit') {
    txQuery = txQuery.gt('debit_mad', 0);
  } else if (filterType === 'credit') {
    txQuery = txQuery.gt('credit_mad', 0);
  }

  // ─── Filtres avancés CEO 2026-06-16 ────────────────────────────────────
  // Période preset ou date range custom (prio au custom)
  // CEO 2026-06-23 P0.2 : défaut serveur aligné sur 'last_3_months' (toolbar
  // l'affichait déjà mais le serveur renvoyait "Tout" — divergence corrigée).
  // P0.3 : si from/to présents on IGNORE le preset.
  const spPeriod = spString(searchParams, 'period');
  const spFrom = spString(searchParams, 'from');
  const spTo = spString(searchParams, 'to');
  const spAccountId = spString(searchParams, 'account_id');
  const spCategory = spString(searchParams, 'category');
  const spQ = spString(searchParams, 'q');
  const spMin = spString(searchParams, 'min');
  const spMax = spString(searchParams, 'max');

  const periodPreset = spPeriod ?? 'last_3_months';
  const hasCustomRange = !!(spFrom || spTo);
  const { fromDate: presetFrom, toDate: presetTo } = resolvePeriodRange(periodPreset);
  const periodFrom: string | null = hasCustomRange ? (spFrom ?? null) : presetFrom;
  const periodTo: string | null = hasCustomRange ? (spTo ?? null) : presetTo;
  if (periodFrom) txQuery = txQuery.gte('operation_date', periodFrom);
  if (periodTo) txQuery = txQuery.lte('operation_date', periodTo);

  if (spAccountId) txQuery = txQuery.eq('account_id', spAccountId);
  if (spCategory) txQuery = txQuery.eq('category_code', spCategory);

  // Recherche multi-champ : libellé + bénéficiaire + référence + montant
  if (spQ) {
    const tokens = spQ.trim().split(/\s+/).filter(Boolean);
    for (const tok of tokens) {
      const safe = tok.replace(/[%_,()]/g, ' ').trim();
      if (!safe) continue;
      const orParts = [
        `label.ilike.%${safe}%`,
        `beneficiary.ilike.%${safe}%`,
        `reference.ilike.%${safe}%`,
      ];
      if (/^\d+(\.\d+)?$/.test(safe)) {
        orParts.push(`debit_mad.eq.${safe}`);
        orParts.push(`credit_mad.eq.${safe}`);
      }
      txQuery = txQuery.or(orParts.join(','));
    }
  }
  const minAmt = spMin ? Number(spMin) : null;
  const maxAmt = spMax ? Number(spMax) : null;
  if (minAmt != null && !isNaN(minAmt)) {
    txQuery = txQuery.or(`debit_mad.gte.${minAmt},credit_mad.gte.${minAmt}`);
  }
  if (maxAmt != null && !isNaN(maxAmt)) {
    txQuery = txQuery.or(`debit_mad.lte.${maxAmt},credit_mad.lte.${maxAmt}`);
  }

  const fetchLimit = needsStatusFilter ? 500 : PAGE_SIZE;
  const fetchFrom = needsStatusFilter ? 0 : wantedOffset;
  const fetchTo = fetchFrom + fetchLimit - 1;

  const sortColumn = SORT_COLUMNS[sortKey] ?? 'operation_date';
  const sortAsc = sortDir === 'asc';

  // Tri principal sur la colonne demandée (NULLS LAST pour les montants — sinon les
  // crédits sans débit remontent dans un tri par débit). Tri secondaire sur imported_at
  // pour stabiliser l'ordre quand plusieurs lignes ont la même valeur.
  let orderedQuery = txQuery.order(sortColumn, { ascending: sortAsc, nullsFirst: false });
  if (sortColumn !== 'operation_date') {
    orderedQuery = orderedQuery.order('operation_date', { ascending: false });
  }
  orderedQuery = orderedQuery.order('imported_at', { ascending: false });

  const { data: txRows, count: txTotalCount } = await orderedQuery.range(fetchFrom, fetchTo);

  // Calcule le statut alloc pour chaque ligne et applique le filtre status si nécessaire
  type TxWithStatus = any & { _allocated: number; _remaining: number; _statusLabel: 'unallocated' | 'partial' | 'allocated' | 'pending' };
  function computeAllocStatus(t: any): TxWithStatus {
    if (t.is_pending) return { ...t, _allocated: 0, _remaining: 0, _statusLabel: 'pending' };
    const amount = Math.abs(Number(t.debit_mad ?? t.credit_mad ?? 0));
    const allocs = (t.allocations ?? []).filter((a: any) => a.deleted_at == null);
    const allocated = allocs.reduce((s: number, a: any) => s + Math.abs(Number(a.amount_mad)), 0);
    const remaining = Math.max(0, amount - allocated);
    let _statusLabel: TxWithStatus['_statusLabel'];
    if (remaining < 0.01 && allocated > 0) _statusLabel = 'allocated';
    else if (allocated > 0 && remaining >= 0.01) _statusLabel = 'partial';
    else _statusLabel = 'unallocated';
    return { ...t, _allocated: allocated, _remaining: remaining, _statusLabel };
  }

  const withStatus = (txRows ?? []).map(computeAllocStatus);
  const afterStatusFilter = needsStatusFilter
    ? withStatus.filter((t) => t._statusLabel === filterStatus)
    : withStatus;

  const transactionsPage = needsStatusFilter
    ? afterStatusFilter.slice(wantedOffset, wantedOffset + PAGE_SIZE)
    : afterStatusFilter;
  // Total pour pagination : si filtre status actif, on ne peut compter qu'après filtrage
  // (on s'appuie sur le buffer de 500 — suffisant pour la plupart des cas).
  const filteredTotal = needsStatusFilter ? afterStatusFilter.length : (txTotalCount ?? 0);
  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));

  // Compte global des transactions non allouées (pour le badge sur le bouton Rapprochement)
  const { data: allTxsForCount } = await supabase
    .from('bank_transactions')
    .select('id, debit_mad, credit_mad, allocations:bank_transaction_allocations(amount_mad, deleted_at)')
    .is('deleted_at', null)
    .eq('is_pending', false)
    .limit(500);
  const unallocatedCount = (allTxsForCount ?? []).filter((t: any) => {
    const amount = Math.abs(Number(t.debit_mad ?? t.credit_mad ?? 0));
    const allocs = (t.allocations ?? []).filter((a: any) => a.deleted_at == null);
    const allocated = allocs.reduce((s: number, a: any) => s + Math.abs(Number(a.amount_mad)), 0);
    return Math.max(0, amount - allocated) > 0.01;
  }).length;

  // Consolidations par business_unit
  const consolidations: Record<string, { label: string; total: number; accounts: number; currency: string }> = {
    stoniz: { label: 'Stoniz Group (clé-en-main)', total: 0, accounts: 0, currency: 'MAD' },
    propria: { label: 'Propria (conciergerie)', total: 0, accounts: 0, currency: 'MAD' },
  };

  for (const b of allBalances) {
    const bu = b.business_unit as string;
    if (consolidations[bu]) {
      consolidations[bu].total += Number(b.current_balance ?? 0);
      consolidations[bu].accounts += 1;
    }
  }

  const grandTotal = Object.values(consolidations).reduce((s, c) => s + c.total, 0);

  return (
    <div className="space-y-8 max-w-7xl">
      <div className="flex items-start justify-between">
        <PageHeader
          title="Trésorerie groupe"
          description="Vue consolidée des soldes bancaires par société et par activité. Saisie manuelle ou import XLSX/CSV des relevés bancaires."
        />
        <div className="flex items-center gap-2">
          <Link
            href="/finance/projection"
            className="inline-flex items-center gap-2 border border-blue-300 bg-blue-50 text-blue-900 px-4 py-2.5 rounded-md text-sm font-medium hover:bg-blue-100"
          >
            🔮 Projection 30/60/90j
          </Link>
          <Link
            href="/finance/synthese"
            className="inline-flex items-center gap-2 border border-emerald-300 bg-emerald-50 text-emerald-900 px-4 py-2.5 rounded-md text-sm font-medium hover:bg-emerald-100"
          >
            📊 Synthèse cabinet
          </Link>
          <Link
            href="/finance/tresorerie/reconciliation"
            className="inline-flex items-center gap-2 border border-stoniz-gray-300 px-4 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-50"
          >
            Rapprochement
            {unallocatedCount > 0 && (
              <span className="bg-orange-100 text-orange-800 text-xs font-semibold px-2 py-0.5 rounded-full">
                {unallocatedCount}
              </span>
            )}
          </Link>
          {canWrite && (
            <Link
              href="/finance/tresorerie/import"
              className="inline-flex items-center gap-2 bg-stoniz-black text-white px-5 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-800"
            >
              <FileUp className="w-4 h-4" />
              Importer un relevé
            </Link>
          )}
        </div>
      </div>

      {accountsInAlert.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4 text-sm text-red-900">
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">🔔</div>
            <div className="flex-1">
              <div className="font-medium mb-1">
                {accountsInAlert.length} compte{accountsInAlert.length > 1 ? 's' : ''} sous le seuil d'alerte
              </div>
              <div className="text-xs text-red-800">
                {accountsInAlert.map((b: any) => `${b.company_name} · ${b.bank_label} ${b.account_label}`).join(' · ')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Vue consolidée groupe */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center gap-3 mb-3">
            <TrendingUp className="w-5 h-5 text-stoniz-black" />
            <div className="text-xs uppercase text-stoniz-gray-500 tracking-wider">Total groupe</div>
          </div>
          <div className="text-3xl font-display font-medium">{fmtMoney(grandTotal)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-2">
            {allBalances.length} compte{allBalances.length > 1 ? 's' : ''} actif{allBalances.length > 1 ? 's' : ''}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3 mb-3">
            <Building2 className="w-5 h-5 text-blue-700" />
            <div className="text-xs uppercase text-stoniz-gray-500 tracking-wider">Stoniz clé-en-main</div>
          </div>
          <div className="text-3xl font-display font-medium">{fmtMoney(consolidations.stoniz.total)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-2">
            {consolidations.stoniz.accounts} compte{consolidations.stoniz.accounts > 1 ? 's' : ''} consolidé{consolidations.stoniz.accounts > 1 ? 's' : ''}
          </div>
        </Card>

        <Card>
          <div className="flex items-center gap-3 mb-3">
            <Wallet className="w-5 h-5 text-emerald-700" />
            <div className="text-xs uppercase text-stoniz-gray-500 tracking-wider">Propria conciergerie</div>
          </div>
          <div className="text-3xl font-display font-medium">{fmtMoney(consolidations.propria.total)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-2">
            {consolidations.propria.accounts === 0
              ? 'Société STZ CLUB à ajouter'
              : `${consolidations.propria.accounts} compte${consolidations.propria.accounts > 1 ? 's' : ''}`}
          </div>
        </Card>
      </div>

      {/* Soldes par compte */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-display">Soldes par compte</h2>
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Dernier solde enregistré pour chaque compte actif
            </p>
          </div>
          {canWrite && allCompanies.length > 0 && (
            <AddAccountForm companies={allCompanies} />
          )}
        </div>

        {allBalances.length === 0 ? (
          <div className="text-center py-12 text-sm text-stoniz-gray-500">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-stoniz-gray-400" />
            Aucun solde enregistré pour le moment.
            {canWrite && ' Utilise le formulaire de saisie ci-dessous pour démarrer.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            {(() => {
              // CEO 2026-06-23 P1.5 : tri côté serveur + total pied
              const sortedBalances = [...allBalances].sort((a: any, b: any) => {
                const sign = soldeSortDir === 'asc' ? 1 : -1;
                if (soldeSortKey === 'company') {
                  return sign * String(a.company_name ?? '').localeCompare(String(b.company_name ?? ''));
                }
                if (soldeSortKey === 'bank') {
                  return sign * String(a.bank_label ?? '').localeCompare(String(b.bank_label ?? ''));
                }
                // balance
                return sign * (Number(a.current_balance ?? 0) - Number(b.current_balance ?? 0));
              });
              const SoldeSortIcon = ({ col }: { col: SoldeSortKey }) => {
                if (soldeSortKey !== col) return <ArrowUpDown className="w-3 h-3 inline opacity-30" />;
                return soldeSortDir === 'asc'
                  ? <ArrowUp className="w-3 h-3 inline text-stoniz-black" />
                  : <ArrowDown className="w-3 h-3 inline text-stoniz-black" />;
              };
              const totalSoldes = allBalances.reduce((s: number, b: any) => s + Number(b.current_balance ?? 0), 0);
              return (
                <table className="w-full text-sm">
                  <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                    <tr>
                      <th className="text-left py-2 px-2">
                        <Link href={buildSoldeSortHref('company')} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                          Société <SoldeSortIcon col="company" />
                        </Link>
                      </th>
                      <th className="text-left py-2 px-2">
                        <Link href={buildSoldeSortHref('bank')} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                          Banque <SoldeSortIcon col="bank" />
                        </Link>
                      </th>
                      <th className="text-left py-2 px-2">Compte</th>
                      <th className="text-right py-2 px-2">
                        <Link href={buildSoldeSortHref('balance')} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                          Solde <SoldeSortIcon col="balance" />
                        </Link>
                      </th>
                      <th className="text-left py-2 px-2">Alerte</th>
                      <th className="text-right py-2 px-2">Au</th>
                      <th className="text-center py-2 px-2 w-8" title="Historique des actions">Hist.</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sortedBalances.map((b: any) => {
                      const acc = accountsById.get(b.account_id) as any;
                      const threshold = acc?.alert_threshold_mad != null ? Number(acc.alert_threshold_mad) : null;
                      const isAlerting = threshold != null && Number(b.current_balance) < threshold;
                      return (
                      <tr key={b.account_id} className={`hover:bg-stoniz-gray-50 ${isAlerting ? 'bg-red-50' : ''}`}>
                        <td className="py-2 px-2">
                          <div className="font-medium">{b.company_name}</div>
                          <div className="text-[11px] uppercase text-stoniz-gray-500">
                            {b.business_unit === 'stoniz' ? 'Clé-en-main' : 'Conciergerie'}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-2">
                            <Landmark className="w-3 h-3 text-stoniz-gray-400" />
                            {b.bank_label}
                          </div>
                        </td>
                        <td className="py-2 px-2 text-stoniz-gray-700">{b.account_label}</td>
                        <td className={`text-right py-2 px-2 font-medium ${b.current_balance < 0 || isAlerting ? 'text-red-600' : ''}`}>
                          {fmtMoney(Number(b.current_balance), b.currency)}
                        </td>
                        <td className="py-2 px-2">
                          <AlertThresholdCell
                            accountId={b.account_id}
                            currentThreshold={threshold}
                            currentBalance={Number(b.current_balance ?? 0)}
                            canEdit={canWrite}
                          />
                        </td>
                        <td className="text-right py-2 px-2 text-stoniz-gray-600">{fmtDate(b.balance_date)}</td>
                        <td className="text-center py-2 px-2">
                          <FinanceAuditButton table="bank_accounts" recordId={b.account_id} size="sm" />
                        </td>
                      </tr>
                      );
                    })}
                    {/* Comptes sans solde encore enregistré */}
                    {(accounts ?? []).filter((a: any) => !allBalances.find((b: any) => b.account_id === a.id)).map((a: any) => (
                      <tr key={`empty-${a.id}`} className="hover:bg-stoniz-gray-50 opacity-60">
                        <td className="py-2 px-2 italic text-stoniz-gray-500">—</td>
                        <td className="py-2 px-2 italic">{a.bank_label}</td>
                        <td className="py-2 px-2 italic">{a.account_label}</td>
                        <td className="text-right py-2 px-2 italic text-stoniz-gray-500">Aucun solde saisi</td>
                        <td className="py-2 px-2">
                          <AlertThresholdCell
                            accountId={a.id}
                            currentThreshold={a.alert_threshold_mad != null ? Number(a.alert_threshold_mad) : null}
                            currentBalance={null}
                            canEdit={canWrite}
                          />
                        </td>
                        <td className="text-right py-2 px-2">—</td>
                        <td className="text-center py-2 px-2">
                          <FinanceAuditButton table="bank_accounts" recordId={a.id} size="sm" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-stoniz-gray-300 font-medium">
                      <td colSpan={3} className="py-2 px-2 text-right text-stoniz-gray-700 uppercase text-xs">Total consolidé</td>
                      <td className={`text-right py-2 px-2 ${totalSoldes < 0 ? 'text-red-600' : ''}`}>{fmtMoney(totalSoldes)}</td>
                      <td colSpan={3} />
                    </tr>
                  </tfoot>
                </table>
              );
            })()}
          </div>
        )}
      </Card>

      {/* Saisie manuelle d'un solde */}
      {canWrite && (accounts ?? []).length > 0 && (
        <Card>
          <h2 className="text-lg font-display mb-1">Enregistrer un solde</h2>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Saisis le solde de l'un de tes comptes à une date donnée. Chaque saisie crée un snapshot historisé.
            Le solde courant affiché = dernière date saisie pour ce compte.
          </p>
          <RecordBalanceForm accounts={accounts ?? []} />
        </Card>
      )}

      {/* Historique récent */}
      {(history?.length ?? 0) > 0 && (
        <Card>
          <h2 className="text-lg font-display mb-3">Historique des 15 derniers soldes</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Compte</th>
                  <th className="text-right py-2 px-2">Solde</th>
                  <th className="text-left py-2 px-2">Source</th>
                  <th className="text-left py-2 px-2">Saisi par</th>
                  <th className="text-left py-2 px-2">Note</th>
                  <th className="text-center py-2 px-2 w-8" title="Historique des actions">Hist.</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {(history ?? []).map((h: any) => (
                  <tr key={h.id} className="hover:bg-stoniz-gray-50">
                    <td className="py-2 px-2">{fmtDate(h.balance_date)}</td>
                    <td className="py-2 px-2">
                      <div className="font-medium">{h.account?.company?.name}</div>
                      <div className="text-[11px] text-stoniz-gray-500">
                        {h.account?.bank_label} · {h.account?.account_label}
                      </div>
                    </td>
                    <td className={`text-right py-2 px-2 font-medium ${Number(h.balance_amount) < 0 ? 'text-red-600' : ''}`}>
                      {fmtMoney(Number(h.balance_amount), h.currency)}
                    </td>
                    <td className="py-2 px-2 text-xs uppercase text-stoniz-gray-600">{h.source}</td>
                    <td className="py-2 px-2 text-xs text-stoniz-gray-600">{h.recorder?.full_name ?? '—'}</td>
                    <td className="py-2 px-2 text-xs text-stoniz-gray-600 italic max-w-xs truncate">
                      {h.notes ?? '—'}
                    </td>
                    <td className="text-center py-2 px-2">
                      <FinanceAuditButton table="bank_balances" recordId={h.id} size="sm" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Transactions importées — toolbar unifiée CEO 2026-06-16 */}
      <Card>
        <div className="mb-3">
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h2 className="text-lg font-display">Transactions importées</h2>
            <p className="text-xs text-stoniz-gray-500">
              {filteredTotal} transaction{filteredTotal > 1 ? 's' : ''} · page {currentPage} / {totalPages}
            </p>
          </div>

          <TresorerieToolbar
            accounts={(accounts ?? []).map((a: any) => ({
              id: a.id,
              label: `${a.bank_label ?? ''} · ${a.account_label ?? ''}`.replace(/^ · /, '').trim(),
            }))}
            categories={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label: label as string }))}
            basePath="/finance/tresorerie"
            compact
            showExport
            moduleKey="tresorerie:transactions"
          />
        </div>

        {transactionsPage.length === 0 ? (
          <div className="text-center py-12 text-sm text-stoniz-gray-500">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-stoniz-gray-400" />
            Aucune transaction ne correspond à ces filtres.
          </div>
        ) : (
          <>
            <TransactionsBulkTable
              transactions={transactionsPage as any[]}
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
            />

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 pt-3 border-t text-xs">
                <div className="text-stoniz-gray-500">
                  Page {currentPage} sur {totalPages} · {filteredTotal} transaction{filteredTotal > 1 ? 's' : ''}
                </div>
                <div className="flex items-center gap-2">
                  {currentPage > 1 ? (
                    <Link
                      href={buildHref({ page: currentPage - 1 === 1 ? null : currentPage - 1 })}
                      className="px-3 py-1.5 border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50"
                    >
                      ← Précédent
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 border border-stoniz-gray-200 rounded text-stoniz-gray-300 cursor-not-allowed">← Précédent</span>
                  )}
                  {currentPage < totalPages ? (
                    <Link
                      href={buildHref({ page: currentPage + 1 })}
                      className="px-3 py-1.5 border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50"
                    >
                      Suivant →
                    </Link>
                  ) : (
                    <span className="px-3 py-1.5 border border-stoniz-gray-200 rounded text-stoniz-gray-300 cursor-not-allowed">Suivant →</span>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* Note prochaine étape */}
      <div className="bg-amber-50 border border-amber-200 rounded-md p-4 text-sm text-amber-900">
        <strong>Prochaine étape (Chantier 4)</strong> — Projection trésorerie 30/60/90 jours :
        ton solde actuel + encaissements probables (clients projets + honoraires) − engagements (artisans / fournisseurs)
        − charges fixes moyennes (loyer, salaires, télécom, DGI, CNSS) + alertes seuil avant découvert.
      </div>

      {/* Historique des actions trésorerie (CEO 2026-06-24 B2) — section dépliable
          agrégeant les events finance_audit_log de toutes les tables trésorerie.
          Mode tablesOnly : filtre par table_name uniquement, sans préfetch des ids. */}
      <FinanceSectionAuditTimeline
        tables={[
          'bank_balances',
          'bank_accounts',
          'bank_companies',
          'bank_category_mappings',
        ]}
        tablesOnly
        title="Historique des actions trésorerie"
        defaultOpen={false}
        limit={100}
      />
    </div>
  );
}
