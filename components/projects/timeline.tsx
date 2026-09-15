import { cn } from '@/lib/utils/cn';
import { formatPhase } from '@/lib/utils/format';

const PHASES = ['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'] as const;

const PHASE_COLOR_BG: Record<string, string> = {
  onboarding: 'bg-purple-100 border-purple-300 text-purple-900',
  sourcing: 'bg-blue-100 border-blue-300 text-blue-900',
  design: 'bg-accent-light border-accent text-accent-dark',
  travaux: 'bg-yellow-100 border-yellow-300 text-yellow-900',
  livraison: 'bg-green-100 border-green-300 text-green-900',
  mise_en_location: 'bg-stoniz-gray-100 border-stoniz-gray-300 text-stoniz-black',
  termine: 'bg-stoniz-black border-stoniz-black text-white',
};

export function Timeline({ phases, currentPhase, hideDates = false }: {
  phases: { phase: string; started_at: string; completed_at: string | null; duration_days: number | null }[];
  currentPhase: string;
  hideDates?: boolean;
}) {
  const phaseMap = new Map(phases.map(p => [p.phase, p]));
  const currentIdx = PHASES.indexOf(currentPhase as any);

  return (
    <div className="flex gap-2 flex-wrap">
      {PHASES.map((phase, idx) => {
        const data = phaseMap.get(phase);
        const isPast = idx < currentIdx;
        const isCurrent = phase === currentPhase;
        return (
          <div
            key={phase}
            className={cn(
              'flex-1 min-w-[120px] rounded-lg border-2 p-3 transition-colors',
              isPast || isCurrent ? PHASE_COLOR_BG[phase] : 'bg-white border-stoniz-gray-200 text-stoniz-gray-400'
            )}
          >
            <div className="text-xs uppercase tracking-wide font-medium">{formatPhase(phase)}</div>
            {!hideDates && data?.started_at && (
              <div className="text-xs mt-1 opacity-75">
                {new Date(data.started_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                {data.completed_at && ` → ${data.duration_days ?? 0}j`}
              </div>
            )}
            {isPast && hideDates && <div className="text-xs mt-1 opacity-75">✓ Terminée</div>}
            {isCurrent && <div className="text-xs mt-1 font-medium">▼ En cours</div>}
          </div>
        );
      })}
    </div>
  );
}
