'use client';

import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { getReviewEventsAction, type ReviewEvent } from '@/app/(team)/propria/avis/actions';

const EVENT_ICON: Record<string, string> = {
  statut: '🔁',
  relance: '📤',
  sentiment: '🎭',
  cause: '🧭',
  assignation: '👤',
  autre: '📝',
};

/**
 * Journal d'un avis (chantier 7 marathon) — fil chronologique des événements
 * propria_review_events (statut, relance, sentiment, cause, assignation).
 * `refreshKey` : à incrémenter par le parent après une action pour recharger.
 */
export function ReviewJournal({
  reviewKind,
  reviewId,
  refreshKey = 0,
}: {
  reviewKind: 'avis' | 'preventif';
  reviewId: string;
  refreshKey?: number;
}) {
  const [events, setEvents] = useState<ReviewEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    getReviewEventsAction({ review_kind: reviewKind, review_id: reviewId })
      .then((r) => {
        if (!active) return;
        if (r.ok) setEvents(r.events);
        else { setEvents([]); setErr(r.error); }
      })
      .catch((e: any) => { if (active) { setEvents([]); setErr(e?.message ?? 'Erreur'); } });
    return () => { active = false; };
  }, [reviewKind, reviewId, refreshKey]);

  function fmt(iso: string) {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-stoniz-gray-700 inline-flex items-center gap-1">
        <History className="w-3 h-3" /> Journal
        {events != null && events.length > 0 && (
          <span className="text-stoniz-gray-400">({events.length})</span>
        )}
      </div>

      {events == null ? (
        <div className="text-[10px] text-stoniz-gray-400">Chargement…</div>
      ) : events.length === 0 ? (
        <div className="text-[10px] text-stoniz-gray-400">
          Aucun événement journalisé pour l&apos;instant.
        </div>
      ) : (
        <div className="space-y-1 max-h-48 overflow-y-auto">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-1.5 text-[11px]">
              <span className="shrink-0" title={e.event_type}>{EVENT_ICON[e.event_type] ?? '📝'}</span>
              <div className="min-w-0">
                <span className="text-stoniz-gray-800">{e.description ?? e.event_type}</span>
                <span className="text-[9px] text-stoniz-gray-400 ml-1.5 whitespace-nowrap">
                  {e.actor_name ?? '—'} · {fmt(e.created_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {err && <div className="text-[10px] text-red-700">{err}</div>}
    </div>
  );
}
