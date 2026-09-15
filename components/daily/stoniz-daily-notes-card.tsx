'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StickyNote, Plus, Trash2, History, AlarmClock } from 'lucide-react';
import {
  createStonizDailyNoteAction,
  toggleStonizDailyNoteResolvedAction,
  deleteStonizDailyNoteAction,
} from '@/app/(team)/daily/actions';

/**
 * Encart « Notes du daily » — Daily Stoniz (CEO 2026-07-06).
 *
 * Adapté du DailyNotesCard Propria (non modifié : scope interdit de la session).
 * Différence clé : les notes non résolues créées AVANT aujourd'hui sont
 * marquées « Reporté de la veille » et remontées en tête de liste — c'est le
 * rappel des actions décidées au daily précédent et pas encore traitées.
 */

export type StonizDailyNote = {
  id: string;
  content: string;
  created_at: string;
  created_by_name: string | null;
  resolved_at: string | null;
  resolved_by_name: string | null;
};

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h}h`;
  const days = Math.round(h / 24);
  if (days < 7) return `il y a ${days}j`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function isBeforeToday(iso: string): boolean {
  const d = new Date(iso);
  const today = new Date();
  return d.getFullYear() < today.getFullYear()
    || (d.getFullYear() === today.getFullYear() && (
      d.getMonth() < today.getMonth()
      || (d.getMonth() === today.getMonth() && d.getDate() < today.getDate())
    ));
}

export function StonizDailyNotesCard({
  activeNotes,
  resolvedNotes,
  canDelete,
}: {
  activeNotes: StonizDailyNote[];
  resolvedNotes: StonizDailyNote[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Optimistic UI : IDs basculés localement pour disparition instantanée.
  const [pendingToggle, setPendingToggle] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (text.trim().length === 0) return;
    setError(null);
    const fd = new FormData();
    fd.set('content', text.trim());
    start(async () => {
      const r = await createStonizDailyNoteAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setText('');
      router.refresh();
      textareaRef.current?.focus();
    });
  }

  function toggle(id: string, resolved: boolean) {
    setPendingToggle((prev) => new Set(prev).add(id));
    start(async () => {
      const r = await toggleStonizDailyNoteResolvedAction(id, resolved);
      if (!r.ok) {
        setPendingToggle((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setError(r.error);
        return;
      }
      router.refresh();
      setTimeout(() => {
        setPendingToggle((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 800);
    });
  }

  function remove(id: string) {
    if (!confirm('Supprimer définitivement cette note ?')) return;
    start(async () => {
      const r = await deleteStonizDailyNoteAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  const displayedActive = activeNotes.filter((n) => !pendingToggle.has(n.id));
  const displayedResolved = resolvedNotes.filter((n) => !pendingToggle.has(n.id));

  // Reports de la veille en tête (rappel des décisions non traitées).
  const carried = displayedActive.filter((n) => isBeforeToday(n.created_at));
  const fresh = displayedActive.filter((n) => !isBeforeToday(n.created_at));
  const ordered = [...carried, ...fresh];

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-medium">Notes du daily</span>
          <span className="text-xs text-stoniz-gray-500">({displayedActive.length} en cours)</span>
          {carried.length > 0 && (
            <span className="text-[10px] bg-orange-100 text-orange-700 border border-orange-200 rounded-full px-2 py-0.5 inline-flex items-center gap-1">
              <AlarmClock className="w-3 h-3" /> {carried.length} reporté{carried.length > 1 ? 's' : ''} de la veille
            </span>
          )}
        </div>
        {resolvedNotes.length > 0 && (
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            <History className="w-3 h-3" />
            {showHistory ? 'Masquer' : `Voir résolues (${resolvedNotes.length})`}
          </button>
        )}
      </div>

      {/* Form d'ajout */}
      <form onSubmit={submit} className="mb-3 flex items-start gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={2}
          placeholder="Une décision, une action à suivre pour l'équipe…"
          className="flex-1 border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm resize-none"
          maxLength={2000}
          disabled={pending}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              (e.currentTarget.form as HTMLFormElement)?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={pending || text.trim().length === 0}
          className="bg-stoniz-black text-white rounded-md px-3 py-2 text-sm hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-1 shrink-0"
          title="Ajouter (⌘↵)"
        >
          <Plus className="w-4 h-4" />
          Ajouter
        </button>
      </form>

      {error && (
        <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>
      )}

      {/* Liste des notes actives (reports de la veille d'abord) */}
      {ordered.length === 0 ? (
        <p className="text-xs text-stoniz-gray-400 italic py-2">
          Aucune note en cours. Note les décisions du daily pour les retrouver demain.
        </p>
      ) : (
        <ul className="space-y-2">
          {ordered.map((n) => {
            const isCarried = isBeforeToday(n.created_at);
            return (
              <li
                key={n.id}
                className={`flex items-start gap-2 group rounded-md p-2 border ${
                  isCarried ? 'bg-orange-50/50 border-orange-200' : 'bg-amber-50/40 border-amber-100'
                }`}
              >
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => toggle(n.id, true)}
                  disabled={pending}
                  className="mt-1 w-4 h-4 cursor-pointer accent-emerald-600 shrink-0"
                  title="Marquer comme réglé"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-stoniz-gray-800 whitespace-pre-wrap break-words">{n.content}</div>
                  <div className="text-[10px] text-stoniz-gray-500 mt-0.5">
                    {isCarried && (
                      <span className="text-orange-700 font-medium">Reporté · </span>
                    )}
                    {n.created_by_name ?? 'Inconnu'} · {timeAgo(n.created_at)}
                  </div>
                </div>
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    disabled={pending}
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-stoniz-gray-400 hover:text-red-600 shrink-0"
                    title="Supprimer définitivement"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Historique des résolues */}
      {showHistory && displayedResolved.length > 0 && (
        <ul className="space-y-1.5 mt-3 pt-3 border-t border-stoniz-gray-100">
          {displayedResolved.map((n) => (
            <li key={n.id} className="flex items-start gap-2 group">
              <input
                type="checkbox"
                checked
                onChange={() => toggle(n.id, false)}
                disabled={pending}
                className="mt-0.5 w-4 h-4 cursor-pointer accent-emerald-600 shrink-0"
                title="Repasser en cours"
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-stoniz-gray-400 line-through whitespace-pre-wrap break-words">
                  {n.content}
                </div>
                <div className="text-[10px] text-stoniz-gray-400">
                  réglé par {n.resolved_by_name ?? '—'}
                  {n.resolved_at ? ` · ${timeAgo(n.resolved_at)}` : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
