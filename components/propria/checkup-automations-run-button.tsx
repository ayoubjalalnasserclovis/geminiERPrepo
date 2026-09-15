'use client';

import { useState, useTransition } from 'react';
import { runCheckupAutomationsNowAction } from '@/app/(team)/propria/checkups/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Bouton CEO/developer « Lancer maintenant » (chantier 11.b) — déclenche les
 * automatisations check-up via la même logique lib que le cron quotidien.
 * Idempotent : relancer le même jour = zéro doublon (le résumé le montre).
 */
export function CheckupAutomationsRunButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);

  function run() {
    startTransition(async () => {
      setResult(null);
      try {
        const res = await runCheckupAutomationsNowAction();
        if (!res || !res.ok) {
          setIsError(true);
          setResult(res?.error ?? 'Erreur inconnue');
          return;
        }
        const s = res.summary;
        setIsError(s.errors.length > 0);
        const parts = [
          `fréquence ${s.frequence.created}`,
          `bureau ${s.bureau.created}`,
          `terrain ${s.terrain.created}${s.terrain.day_eligible ? '' : ' (jour non éligible)'}`,
          `logement du jour ${s.logement_du_jour.created}${s.logement_du_jour.enabled ? '' : ' (désactivé)'}`,
        ];
        setResult(
          `Créations — ${parts.join(' · ')}` +
            (s.errors.length > 0 ? ` · ⚠ ${s.errors.length} erreur(s) : ${s.errors[0]}` : ''),
        );
      } catch (e) {
        setIsError(true);
        setResult(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        title="Exécute immédiatement les automatisations du cron quotidien (fréquence, aléatoire bureau/terrain, logement du jour). Idempotent : aucun doublon si déjà lancé aujourd'hui."
        className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50 disabled:opacity-50 whitespace-nowrap"
      >
        {pending ? '⏳ Automatisations…' : '⚙️ Lancer maintenant'}
      </button>
      {result && isError && (
        <div className="max-w-xs w-full">
          <SessionExpiredBanner error={result} />
        </div>
      )}
      {result && !isError && (
        <p className="text-[11px] max-w-xs text-right text-stoniz-gray-500">
          {result}
        </p>
      )}
    </div>
  );
}
