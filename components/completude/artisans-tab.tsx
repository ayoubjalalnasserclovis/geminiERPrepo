import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import {
  computeArtisansCompletude,
  type ArtisanCompletudeMode,
} from '@/lib/completude/artisans-completude';
import { formatBusinessScope } from '@/lib/artisans/specialities';

/**
 * Tab "Artisans" de /admin/completude. Deux modes :
 *   - 'strict'   : reproduit /artisans/incomplets (4 critères bloquants).
 *   - 'weighted' : score 0-100 pondéré (défaut).
 *
 * URL state :
 *   ?tab=artisans&mode=strict|weighted&scope=travaux|deco|both|all
 */

type Scope = 'travaux' | 'deco' | 'both' | 'all';

export type ArtisansTabSearchParams = {
  mode?: ArtisanCompletudeMode;
  scope?: Scope;
};

function isMode(v: string | undefined): v is ArtisanCompletudeMode {
  return v === 'strict' || v === 'weighted';
}
function isScope(v: string | undefined): v is Scope {
  return v === 'travaux' || v === 'deco' || v === 'both' || v === 'all';
}

export async function ArtisansTab({
  searchParams,
  buildHref,
}: {
  searchParams: ArtisansTabSearchParams;
  buildHref: (patch: Record<string, string | undefined>) => string;
}) {
  const mode: ArtisanCompletudeMode = isMode(searchParams.mode) ? searchParams.mode : 'weighted';
  const scope: Scope = isScope(searchParams.scope) ? searchParams.scope : 'all';

  const { rows, stats } = await computeArtisansCompletude({
    mode,
    businessScope: scope,
  });

  // Tri : criticality croissante puis score croissant (déjà fait dans le helper,
  // mais on re-trie défensivement en cas de mode strict).
  const order = { red: 0, orange: 1, gray: 2, green: 3 } as const;
  const sorted = [...rows].sort((a, b) => {
    if (mode === 'strict') {
      // Strict : bloqués d'abord (par nb de raisons décroissant)
      const aBlocked = a.scoreStrict === 'blocked' ? 0 : 1;
      const bBlocked = b.scoreStrict === 'blocked' ? 0 : 1;
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      return b.blockedReasons.length - a.blockedReasons.length;
    }
    if (order[a.criticality] !== order[b.criticality]) {
      return order[a.criticality] - order[b.criticality];
    }
    return a.scoreWeighted - b.scoreWeighted;
  });

  // Mode strict : on n'affiche que les bloqués
  const displayed = mode === 'strict'
    ? sorted.filter(r => r.scoreStrict === 'blocked')
    : sorted;

  // Top raisons bloquantes (mode strict)
  const blockedReasonsAgg = new Map<string, number>();
  for (const r of rows) {
    if (r.scoreStrict !== 'blocked') continue;
    for (const reason of r.blockedReasons) {
      blockedReasonsAgg.set(reason, (blockedReasonsAgg.get(reason) ?? 0) + 1);
    }
  }
  const topBlockedReasons = Array.from(blockedReasonsAgg.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  return (
    <>
      <div className="mb-5">
        <p className="text-sm text-stoniz-gray-600 max-w-3xl">
          Mode <strong>{mode === 'strict' ? 'strict' : 'pondéré'}</strong> —{' '}
          {mode === 'strict'
            ? 'reproduit /artisans/incomplets : 4 critères bloquants pour la validation des paiements (banque + RIB + attestation RIB + attestation de régularité fiscale fraîche).'
            : 'score 0-100 pondéré sur l\'ensemble des champs de la fiche (bloquant 15, important 10, mineur 5).'}
        </p>
      </div>

      {/* Toggle mode + filtre scope */}
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <div className="inline-flex border border-stoniz-gray-300 rounded overflow-hidden">
          <Link
            href={buildHref({ mode: 'weighted' })}
            className={`text-xs px-3 py-1.5 ${
              mode === 'weighted'
                ? 'bg-stoniz-black text-white'
                : 'bg-white text-stoniz-gray-700 hover:bg-stoniz-beige'
            }`}
          >
            Mode pondéré
          </Link>
          <Link
            href={buildHref({ mode: 'strict' })}
            className={`text-xs px-3 py-1.5 border-l border-stoniz-gray-300 ${
              mode === 'strict'
                ? 'bg-stoniz-black text-white'
                : 'bg-white text-stoniz-gray-700 hover:bg-stoniz-beige'
            }`}
          >
            Mode strict
          </Link>
        </div>

        <div className="ml-2 h-5 w-px bg-stoniz-gray-300" aria-hidden />

        <span className="text-xs text-stoniz-gray-500">Périmètre :</span>
        {([
          { v: 'all', label: 'Tous' },
          { v: 'travaux', label: 'Travaux' },
          { v: 'deco', label: 'Déco' },
          { v: 'both', label: 'Both' },
        ] as const).map(opt => (
          <Link
            key={opt.v}
            href={buildHref({ scope: opt.v === 'all' ? undefined : opt.v })}
            className={`text-xs px-3 py-1 rounded-full border transition ${
              scope === opt.v
                ? 'bg-stoniz-black text-white border-stoniz-black'
                : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {/* En-tête stats */}
      {mode === 'strict' ? (
        <div className="grid md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
            <div className="text-xs text-stoniz-gray-500 uppercase">Bloqués paiement</div>
            <div className="text-3xl font-display mt-1 text-red-700">{stats.blockedStrict}</div>
            <div className="text-xs text-stoniz-gray-500 mt-1">
              sur {stats.total} artisan{stats.total > 1 ? 's' : ''} actif{stats.total > 1 ? 's' : ''}
            </div>
          </div>
          <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
            <div className="text-xs text-stoniz-gray-500 uppercase mb-2">Top raisons bloquantes</div>
            {topBlockedReasons.length === 0 ? (
              <div className="text-sm text-emerald-700">Aucun blocage actif</div>
            ) : (
              <ul className="text-sm space-y-1">
                {topBlockedReasons.map(b => (
                  <li key={b.label} className="flex items-center justify-between gap-2">
                    <span className="text-stoniz-gray-700">{b.label}</span>
                    <span className="font-mono text-stoniz-gray-500 shrink-0">{b.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
              <div className="text-xs text-stoniz-gray-500 uppercase">Artisans actifs</div>
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
        </>
      )}

      <div className="text-xs text-stoniz-gray-500 mb-3">
        {displayed.length} artisan{displayed.length > 1 ? 's' : ''} affiché{displayed.length > 1 ? 's' : ''}
        {displayed.length !== stats.total ? ` (sur ${stats.total})` : ''}
      </div>

      {/* Tableau */}
      {displayed.length === 0 ? (
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-8 text-center text-sm text-stoniz-gray-500">
          {mode === 'strict'
            ? '🎉 Aucun artisan bloqué — toutes les fiches sont prêtes pour les paiements.'
            : 'Aucun artisan ne correspond à ces filtres.'}
        </div>
      ) : (
        <div className="bg-white border border-stoniz-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stoniz-beige text-stoniz-gray-600 text-xs uppercase tracking-wider">
                <tr>
                  <th className="text-left px-3 py-2">Nom</th>
                  <th className="text-left px-3 py-2">Périmètre</th>
                  {mode === 'strict' ? (
                    <th className="text-left px-3 py-2">Raisons bloquantes</th>
                  ) : (
                    <>
                      <th className="text-left px-3 py-2 w-56">Score</th>
                      <th className="text-left px-3 py-2">Top manque</th>
                    </>
                  )}
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
                        <Link href={`/artisans/${r.id}`} className="text-stoniz-black hover:underline">
                          {r.name}
                        </Link>
                        {r.isIndep && (
                          <span className="ml-2 text-[10px] uppercase tracking-wider text-stoniz-gray-500 bg-stoniz-gray-100 px-1.5 py-0.5 rounded">
                            indép.
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-stoniz-gray-700">
                        {formatBusinessScope(r.businessScope)}
                      </td>
                      {mode === 'strict' ? (
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-1.5">
                            {r.blockedReasons.map(reason => (
                              <span
                                key={reason}
                                className="inline-flex items-center gap-1 text-xs bg-red-50 text-red-900 border border-red-200 rounded-full px-2 py-0.5"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                {reason}
                              </span>
                            ))}
                          </div>
                        </td>
                      ) : (
                        <>
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
                        </>
                      )}
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/artisans/${r.id}`}
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
