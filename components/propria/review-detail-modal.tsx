'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Star, MoveRight, CheckCircle2, XCircle } from 'lucide-react';
import {
  moveReviewColumnAction,
  setReviewInternalNoteAction,
  assignReviewAction,
} from '@/app/(team)/propria/avis/actions';
import { CommentsThread } from '@/components/propria/comments-thread';
import { ReviewJournal } from '@/components/propria/review-journal';

type Column = 'a_traiter' | 'ticket1_ouvert' | 'ticket1_non_resolu' | 'ticket2_ouvert' | 'gagne' | 'perdu';

export type ReviewForModal = {
  id: string;
  guest_name: string | null;
  channel_name: string | null;
  public_review: string | null;
  private_review?: string | null;
  rating_normalized: number | null;
  submitted_at: string;
  removed_at: string | null;
  kanban_column: Column;
  ticket1_opened_at: string | null;
  ticket1_unresolved_at: string | null;
  ticket2_opened_at: string | null;
  won_at: string | null;
  lost_at: string | null;
  internal_notes: string | null;
  unit_code: string | null;
  property_name: string | null;
  assignee_id: string | null;
  hostaway_reservation_id?: number | null;
};

type Assignee = { id: string; full_name: string | null };
type Profile = { id: string; full_name: string | null };

const COLUMN_LABELS: { key: Column; label: string }[] = [
  { key: 'a_traiter',          label: '⚠ À traiter' },
  { key: 'ticket1_ouvert',     label: '📩 1er ticket ouvert' },
  { key: 'ticket1_non_resolu', label: '⏳ 1er ticket non résolu' },
  { key: 'ticket2_ouvert',     label: '📩 2ème ticket ouvert' },
  { key: 'gagne',              label: '✅ Gagné' },
  { key: 'perdu',              label: '❌ Perdu' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

/**
 * Modale plein écran d'un avis publié (chantier 7 marathon U9) :
 * détail complet + notes + déplacement + journal des événements +
 * fil de commentaires internes partagé (décision B5, entityType="avis").
 */
export function ReviewDetailModal({
  review,
  assignees,
  profiles,
  canDeleteComments,
  onClose,
}: {
  review: ReviewForModal;
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState(review.internal_notes ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [journalKey, setJournalKey] = useState(0);

  function refresh() {
    setJournalKey((k) => k + 1);
    router.refresh();
  }

  function move(column: Column) {
    setErr(null);
    start(async () => {
      const r: any = await moveReviewColumnAction({ review_id: review.id, column })
        .catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' }));
      if (!r?.ok) { setErr(r?.error ?? 'Échec'); return; }
      refresh();
    });
  }
  function saveNote() {
    start(async () => {
      await setReviewInternalNoteAction({ review_id: review.id, notes });
      refresh();
    });
  }
  function assign(assignee_id: string | null) {
    start(async () => {
      await assignReviewAction({ review_id: review.id, assignee_id });
      refresh();
    });
  }

  const rating = review.rating_normalized;
  const ratingColor = rating == null ? 'text-stoniz-gray-400' : rating >= 4.5 ? 'text-emerald-700' : rating <= 3 ? 'text-red-700' : 'text-amber-700';
  const currentIdx = COLUMN_LABELS.findIndex((c) => c.key === review.kanban_column);
  const nextCol = currentIdx >= 0 && currentIdx < COLUMN_LABELS.length - 1 ? COLUMN_LABELS[currentIdx + 1] : null;

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b border-stoniz-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-base font-medium inline-flex items-center gap-2">
              <span className={`inline-flex items-center gap-1 ${ratingColor}`}>
                <Star className="w-4 h-4 fill-current" />
                {rating != null ? rating.toFixed(1) : '—'}/5
              </span>
              <span>{review.guest_name ?? 'Voyageur'}</span>
            </div>
            <div className="text-[11px] text-stoniz-gray-500">
              {review.unit_code ?? '—'}{review.property_name ? ` (${review.property_name})` : ''}
              {' · '}{review.channel_name ?? '?'} · publié le {fmtDate(review.submitted_at)}
              {review.hostaway_reservation_id ? ` · résa #${review.hostaway_reservation_id}` : ''}
              {review.removed_at ? ` · 🗑 supprimé le ${fmtDate(review.removed_at)}` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-stoniz-gray-500 hover:text-stoniz-black">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Colonne gauche : l'avis + workflow */}
            <div className="space-y-4">
              {review.public_review && (
                <div>
                  <div className="text-xs font-medium mb-1">Avis public</div>
                  <p className="text-sm text-stoniz-gray-800 whitespace-pre-wrap bg-stoniz-gray-50 border border-stoniz-gray-100 rounded p-3">
                    {review.public_review}
                  </p>
                </div>
              )}
              {review.private_review && (
                <div>
                  <div className="text-xs font-medium mb-1">Commentaire privé du voyageur</div>
                  <p className="text-sm text-stoniz-gray-800 whitespace-pre-wrap bg-amber-50 border border-amber-100 rounded p-3">
                    {review.private_review}
                  </p>
                </div>
              )}

              {/* Assignation */}
              <div>
                <div className="text-xs font-medium mb-1">Assigné à</div>
                <select
                  value={review.assignee_id ?? ''}
                  onChange={(e) => assign(e.target.value || null)}
                  disabled={pending}
                  className={`w-full border rounded px-2 py-1.5 text-xs ${review.assignee_id ? 'border-blue-300 bg-blue-50' : 'border-stoniz-gray-300'}`}
                >
                  <option value="">— Non assigné —</option>
                  {assignees.map((a) => (
                    <option key={a.id} value={a.id}>👤 {a.full_name ?? '—'}</option>
                  ))}
                </select>
              </div>

              {/* Note interne */}
              <div>
                <div className="text-xs font-medium mb-1">Note interne</div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  onBlur={saveNote}
                  placeholder="Action prise, plan B…"
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-xs"
                  rows={3}
                />
              </div>

              {/* Timeline tickets */}
              <div className="space-y-0.5 text-[11px] text-stoniz-gray-500">
                {review.ticket1_opened_at && <div>📩 1er ticket ouvert le {fmtDate(review.ticket1_opened_at)}</div>}
                {review.ticket1_unresolved_at && <div>⏳ 1er ticket non résolu le {fmtDate(review.ticket1_unresolved_at)}</div>}
                {review.ticket2_opened_at && <div>📩 2ème ticket ouvert le {fmtDate(review.ticket2_opened_at)}</div>}
                {review.won_at && <div>✅ Gagné le {fmtDate(review.won_at)}</div>}
                {review.lost_at && <div>❌ Perdu le {fmtDate(review.lost_at)}</div>}
              </div>

              {/* Déplacement */}
              <div className="flex flex-wrap gap-1.5">
                {nextCol && (
                  <button type="button" onClick={() => move(nextCol.key)} disabled={pending}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-blue-700 disabled:opacity-50">
                    <MoveRight className="w-3 h-3" /> {nextCol.label.replace(/^.\s/, '')}
                  </button>
                )}
                {review.kanban_column !== 'gagne' && (
                  <button type="button" onClick={() => move('gagne')} disabled={pending}
                    className="bg-emerald-600 text-white px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-50">
                    <CheckCircle2 className="w-3 h-3" /> Gagné
                  </button>
                )}
                {review.kanban_column !== 'perdu' && (
                  <button type="button" onClick={() => move('perdu')} disabled={pending}
                    className="bg-red-600 text-white px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-red-700 disabled:opacity-50">
                    <XCircle className="w-3 h-3" /> Perdu
                  </button>
                )}
              </div>

              {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}
            </div>

            {/* Colonne droite : journal + commentaires */}
            <div className="space-y-5">
              <ReviewJournal reviewKind="avis" reviewId={review.id} refreshKey={journalKey} />
              <div className="border-t border-stoniz-gray-100 pt-4">
                <CommentsThread
                  entityType="avis"
                  entityId={review.id}
                  profiles={profiles}
                  canDelete={canDeleteComments}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
