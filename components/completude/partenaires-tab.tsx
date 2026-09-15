import Link from 'next/link';
import { AlertOctagon } from 'lucide-react';
import {
  computePartnersCompletude,
  type PartnerType,
} from '@/lib/completude/partenaires-completude';

/**
 * Tab "Partenaires" de /admin/completude. Mode pondéré uniquement
 * (cf brief CEO — pas de bloquant paiement comme pour les artisans).
 *
 * URL state :
 *   ?tab=partenaires&partnerType=agence|particulier|notaire|avocat|autre|none|all
 *
 * Bandeau spécial "X sans type" affiché si stats.withoutPartnerType > 0,
 * sauf si on est déjà en train de filtrer sur "none" (déjà ciblé).
 */

const PARTNER_TYPE_LABELS: Record<PartnerType, string> = {
  agence: 'Agence',
  particulier: 'Particulier',
  notaire: 'Notaire',
  avocat: 'Avocat',
  autre: 'Autre',
};

const PARTNER_TYPE_BADGE: Record<PartnerType, string> = {
  agence: 'bg-blue-50 text-blue-800 border-blue-200',
  particulier: 'bg-purple-50 text-purple-800 border-purple-200',
  notaire: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  avocat: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  autre: 'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-200',
};

type FilterValue = PartnerType | 'all' | 'none';

function isPartnerType(v: string | undefined): v is PartnerType {
  return v === 'agence' || v === 'particulier' || v === 'notaire'
    || v === 'avocat' || v === 'autre';
}

export type PartenairesTabSearchParams = {
  partnerType?: string;
};

export async function PartenairesTab({
  searchParams,
  buildHref,
}: {
  searchParams: PartenairesTabSearchParams;
  buildHref: (patch: Record<string, string | undefined>) => string;
}) {
  const filterRaw = searchParams.partnerType;
  const filter: FilterValue =
    filterRaw === 'none' ? 'none'
    : isPartnerType(filterRaw) ? filterRaw
    : 'all';

  // On charge TOUS les partenaires (le helper supporte un filtre côté requête
  // mais on a besoin des stats globales pour les compteurs onglets). On filtre
  // côté affichage si nécessaire.
  const { rows, stats } = await computePartnersCompletude({ partnerType: 'all' });

  let displayed = rows;
  if (filter === 'none') {
    displayed = rows.filter(r => r.partnerType === null);
  } else if (filter !== 'all') {
    displayed = rows.filter(r => r.partnerType === filter);
  }

  // Re-tri défensif : criticité, puis score croissant.
  const order = { red: 0, orange: 1, gray: 2, green: 3 } as const;
  displayed = [...displayed].sort((a, b) => {
    if (order[a.criticality] !== order[b.criticality]) {
      return order[a.criticality] - order[b.criticality];
    }
    return a.scoreWeighted - b.scoreWeighted;
  });

  // Comptage par type pour les chips
  const countByType = new Map<PartnerType | 'none', number>();
  for (const r of rows) {
    const k = r.partnerType ?? 'none';
    countByType.set(k, (countByType.get(k) ?? 0) + 1);
  }

  return (
    <>
      <div className="mb-5">
        <p className="text-sm text-stoniz-gray-600 max-w-3xl">
          Score 0-100 pondéré sur les 16 champs canon des fiches partenaires
          (bloquant 15, important 10, mineur 5). Périmètre : tous les partenaires
          non supprimés, tous statuts confondus.
        </p>
      </div>

      {/* Bandeau spécial "sans type" */}
      {stats.withoutPartnerType > 0 && filter !== 'none' && (
        <div className="bg-red-50 border-l-4 border-red-500 rounded-r-lg p-4 mb-6 flex items-start gap-3">
          <AlertOctagon className="w-5 h-5 text-red-700 shrink-0 mt-0.5" aria-hidden />
          <div className="flex-1">
            <div className="text-sm font-medium text-red-900">
              {stats.withoutPartnerType} partenaire{stats.withoutPartnerType > 1 ? 's' : ''} sans type — à classer en priorité
            </div>
            <div className="text-xs text-red-800 mt-1">
              Le type partenaire (agence / particulier / notaire / avocat / autre) conditionne
              les champs applicables (ICE, RC, quartiers...). C&apos;est le manque n°1 au launch.
            </div>
          </div>
          <Link
            href={buildHref({ partnerType: 'none' })}
            className="text-xs bg-red-600 text-white px-3 py-1.5 rounded hover:bg-red-700 whitespace-nowrap"
          >
            Voir la liste →
          </Link>
        </div>
      )}

      {/* En-tête stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Partenaires</div>
          <div className="text-2xl font-display mt-1">{stats.total}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Score moyen</div>
          <div className={`text-2xl font-display mt-1 ${
            stats.avgScoreWeighted < 50 ? 'text-red-700'
            : stats.avgScoreWeighted < 75 ? 'text-amber-700'
            : stats.avgScoreWeighted < 90 ? 'text-stoniz-gray-700'
            : 'text-emerald-700'
          }`}>
            {stats.avgScoreWeighted}%
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Rouge (&lt; 50%)</div>
          <div className="text-2xl font-display mt-1 text-red-700">{stats.red}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Orange (50-74%)</div>
          <div className="text-2xl font-display mt-1 text-amber-700">{stats.orange}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Gris/Vert (≥ 75%)</div>
          <div className="text-2xl font-display mt-1">
            <span className="text-stoniz-gray-700">{stats.gray}</span>
            <span className="text-stoniz-gray-400"> / </span>
            <span className="text-emerald-700">{stats.green}</span>
          </div>
        </div>
      </div>

      {stats.topMissingAggregated.length > 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4 mb-6">
          <h3 className="text-sm font-medium mb-3">Top 5 manques récurrents</h3>
          <ul className="text-sm space-y-1.5">
            {stats.topMissingAggregated.map(m => (
              <li key={m.label} className="flex items-start justify-between gap-2">
                <span className="text-stoniz-gray-700">{m.label}</span>
                <span className="text-stoniz-gray-500 font-mono shrink-0">{m.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Filtre par type */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <Link
          href={buildHref({ partnerType: undefined })}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            filter === 'all'
              ? 'bg-stoniz-black text-white border-stoniz-black'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
          }`}
        >
          Tous ({stats.total})
        </Link>
        {(['agence', 'particulier', 'notaire', 'avocat', 'autre'] as const).map(t => (
          <Link
            key={t}
            href={buildHref({ partnerType: t })}
            className={`text-xs px-3 py-1.5 rounded-full border transition ${
              filter === t
                ? 'bg-stoniz-black text-white border-stoniz-black'
                : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
            }`}
          >
            {PARTNER_TYPE_LABELS[t]} ({countByType.get(t) ?? 0})
          </Link>
        ))}
        <Link
          href={buildHref({ partnerType: 'none' })}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            filter === 'none'
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-white text-red-700 border-red-300 hover:border-red-600'
          }`}
        >
          Sans type ({stats.withoutPartnerType})
        </Link>
      </div>

      <div className="text-xs text-stoniz-gray-500 mb-3">
        {displayed.length} partenaire{displayed.length > 1 ? 's' : ''} affiché{displayed.length > 1 ? 's' : ''}
        {displayed.length !== stats.total ? ` (sur ${stats.total})` : ''}
      </div>

      {/* Tableau */}
      {displayed.length === 0 ? (
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-8 text-center text-sm text-stoniz-gray-500">
          Aucun partenaire ne correspond à ce filtre.
        </div>
      ) : (
        <div className="bg-white border border-stoniz-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stoniz-beige text-stoniz-gray-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2 w-56">Score</th>
                  <th className="text-left px-3 py-2">Top manque</th>
                  <th className="text-right px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {displayed.map(r => {
                  const barColor =
                    r.criticality === 'red' ? 'bg-red-500'
                    : r.criticality === 'orange' ? 'bg-amber-500'
                    : r.criticality === 'gray' ? 'bg-stoniz-gray-400'
                    : 'bg-emerald-500';
                  return (
                    <tr key={r.id} className="border-t border-stoniz-gray-100 hover:bg-stoniz-beige/30">
                      <td className="px-3 py-2">
                        <Link href={`/partners/${r.id}`} className="text-stoniz-black hover:underline">
                          {r.name}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        {r.partnerType ? (
                          <span className={`text-xs px-2 py-0.5 rounded border ${PARTNER_TYPE_BADGE[r.partnerType]}`}>
                            {PARTNER_TYPE_LABELS[r.partnerType]}
                          </span>
                        ) : (
                          <span className="text-xs px-2 py-0.5 rounded border bg-red-50 text-red-800 border-red-200">
                            Sans type
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${barColor} shrink-0`} aria-hidden />
                          <div className="flex-1 bg-stoniz-gray-100 rounded-full h-2 min-w-[80px]">
                            <div
                              className={`h-2 rounded-full ${barColor}`}
                              style={{ width: `${r.scoreWeighted}%` }}
                            />
                          </div>
                          <span className="text-xs font-mono tabular-nums w-9 text-right">
                            {r.scoreWeighted}%
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-stoniz-gray-700 text-xs">{r.topMissing}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/partners/${r.id}`}
                          className="text-xs text-stoniz-black underline hover:no-underline"
                        >
                          Voir fiche
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
