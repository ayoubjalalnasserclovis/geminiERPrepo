'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, MoveRight, FileText, MessageSquare, CheckCircle2, XCircle, PanelRightOpen } from 'lucide-react';
import { moveReviewColumnAction, setReviewInternalNoteAction, assignReviewAction } from '@/app/(team)/propria/avis/actions';
import { ReviewDetailModal } from '@/components/propria/review-detail-modal';

type Column = 'a_traiter' | 'ticket1_ouvert' | 'ticket1_non_resolu' | 'ticket2_ouvert' | 'gagne' | 'perdu';

type Review = {
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

const COLUMNS: { key: Column; label: string; color: string; bg: string }[] = [
  { key: 'a_traiter',          label: '⚠ À traiter',              color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  { key: 'ticket1_ouvert',     label: '📩 1er ticket ouvert',     color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  { key: 'ticket1_non_resolu', label: '⏳ 1er ticket non résolu', color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200' },
  { key: 'ticket2_ouvert',     label: '📩 2ème ticket ouvert',    color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200' },
  { key: 'gagne',              label: '✅ Gagné',                  color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  { key: 'perdu',              label: '❌ Perdu',                  color: 'text-red-700',    bg: 'bg-red-50 border-red-200' },
];

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

function ReviewCard({ review, assignees, profiles, canDeleteComments, defaultDetailOpen, onMove, onSaveNote, onAssign }: {
  review: Review;
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
  defaultDetailOpen?: boolean;
  onMove: (column: Column) => void;
  onSaveNote: (notes: string) => void;
  onAssign: (assignee_id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(defaultDetailOpen ?? false);
  const [notes, setNotes] = useState(review.internal_notes ?? '');
  const rating = review.rating_normalized;
  const ratingColor = rating == null ? 'text-stoniz-gray-400' : rating >= 4.5 ? 'text-emerald-700' : rating <= 3 ? 'text-red-700' : 'text-amber-700';

  const currentIdx = COLUMNS.findIndex((c) => c.key === review.kanban_column);
  const nextCol = currentIdx < COLUMNS.length - 1 ? COLUMNS[currentIdx + 1] : null;

  return (
    <div
      className="bg-white border border-stoniz-gray-200 rounded-lg p-3 text-xs space-y-2"
      // Drag & drop natif (chantier 7) — désactivé quand la carte est ouverte
      // pour ne pas gêner la sélection de texte dans les champs.
      draggable={!open}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', review.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`font-medium inline-flex items-center gap-1 ${ratingColor}`}>
            <Star className="w-3 h-3 fill-current" />
            {rating != null ? rating.toFixed(1) : '—'}/5
          </div>
          <div className="text-stoniz-gray-500 text-[10px]">{fmtDate(review.submitted_at)} · {review.channel_name ?? '?'}</div>
        </div>
        {review.unit_code && (
          <div className="text-[10px] text-stoniz-gray-700 font-mono shrink-0">{review.unit_code}</div>
        )}
      </div>
      <div className="text-stoniz-gray-600 font-medium">{review.guest_name ?? 'Voyageur'}</div>

      {/* Assignation */}
      <select
        value={review.assignee_id ?? ''}
        onChange={(e) => onAssign(e.target.value || null)}
        className={`w-full border rounded px-1.5 py-0.5 text-[10px] ${review.assignee_id ? 'border-blue-300 bg-blue-50' : 'border-stoniz-gray-200 bg-stoniz-gray-50 text-stoniz-gray-500'}`}
      >
        <option value="">— Non assigné —</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>👤 {a.full_name ?? '—'}</option>
        ))}
      </select>
      {review.public_review && (
        <p className={`text-stoniz-gray-700 ${open ? '' : 'line-clamp-2'}`}>{review.public_review}</p>
      )}

      {open && (
        <div className="space-y-2 mt-2">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => onSaveNote(notes)}
            placeholder="Note interne (action prise, plan B…)"
            className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]"
            rows={2}
          />
          {/* Timeline tickets */}
          <div className="space-y-0.5 text-[10px] text-stoniz-gray-500">
            {review.ticket1_opened_at && <div>📩 1er ticket ouvert le {fmtDate(review.ticket1_opened_at)}</div>}
            {review.ticket1_unresolved_at && <div>⏳ 1er ticket non résolu le {fmtDate(review.ticket1_unresolved_at)}</div>}
            {review.ticket2_opened_at && <div>📩 2ème ticket ouvert le {fmtDate(review.ticket2_opened_at)}</div>}
            {review.won_at && <div>✅ Gagné le {fmtDate(review.won_at)}</div>}
            {review.lost_at && <div>❌ Perdu le {fmtDate(review.lost_at)}</div>}
          </div>
          {/* Boutons de déplacement */}
          <div className="flex flex-wrap gap-1">
            {nextCol && (
              <button
                type="button"
                onClick={() => onMove(nextCol.key)}
                className="bg-blue-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-blue-700"
              >
                <MoveRight className="w-3 h-3" /> {nextCol.label.replace(/^.\s/, '')}
              </button>
            )}
            {review.kanban_column !== 'gagne' && (
              <button
                type="button"
                onClick={() => onMove('gagne')}
                className="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-emerald-700"
              >
                <CheckCircle2 className="w-3 h-3" /> Gagné
              </button>
            )}
            {review.kanban_column !== 'perdu' && (
              <button
                type="button"
                onClick={() => onMove('perdu')}
                className="bg-red-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-red-700"
              >
                <XCircle className="w-3 h-3" /> Perdu
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-blue-600 hover:underline text-[10px] inline-flex items-center gap-1"
        >
          <MessageSquare className="w-2.5 h-2.5" />
          {open ? 'Réduire' : 'Détails / Actions'}
        </button>
        <button
          type="button"
          onClick={() => setDetailOpen(true)}
          className="text-stoniz-gray-600 hover:text-stoniz-black hover:underline text-[10px] inline-flex items-center gap-1"
        >
          <PanelRightOpen className="w-2.5 h-2.5" />
          Dossier complet
        </button>
      </div>

      {detailOpen && (
        <ReviewDetailModal
          review={review}
          assignees={assignees}
          profiles={profiles}
          canDeleteComments={canDeleteComments}
          onClose={() => setDetailOpen(false)}
        />
      )}
    </div>
  );
}

export function PostReviewKanban({ reviews, assignees, profiles, canDeleteComments, openReviewId }: {
  reviews: Review[];
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
  /** Deep-link : id d'un avis dont la modale doit s'ouvrir au chargement. */
  openReviewId?: string | null;
}) {
  const router = useRouter();
  const [, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function move(id: string, column: Column) {
    start(async () => {
      const r = await moveReviewColumnAction({ review_id: id, column })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      router.refresh();
    });
  }
  function saveNote(id: string, notes: string) {
    start(async () => {
      await setReviewInternalNoteAction({ review_id: id, notes });
      router.refresh();
    });
  }
  function assign(id: string, assignee_id: string | null) {
    start(async () => {
      await assignReviewAction({ review_id: id, assignee_id });
      router.refresh();
    });
  }

  const byColumn = new Map<Column, Review[]>();
  for (const c of COLUMNS) byColumn.set(c.key, []);
  for (const r of reviews) byColumn.get(r.kanban_column)?.push(r);

  return (
    <div className="space-y-3">
      {msg && (
        <div className={`text-xs rounded px-3 py-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>
          {msg.text}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {COLUMNS.map((col) => {
          const items = byColumn.get(col.key) ?? [];
          return (
            <div
              key={col.key}
              className={`rounded-xl border-2 p-3 ${col.bg}`}
              // Cible de drop (chantier 7) — complète les boutons (fallback mobile)
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) move(id, col.key);
              }}
            >
              <div className={`text-xs font-medium mb-3 flex items-center justify-between ${col.color}`}>
                <span>{col.label}</span>
                <span className="bg-white border border-current rounded-full px-2 text-[10px]">{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {items.map((r) => (
                  <ReviewCard
                    key={r.id}
                    review={r}
                    assignees={assignees}
                    profiles={profiles}
                    canDeleteComments={canDeleteComments}
                    defaultDetailOpen={openReviewId === r.id}
                    onMove={(c) => move(r.id, c)}
                    onSaveNote={(notes) => saveNote(r.id, notes)}
                    onAssign={(aid) => assign(r.id, aid)}
                  />
                ))}
                {items.length === 0 && (
                  <div className="text-[10px] text-stoniz-gray-400 text-center py-4">vide</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
