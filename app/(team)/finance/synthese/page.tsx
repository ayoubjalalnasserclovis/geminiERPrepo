import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, AlertCircle } from 'lucide-react';
import { CATEGORY_LABELS } from '@/lib/finance/bank-categorizer';
import { detectRecurringPayments } from '@/lib/finance/recurring-detector';
import { getSessionUser } from '@/lib/auth/require';
import { RecurringTypeSelect } from './recurring-type-select';

/**
 * Page synthèse cabinet — vue P&L cabinet RAPIDE basée sur la catégorisation auto
 * des transactions bancaires Chaabi, SANS dépendre des allocations projet.
 *
 * Cas d'usage : pilotage cabinet immédiat sans avoir à allouer chaque transaction
 * à un projet (ce qui demande du temps). Les marges par projet, elles, nécessitent
 * toujours les allocations détaillées.
 */

function fmtMad(n: number): string {
  if (n == null || isNaN(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtMadCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M MAD`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)}k MAD`;
  return `${Math.round(n)} MAD`;
}

function monthLabel(yyyymm: string): string {
  const [y, m] = yyyymm.split('-');
  const names = ['janv', 'févr', 'mars', 'avr', 'mai', 'juin', 'juil', 'août', 'sept', 'oct', 'nov', 'déc'];
  return `${names[parseInt(m, 10) - 1]} ${y.slice(2)}`;
}

// Catégories cabinet (à isoler dans la synthèse) — par opposition aux flux projets
const CABINET_CATEGORIES = [
  'dgi',
  'cnss',
  'maroc_telecom',
  'frais_bancaire',
] as const;

export default async function SynthesePage() {
  await requireRole(['ceo', 'finance', 'developer']);
  const me = await getSessionUser();
  const canWrite = me?.role === 'ceo' || me?.role === 'finance';
  const supabase = createClient();

  const now = new Date();
  // Période : 12 derniers mois pour les graphes mensuels
  const start12m = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const start3m = new Date(now.getFullYear(), now.getMonth() - 2, 1);

  // Fetch transactions sur 12 mois (pas pending, pas deleted)
  const { data: txs } = await supabase
    .from('bank_transactions')
    .select('id, operation_date, debit_mad, credit_mad, category_code, beneficiary, label, account_id')
    .gte('operation_date', start12m.toISOString().slice(0, 10))
    .is('deleted_at', null)
    .eq('is_pending', false)
    .order('operation_date', { ascending: false })
    .limit(5000);

  const allTxs = (txs ?? []) as any[];
  const last3mTxs = allTxs.filter((t) => t.operation_date >= start3m.toISOString().slice(0, 10));

  // ─── Cashflow mensuel (12 derniers mois) ───────────────────────────────
  const monthlyFlow: Record<string, { credit: number; debit: number; net: number }> = {};
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthlyFlow[key] = { credit: 0, debit: 0, net: 0 };
  }
  for (const t of allTxs) {
    const key = t.operation_date.slice(0, 7);
    if (!monthlyFlow[key]) continue;
    monthlyFlow[key].credit += Number(t.credit_mad ?? 0);
    monthlyFlow[key].debit += Number(t.debit_mad ?? 0);
    monthlyFlow[key].net = monthlyFlow[key].credit - monthlyFlow[key].debit;
  }
  const monthKeys = Object.keys(monthlyFlow);
  const maxFlow = Math.max(
    ...Object.values(monthlyFlow).flatMap((m) => [m.credit, m.debit, 1])
  );

  // ─── Charges cabinet par catégorie (3 derniers mois) ───────────────────
  const cabinetByCategory: Record<string, number> = {};
  for (const cat of CABINET_CATEGORIES) cabinetByCategory[cat] = 0;
  // Note : les salaires réels sont affichés dans le bloc "Salariés & paiements
  // récurrents" via detectRecurringPayments() (basé sur bank_transactions).

  for (const t of last3mTxs) {
    const debit = Number(t.debit_mad ?? 0);
    if (debit <= 0) continue;
    const cat = t.category_code as string | null;
    if (cat && (CABINET_CATEGORIES as readonly string[]).includes(cat)) {
      cabinetByCategory[cat] += debit;
    }
  }

  // ─── Top bénéficiaires (3 derniers mois) ───────────────────────────────
  const debitByBenef: Record<string, { total: number; count: number }> = {};
  const creditByBenef: Record<string, { total: number; count: number }> = {};
  for (const t of last3mTxs) {
    const benef = (t.beneficiary && String(t.beneficiary).trim()) || null;
    if (!benef) continue;
    const debit = Number(t.debit_mad ?? 0);
    const credit = Number(t.credit_mad ?? 0);
    if (debit > 0) {
      if (!debitByBenef[benef]) debitByBenef[benef] = { total: 0, count: 0 };
      debitByBenef[benef].total += debit;
      debitByBenef[benef].count += 1;
    }
    if (credit > 0) {
      if (!creditByBenef[benef]) creditByBenef[benef] = { total: 0, count: 0 };
      creditByBenef[benef].total += credit;
      creditByBenef[benef].count += 1;
    }
  }
  const topDebit = Object.entries(debitByBenef)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);
  const topCredit = Object.entries(creditByBenef)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 15);

  // Détection des vrais salariés / paiements récurrents fixes via helper canon
  // (même montant récurrent ≥ 3 mois, CV < 20 %, exclusion artisans/sociétés).
  // Aligné avec /finance/projection et le brief hebdo. CEO 2026-09-02.
  const recurringPaymentsAll = await detectRecurringPayments();
  const recurringActive = recurringPaymentsAll.filter(p => p.is_active);
  const recurringInactive = recurringPaymentsAll.filter(p => !p.is_active);

  // ─── Soldes bancaires courants ─────────────────────────────────────────
  const { data: balances } = await supabase
    .from('v_bank_account_current_balance')
    .select('*')
    .eq('is_active', true)
    .order('company_name');
  const totalBalance = ((balances ?? []) as any[]).reduce(
    (s, b) => s + Number(b.current_balance ?? 0),
    0
  );

  // ─── Totaux résumés ────────────────────────────────────────────────────
  const totalDebit3m = last3mTxs.reduce((s, t) => s + Number(t.debit_mad ?? 0), 0);
  const totalCredit3m = last3mTxs.reduce((s, t) => s + Number(t.credit_mad ?? 0), 0);
  const netFlow3m = totalCredit3m - totalDebit3m;
  const monthsForAvg = 3;

  // % alloué (info pour mettre en perspective)
  const { count: allocatedCount } = await supabase
    .from('bank_transaction_allocations')
    .select('id', { count: 'exact', head: true })
    .is('deleted_at', null);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <Link
          href="/finance/tresorerie"
          className="inline-flex items-center gap-2 text-sm text-stoniz-gray-500 hover:text-stoniz-black mb-2"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour à la trésorerie
        </Link>
        <PageHeader
          title="Synthèse cabinet"
          description="Vue P&L cabinet basée sur la catégorisation auto des relevés Chaabi · 3 derniers mois · ne nécessite pas d'allocations projet."
        />
      </div>

      {/* Bandeau pédagogique */}
      <div className="bg-emerald-50 border border-emerald-200 rounded-md p-4 text-sm text-emerald-900">
        <div className="flex items-start gap-3">
          <Wallet className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-medium mb-1">
              Cette synthèse est utilisable <strong>tout de suite</strong>, sans avoir alloué une seule transaction à un projet.
            </div>
            <div className="text-xs text-emerald-800">
              Elle s'appuie sur la <strong>catégorisation auto</strong> que ton catégoriseur Chaabi applique à l'import.
              Pour les <strong>marges réelles par projet</strong> (reste à payer artisan X sur projet Y, marge réelle vs cible), tu auras besoin de compléter les allocations dans <Link className="underline" href="/finance/tresorerie/reconciliation">Rapprochement banque</Link> — c'est le travail que tu peux déléguer à un assistant plus tard.
              {' '}
              <strong>{allocatedCount ?? 0}</strong> allocations actuellement.
            </div>
          </div>
        </div>
      </div>

      {/* KPI résumés 3 derniers mois */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <Wallet className="w-4 h-4 text-stoniz-gray-500" />
            <div className="text-xs uppercase text-stoniz-gray-500">Solde groupe</div>
          </div>
          <div className="text-2xl font-display">{fmtMadCompact(totalBalance)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">Tous comptes actifs</div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="w-4 h-4 text-emerald-700" />
            <div className="text-xs uppercase text-stoniz-gray-500">Entrées 3 mois</div>
          </div>
          <div className="text-2xl font-display text-emerald-700">{fmtMadCompact(totalCredit3m)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">
            ≈ {fmtMadCompact(totalCredit3m / monthsForAvg)} / mois
          </div>
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-1">
            <TrendingDown className="w-4 h-4 text-red-700" />
            <div className="text-xs uppercase text-stoniz-gray-500">Sorties 3 mois</div>
          </div>
          <div className="text-2xl font-display text-red-700">{fmtMadCompact(totalDebit3m)}</div>
          <div className="text-xs text-stoniz-gray-500 mt-1">
            ≈ {fmtMadCompact(totalDebit3m / monthsForAvg)} / mois
          </div>
        </Card>
        <Card>
          <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Cashflow net 3 mois</div>
          <div className={`text-2xl font-display ${netFlow3m >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
            {netFlow3m >= 0 ? '+ ' : '− '}
            {fmtMadCompact(Math.abs(netFlow3m))}
          </div>
          <div className="text-xs text-stoniz-gray-500 mt-1">Crédit − Débit</div>
        </Card>
      </div>

      {/* Cashflow mensuel 12 mois — bar chart CSS */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-display">Cashflow mensuel — 12 derniers mois</h2>
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Entrées vs sorties bancaires. Permet de repérer les mois anormaux (gros décaissement, encaissement client important).
            </p>
          </div>
          <div className="flex gap-3 text-xs">
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-emerald-600 rounded-sm" /> Entrées</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 bg-red-600 rounded-sm" /> Sorties</span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[700px]">
            <div className="flex items-end gap-2 h-48">
              {monthKeys.map((key) => {
                const m = monthlyFlow[key];
                const hCredit = (m.credit / maxFlow) * 100;
                const hDebit = (m.debit / maxFlow) * 100;
                return (
                  <div key={key} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                    <div className="flex w-full gap-0.5 items-end h-full">
                      <div
                        className="flex-1 bg-emerald-600 rounded-t"
                        style={{ height: `${hCredit}%`, minHeight: m.credit > 0 ? '2px' : '0' }}
                        title={`${monthLabel(key)} entrées : ${fmtMad(m.credit)}`}
                      />
                      <div
                        className="flex-1 bg-red-600 rounded-t"
                        style={{ height: `${hDebit}%`, minHeight: m.debit > 0 ? '2px' : '0' }}
                        title={`${monthLabel(key)} sorties : ${fmtMad(m.debit)}`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2 mt-2">
              {monthKeys.map((key) => (
                <div key={key} className="flex-1 text-center text-[10px] text-stoniz-gray-500">
                  {monthLabel(key)}
                </div>
              ))}
            </div>
            {/* Ligne net mensuel */}
            <div className="mt-4 flex gap-2 text-[10px] text-center">
              {monthKeys.map((key) => {
                const net = monthlyFlow[key].net;
                return (
                  <div
                    key={key}
                    className={`flex-1 font-mono ${net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}
                  >
                    {net >= 0 ? '+' : '−'}{Math.round(Math.abs(net) / 1000)}k
                  </div>
                );
              })}
            </div>
            <div className="text-[10px] text-center text-stoniz-gray-500 mt-1">
              ↑ Net mensuel (k MAD)
            </div>
          </div>
        </div>
      </Card>

      {/* Charges cabinet identifiées 3 derniers mois */}
      <Card>
        <div className="mb-3">
          <h2 className="text-lg font-display">Charges cabinet identifiées</h2>
          <p className="text-xs text-stoniz-gray-500 mt-1">
            Catégorisées automatiquement par le catégoriseur Chaabi · 3 derniers mois
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(cabinetByCategory)
            .filter(([, total]) => total > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, total]) => (
              <div key={cat} className="flex items-center justify-between border border-stoniz-gray-200 rounded p-3">
                <div>
                  <div className="text-sm font-medium">
                    {(CATEGORY_LABELS as any)[cat] ?? cat.replace(/_/g, ' ')}
                  </div>
                  <div className="text-xs text-stoniz-gray-500">
                    ≈ {fmtMadCompact(total / monthsForAvg)} / mois
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-lg font-display">{fmtMadCompact(total)}</div>
                  <div className="text-xs text-stoniz-gray-500">3 mois</div>
                </div>
              </div>
            ))}
        </div>
        {Object.values(cabinetByCategory).every((v) => v === 0) && (
          <div className="text-center py-6 text-sm text-stoniz-gray-500">
            <AlertCircle className="w-8 h-8 mx-auto mb-2 text-stoniz-gray-400" />
            Aucune charge cabinet détectée auto sur les 3 derniers mois.
            Vérifie tes imports bancaires ou enrichis ton catégoriseur.
          </div>
        )}
      </Card>

      {/* Salariés & prestataires récurrents (détection stricte : montant fixe ≥ 3 mois) */}
      {recurringPaymentsAll.length > 0 && (() => {
        // Total "récurrent projection" exclut prestataires (ponctuels) et ignorés
        const RECURRING_FOR_TOTAL: string[] = ['salaire', 'loyer', 'abonnement', 'autre'];
        const activeForTotal = recurringActive.filter(p => RECURRING_FOR_TOTAL.includes(p.type));
        const totalActive = activeForTotal.reduce((s, p) => s + p.amount_per_month, 0);
        const byType = { salaire: 0, prestataire: 0, loyer: 0, abonnement: 0, autre: 0, ignore: 0 } as Record<string, number>;
        // La ventilation par type liste tout (prestataire compris) pour info,
        // mais seuls salaire/loyer/abonnement/autre feront le total projeté.
        for (const p of recurringActive) byType[p.type] += p.amount_per_month;
        const TYPE_LABELS: Record<string, string> = {
          salaire: 'Masse salariale', prestataire: 'Prestataires', loyer: 'Loyers',
          abonnement: 'Abonnements', autre: 'Autres', ignore: 'Ignorés',
        };
        const TYPE_COLORS: Record<string, string> = {
          salaire: 'text-blue-700', prestataire: 'text-purple-700', loyer: 'text-amber-700',
          abonnement: 'text-cyan-700', autre: 'text-stoniz-gray-700',
        };
        return (
          <Card>
            <div className="mb-3 flex items-center justify-between flex-wrap gap-2">
              <div>
                <h2 className="text-lg font-display">Salariés & paiements récurrents</h2>
                <p className="text-xs text-stoniz-gray-500 mt-1">
                  Détection : bénéficiaire payé au même montant (±20 %) sur ≥ 3 mois.
                  <br />
                  <strong>Total projeté</strong> = salaires + loyers + abonnements + autres.
                  Les <strong>prestataires</strong> (missions ponctuelles) et <strong>ignore</strong> sont exclus du total car ce ne sont pas des charges cabinet fixes.
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs uppercase text-stoniz-gray-500">Total récurrent projeté</div>
                <div className="text-2xl font-display">{fmtMad(totalActive)}/mois</div>
                <div className="text-[10px] text-stoniz-gray-400">hors prestataires & ignorés</div>
              </div>
            </div>

            {/* Ventilation par type (uniquement types avec montant > 0) */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
              {(['salaire', 'prestataire', 'loyer', 'abonnement', 'autre'] as const)
                .filter(t => byType[t] > 0)
                .map(t => (
                <div key={t} className="border rounded px-3 py-2">
                  <div className="text-[10px] uppercase text-stoniz-gray-500">{TYPE_LABELS[t]}</div>
                  <div className={`text-base font-display ${TYPE_COLORS[t]}`}>{fmtMad(byType[t])}/mois</div>
                </div>
              ))}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Bénéficiaire</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Statut</th>
                    <th className="text-right py-2 px-2">Montant/mois</th>
                    <th className="text-right py-2 px-2">Nb mois</th>
                    <th className="text-left py-2 px-2">Mois actifs</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...recurringActive, ...recurringInactive].map(p => {
                    const inTotal = ['salaire', 'loyer', 'abonnement', 'autre'].includes(p.type) && p.is_active;
                    return (
                    <tr key={p.beneficiary} className={
                      p.type === 'ignore' ? 'opacity-40 hover:bg-stoniz-gray-50' :
                      !p.is_active ? 'opacity-60 hover:bg-stoniz-gray-50' :
                      p.type === 'prestataire' ? 'opacity-70 hover:bg-stoniz-gray-50' :
                      'hover:bg-stoniz-gray-50'
                    }>
                      <td className="py-1.5 px-2 font-medium">{p.beneficiary}</td>
                      <td className="py-1.5 px-2">
                        <RecurringTypeSelect
                          beneficiary={p.beneficiary}
                          current={p.type}
                          canWrite={canWrite}
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        {p.is_active ? (
                          <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-green-100 text-green-800">Actif</span>
                        ) : (
                          <span className="inline-block text-xs px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-600">Inactif</span>
                        )}
                      </td>
                      <td className="text-right py-1.5 px-2 font-mono">
                        {fmtMad(p.amount_per_month)}
                        {!inTotal && (
                          <div className="text-[10px] text-stoniz-gray-400 italic">hors total projeté</div>
                        )}
                      </td>
                      <td className="text-right py-1.5 px-2">{p.nb_mois}</td>
                      <td className="py-1.5 px-2 text-xs text-stoniz-gray-500">{p.months_active.join(' · ')}</td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })()}

      {/* Top bénéficiaires sortants & entrants */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="mb-3">
            <h2 className="text-base font-display">Top 15 sorties (3 derniers mois)</h2>
            <p className="text-xs text-stoniz-gray-500">Qui je paye le plus</p>
          </div>
          <div className="space-y-1">
            {topDebit.map((r, i) => {
              const maxTop = topDebit[0]?.total ?? 1;
              const pct = (r.total / maxTop) * 100;
              return (
                <div key={r.name} className="text-xs">
                  <div className="flex justify-between mb-0.5">
                    <span className="truncate flex-1 mr-2" title={r.name}>
                      <span className="text-stoniz-gray-400 mr-1">{i + 1}.</span>
                      {r.name}
                      <span className="text-stoniz-gray-400 ml-1">({r.count}×)</span>
                    </span>
                    <span className="font-mono text-red-700">{fmtMadCompact(r.total)}</span>
                  </div>
                  <div className="h-1 bg-stoniz-gray-100 rounded">
                    <div className="h-full bg-red-600 rounded" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {topDebit.length === 0 && (
              <div className="text-sm text-stoniz-gray-500 text-center py-6">
                Aucune sortie bancaire détectée sur 3 mois.
              </div>
            )}
          </div>
        </Card>

        <Card>
          <div className="mb-3">
            <h2 className="text-base font-display">Top 15 entrées (3 derniers mois)</h2>
            <p className="text-xs text-stoniz-gray-500">Qui me paye le plus (clients, intercompany…)</p>
          </div>
          <div className="space-y-1">
            {topCredit.map((r, i) => {
              const maxTop = topCredit[0]?.total ?? 1;
              const pct = (r.total / maxTop) * 100;
              return (
                <div key={r.name} className="text-xs">
                  <div className="flex justify-between mb-0.5">
                    <span className="truncate flex-1 mr-2" title={r.name}>
                      <span className="text-stoniz-gray-400 mr-1">{i + 1}.</span>
                      {r.name}
                      <span className="text-stoniz-gray-400 ml-1">({r.count}×)</span>
                    </span>
                    <span className="font-mono text-emerald-700">{fmtMadCompact(r.total)}</span>
                  </div>
                  <div className="h-1 bg-stoniz-gray-100 rounded">
                    <div className="h-full bg-emerald-600 rounded" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            {topCredit.length === 0 && (
              <div className="text-sm text-stoniz-gray-500 text-center py-6">
                Aucune entrée bancaire détectée sur 3 mois.
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Note finale */}
      <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-4 text-xs text-stoniz-gray-700">
        <strong>Comment lire cette page :</strong> tous les chiffres sont calculés directement depuis tes relevés Chaabi importés,
        avec la catégorisation auto. Pas besoin d'avoir alloué les transactions à des projets pour les voir ici.
        Si certaines lignes ne sont pas bien catégorisées (catégorie "Autre / À qualifier"), elles passent dans le tableau
        sans être agrégées par poste — c'est ce que tu peux faire améliorer par un assistant en complétant les allocations.
      </div>
    </div>
  );
}
