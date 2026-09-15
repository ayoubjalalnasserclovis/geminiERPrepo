import { AlertTriangle } from 'lucide-react';

export type PhaseWarning = {
  code: string;
  severity: 'low' | 'medium' | 'high';
  title: string;
  detail: string;
};

/**
 * Affichage des soft blocks avant le bouton "Avancer en phase X".
 * Distinct des hard blocks (qui sont enforced par la RPC `advance_project_phase`).
 * Le chef projet voit les alertes mais peut quand même cliquer pour avancer.
 */
export function PhaseAdvanceWarnings({
  warnings,
  targetPhaseLabel,
}: {
  warnings: PhaseWarning[];
  targetPhaseLabel: string;
}) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className="bg-amber-50 border-2 border-amber-300 rounded-lg p-4 mb-3">
      <div className="flex items-start gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
        <div>
          <h4 className="font-medium text-amber-900 text-sm">
            {warnings.length} vérification{warnings.length > 1 ? 's' : ''} recommandée{warnings.length > 1 ? 's' : ''} avant de passer en {targetPhaseLabel}
          </h4>
          <p className="text-xs text-amber-800 mt-0.5">
            Ces points ne bloquent pas la transition mais signalent un risque métier non couvert.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {warnings.map(w => (
          <li
            key={w.code}
            className="bg-white border border-amber-200 rounded p-3 text-sm"
          >
            <div className="font-medium text-amber-900">{w.title}</div>
            <div className="text-xs text-stoniz-gray-700 mt-1">{w.detail}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
