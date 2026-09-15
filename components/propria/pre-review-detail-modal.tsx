'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X, Star, CheckCircle2, XCircle, Phone, Mail, Hash, Moon } from 'lucide-react';
import {
  setPreReviewSentimentAction,
  setPreReviewMainCauseAction,
  movePreReviewKanbanAction,
  addPreReviewActionAction,
  setPreReviewNoteAction,
  assignPreReviewAction,
} from '@/app/(team)/propria/avis/actions';
import { CommentsThread } from '@/components/propria/comments-thread';
import { ReviewJournal } from '@/components/propria/review-journal';

type KanbanStatus = 'nouveau' | 'risque' | 'neutre' | 'bon' | 'action_lancee' | 'accomplie' | 'ratee';
type Sentiment = 'bon' | 'neutre' | 'mauvais' | null;
type ActionType = 'compensation' | 'message' | 'appel' | 'geste_commercial' | 'relance_positive' | 'autre';
export type MainCause = 'menage' | 'acces' | 'cle' | 'climatisation' | 'internet' | 'bruit' | 'communication' | 'equipement' | 'prix' | 'autre';

export type TrackingForModal = {
  id: string;
  hostaway_reservation_id: number;
  sentiment: Sentiment;
  kanban_status: KanbanStatus;
  main_cause: MainCause | null;
  completion_reason: string | null;
  internal_notes: string | null;
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  channel_name: string | null;
  arrival_date: string;
  departure_date: string;
  unit_code: string | null;
  property_name: string | null;
  review_rating: number | null;
  review_comment: string | null;
  assignee_id: string | null;
};

type Assignee = { id: string; full_name: string | null };
type Profile = { id: string; full_name: string | null };

export const MAIN_CAUSE_OPTIONS: { key: MainCause; label: string }[] = [
  { key: 'menage',        label: '🧹 Ménage' },
  { key: 'acces',         label: '🚪 Accès' },
  { key: 'cle',           label: '🔑 Clé' },
  { key: 'climatisation', label: '❄️ Climatisation' },
  { key: 'internet',      label: '📶 Internet' },
  { key: 'bruit',         label: '📢 Bruit' },
  { key: 'communication', label: '💬 Communication' },
  { key: 'equipement',    label: '🛋 Équipement' },
  { key: 'prix',          label: '💶 Prix' },
  { key: 'autre',         label: '🔧 Autre' },
];

const SENTIMENT_BADGE: Record<NonNullable<Sentiment>, { label: string; color: string }> = {
  bon:     { label: '🟢 Bon',     color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  neutre:  { label: '🟡 Neutre',  color: 'bg-amber-100 text-amber-800 border-amber-200' },
  mauvais: { label: '🔴 Mauvais', color: 'bg-red-100 text-red-800 border-red-200' },
};

const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  compensation: '💶 Compensation',
  message: '✉ Message',
  appel: '📞 Appel',
  geste_commercial: '🎁 Geste commercial',
  relance_positive: '⭐ Relance positive',
  autre: '🔧 Autre',
};

function fmtDate(iso: string) {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

/** Durée du séjour DÉRIVÉE des dates de la résa (jamais stockée). */
export function stayNights(arrival: string, departure: string): number | null {
  if (!arrival || !departure) return null;
  const ms = new Date(departure + 'T00:00:00Z').getTime() - new Date(arrival + 'T00:00:00Z').getTime();
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Modale plein écran d'un avis préventif (chantier 7 marathon U10) :
 * coordonnées voyageur + n° de résa + durée du séjour (dérivée),
 * sentiment modifiable à tout moment, QCM cause principale si négatif,
 * journal des événements + fil de commentaires internes.
 */
export function PreReviewDetailModal({
  t,
  assignees,
  profiles,
  canDeleteComments,
  onClose,
}: {
  t: TrackingForModal;
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState(t.internal_notes ?? '');
  const [actionType, setActionType] = useState<ActionType>('message');
  const [actionDesc, setActionDesc] = useState('');
  const [actionAmount, setActionAmount] = useState('');
  const [journalKey, setJournalKey] = useState(0);

  const nights = stayNights(t.arrival_date, t.departure_date);
  const isClosed = t.kanban_status === 'accomplie' || t.kanban_status === 'ratee';

  function refresh() {
    setJournalKey((k) => k + 1);
    router.refresh();
  }

  function setSentiment(s: NonNullable<Sentiment>) {
    start(async () => {
      await setPreReviewSentimentAction({ tracking_id: t.id, sentiment: s });
      refresh();
    });
  }
  function setCause(cause: MainCause | null) {
    start(async () => {
      await setPreReviewMainCauseAction({ tracking_id: t.id, main_cause: cause });
      refresh();
    });
  }
  function moveTo(status: KanbanStatus) {
    start(async () => {
      await movePreReviewKanbanAction({ tracking_id: t.id, status });
      refresh();
    });
  }
  function addAction() {
    start(async () => {
      const r: any = await addPreReviewActionAction({
        tracking_id: t.id,
        action_type: actionType,
        description: actionDesc || null,
        amount: actionAmount ? Number(actionAmount) : null,
      });
      if (r?.ok) { setActionDesc(''); setActionAmount(''); refresh(); }
    });
  }
  function saveNote() {
    start(async () => {
      await setPreReviewNoteAction({ tracking_id: t.id, notes });
      refresh();
    });
  }
  function assign(assignee_id: string | null) {
    start(async () => {
      await assignPreReviewAction({ tracking_id: t.id, assignee_id });
      refresh();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-4xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="border-b border-stoniz-gray-200 px-5 py-3 flex items-center justify-between shrink-0">
          <div>
            <div className="text-base font-medium">{t.guest_name ?? 'Voyageur'}</div>
            <div className="text-[11px] text-stoniz-gray-500">
              {t.unit_code ?? '—'}{t.property_name ? ` (${t.property_name})` : ''}
              {' · '}{t.channel_name ?? '?'} · {fmtDate(t.arrival_date)} → {fmtDate(t.departure_date)}
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-stoniz-gray-500 hover:text-stoniz-black">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Colonne gauche : voyageur + workflow */}
            <div className="space-y-4">
              {/* Coordonnées voyageur + résa + durée (dérivée) */}
              <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-3 space-y-1.5 text-xs">
                <div className="text-[10px] uppercase text-stoniz-gray-500 font-medium">Voyageur & réservation</div>
                <div className="inline-flex items-center gap-1.5 mr-4">
                  <Hash className="w-3 h-3 text-stoniz-gray-400" />
                  Résa n° <span className="font-mono">{t.hostaway_reservation_id}</span>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <Moon className="w-3 h-3 text-stoniz-gray-400" />
                  {nights != null ? `${nights} nuit${nights > 1 ? 's' : ''}` : 'Durée inconnue'}
                </div>
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3 h-3 text-stoniz-gray-400" />
                  {t.guest_email ? (
                    <a href={`mailto:${t.guest_email}`} className="text-blue-600 hover:underline break-all">{t.guest_email}</a>
                  ) : <span className="text-stoniz-gray-400">Email non communiqué</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  <Phone className="w-3 h-3 text-stoniz-gray-400" />
                  {t.guest_phone ? (
                    <a href={`tel:${t.guest_phone}`} className="text-blue-600 hover:underline">{t.guest_phone}</a>
                  ) : <span className="text-stoniz-gray-400">Téléphone non communiqué</span>}
                </div>
              </div>

              {/* Avis reçu (si bascule) */}
              {t.review_rating != null && (
                <div className="text-xs inline-flex items-center gap-1.5">
                  <span className="font-medium">Avis reçu :</span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${t.review_rating >= 4.5 ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-red-100 text-red-800 border-red-200'}`}>
                    <Star className="w-3 h-3 fill-current" /> {t.review_rating.toFixed(1)}/5
                  </span>
                </div>
              )}
              {t.review_comment && (
                <p className="text-xs text-stoniz-gray-700 italic bg-stoniz-gray-50 border border-stoniz-gray-100 rounded p-2">
                  « {t.review_comment} »
                </p>
              )}

              {/* Sentiment — modifiable à tout moment (chantier 7) */}
              <div>
                <div className="text-xs font-medium mb-1">Sentiment</div>
                <div className="flex gap-1.5">
                  {(['bon', 'neutre', 'mauvais'] as const).map((s) => (
                    <button key={s} type="button" onClick={() => setSentiment(s)} disabled={pending}
                      className={`px-3 py-1 border rounded text-[11px] disabled:opacity-50 ${t.sentiment === s ? SENTIMENT_BADGE[s].color : 'bg-white border-stoniz-gray-200 text-stoniz-gray-600 hover:bg-stoniz-gray-50'}`}>
                      {SENTIMENT_BADGE[s].label}
                    </button>
                  ))}
                </div>
              </div>

              {/* QCM cause principale — visible quand le sentiment est négatif */}
              {t.sentiment === 'mauvais' && (
                <div>
                  <div className="text-xs font-medium mb-1">Cause principale (QCM)</div>
                  <div className="flex flex-wrap gap-1">
                    {MAIN_CAUSE_OPTIONS.map((c) => (
                      <button key={c.key} type="button" disabled={pending}
                        onClick={() => setCause(t.main_cause === c.key ? null : c.key)}
                        className={`px-2 py-1 border rounded text-[10px] disabled:opacity-50 ${t.main_cause === c.key ? 'bg-red-600 text-white border-red-600' : 'bg-white border-stoniz-gray-200 text-stoniz-gray-700 hover:bg-red-50'}`}>
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Assignation */}
              <div>
                <div className="text-xs font-medium mb-1">Assigné à</div>
                <select value={t.assignee_id ?? ''} onChange={(e) => assign(e.target.value || null)} disabled={pending}
                  className={`w-full border rounded px-2 py-1.5 text-xs ${t.assignee_id ? 'border-blue-300 bg-blue-50' : 'border-stoniz-gray-300'}`}>
                  <option value="">— Non assigné —</option>
                  {assignees.map((a) => <option key={a.id} value={a.id}>👤 {a.full_name ?? '—'}</option>)}
                </select>
              </div>

              {/* Note interne */}
              <div>
                <div className="text-xs font-medium mb-1">Note interne</div>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNote}
                  placeholder="Contexte, plan d'action…"
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-xs" rows={3} />
              </div>

              {/* Ajouter une action */}
              {!isClosed && (
                <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded p-3 space-y-1.5">
                  <div className="text-[11px] font-medium">+ Ajouter une action</div>
                  <select value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}
                    className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs">
                    {Object.entries(ACTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input value={actionDesc} onChange={(e) => setActionDesc(e.target.value)}
                    placeholder="Description (optionnel)"
                    className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs" />
                  {actionType === 'compensation' && (
                    <input value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} type="number" step="0.01"
                      placeholder="Montant"
                      className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs" />
                  )}
                  <button type="button" onClick={addAction} disabled={pending}
                    className="bg-stoniz-black text-white px-3 py-1.5 rounded text-[11px] w-full disabled:opacity-50">
                    Ajouter
                  </button>
                </div>
              )}

              {/* Fin manuelle */}
              {!isClosed && (
                <div className="flex gap-1.5 flex-wrap">
                  <button type="button" onClick={() => moveTo('accomplie')} disabled={pending}
                    className="bg-emerald-600 text-white px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-emerald-700 disabled:opacity-50">
                    <CheckCircle2 className="w-3 h-3" /> Forcer accomplie
                  </button>
                  <button type="button" onClick={() => moveTo('ratee')} disabled={pending}
                    className="bg-red-600 text-white px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-red-700 disabled:opacity-50">
                    <XCircle className="w-3 h-3" /> Forcer ratée
                  </button>
                </div>
              )}
              {t.completion_reason && (
                <div className="text-[11px] text-stoniz-gray-500">{t.completion_reason}</div>
              )}
            </div>

            {/* Colonne droite : journal + commentaires */}
            <div className="space-y-5">
              <ReviewJournal reviewKind="preventif" reviewId={t.id} refreshKey={journalKey} />
              <div className="border-t border-stoniz-gray-100 pt-4">
                {/* entity_type 'avis' réutilisé pour les préventifs (entity_id = tracking.id) */}
                <CommentsThread
                  entityType="avis"
                  entityId={t.id}
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
