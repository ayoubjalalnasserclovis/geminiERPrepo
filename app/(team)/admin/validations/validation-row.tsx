'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle, ExternalLink, Calendar, FileText } from 'lucide-react';
import { validateLifecycleTransitionAction } from '@/app/(team)/projects/[id]/lifecycle-actions';

export function ValidationRow({
  transitionId,
  projectId,
  projectCode,
  clientName,
  requesterName,
  requesterRole,
  toStatus,
  phaseSnapshot,
  reasonLabel,
  memo,
  expectedResumeAt,
  requestedAt,
}: {
  transitionId: string;
  projectId: string;
  projectCode: string;
  clientName: string;
  requesterName: string;
  requesterRole: string;
  toStatus: string;
  phaseSnapshot: string | null;
  reasonLabel: string;
  memo: string | null;
  expectedResumeAt: string | null;
  requestedAt: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showRejectMemo, setShowRejectMemo] = useState(false);
  const [rejectMemo, setRejectMemo] = useState('');
  const router = useRouter();

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
    <div className="border border-stoniz-gray-200 rounded-xl p-4 bg-white">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs uppercase tracking-wide font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded">
              → {toStatus}
            </span>
            {phaseSnapshot && (
              <span className="text-xs text-stoniz-gray-500">depuis phase {phaseSnapshot}</span>
            )}
          </div>
          <div className="font-medium text-stoniz-black">{clientName}</div>
          <div className="text-xs text-stoniz-gray-500">{projectCode}</div>
        </div>
        <Link
          href={`/projects/${projectId}`}
          className="text-xs text-stoniz-gray-600 hover:underline flex items-center gap-1 flex-shrink-0"
        >
          Voir fiche
          <ExternalLink className="w-3 h-3" />
        </Link>
      </div>

      <div className="grid md:grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <div className="text-xs text-stoniz-gray-500">Raison</div>
          <div className="font-medium">{reasonLabel}</div>
        </div>
        <div>
          <div className="text-xs text-stoniz-gray-500">Demandé par</div>
          <div className="font-medium">
            {requesterName} <span className="text-xs text-stoniz-gray-500 uppercase">· {requesterRole}</span>
          </div>
        </div>
        {expectedResumeAt && (
          <div>
            <div className="text-xs text-stoniz-gray-500">Reprise prévue</div>
            <div className="font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              {new Date(expectedResumeAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
            </div>
          </div>
        )}
        <div>
          <div className="text-xs text-stoniz-gray-500">Demandée le</div>
          <div className="text-xs">{new Date(requestedAt).toLocaleString('fr-FR')}</div>
        </div>
      </div>

      {memo && (
        <div className="bg-stoniz-gray-50 border-l-2 border-stoniz-gray-300 p-3 mb-3 text-sm">
          <div className="flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-stoniz-gray-500" />
            <em className="text-stoniz-gray-700">« {memo} »</em>
          </div>
        </div>
      )}

      {showRejectMemo && (
        <div className="mb-3">
          <label className="block text-xs text-stoniz-gray-500 mb-1">Raison du rejet (optionnelle)</label>
          <input
            value={rejectMemo}
            onChange={(e) => setRejectMemo(e.target.value)}
            placeholder="Pourquoi tu rejettes…"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>
      )}

      {error && <div className="text-xs text-red-700 mb-2">{error}</div>}

      <div className="flex gap-2 justify-end">
        {!showRejectMemo ? (
          <>
            <button
              onClick={() => setShowRejectMemo(true)}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded border border-red-300 text-red-800 hover:bg-red-50 disabled:opacity-40 flex items-center gap-1"
            >
              <XCircle className="w-3.5 h-3.5" />
              Rejeter
            </button>
            <button
              onClick={() => decide('approved')}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded bg-emerald-700 text-white hover:bg-emerald-800 disabled:opacity-40 flex items-center gap-1"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              {pending ? '…' : 'Approuver'}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={() => { setShowRejectMemo(false); setRejectMemo(''); }}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
            >
              Annuler
            </button>
            <button
              onClick={() => decide('rejected', rejectMemo)}
              disabled={pending}
              className="text-xs px-3 py-1.5 rounded bg-red-700 text-white hover:bg-red-800 disabled:opacity-40"
            >
              {pending ? '…' : 'Confirmer le rejet'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
