'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  startCleaningAction,
  submitCleaningForValidationAction,
  validateCleaningAction,
  refuseCleaningAction,
  cancelCleaningAction,
  reopenCleaningAction,
} from '@/app/(team)/propria/menage/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

type ActionResult = { ok: true } | { ok: false; error: string };

/**
 * Boutons du workflow d'un ménage côté client. Identique à
 * InterventionWorkflowActions mais ciblé sur les server actions ménage.
 *
 * CEO 2026-06-09 : si des incidents sont encore ouverts au moment où le
 * back-office veut valider, on ne bloque pas mais on demande confirmation
 * via une modale. Les incidents resteront actionnables dans /propria/menage/incidents.
 */
export function CleaningWorkflowActions({
  id, status, hasProof, canValidate, isBackOffice, openIncidentsCount = 0,
  checklistMissingCount = 0,
}: {
  id: string;
  status: string;
  hasProof: boolean;
  canValidate: boolean;
  isBackOffice: boolean;
  /** Nombre d'incidents non clos (reported + acknowledged) liés à ce ménage. */
  openIncidentsCount?: number;
  /**
   * Chantier 5 marathon (U21) : nb d'items de checklist SANS photo.
   * TERMINER est impossible tant que > 0 (photos obligatoires).
   */
  checklistMissingCount?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [confirmValidate, setConfirmValidate] = useState(false);

  function run(fn: () => Promise<ActionResult>) {
    setErr(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r || !r.ok) {
          setErr(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  function refuse() {
    const reason = window.prompt('Motif du refus (visible par la dame de ménage) :', '');
    if (reason === null) return;
    run(() => refuseCleaningAction(id, reason));
  }

  function clickValidate() {
    if (openIncidentsCount > 0) {
      setConfirmValidate(true);
      return;
    }
    run(() => validateCleaningAction(id));
  }

  function confirmValidateNow() {
    setConfirmValidate(false);
    run(() => validateCleaningAction(id));
  }

  // w-full sur mobile : cibles tactiles confortables pour le terrain
  const btn = 'w-full sm:w-auto text-center px-4 py-2.5 sm:py-2 rounded-md text-sm disabled:opacity-50';

  return (
    <div className="flex w-full sm:w-auto flex-col items-stretch sm:items-end gap-2">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:justify-end">
        {(status === 'a_traiter' || status === 'refusee') && (
          <button onClick={() => run(() => startCleaningAction(id))} disabled={pending}
            className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            Démarrer →
          </button>
        )}

        {status === 'en_cours' && (
          <>
            <button
              onClick={() => run(() => submitCleaningForValidationAction(id))}
              disabled={pending || !hasProof || checklistMissingCount > 0}
              title={
                checklistMissingCount > 0
                  ? `${checklistMissingCount} photo(s) de checklist manquante(s)`
                  : hasProof ? '' : 'Déposez au moins une preuve (photo ou vidéo) avant de soumettre'
              }
              className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
            >
              ✅ TERMINER →
            </button>
            {checklistMissingCount > 0 && (
              <span className="text-[11px] text-red-700 sm:text-right">
                📸 {checklistMissingCount} photo{checklistMissingCount > 1 ? 's' : ''} manquante{checklistMissingCount > 1 ? 's' : ''} dans la checklist
              </span>
            )}
          </>
        )}

        {canValidate && status === 'a_valider' && (
          <>
            <button onClick={clickValidate} disabled={pending}
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
          <button onClick={() => run(() => reopenCleaningAction(id))} disabled={pending}
            className={`${btn} border border-stoniz-gray-300 hover:bg-stoniz-gray-50`}>
            Réouvrir
          </button>
        )}

        {isBackOffice && ['a_traiter','en_cours','a_valider','refusee'].includes(status) && (
          <button onClick={() => run(() => cancelCleaningAction(id))} disabled={pending}
            className={`${btn} border border-stoniz-gray-300 hover:bg-stoniz-gray-50`}>
            Annuler
          </button>
        )}
      </div>

      {err && (
        <div className="max-w-md">
          <SessionExpiredBanner error={err} />
        </div>
      )}

      {/* Modale de confirmation si on valide avec incidents ouverts */}
      {confirmValidate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setConfirmValidate(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full p-6 text-left"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl mb-2">
              ⚠ {openIncidentsCount} incident{openIncidentsCount > 1 ? 's' : ''} encore ouvert{openIncidentsCount > 1 ? 's' : ''}
            </h2>
            <p className="text-sm text-stoniz-gray-700 mb-4">
              Valider ce ménage ne ferme PAS les incidents en cours. Ils resteront actionnables
              dans <strong>/propria/menage/incidents</strong> jusqu'à leur résolution ou déclin.
            </p>
            <p className="text-xs text-stoniz-gray-500 mb-4">
              Si tu préfères traiter d'abord les incidents (transformer en intervention ou décliner),
              annule et clique sur la section incidents en haut de page.
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmValidate(false)} disabled={pending}
                className="px-4 py-2 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50">
                Annuler
              </button>
              <button onClick={confirmValidateNow} disabled={pending}
                className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm hover:bg-emerald-700">
                {pending ? 'Validation…' : 'Valider quand même'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
