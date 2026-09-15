'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { StickyNote, Plus, Trash2, History } from 'lucide-react';
import {
  createDailyNoteAction,
  toggleDailyNoteResolvedAction,
  deleteDailyNoteAction,
} from '@/app/(team)/propria/daily/actions';

/**
 * Encart « Notes du daily » (CEO 2026-06-11).
 *
 * - Partagé entre l'équipe Propria (CEO + propria + dev)
 * - 1 entrée = 1 note libre
 * - Checkbox à côté → marque résolu, disparaît de l'encart actif
 * - Toggle « Voir résolues (N) » → dépile l'historique (décochable pour
 *   re-basculer en actif)
 */

export type DailyNote = {
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

export function DailyNotesCard({
  activeNotes,
  resolvedNotes,
  canDelete,
}: {
  activeNotes: DailyNote[];
  resolvedNotes: DailyNote[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  // Optimistic UI : on tient la liste des IDs qu'on a basculés en local
  // pour que la note disparaisse instantanément sans attendre le refresh.
  const [pendingToggle, setPendingToggle] = useState<Set<string>>(new Set());
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (text.trim().length === 0) return;
    setError(null);
    const fd = new FormData();
    fd.set('content', text.trim());
    start(async () => {
      const r = await createDailyNoteAction(fd);
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
      const r = await toggleDailyNoteResolvedAction(id, resolved);
      if (!r.ok) {
        // Annule le toggle optimistic
        setPendingToggle((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        setError(r.error);
        return;
      }
      router.refresh();
      // On laisse le pendingToggle, il sera "purgé" implicitement après refresh
      // car la note va passer côté résolu/actif et la nouvelle liste n'aura
      // plus de risque d'incohérence.
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
      const r = await deleteDailyNoteAction(id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  // Filtre optimistic : si on vient de cocher une active, on la cache tout de
  // suite ; si on vient de décocher une résolue, idem.
  const displayedActive = activeNotes.filter((n) => !pendingToggle.has(n.id));
  const displayedResolved = resolvedNotes.filter((n) => !pendingToggle.has(n.id));

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <StickyNote className="w-4 h-4 text-amber-600" />
          <span className="text-sm font-medium">Notes du daily</span>
          <span className="text-xs text-stoniz-gray-500">({displayedActive.length} en cours)</span>
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
          placeholder="Une chose à noter pour l'équipe…"
          className="flex-1 border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm resize-none"
          maxLength={2000}
          disabled={pending}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter pour submit rapide
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

      {/* Liste des notes actives */}
      {displayedActive.length === 0 ? (
        <p className="text-xs text-stoniz-gray-400 italic py-2">
          Aucune note en cours. Note ce que tu veux suivre au prochain point.
        </p>
      ) : (
        <ul className="space-y-2">
          {displayedActive.map((n) => (
            <li key={n.id} className="flex items-start gap-2 group bg-amber-50/40 border border-amber-100 rounded-md p-2">
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
          ))}
        </ul>
      )}

      {/* Historique des résolues */}
      {showHistory && displayedResolved.length > 0 && (
        <div className="mt-4 pt-3 border-t border-stoniz-gray-100">
          <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500 mb-2">
            Résolues ({displayedResolved.length})
          </div>
          <ul className="space-y-1.5">
            {displayedResolved.map((n) => (
              <li key={n.id} className="flex items-start gap-2 group">
                <input
                  type="checkbox"
                  checked={true}
                  onChange={() => toggle(n.id, false)}
                  disabled={pending}
                  className="mt-1 w-4 h-4 cursor-pointer accent-emerald-600 shrink-0"
                  title="Re-activer cette note"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-stoniz-gray-500 line-through whitespace-pre-wrap break-words">{n.content}</div>
                  <div className="text-[10px] text-stoniz-gray-400 mt-0.5">
                    {n.created_by_name ?? 'Inconnu'}
                    {' · noté '}{timeAgo(n.created_at)}
                    {n.resolved_at && ` · réglé ${timeAgo(n.resolved_at)}${n.resolved_by_name ? ` par ${n.resolved_by_name}` : ''}`}
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
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
