import Link from 'next/link';
import type { ProjectCompleteness } from '@/lib/completude/projets-completude';
import { OWNER_LABELS, PHASE_LABELS } from '@/lib/completude/projets-completude';
import { X } from 'lucide-react';

export function CompletudeProjetsDetail({
  row,
  closeHref,
}: {
  row: ProjectCompleteness;
  closeHref: string;
}) {
  // Regroupe les manques par propriétaire (qui doit agir)
  const byOwner = new Map<string, typeof row.missing>();
  for (const m of row.missing) {
    const arr = byOwner.get(m.owner) ?? [];
    arr.push(m);
    byOwner.set(m.owner, arr);
  }

  const critColor =
    row.criticality === 'rouge'
      ? 'text-red-700 bg-red-50 border-red-200'
      : row.criticality === 'orange'
      ? 'text-amber-700 bg-amber-50 border-amber-200'
      : 'text-emerald-700 bg-emerald-50 border-emerald-200';

  return (
    <div
      id="detail"
      className="bg-white border-2 border-stoniz-black rounded-lg overflow-hidden scroll-mt-4"
    >
      <div className="flex items-start justify-between p-4 bg-stoniz-beige/40 border-b border-stoniz-gray-200">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            Détail complétude
          </div>
          <h2 className="text-lg font-display">
            <Link href={`/projects/${row.project_id}`} className="hover:underline">
              {row.reference} — {row.client_name}
            </Link>
          </h2>
          <div className="text-sm text-stoniz-gray-600 mt-1 flex items-center gap-3 flex-wrap">
            <span>Phase : <strong>{PHASE_LABELS[row.current_phase]}</strong></span>
            <span>·</span>
            <span>Chef : {row.chef_name ?? '(non assigné)'}</span>
            <span>·</span>
            <span className={`px-2 py-0.5 border rounded text-xs ${critColor}`}>
              Score {row.score}% ({row.total_present}/{row.total_required} attendus)
            </span>
          </div>
        </div>
        <Link
          href={closeHref}
          className="text-stoniz-gray-500 hover:text-stoniz-black p-1"
          aria-label="Fermer le détail"
        >
          <X className="w-5 h-5" />
        </Link>
      </div>

      {row.missing.length === 0 ? (
        <div className="p-6 text-center text-sm text-emerald-700">
          Tous les attendus sont présents pour ce projet.
        </div>
      ) : (
        <div className="p-4 space-y-4">
          {Array.from(byOwner.entries()).map(([owner, items]) => (
            <div key={owner}>
              <h3 className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">
                À traiter par : {OWNER_LABELS[owner as keyof typeof OWNER_LABELS] ?? owner} ({items.length})
              </h3>
              <ul className="space-y-1">
                {items
                  .sort((a, b) => b.weight - a.weight)
                  .map(m => (
                    <li
                      key={m.key}
                      className="flex items-center justify-between gap-3 px-3 py-2 bg-stoniz-beige/30 border border-stoniz-gray-100 rounded"
                    >
                      <span className="text-sm">{m.label}</span>
                      <span className="text-xs font-mono text-stoniz-gray-500 shrink-0">
                        poids {m.weight}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          <div className="pt-3 border-t border-stoniz-gray-100 flex justify-end">
            <Link
              href={`/projects/${row.project_id}`}
              className="text-sm text-stoniz-black underline hover:no-underline"
            >
              Ouvrir la fiche projet →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
