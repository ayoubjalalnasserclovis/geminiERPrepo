import Link from 'next/link';
import {
  computeProjectCompleteness,
  topMissingItems,
  topChefsWithDebt,
  topPhasesWithDebt,
  REQUIREMENTS,
  PHASE_LABELS,
  type Phase,
} from '@/lib/completude/projets-completude';
import { CompletudeProjetsTable } from '@/components/admin/completude-projets-table';
import { CompletudeProjetsDetail } from '@/components/admin/completude-projets-detail';

/**
 * Tab "Projets" de /admin/completude. Extrait du canon initial
 * /admin/completude-projets (CEO 2026-06-19) sans changement de logique.
 *
 * NB : préserve `tab=projets` dans les liens internes (filtres / drill-down)
 * en construisant les URL via la closure `buildHref` du parent.
 */
export type ProjetsTabSearchParams = {
  criticality?: 'rouge' | 'orange' | 'vert';
  phase?: Phase;
  chef?: string;
  open?: string;
  historique?: '1';
};

export async function ProjetsTab({
  searchParams,
  buildHref,
}: {
  searchParams: ProjetsTabSearchParams;
  /** Construit une URL en préservant les params hors-tab (tab + autres) */
  buildHref: (patch: Record<string, string | undefined>) => string;
}) {
  const includeHistorical = searchParams.historique === '1';
  const rows = await computeProjectCompleteness(undefined, includeHistorical);
  const total = rows.length;

  const nRouge = rows.filter(r => r.criticality === 'rouge').length;
  const nOrange = rows.filter(r => r.criticality === 'orange').length;
  const nVert = rows.filter(r => r.criticality === 'vert').length;
  const avgScore = total > 0 ? Math.round(rows.reduce((s, r) => s + r.score, 0) / total) : 0;

  const topMiss = topMissingItems(rows, 5);
  const topChefs = topChefsWithDebt(rows, 5);
  const phaseStats = topPhasesWithDebt(rows);

  const chefs = Array.from(new Set(rows.map(r => r.chef_name).filter(Boolean) as string[])).sort();

  let filtered = rows;
  if (searchParams.criticality) filtered = filtered.filter(r => r.criticality === searchParams.criticality);
  if (searchParams.phase) filtered = filtered.filter(r => r.current_phase === searchParams.phase);
  if (searchParams.chef) filtered = filtered.filter(r => r.chef_name === searchParams.chef);

  const opened = searchParams.open ? rows.find(r => r.project_id === searchParams.open) ?? null : null;

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-6">
        <p className="text-sm text-stoniz-gray-600 max-w-3xl">
          Vue temps réel — recalculée à chaque ouverture. Tous les attendus manquants
          par phase sont signalés (V1 stricte). Périmètre par défaut : projets actifs/pause
          jusqu&apos;à la phase Livraison.{' '}
          {includeHistorical && (
            <span className="text-stoniz-gray-800 font-medium">
              Mode historique activé (inclut mise en location et terminés).
            </span>
          )}
        </p>
        <a
          href={buildHref({ historique: includeHistorical ? undefined : '1' })}
          className={`flex-shrink-0 text-xs px-3 py-1.5 rounded border whitespace-nowrap ${
            includeHistorical
              ? 'bg-stoniz-gray-800 text-white border-stoniz-gray-800 hover:bg-stoniz-gray-700'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-200 hover:bg-stoniz-beige'
          }`}
        >
          {includeHistorical ? '✓ Historique inclus' : 'Inclure l\'historique'}
        </a>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Projets in-scope</div>
          <div className="text-2xl font-display mt-1">{total}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Score moyen</div>
          <div className={`text-2xl font-display mt-1 ${avgScore < 50 ? 'text-red-700' : avgScore < 80 ? 'text-amber-700' : 'text-emerald-700'}`}>
            {avgScore}%
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Rouges (&lt; 50%)</div>
          <div className="text-2xl font-display mt-1 text-red-700">{nRouge}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Oranges (50-79%)</div>
          <div className="text-2xl font-display mt-1 text-amber-700">{nOrange}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Verts (≥ 80%)</div>
          <div className="text-2xl font-display mt-1 text-emerald-700">{nVert}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Top 5 manques récurrents</h3>
          <ul className="text-sm space-y-1.5">
            {topMiss.map(m => (
              <li key={m.key} className="flex items-start justify-between gap-2">
                <span className="text-stoniz-gray-700">{m.label}</span>
                <span className="text-stoniz-gray-500 font-mono shrink-0">{m.count}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Top chefs avec dette</h3>
          <ul className="text-sm space-y-1.5">
            {topChefs.map(c => (
              <li key={c.chef} className="flex items-start justify-between gap-2">
                <span className="text-stoniz-gray-700">{c.chef}</span>
                <span className="text-stoniz-gray-500 font-mono shrink-0">
                  {c.missingTotal} manques / {c.projectsCount} proj.
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-medium mb-3">Phases avec dette</h3>
          <ul className="text-sm space-y-1.5">
            {phaseStats.map(p => (
              <li key={p.phase} className="flex items-start justify-between gap-2">
                <span className="text-stoniz-gray-700">
                  {PHASE_LABELS[p.phase]} ({p.projectsCount})
                </span>
                <span className="text-stoniz-gray-500 font-mono shrink-0">
                  {p.missingTotal} m. · {p.avgScore}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        <Link
          href={buildHref({ criticality: undefined })}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            !searchParams.criticality
              ? 'bg-stoniz-black text-white border-stoniz-black'
              : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:border-stoniz-black'
          }`}
        >
          Tous ({total})
        </Link>
        <Link
          href={buildHref({ criticality: 'rouge' })}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            searchParams.criticality === 'rouge'
              ? 'bg-red-600 text-white border-red-600'
              : 'bg-white text-red-700 border-red-300 hover:border-red-600'
          }`}
        >
          Rouges ({nRouge})
        </Link>
        <Link
          href={buildHref({ criticality: 'orange' })}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            searchParams.criticality === 'orange'
              ? 'bg-amber-500 text-white border-amber-500'
              : 'bg-white text-amber-700 border-amber-300 hover:border-amber-500'
          }`}
        >
          Oranges ({nOrange})
        </Link>
        <Link
          href={buildHref({ criticality: 'vert' })}
          className={`text-xs px-3 py-1.5 rounded-full border transition ${
            searchParams.criticality === 'vert'
              ? 'bg-emerald-600 text-white border-emerald-600'
              : 'bg-white text-emerald-700 border-emerald-300 hover:border-emerald-600'
          }`}
        >
          Verts ({nVert})
        </Link>

        <div className="ml-2 h-5 w-px bg-stoniz-gray-300" aria-hidden />

        <form action="/admin/completude" method="get" className="flex gap-2 items-center">
          <input type="hidden" name="tab" value="projets" />
          {searchParams.criticality && (
            <input type="hidden" name="criticality" value={searchParams.criticality} />
          )}
          {includeHistorical && <input type="hidden" name="historique" value="1" />}
          <label className="text-xs text-stoniz-gray-500">Phase :</label>
          <select
            name="phase"
            defaultValue={searchParams.phase ?? ''}
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="">Toutes</option>
            {(['onboarding', 'sourcing', 'design', 'travaux', 'livraison'] as const).map(p => (
              <option key={p} value={p}>{PHASE_LABELS[p]}</option>
            ))}
          </select>
          <label className="text-xs text-stoniz-gray-500 ml-2">Chef :</label>
          <select
            name="chef"
            defaultValue={searchParams.chef ?? ''}
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 bg-white"
          >
            <option value="">Tous</option>
            {chefs.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <button
            type="submit"
            className="text-xs px-3 py-1 bg-stoniz-black text-white rounded hover:bg-stoniz-gray-800"
          >
            Appliquer
          </button>
          {(searchParams.phase || searchParams.chef) && (
            <Link
              href={buildHref({ phase: undefined, chef: undefined })}
              className="text-xs text-stoniz-gray-500 underline hover:text-stoniz-black"
            >
              Réinitialiser
            </Link>
          )}
        </form>
      </div>

      <div className="text-xs text-stoniz-gray-500 mb-3">
        {filtered.length} projet{filtered.length > 1 ? 's' : ''} affiché{filtered.length > 1 ? 's' : ''}
        {filtered.length !== total ? ` (sur ${total})` : ''}
      </div>

      <CompletudeProjetsTable rows={filtered} openId={searchParams.open ?? null} />

      {opened && (
        <div className="mt-6">
          <CompletudeProjetsDetail row={opened} closeHref={buildHref({ open: undefined })} />
        </div>
      )}

      <details className="mt-8 bg-white border border-stoniz-gray-200 rounded-lg p-4">
        <summary className="text-sm font-medium cursor-pointer">
          Référentiel utilisé ({REQUIREMENTS.length} attendus)
        </summary>
        <div className="overflow-x-auto mt-3">
          <table className="w-full text-xs">
            <thead className="text-stoniz-gray-500">
              <tr>
                <th className="text-left py-1 pr-3">Clé</th>
                <th className="text-left py-1 pr-3">Libellé</th>
                <th className="text-left py-1 pr-3">Phase min</th>
                <th className="text-left py-1 pr-3">Propriétaire</th>
                <th className="text-right py-1">Poids</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {REQUIREMENTS.map(r => (
                <tr key={r.key} className="border-t border-stoniz-gray-100">
                  <td className="py-1 pr-3 text-stoniz-gray-700">{r.key}</td>
                  <td className="py-1 pr-3 font-sans">{r.label}</td>
                  <td className="py-1 pr-3">{r.phase}</td>
                  <td className="py-1 pr-3">{r.owner}</td>
                  <td className="py-1 text-right">{r.weight}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
