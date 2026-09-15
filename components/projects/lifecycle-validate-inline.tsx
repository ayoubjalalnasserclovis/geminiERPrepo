'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { validateLifecycleTransitionAction } from '@/app/(team)/projects/[id]/lifecycle-actions';

/**
 * Boutons Approuver / Rejeter à afficher directement dans la timeline
 * lifecycle d'un projet, à côté d'une transition en 'pending'. CEO-only.
 *
 * Complète (sans remplacer) la page /admin/validations qui reste le hub
 * central des demandes en attente sur TOUS les projets. Ici on offre le
 * chemin direct au CEO qui consulte déjà la fiche.
 *
 * CEO 2026-08-17.
 */
export function LifecycleValidateInline({
  transitionId,
  toStatus,
  userRole,
}: {
  transitionId: string;
  toStatus: string;
  userRole: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showRejectMemo, setShowRejectMemo] = useState(false);
  const [rejectMemo, setRejectMemo] = useState('');

  // Seul le CEO peut valider une transition lifecycle.
  if (userRole !== 'ceo') return null;

  function decide(decision: 'approved' | 'rejected', memoText?: string) {
    setError(null);
    const fd = new FormData();
    fd.append('transition_id', transitionId);
    fd.append('decision', decision);
    if (memoText) fd.append('decision_memo', memoText);
    start(async () => {
      const r = await validateLifecycleTransitionAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="mt-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
      <div className="text-[11px] text-amber-900 mb-2">
        Demande en attente de ta validation (passage à <strong>{toStatus}</strong>).
      </div>

      {showRejectMemo && (
        <div className="mb-2">
          <input
            value={rejectMemo}
            onChange={(e) => setRejectMemo(e.target.value)}
            placeholder="Raison du rejet (optionnelle)…"
            className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-xs bg-white"
          />
        </div>
      )}

      {error && <div className="text-[11px] text-red-700 mb-2">{error}</div>}

      <div className="flex gap-2 justify-end">
        {!showRejectMemo ? (
          <>
            <button
              onClick={() => setShowRejectMemo(true)}
              disabled={pending}
              className="text-[11px] px-2.5 py-1 rounded border border-red-300 text-red-800 hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <XCircle className="w-3 h-3" />
              Rejeter
            </button>
            <button
              onClick={() => decide('approved')}
              disabled={pending}
              className="text-[11px] px-2.5 py-1 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <CheckCircle2 className="w-3 h-3" />
              {pending ? '…' : 'Approuver'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { setShowRejectMemo(false); setRejectMemo(''); }}
              disabled={pending}
              className="text-[11px] px-2.5 py-1 rounded border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
            >
              Annuler
            </button>
            <button
              onClick={() => decide('rejected', rejectMemo)}
              disabled={pending}
              className="text-[11px] px-2.5 py-1 rounded bg-red-700 text-white hover:bg-red-800 disabled:opacity-40"
            >
              {pending ? '…' : 'Confirmer le rejet'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
