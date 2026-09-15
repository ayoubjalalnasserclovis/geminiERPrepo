import Link from 'next/link';
import type { ProjectCompleteness } from '@/lib/completude/projets-completude';
import { PHASE_LABELS } from '@/lib/completude/projets-completude';

export function CompletudeProjetsTable({
  rows,
  openId,
}: {
  rows: ProjectCompleteness[];
  openId: string | null;
}) {
  if (rows.length === 0) {
    return (
      <div className="bg-white border border-stoniz-gray-200 rounded-lg p-8 text-center text-sm text-stoniz-gray-500">
        Aucun projet ne correspond à ces filtres.
      </div>
    );
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-lg overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-beige text-stoniz-gray-600 text-xs uppercase tracking-wider">
            <tr>
              <th className="text-left px-3 py-2">Référence</th>
              <th className="text-left px-3 py-2">Client</th>
              <th className="text-left px-3 py-2">Chef</th>
              <th className="text-left px-3 py-2">Phase</th>
              <th className="text-left px-3 py-2 w-48">Score</th>
              <th className="text-right px-3 py-2">Manques</th>
              <th className="text-right px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isOpen = r.project_id === openId;
              const barColor =
                r.criticality === 'rouge'
                  ? 'bg-red-500'
                  : r.criticality === 'orange'
                  ? 'bg-amber-500'
                  : 'bg-emerald-500';
              const dot =
                r.criticality === 'rouge'
                  ? 'bg-red-500'
                  : r.criticality === 'orange'
                  ? 'bg-amber-500'
                  : 'bg-emerald-500';
              return (
                <tr
                  key={r.project_id}
                  className={`border-t border-stoniz-gray-100 hover:bg-stoniz-beige/30 ${
                    isOpen ? 'bg-stoniz-beige/50' : ''
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    <Link
                      href={`/projects/${r.project_id}`}
                      className="text-stoniz-black hover:underline"
                    >
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{r.client_name}</td>
                  <td className="px-3 py-2 text-stoniz-gray-700">
                    {r.chef_name ?? <span className="text-stoniz-gray-400">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 bg-stoniz-gray-100 rounded">
                      {PHASE_LABELS[r.current_phase]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${dot} shrink-0`} aria-hidden />
                      <div className="flex-1 bg-stoniz-gray-100 rounded-full h-2 min-w-[80px]">
                        <div
                          className={`h-2 rounded-full ${barColor}`}
                          style={{ width: `${r.score}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono tabular-nums w-9 text-right">
                        {r.score}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {r.missing.length > 0 ? (
                      <span className={r.criticality === 'rouge' ? 'text-red-700' : 'text-amber-700'}>
                        {r.missing.length}
                      </span>
                    ) : (
                      <span className="text-emerald-700">0</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`?open=${r.project_id}#detail`}
                      className="text-xs text-stoniz-black underline hover:no-underline"
                    >
                      {isOpen ? 'Ouvert' : 'Détails'}
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
