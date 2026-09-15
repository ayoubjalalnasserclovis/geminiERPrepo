'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { advancePhaseAction } from '@/app/(team)/projects/actions';
import { formatPhase } from '@/lib/utils/format';

export function AdvancePhaseButton({ projectId, newPhase, disabled }: {
  projectId: string; newPhase: string; disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-end gap-1">
      {error && <div className="text-xs text-red-600">{error}</div>}
      <Button
        disabled={disabled || pending}
        onClick={() => {
          if (!confirm(`Avancer le projet en phase "${formatPhase(newPhase)}" ?\n\nLes tâches de la nouvelle phase seront créées automatiquement.`)) return;
          start(async () => {
            const r = await advancePhaseAction({ project_id: projectId, new_phase: newPhase });
            if (!r.ok) setError(r.error ?? 'Erreur');
          });
        }}
      >
        {pending ? 'Avancement…' : `Avancer en ${formatPhase(newPhase)}`}
      </Button>
    </div>
  );
}
