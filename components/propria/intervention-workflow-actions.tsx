'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  startInterventionAction,
  submitForValidationAction,
  validateInterventionAction,
  refuseInterventionAction,
  cancelInterventionAction,
  reopenInterventionAction,
} from '@/app/(team)/propria/interventions/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Boutons du workflow d'une intervention/tâche, côté client : exécutent les
 * Server Actions, INTERCEPTENT les erreurs et les affichent (au lieu de faire
 * planter le rendu de la page).
 */
export function InterventionWorkflowActions({
  id,
  status,
  hasProof,
  canValidate,
  isBackOffice,
  canAct = true,
  blockedReason,
}: {
  id: string;
  status: string;
  hasProof: boolean;
  canValidate: boolean;
  isBackOffice: boolean;
  /** false = utilisateur peut voir mais pas agir sur le workflow (créateur non assigné). */
  canAct?: boolean;
  /** Message à afficher quand canAct=false, ex "Tâche assignée à Ayoub". */
  blockedReason?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string } | void>) {
    setErr(null);
    start(async () => {
      try {
        const r = await fn();
        // Les actions défensives renvoient { ok, error }. Garde la compat
        // avec celles qui renvoient encore void (createInterventionProof...).
        if (r && typeof r === 'object' && 'ok' in r && !r.ok) {
          setErr(r.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inattendue');
      }
    });
  }

  function refuse() {
    const reason = window.prompt('Motif du refus (visible par le terrain) :', '');
    if (reason === null) return;
    run(() => refuseInterventionAction(id, reason));
  }

  // w-full sur mobile : cibles tactiles confortables pour le terrain
  const btn = 'w-full sm:w-auto text-center px-4 py-2.5 sm:py-2 rounded-md text-sm disabled:opacity-50';

  // Cas spécial : créateur d'une tâche assignée à quelqu'un d'autre.
  // Pas d'actions, juste une info qui dédramatise l'absence des boutons.
  if (!canAct && !isBackOffice) {
    return (
      <div className="flex flex-col items-end gap-1 text-right">
        <p className="text-xs text-stoniz-gray-500 italic max-w-xs">
          {blockedReason ?? 'Tâche assignée à un autre collaborateur — il pilote son démarrage et son avancement.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full sm:w-auto flex-col items-stretch sm:items-end gap-2">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:justify-end">
        {(status === 'a_traiter' || status === 'refusee') && (
          <button onClick={() => run(() => startInterventionAction(id))} disabled={pending}
            className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            Démarrer →
          </button>
        )}

        {status === 'en_cours' && (
          <button
            onClick={() => run(() => submitForValidationAction(id))}
            disabled={pending || !hasProof}
            title={hasProof ? '' : 'Déposez au moins une preuve avant de soumettre'}
            className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
          >
            Soumettre pour validation →
          </button>
        )}

        {canValidate && status === 'a_valider' && (
          <>
            <button onClick={() => run(() => validateInterventionAction(id))} disabled={pending}
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              ✓ Valider
            </button>
            <button onClick={refuse} disabled={pending}
              className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
              Refuser
            </button>
          </>
        )}

        {canValidate && status === 'cloture' && (
          <button onClick={() => run(() => reopenInterventionAction(id))} disabled={pending}
            className={`${btn} border border-stoniz-gray-300 hover:bg-stoniz-gray-50`}>
            Réouvrir
          </button>
        )}

        {isBackOffice && ['a_traiter', 'en_cours', 'a_valider', 'refusee'].includes(status) && (
          <button onClick={() => run(() => cancelInterventionAction(id))} disabled={pending}
            className={`${btn} border border-stoniz-gray-300 hover:bg-stoniz-gray-50`}>
            Annuler
          </button>
        )}
      </div>

      {err && (
        <div className="max-w-md w-full">
          <SessionExpiredBanner error={err} />
        </div>
      )}
    </div>
  );
}
