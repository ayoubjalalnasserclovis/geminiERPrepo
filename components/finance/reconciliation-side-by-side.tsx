import Link from 'next/link';
import { Card } from '@/components/ui/card';
import {
  AlertTriangle,
  CheckCircle2,
  Banknote,
  Wallet,
  Inbox,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';
import type {
  ExpectedPayment,
  BankPair,
  ReconciliationStats,
  ExpectedPaymentSource,
} from '@/lib/finance/reconciliation-pairs';
import { SOURCE_LABELS } from '@/lib/finance/reconciliation-pairs';
import { cn } from '@/lib/utils/cn';

/**
 * Vue côte-à-côte de la réconciliation banque ↔ Stoniz (P2.B 2026-06-24).
 *
 * - Colonne gauche : paiements attendus (4 sources)
 * - Colonne droite : transactions banque
 *
 * Server component pur (les filtres rapides sont des liens URL).
 *
 * Couleurs : canon Stoniz `stoniz_ux_canon` — orange pour anomalies (orphelins),
 * emerald pour OK (matchés), gris pour neutre. Pas de rouge.
 *
 * Pour la liste plate existante voir `reconciliation/page.tsx?view=list`.
 */

const MAX_ITEMS_PER_COL = 200;

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtSignedMad(n: number): string {
  const sign = n < 0 ? '-' : '+';
  return `${sign}${fmtMad(Math.abs(n))}`;
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

function isOverdue(dueDate: string | null, matched: boolean): boolean {
  if (!dueDate || matched) return false;
  const today = new Date().toISOString().slice(0, 10);
  return dueDate < today;
}

// ─── Chip filtre ────────────────────────────────────────────────────────────

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-stoniz-black bg-stoniz-black text-cream'
          : 'border-stoniz-gray-300 bg-white text-stoniz-gray-700 hover:bg-stoniz-gray-50',
      )}
    >
      {children}
    </Link>
  );
}

// ─── Status badge ───────────────────────────────────────────────────────────

function MatchBadge({ matched }: { matched: boolean }) {
  if (matched) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
        <CheckCircle2 className="h-3 w-3" />
        Matché
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-900">
      <AlertTriangle className="h-3 w-3" />
      Orphelin
    </span>
  );
}

/**
 * Badge à 3 états pour les transactions banque :
 *   - matched           → vert "Matché"
 *   - cabinet (allocation sans FK projet) → gris "Cabinet : <type>"
 *   - vraiment orphelin → orange "À allouer"
 *
 * Cabinet = catégorisation comptable hors projet (frais_bancaire, cabinet_charge,
 * cabinet_fiscal, cabinet_social, autre, intercompany). Ces transactions ont une
 * allocation active mais aucune FK paiement-projet — c'est NORMAL, pas un orphelin.
 */
const CABINET_TYPE_LABELS: Record<string, string> = {
  frais_bancaire: 'Frais bancaires',
  cabinet_charge: 'Charges cabinet',
  cabinet_fiscal: 'Fiscal (DGI)',
  cabinet_social: 'Social (CNSS)',
  autre: 'Autre',
  intercompany: 'Intercompany',
};

function BankMatchBadge({ item }: { item: BankPair }) {
  if (item.matched) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
        <CheckCircle2 className="h-3 w-3" />
        Matché
      </span>
    );
  }
  if (item.hasAllocation) {
    const label =
      (item.allocationType && CABINET_TYPE_LABELS[item.allocationType]) ||
      item.allocationType ||
      'Cabinet';
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-stoniz-gray-100 px-2 py-0.5 text-[11px] font-medium text-stoniz-gray-700"
        title={`Catégorisée hors projet — ${label}`}
      >
        <Banknote className="h-3 w-3" />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-900">
      <AlertTriangle className="h-3 w-3" />
      À allouer
    </span>
  );
}

function SourceBadge({ source }: { source: ExpectedPaymentSource }) {
  const map: Record<ExpectedPaymentSource, string> = {
    honoraires: 'bg-purple-100 text-purple-900',
    travaux: 'bg-yellow text-stoniz-black',
    achats: 'bg-blue-100 text-blue-900',
    services: 'bg-stoniz-gray-200 text-stoniz-black',
  };
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium', map[source])}>
      {SOURCE_LABELS[source]}
    </span>
  );
}

// ─── Items ──────────────────────────────────────────────────────────────────

function ExpectedItem({ item }: { item: ExpectedPayment }) {
  const overdue = isOverdue(item.dueDate, item.matched);
  return (
    <li className="border-b border-stoniz-gray-100 px-3 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <SourceBadge source={item.source} />
            <MatchBadge matched={item.matched} />
            {overdue && (
              <span className="inline-flex rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-medium text-orange-900">
                En retard
              </span>
            )}
          </div>
          <div
            className="mt-1 truncate text-sm font-medium text-stoniz-black"
            title={item.label}
          >
            {item.label}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-stoniz-gray-500">
            <span>Échéance {fmtDate(item.dueDate)}</span>
            {item.context?.projectRef && (
              <>
                <span>·</span>
                <Link
                  href={`/projects/${item.context.projectId}`}
                  className="text-stoniz-gray-600 underline-offset-2 hover:text-stoniz-black hover:underline"
                >
                  {item.context.projectRef}
                </Link>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-sm font-semibold text-stoniz-black">{fmtMad(item.amount)}</div>
          {item.remaining > 0 && item.remaining < item.amount && (
            <div className="text-[11px] text-orange-700">
              Reste {fmtMad(item.remaining)}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function BankItem({ item }: { item: BankPair }) {
  const isCredit = item.amount > 0;
  return (
    <li className="border-b border-stoniz-gray-100 px-3 py-2.5 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            {isCredit ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <ArrowDownRight className="h-3 w-3" />
                Crédit
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-stoniz-gray-100 px-2 py-0.5 text-[11px] font-medium text-stoniz-gray-700">
                <ArrowUpRight className="h-3 w-3" />
                Débit
              </span>
            )}
            <BankMatchBadge item={item} />
          </div>
          <Link
            href={`/finance/tresorerie/transactions/${item.id}`}
            className="mt-1 block truncate text-sm font-medium text-stoniz-black hover:underline"
            title={item.label}
          >
            {item.label}
          </Link>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-stoniz-gray-500">
            <span>{fmtDate(item.operationDate)}</span>
            {item.beneficiary && (
              <>
                <span>·</span>
                <span className="truncate" title={item.beneficiary}>
                  {item.beneficiary}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div
            className={cn(
              'text-sm font-semibold',
              isCredit ? 'text-emerald-700' : 'text-stoniz-gray-800',
            )}
          >
            {fmtSignedMad(item.amount)}
          </div>
          {item.remaining > 0 && item.remaining < Math.abs(item.amount) && (
            <div className="text-[11px] text-orange-700">
              Reste {fmtMad(item.remaining)}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// ─── Composant principal ────────────────────────────────────────────────────

export type ReconciliationSideBySideProps = {
  expected: ExpectedPayment[];
  bank: BankPair[];
  stats: ReconciliationStats;
  /** Filtres actifs côté URL */
  activeFilters: {
    matchStatus: 'all' | 'matched' | 'orphan';
    source: ExpectedPaymentSource | 'all';
  };
  /** Builder de href : prend des overrides et renvoie l'URL complète */
  buildHref: (overrides: Record<string, string | null>) => string;
};

export function ReconciliationSideBySide({
  expected,
  bank,
  stats,
  activeFilters,
  buildHref,
}: ReconciliationSideBySideProps) {
  const expectedTruncated = expected.length > MAX_ITEMS_PER_COL;
  const bankTruncated = bank.length > MAX_ITEMS_PER_COL;
  const expectedShown = expectedTruncated ? expected.slice(0, MAX_ITEMS_PER_COL) : expected;
  const bankShown = bankTruncated ? bank.slice(0, MAX_ITEMS_PER_COL) : bank;

  return (
    <div className="space-y-4">
      {/* Stats en-tête — 4 cards : matchés / cabinet (hors projet) / attendus orphelins / banque vraiment orphelines */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-emerald-200 bg-emerald-50/40">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-emerald-100 p-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-700" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase text-emerald-900/80">Matchés projet</div>
              <div className="font-display text-2xl text-emerald-900">
                {stats.expectedMatched} attendus · {stats.bankMatched} banque
              </div>
              <div className="text-xs text-emerald-800/80">
                {fmtMad(stats.amountMatched)} appariés
              </div>
            </div>
          </div>
        </Card>
        <Card className="border-stoniz-gray-200 bg-stoniz-gray-50/60">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-stoniz-gray-100 p-2">
              <Banknote className="h-5 w-5 text-stoniz-gray-700" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase text-stoniz-gray-700">Cabinet (hors projet)</div>
              <div className="font-display text-2xl text-stoniz-gray-900">
                {stats.bankCategorizedOnly}
              </div>
              <div className="text-xs text-stoniz-gray-600">
                {fmtMad(stats.amountCategorizedOnly)} catégorisés (frais, charges, impôts…)
              </div>
            </div>
          </div>
        </Card>
        <Card className="border-orange-200 bg-orange-50/40">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-orange-100 p-2">
              <Wallet className="h-5 w-5 text-orange-700" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase text-orange-900/80">Attendus orphelins</div>
              <div className="font-display text-2xl text-orange-900">{stats.expectedOrphan}</div>
              <div className="text-xs text-orange-800/80">
                {fmtMad(stats.amountOrphanExpected)} à percevoir / payer
              </div>
            </div>
          </div>
        </Card>
        <Card className="border-orange-200 bg-orange-50/40">
          <div className="flex items-start gap-3">
            <div className="rounded-full bg-orange-100 p-2">
              <Banknote className="h-5 w-5 text-orange-700" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase text-orange-900/80">Banque à allouer</div>
              <div className="font-display text-2xl text-orange-900">{stats.bankOrphan}</div>
              <div className="text-xs text-orange-800/80">
                {fmtMad(stats.amountOrphanBank)} sans allocation
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Filtres rapides */}
      <Card className="space-y-3">
        <div>
          <div className="mb-1.5 text-xs uppercase text-stoniz-gray-500">Statut</div>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              href={buildHref({ matchStatus: null })}
              active={activeFilters.matchStatus === 'all'}
            >
              Tous
            </FilterChip>
            <FilterChip
              href={buildHref({ matchStatus: 'matched' })}
              active={activeFilters.matchStatus === 'matched'}
            >
              <CheckCircle2 className="h-3 w-3" />
              Matchés
            </FilterChip>
            <FilterChip
              href={buildHref({ matchStatus: 'orphan' })}
              active={activeFilters.matchStatus === 'orphan'}
            >
              <AlertTriangle className="h-3 w-3" />
              Orphelins
            </FilterChip>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-xs uppercase text-stoniz-gray-500">Source des attendus</div>
          <div className="flex flex-wrap gap-2">
            <FilterChip
              href={buildHref({ source: null })}
              active={activeFilters.source === 'all'}
            >
              Toutes
            </FilterChip>
            {(['honoraires', 'travaux', 'achats', 'services'] as const).map((s) => (
              <FilterChip
                key={s}
                href={buildHref({ source: s })}
                active={activeFilters.source === s}
              >
                {SOURCE_LABELS[s]}
              </FilterChip>
            ))}
          </div>
        </div>
      </Card>

      {/* Côte-à-côte */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* GAUCHE — Attendus */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-stoniz-gray-100 px-4 py-3">
            <div>
              <h3 className="font-display text-base">Attendus</h3>
              <p className="text-xs text-stoniz-gray-500">
                Triés par échéance — les plus urgents en haut
              </p>
            </div>
            <div className="text-right text-xs text-stoniz-gray-500">
              <div className="font-medium text-stoniz-black">{expected.length}</div>
              <div>{fmtMad(expected.reduce((s, e) => s + e.amount, 0))}</div>
            </div>
          </div>
          {expectedShown.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Inbox className="mx-auto mb-2 h-8 w-8 text-stoniz-gray-300" />
              <p className="text-sm text-stoniz-gray-500">
                Aucun paiement attendu sur cette période — élargis la fenêtre.
              </p>
            </div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {expectedShown.map((e) => (
                <ExpectedItem key={`exp-${e.source}-${e.id}`} item={e} />
              ))}
            </ul>
          )}
          {expectedTruncated && (
            <div className="border-t border-stoniz-gray-100 bg-stoniz-gray-50 px-4 py-2 text-xs text-stoniz-gray-600">
              {MAX_ITEMS_PER_COL} sur {expected.length} — affine la période ou la source.
            </div>
          )}
        </Card>

        {/* DROITE — Transactions banque */}
        <Card className="p-0">
          <div className="flex items-center justify-between border-b border-stoniz-gray-100 px-4 py-3">
            <div>
              <h3 className="font-display text-base">Transactions banque</h3>
              <p className="text-xs text-stoniz-gray-500">
                Triées par date — les plus récentes en haut
              </p>
            </div>
            <div className="text-right text-xs text-stoniz-gray-500">
              <div className="font-medium text-stoniz-black">{bank.length}</div>
              <div>{fmtMad(bank.reduce((s, b) => s + Math.abs(b.amount), 0))}</div>
            </div>
          </div>
          {bankShown.length === 0 ? (
            <div className="px-4 py-12 text-center">
              <Inbox className="mx-auto mb-2 h-8 w-8 text-stoniz-gray-300" />
              <p className="text-sm text-stoniz-gray-500">
                Aucune transaction banque sur cette période.
              </p>
            </div>
          ) : (
            <ul className="max-h-[70vh] overflow-y-auto">
              {bankShown.map((b) => (
                <BankItem key={`bank-${b.id}`} item={b} />
              ))}
            </ul>
          )}
          {bankTruncated && (
            <div className="border-t border-stoniz-gray-100 bg-stoniz-gray-50 px-4 py-2 text-xs text-stoniz-gray-600">
              {MAX_ITEMS_PER_COL} sur {bank.length} — affine la période ou le compte.
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
