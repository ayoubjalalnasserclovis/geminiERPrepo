import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { Wallet, TrendingUp, TrendingDown, CalendarClock, ArrowLeft, AlertTriangle } from 'lucide-react';
import { collectProjectionMensuelle, type MonthBucket, type FlowLine } from '@/lib/finance/projection-mensuelle';
import { FlowLineMonthInput } from '@/components/finance/flow-line-month-input';

/**
 * Sous-page projection cashflow — vue mois par mois (CEO 2026-08-17d).
 *
 * Complète la page /finance/projection (fenêtres 30/60/90j). Ici on ventile
 * sur 12 mois glissants avec 3 colonnes : encaissements | décaissements |
 * solde cumulé. Chaque ligne est éditable (input mois) pour simuler.
 *
 * Sources :
 *   - Encaissements = honoraires Stoniz (via forecast_month) + travaux/achats
 *     encaissements planifiés. Toggle "Inclure honoraires" (URL param).
 *   - Décaissements = travaux/achats/services payments planifiés + charges
 *     récurrentes moyennes (DGI, CNSS, Telecom, banque sur 3 derniers mois).
 *
 * Devise : tout en MAD. Les honoraires stockés en EUR sont convertis au
 * taux fixe 1 EUR = 10 MAD.
 */

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  return sign + new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.abs(n)) + ' MAD';
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
}

const KIND_LABEL: Record<string, string> = {
  honoraires_stoniz: 'Honoraires',
  travaux_encaissement: 'Enc. travaux',
  achats_encaissement: 'Enc. achats',
  travaux_payment: 'Artisan',
  achats_payment: 'Fournisseur',
  services_payment: 'Service',
  recurring: 'Récurrent',
};

const KIND_COLOR: Record<string, string> = {
  honoraires_stoniz: 'bg-emerald-50 text-emerald-800',
  travaux_encaissement: 'bg-emerald-50 text-emerald-800',
  achats_encaissement: 'bg-emerald-50 text-emerald-800',
  travaux_payment: 'bg-red-50 text-red-800',
  achats_payment: 'bg-red-50 text-red-800',
  services_payment: 'bg-red-50 text-red-800',
  recurring: 'bg-stoniz-gray-100 text-stoniz-gray-700',
};

export default async function ProjectionMensuellePage({
  searchParams,
}: {
  searchParams?: { with_honoraires?: string };
}) {
  await requireRole(['ceo', 'finance', 'developer']);
  const includeHonoraires = searchParams?.with_honoraires !== '0';
  const data = await collectProjectionMensuelle({ includeHonoraires });

  return (
    <div className="max-w-[1600px]">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
            <Link href="/finance/projection" className="hover:text-stoniz-black inline-flex items-center gap-1">
              <ArrowLeft className="w-3 h-3" />
              Projection 30/60/90j
            </Link>
            <span>·</span>
            <span>Mois par mois</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Projection mensuelle</h1>
          <p className="text-sm text-stoniz-gray-600 mt-1 max-w-3xl">
            Cashflow prévisionnel sur 12 mois. Chaque ligne est modifiable : clique
            le mois d'un encaissement ou d'un décaissement pour simuler. Les honoraires
            Stoniz sont convertis en MAD au taux 1 € = 10 MAD.
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {/* Toggle honoraires */}
          <div className="flex items-center gap-2 text-xs">
            <Link
              href="/finance/projection/mensuelle"
              className={`px-3 py-1.5 rounded-md border ${includeHonoraires ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white border-stoniz-gray-300 hover:bg-stoniz-gray-50'}`}
            >
              Inclure honoraires
            </Link>
            <Link
              href="/finance/projection/mensuelle?with_honoraires=0"
              className={`px-3 py-1.5 rounded-md border ${!includeHonoraires ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white border-stoniz-gray-300 hover:bg-stoniz-gray-50'}`}
            >
              Sans honoraires
            </Link>
          </div>
        </div>
      </div>

      {/* Solde de départ + KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-stoniz-black rounded-lg p-4">
          <Wallet className="w-4 h-4 text-white/80 mb-2" />
          <div className="text-2xl font-display !text-white">{fmtMad(data.starting_balance)}</div>
          <div className="text-xs text-white/80">Solde de départ (au {data.starting_balance_date})</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <TrendingUp className="w-4 h-4 text-emerald-700 mb-2" />
          <div className="text-2xl font-display !text-emerald-900">{fmtMad(data.totals.grand_total_in)}</div>
          <div className="text-xs text-emerald-700">Encaissements 12 mois</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <TrendingDown className="w-4 h-4 text-red-700 mb-2" />
          <div className="text-2xl font-display !text-red-900">{fmtMad(data.totals.grand_total_out)}</div>
          <div className="text-xs text-red-700">Décaissements 12 mois</div>
        </div>
        <div className={`rounded-lg p-4 ${data.totals.ending_balance >= 0 ? 'bg-emerald-900' : 'bg-red-900'}`}>
          <Wallet className="w-4 h-4 text-white/80 mb-2" />
          <div className="text-2xl font-display !text-white">{fmtMad(data.totals.ending_balance)}</div>
          <div className="text-xs text-white/80">Solde fin de période</div>
        </div>
      </div>

      {/* Alerte lignes sans date */}
      {(data.undated.inflows.length > 0 || data.undated.outflows.length > 0) && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>Lignes sans date prévue exclues des mois :</strong>{' '}
            {data.undated.inflows.length > 0 && (
              <>+{fmtMad(data.undated.total_in)} en encaissements ({data.undated.inflows.length} lignes)</>
            )}
            {data.undated.inflows.length > 0 && data.undated.outflows.length > 0 && ' · '}
            {data.undated.outflows.length > 0 && (
              <>-{fmtMad(data.undated.total_out)} en décaissements ({data.undated.outflows.length} lignes)</>
            )}
            . Saisis un mois pour les faire apparaître dans la projection.
          </div>
        </div>
      )}

      {/* Tableau mois par mois */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 w-[100px]">Mois</th>
                <th className="text-left px-3 py-2">Encaissements</th>
                <th className="text-left px-3 py-2">Décaissements</th>
                <th className="text-right px-3 py-2 w-[140px] bg-stoniz-gray-100">Solde fin de mois</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {data.months.map((m) => (
                <MonthRow key={m.month} bucket={m} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-stoniz-gray-500 mt-4">
        💡 <strong>Comment on calcule :</strong> le solde de départ vient du dernier
        snapshot bancaire consolidé (tous comptes actifs). Chaque mois on ajoute les
        encaissements attendus et on soustrait les décaissements planifiés + charges
        récurrentes (moyenne 3 derniers mois : DGI, CNSS, Telecom, banque). Un mois où
        le solde devient négatif est un point de tension à anticiper.
      </p>
    </div>
  );
}

// ─── Ligne mois avec 3 colonnes ────────────────────────────────────────────

function MonthRow({ bucket }: { bucket: MonthBucket }) {
  const soldeClass = bucket.ending_balance < 0
    ? 'text-red-800 font-semibold'
    : 'text-stoniz-black font-semibold';

  return (
    <tr className="align-top hover:bg-stoniz-gray-50">
      <td className="px-3 py-3 text-xs font-medium bg-stoniz-gray-50 sticky left-0">
        <div>{fmtMonth(bucket.month)}</div>
        <div className={`text-[10px] mt-1 ${bucket.net >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
          net {bucket.net >= 0 ? '+' : ''}{fmtMad(bucket.net)}
        </div>
      </td>
      <td className="px-3 py-3">
        <FlowList lines={bucket.inflows} total={bucket.total_in} accent="emerald" />
      </td>
      <td className="px-3 py-3">
        <FlowList lines={bucket.outflows} total={bucket.total_out} accent="red" />
      </td>
      <td className={`px-3 py-3 text-right ${soldeClass} bg-stoniz-gray-50`}>
        {fmtMad(bucket.ending_balance)}
      </td>
    </tr>
  );
}

function FlowList({
  lines, total, accent,
}: {
  lines: FlowLine[];
  total: number;
  accent: 'emerald' | 'red';
}) {
  const totalColor = accent === 'emerald' ? 'text-emerald-700' : 'text-red-700';
  if (lines.length === 0) {
    return <div className="text-xs text-stoniz-gray-400 italic">—</div>;
  }
  return (
    <div className="space-y-1.5">
      <div className={`text-xs font-medium ${totalColor}`}>
        {accent === 'emerald' ? '+' : '-'}{fmtMad(total)} <span className="text-stoniz-gray-500">({lines.length})</span>
      </div>
      <ul className="space-y-1">
        {lines.map((l) => (
          <li key={l.id_ref} className="flex items-center gap-2 text-[11px]">
            <span className={`inline-block text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded ${KIND_COLOR[l.kind]}`}>
              {KIND_LABEL[l.kind]}
            </span>
            <span className="flex-1 truncate text-stoniz-gray-700" title={l.label}>{l.label}</span>
            <span className="font-mono text-stoniz-gray-800 tabular-nums">{fmtMad(l.amount_mad)}</span>
            <FlowLineMonthInput
              idRef={l.id_ref}
              initialMonth={l.month || null}
              disabled={l.kind === 'recurring'}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
