'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle } from 'lucide-react';
import { toggleHonorairesConfirmedAction } from '@/app/(team)/finance/tresorerie/honoraires-a-percevoir/actions';

/**
 * Case "Confirmé" à côté d'une ligne projet sur la page Honoraires à percevoir.
 * CEO/finance clique pour indiquer qu'il pense que le projet ira jusqu'au bout
 * du process honoraires. Utilisé pour construire le KPI "CA confirmé".
 *
 * CEO 2026-08-17c.
 */
export function HonorairesConfirmedToggle({
  projectId,
  initialConfirmed,
}: {
  projectId: string;
  initialConfirmed: boolean;
}) {
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(initialConfirmed);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggle() {
    const next = !confirmed;
    setError(null);
    // Optimistic UI — on flip tout de suite pour un feedback instantané ;
    // si l'action échoue on remet en place et on affiche l'erreur.
    setConfirmed(next);
    start(async () => {
      const r = await toggleHonorairesConfirmedAction({
        project_id: projectId,
        confirmed: next,
      });
      if (!r.ok) {
        setConfirmed(!next);
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded border ${
          confirmed
            ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
            : 'bg-white border-stoniz-gray-300 text-stoniz-gray-600 hover:bg-stoniz-gray-50'
        } disabled:opacity-50`}
        title={confirmed ? 'Projet marqué confirmé — cliquer pour retirer' : 'Cliquer pour marquer comme confirmé'}
      >
        {confirmed ? <CheckCircle2 className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
        {confirmed ? 'Confirmé' : 'À confirmer'}
      </button>
      {error && <span className="text-[10px] text-red-700">{error}</span>}
    </span>
  );
}
