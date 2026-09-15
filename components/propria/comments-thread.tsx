'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Send, Trash2, MessageCircle } from 'lucide-react';
import {
  getCommentsAction,
  addCommentAction,
  deleteCommentAction,
  type CommentEntityType,
  type PropriaComment,
} from '@/app/(team)/propria/comments-actions';

type Profile = { id: string; full_name: string | null };

/**
 * Fil de commentaires partagé (décision B5) — litiges, avis, incidents.
 * Saisie avec Entrée OU bouton, mentions @ (autocomplete sur les profils
 * passés en prop, uuid stockés dans mentions[]). Suppression CEO only.
 */
export function CommentsThread({
  entityType,
  entityId,
  profiles,
  canDelete = false,
}: {
  entityType: CommentEntityType;
  entityId: string;
  profiles: Profile[];
  /** true si l'utilisateur courant est CEO (suppression) */
  canDelete?: boolean;
}) {
  const [comments, setComments] = useState<PropriaComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function reload() {
    const r = await getCommentsAction({ entity_type: entityType, entity_id: entityId });
    if (r.ok) setComments(r.comments);
    setLoading(false);
  }

  useEffect(() => {
    setLoading(true);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  // ─── Autocomplete @mention : token "@xxx" en fin de saisie ────────────
  const mentionMatch = body.match(/@([^\s@]*)$/);
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const suggestions = mentionQuery != null
    ? profiles.filter((p) =>
        (p.full_name ?? '').toLowerCase().includes(mentionQuery)).slice(0, 5)
    : [];

  function pickMention(p: Profile) {
    setBody(body.replace(/@([^\s@]*)$/, `@${p.full_name ?? '?'} `));
    setMentionIds((cur) => (cur.includes(p.id) ? cur : [...cur, p.id]));
    inputRef.current?.focus();
  }

  function submit() {
    const text = body.trim();
    if (!text || pending) return;
    setErr(null);
    start(async () => {
      const r = await addCommentAction({
        entity_type: entityType,
        entity_id: entityId,
        body: text,
        mentions: mentionIds,
      });
      if (!r.ok) { setErr(r.error); return; }
      setBody('');
      setMentionIds([]);
      await reload();
    });
  }

  function remove(id: string) {
    start(async () => {
      const r = await deleteCommentAction({ comment_id: id });
      if (!r.ok) { setErr(r.error); return; }
      await reload();
    });
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleString('fr-FR', {
      day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-[11px] font-medium text-stoniz-gray-700 inline-flex items-center gap-1">
        <MessageCircle className="w-3 h-3" /> Commentaires
        {comments.length > 0 && <span className="text-stoniz-gray-400">({comments.length})</span>}
      </div>

      {loading ? (
        <div className="text-[10px] text-stoniz-gray-400">Chargement…</div>
      ) : comments.length === 0 ? (
        <div className="text-[10px] text-stoniz-gray-400">Aucun commentaire.</div>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {comments.map((c) => (
            <div key={c.id} className="bg-stoniz-gray-50 border border-stoniz-gray-100 rounded px-2 py-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium">{c.author_name ?? '—'}</span>
                <span className="text-[9px] text-stoniz-gray-400 inline-flex items-center gap-1">
                  {fmt(c.created_at)}
                  {canDelete && (
                    <button type="button" onClick={() => remove(c.id)} title="Supprimer (CEO)"
                      className="text-stoniz-gray-400 hover:text-red-600">
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  )}
                </span>
              </div>
              <p className="text-[11px] text-stoniz-gray-800 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        {suggestions.length > 0 && (
          <div className="absolute bottom-full left-0 mb-1 bg-white border border-stoniz-gray-200 rounded shadow-md z-10 w-56">
            {suggestions.map((p) => (
              <button key={p.id} type="button" onClick={() => pickMention(p)}
                className="block w-full text-left px-2 py-1 text-[11px] hover:bg-blue-50">
                @{p.full_name ?? '—'}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-1">
          <input
            ref={inputRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length === 0) { e.preventDefault(); submit(); }
              if (e.key === 'Enter' && suggestions.length > 0) { e.preventDefault(); pickMention(suggestions[0]); }
            }}
            placeholder="Commentaire… (@ pour mentionner)"
            className="flex-1 border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]"
          />
          <button type="button" onClick={submit} disabled={pending || !body.trim()}
            className="bg-stoniz-black text-white px-2 py-1 rounded text-[10px] disabled:opacity-40 inline-flex items-center gap-1">
            <Send className="w-3 h-3" />
          </button>
        </div>
      </div>

      {err && <div className="text-[10px] text-red-700">{err}</div>}
    </div>
  );
}
