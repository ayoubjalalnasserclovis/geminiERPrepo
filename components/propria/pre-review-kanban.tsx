'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Star, MoveRight, MessageSquare, CheckCircle2, XCircle, Clock, RefreshCw, PanelRightOpen, Hash, Moon } from 'lucide-react';
import {
  setPreReviewSentimentAction,
  setPreReviewMainCauseAction,
  movePreReviewKanbanAction,
  addPreReviewActionAction,
  setPreReviewNoteAction,
  triggerPreReviewSyncAction,
  assignPreReviewAction,
} from '@/app/(team)/propria/avis/actions';
import {
  PreReviewDetailModal,
  MAIN_CAUSE_OPTIONS,
  stayNights,
  type MainCause,
} from '@/components/propria/pre-review-detail-modal';

type KanbanStatus = 'nouveau' | 'risque' | 'neutre' | 'bon' | 'action_lancee' | 'accomplie' | 'ratee';
type Sentiment = 'bon' | 'neutre' | 'mauvais' | null;
type ActionType = 'compensation' | 'message' | 'appel' | 'geste_commercial' | 'relance_positive' | 'autre';

type Tracking = {
  id: string;
  hostaway_reservation_id: number;
  sentiment: Sentiment;
  kanban_status: KanbanStatus;
  main_cause: MainCause | null;
  related_review_id: string | null;
  completed_at: string | null;
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
  // Avis lié (si présent)
  review_rating: number | null;
  review_comment: string | null;
  // Actions liées
  nb_actions: number;
  days_left: number;     // 14 - (today - departure_date)
  assignee_id: string | null;
};

type Assignee = { id: string; full_name: string | null };
type Profile = { id: string; full_name: string | null };

const COLUMNS: { key: KanbanStatus; label: string; color: string; bg: string }[] = [
  { key: 'nouveau',       label: '🆕 À évaluer',          color: 'text-stoniz-gray-700', bg: 'bg-stoniz-gray-50 border-stoniz-gray-300' },
  { key: 'risque',        label: '🔴 Risque mauvais avis', color: 'text-red-700',         bg: 'bg-red-50 border-red-300' },
  // CEO 2026-06-11 : colonne dédiée pour les sentiments neutres
  // (avant ils se confondaient dans la colonne Risque).
  { key: 'neutre',        label: '🟡 Neutre',              color: 'text-amber-700',       bg: 'bg-amber-50 border-amber-300' },
  { key: 'bon',           label: '🟢 Bon retour attendu',  color: 'text-emerald-700',     bg: 'bg-emerald-50 border-emerald-300' },
  { key: 'action_lancee', label: '📤 Action lancée',       color: 'text-orange-700',      bg: 'bg-orange-50 border-orange-300' },
  { key: 'accomplie',     label: '✅ Mission accomplie',    color: 'text-emerald-700',     bg: 'bg-emerald-100 border-emerald-400' },
  { key: 'ratee',         label: '❌ Mission ratée',        color: 'text-red-700',         bg: 'bg-red-100 border-red-400' },
];

const ACTION_TYPE_LABEL: Record<ActionType, string> = {
  compensation: '💶 Compensation',
  message: '✉ Message',
  appel: '📞 Appel',
  geste_commercial: '🎁 Geste commercial',
  relance_positive: '⭐ Relance positive',
  autre: '🔧 Autre',
};

const SENTIMENT_BADGE: Record<NonNullable<Sentiment>, { label: string; color: string }> = {
  bon:     { label: '🟢 Bon',     color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  neutre:  { label: '🟡 Neutre',  color: 'bg-amber-100 text-amber-800 border-amber-200' },
  mauvais: { label: '🔴 Mauvais', color: 'bg-red-100 text-red-800 border-red-200' },
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function TrackingCard({ t, assignees, profiles, canDeleteComments, onRefresh }: {
  t: Tracking;
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [, start] = useTransition();
  const [notes, setNotes] = useState(t.internal_notes ?? '');
  const [actionType, setActionType] = useState<ActionType>('message');
  const [actionDesc, setActionDesc] = useState('');
  const [actionAmount, setActionAmount] = useState('');

  function setSentiment(s: NonNullable<Sentiment>) {
    start(async () => {
      await setPreReviewSentimentAction({ tracking_id: t.id, sentiment: s });
      onRefresh();
    });
  }
  function setCause(cause: MainCause | null) {
    start(async () => {
      await setPreReviewMainCauseAction({ tracking_id: t.id, main_cause: cause });
      onRefresh();
    });
  }
  function moveTo(status: KanbanStatus) {
    start(async () => {
      await movePreReviewKanbanAction({ tracking_id: t.id, status });
      onRefresh();
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
      if (r?.ok) {
        setActionDesc('');
        setActionAmount('');
        onRefresh();
      }
    });
  }
  function saveNote() {
    start(async () => {
      await setPreReviewNoteAction({ tracking_id: t.id, notes });
      onRefresh();
    });
  }
  function assign(assignee_id: string | null) {
    start(async () => {
      await assignPreReviewAction({ tracking_id: t.id, assignee_id });
      onRefresh();
    });
  }

  const isClosed = t.kanban_status === 'accomplie' || t.kanban_status === 'ratee';
  const nights = stayNights(t.arrival_date, t.departure_date);

  return (
    <div
      className="bg-white border border-stoniz-gray-200 rounded-lg p-3 text-xs space-y-2"
      // Drag & drop natif (chantier 7) — désactivé quand la carte est ouverte
      // pour ne pas gêner la sélection de texte dans les champs.
      draggable={!open}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium">{t.guest_name ?? 'Voyageur'}</div>
          <div className="text-[10px] text-stoniz-gray-500">
            {t.channel_name ?? '?'} · départ {fmtDate(t.departure_date)}
            {nights != null && ` · ${nights} nuit${nights > 1 ? 's' : ''}`}
          </div>
        </div>
        {t.unit_code && (
          <div className="text-[10px] font-mono text-stoniz-gray-700 shrink-0">{t.unit_code}</div>
        )}
      </div>

      {/* Assignation */}
      <select
        value={t.assignee_id ?? ''}
        onChange={(e) => assign(e.target.value || null)}
        className={`w-full border rounded px-1.5 py-0.5 text-[10px] ${t.assignee_id ? 'border-blue-300 bg-blue-50' : 'border-stoniz-gray-200 bg-stoniz-gray-50 text-stoniz-gray-500'}`}
      >
        <option value="">— Non assigné —</option>
        {assignees.map((a) => (
          <option key={a.id} value={a.id}>👤 {a.full_name ?? '—'}</option>
        ))}
      </select>

      {/* Badge sentiment + jours restants */}
      <div className="flex items-center gap-2 text-[10px] flex-wrap">
        {t.sentiment && (
          <span className={`px-2 py-0.5 border rounded ${SENTIMENT_BADGE[t.sentiment].color}`}>
            {SENTIMENT_BADGE[t.sentiment].label}
          </span>
        )}
        {!isClosed && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${t.days_left <= 3 ? 'bg-red-100 text-red-800 border-red-200' : 'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-200'}`}>
            <Clock className="w-2.5 h-2.5" />
            {t.days_left > 0 ? `J+${14 - t.days_left}/14` : 'Dernier jour'}
          </span>
        )}
        {t.nb_actions > 0 && (
          <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded">
            {t.nb_actions} action{t.nb_actions > 1 ? 's' : ''}
          </span>
        )}
        {t.review_rating != null && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border ${t.review_rating >= 4.5 ? 'bg-emerald-100 text-emerald-800 border-emerald-200' : 'bg-red-100 text-red-800 border-red-200'}`}>
            <Star className="w-2.5 h-2.5 fill-current" />
            {t.review_rating.toFixed(1)}/5
          </span>
        )}
      </div>

      {t.review_comment && (
        <p className={`text-stoniz-gray-700 italic ${open ? '' : 'line-clamp-2'}`}>
          « {t.review_comment} »
        </p>
      )}

      {t.completion_reason && (
        <div className="text-[10px] text-stoniz-gray-500">{t.completion_reason}</div>
      )}

      {open && (
        <div className="space-y-2 pt-2 border-t border-stoniz-gray-100">
          {/* Voyageur + résa + durée dérivée (chantier 7 — U10) */}
          <div className="text-[10px] text-stoniz-gray-600 space-y-0.5">
            <div className="inline-flex items-center gap-1 mr-3">
              <Hash className="w-2.5 h-2.5 text-stoniz-gray-400" />
              Résa <span className="font-mono">{t.hostaway_reservation_id}</span>
            </div>
            <span className="inline-flex items-center gap-1">
              <Moon className="w-2.5 h-2.5 text-stoniz-gray-400" />
              {nights != null ? `${nights} nuit${nights > 1 ? 's' : ''}` : '—'}
            </span>
            {t.guest_email && (
              <div>✉ <a href={`mailto:${t.guest_email}`} className="text-blue-600 hover:underline break-all">{t.guest_email}</a></div>
            )}
            {t.guest_phone && (
              <div>📞 <a href={`tel:${t.guest_phone}`} className="text-blue-600 hover:underline">{t.guest_phone}</a></div>
            )}
          </div>

          {/* Sentiment manuel — modifiable à tout moment (chantier 7) */}
          <div>
            <div className="text-[10px] text-stoniz-gray-500 mb-1">Sentiment :</div>
            <div className="flex gap-1">
              {(['bon','neutre','mauvais'] as const).map((s) => (
                <button key={s} type="button" onClick={() => setSentiment(s)}
                  className={`px-2 py-0.5 border rounded text-[10px] ${t.sentiment === s ? SENTIMENT_BADGE[s].color : 'bg-white border-stoniz-gray-200 text-stoniz-gray-600 hover:bg-stoniz-gray-50'}`}>
                  {SENTIMENT_BADGE[s].label}
                </button>
              ))}
            </div>
          </div>

          {/* QCM cause principale — visible si sentiment négatif (chantier 7) */}
          {t.sentiment === 'mauvais' && (
            <div>
              <div className="text-[10px] text-stoniz-gray-500 mb-1">Cause principale :</div>
              <div className="flex flex-wrap gap-1">
                {MAIN_CAUSE_OPTIONS.map((c) => (
                  <button key={c.key} type="button"
                    onClick={() => setCause(t.main_cause === c.key ? null : c.key)}
                    className={`px-1.5 py-0.5 border rounded text-[9px] ${t.main_cause === c.key ? 'bg-red-600 text-white border-red-600' : 'bg-white border-stoniz-gray-200 text-stoniz-gray-700 hover:bg-red-50'}`}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <div className="text-[10px] text-stoniz-gray-500 mb-1">Note interne :</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={saveNote}
              placeholder="Contexte, plan d'action…"
              className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]"
              rows={2} />
          </div>

          {/* Ajouter une action */}
          {!isClosed && (
            <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded p-2 space-y-1">
              <div className="text-[10px] font-medium">+ Ajouter une action</div>
              <select value={actionType} onChange={(e) => setActionType(e.target.value as ActionType)}
                className="w-full border border-stoniz-gray-300 rounded px-1 py-0.5 text-[11px]">
                {Object.entries(ACTION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input value={actionDesc} onChange={(e) => setActionDesc(e.target.value)}
                placeholder="Description (optionnel)"
                className="w-full border border-stoniz-gray-300 rounded px-1 py-0.5 text-[11px]" />
              {actionType === 'compensation' && (
                <input value={actionAmount} onChange={(e) => setActionAmount(e.target.value)} type="number" step="0.01"
                  placeholder="Montant"
                  className="w-full border border-stoniz-gray-300 rounded px-1 py-0.5 text-[11px]" />
              )}
              <button type="button" onClick={addAction}
                className="bg-stoniz-black text-white px-2 py-1 rounded text-[10px] w-full">
                Ajouter
              </button>
            </div>
          )}

          {/* Boutons fin manuelle */}
          {!isClosed && (
            <div className="flex gap-1 flex-wrap">
              <button type="button" onClick={() => moveTo('accomplie')}
                className="bg-emerald-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-emerald-700">
                <CheckCircle2 className="w-3 h-3" /> Forcer accomplie
              </button>
              <button type="button" onClick={() => moveTo('ratee')}
                className="bg-red-600 text-white px-2 py-1 rounded text-[10px] inline-flex items-center gap-1 hover:bg-red-700">
                <XCircle className="w-3 h-3" /> Forcer ratée
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={() => setOpen(!open)}
          className="text-blue-600 hover:underline text-[10px] inline-flex items-center gap-1">
          <MessageSquare className="w-2.5 h-2.5" />
          {open ? 'Réduire' : 'Détails / Actions'}
        </button>
        <button type="button" onClick={() => setDetailOpen(true)}
          className="text-stoniz-gray-600 hover:text-stoniz-black hover:underline text-[10px] inline-flex items-center gap-1">
          <PanelRightOpen className="w-2.5 h-2.5" />
          Ticket complet
        </button>
      </div>

      {detailOpen && (
        <PreReviewDetailModal
          t={t}
          assignees={assignees}
          profiles={profiles}
          canDeleteComments={canDeleteComments}
          onClose={() => { setDetailOpen(false); onRefresh(); }}
        />
      )}
    </div>
  );
}

export function PreReviewKanban({ trackings, assignees, profiles, canDeleteComments }: {
  trackings: Tracking[];
  assignees: Assignee[];
  profiles: Profile[];
  canDeleteComments: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function syncNow() {
    start(async () => {
      const r: any = await triggerPreReviewSyncAction();
      if (r?.ok) {
        setMsg(`✓ ${r.created} créé(s) · ${r.basculee_avis_recu} bascule(s) avis · ${r.basculee_expiree} expiré(s)`);
        router.refresh();
      } else {
        setMsg(`✕ ${r?.error ?? 'Erreur'}`);
      }
    });
  }

  // Drag & drop natif (chantier 7) — en PLUS des boutons (fallback mobile)
  function dropMove(id: string, status: KanbanStatus) {
    start(async () => {
      await movePreReviewKanbanAction({ tracking_id: id, status });
      router.refresh();
    });
  }

  const byColumn = new Map<KanbanStatus, Tracking[]>();
  for (const c of COLUMNS) byColumn.set(c.key, []);
  for (const t of trackings) byColumn.get(t.kanban_status)?.push(t);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        {msg && <div className="text-xs text-emerald-700">{msg}</div>}
        <button type="button" onClick={syncNow} disabled={pending}
          className="border border-stoniz-gray-300 px-3 py-1.5 rounded text-xs hover:bg-stoniz-gray-50 inline-flex items-center gap-1 disabled:opacity-50">
          <RefreshCw className={`w-3 h-3 ${pending ? 'animate-spin' : ''}`} />
          {pending ? 'Sync…' : 'Forcer sync trackings'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-7 gap-3">
        {COLUMNS.map((col) => {
          const items = byColumn.get(col.key) ?? [];
          return (
            <div
              key={col.key}
              className={`rounded-xl border-2 p-3 ${col.bg}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData('text/plain');
                if (id) dropMove(id, col.key);
              }}
            >
              <div className={`text-xs font-medium mb-3 flex items-center justify-between ${col.color}`}>
                <span>{col.label}</span>
                <span className="bg-white border border-current rounded-full px-2 text-[10px]">{items.length}</span>
              </div>
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {items.map((t) => (
                  <TrackingCard key={t.id} t={t} assignees={assignees} profiles={profiles}
                    canDeleteComments={canDeleteComments} onRefresh={() => router.refresh()} />
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
