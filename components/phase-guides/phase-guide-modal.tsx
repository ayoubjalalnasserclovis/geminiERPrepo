'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { acknowledgePhaseGuideAction } from '@/app/(client)/client/projects/[id]/phase-guide/actions';
import { PhaseGuideContent, PHASE_GUIDE_META } from './phase-guide-content';

type PhaseKey = 'sourcing' | 'design' | 'travaux' | 'mise_en_location';

export function PhaseGuideModal({
  projectId,
  phase,
}: {
  projectId: string;
  phase: PhaseKey;
}) {
  const meta = PHASE_GUIDE_META[phase];
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Verrouille le scroll de la page derrière le modal
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Détecte si l'utilisateur a scrollé près du bas (tolérance 60px)
  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom <= 60) {
      setHasScrolledToBottom(true);
    }
  }

  // Si le contenu tient sans scroll (peu probable), on active direct
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight <= el.clientHeight + 10) {
      setHasScrolledToBottom(true);
    }
  }, []);

  function submit() {
    setError(null);
    start(async () => {
      const r = await acknowledgePhaseGuideAction({ project_id: projectId, phase });
      if (r && !r.ok) {
        setError(r.error ?? 'Une erreur est survenue. Réessayez.');
      }
      // sinon, redirect/refresh géré par l'action
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-stoniz-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fadein">
      <div className="bg-cream rounded-md max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-6 py-5 border-b border-grey-line bg-white">
          <p className="eyebrow text-xs mb-1">{meta.eyebrow}</p>
          <h2 className="font-display text-2xl text-stoniz-black flex items-center gap-2">
            <span>{meta.emoji}</span>
            <span>{meta.title}</span>
          </h2>
          <p className="text-xs text-grey-text mt-2">
            Merci de lire ce document jusqu'au bout. Le bouton de validation s'activera dès que vous
            aurez fini votre lecture.
          </p>
        </div>

        {/* Contenu scrollable */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="overflow-y-auto px-6 py-6 flex-1 bg-cream"
        >
          <PhaseGuideContent phase={phase} />
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-grey-line bg-white">
          {error && (
            <div className="mb-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-sm p-2">
              {error}
            </div>
          )}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-grey-text">
              {hasScrolledToBottom
                ? '✓ Vous avez bien lu le document.'
                : 'Continuez à scroller pour activer le bouton…'}
            </p>
            <button
              onClick={submit}
              disabled={!hasScrolledToBottom || pending}
              className="bg-yellow text-stoniz-black border-[1.5px] border-stoniz-black px-6 py-3 rounded-sm font-semibold hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
            >
              {pending ? 'Envoi…' : "J'ai lu et compris — m'envoyer le document"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
