'use client';

// ─── Retour à l'étape précédente (CEO 2026-08-19, session D) ───────────────
// Corrige les passages d'étape accidentels : recule le projet d'UNE étape,
// avec confirmation explicite. Rien n'est supprimé — tâches, paiements et
// documents restent en place, et la ré-avancée ne crée plus de doublons.
// Rôles : ceo + chef_projet (vérifiés côté action ET côté RPC).

import { useState, useTransition } from 'react';
import { Undo2 } from 'lucide-react';
import { revertPhaseAction } from '@/app/(team)/projects/actions';
import { formatPhase } from '@/lib/utils/format';

export function RevertPhaseButton({ projectId, currentPhase, previousPhase }: {
  projectId: string;
  currentPhase: string;
  previousPhase: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col items-start gap-1">
      {error && <div className="text-xs text-red-600">{error}</div>}
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!confirm(
            `Revenir de "${formatPhase(currentPhase)}" à "${formatPhase(previousPhase)}" ?\n\n`
            + `Rien n'est supprimé : tâches, paiements et documents restent en place. `
            + `Le retour est tracé dans l'historique des phases (qui, quand). `
            + `Tu pourras ré-avancer quand tu veux, sans doublons.`,
          )) return;
          start(async () => {
            const r = await revertPhaseAction(projectId);
            if (!r.ok) setError(r.error ?? 'Erreur');
          });
        }}
        className="text-xs text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1 underline underline-offset-4 disabled:opacity-50"
      >
        <Undo2 className="w-3 h-3" />
        {pending ? 'Retour…' : `Revenir à ${formatPhase(previousPhase)}`}
      </button>
    </div>
  );
}
