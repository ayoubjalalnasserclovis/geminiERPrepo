'use client';

import { useState, useTransition } from 'react';
import { Pin, PinOff, Trash2, Pencil, Send, X, Check, FileText } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  addProjectNoteAction, updateProjectNoteAction, deleteProjectNoteAction,
} from '@/app/(team)/projects/[id]/notes/actions';
import { MESSAGE_TEMPLATES, TEMPLATE_CATEGORIES } from '@/lib/notes/message-templates';

type Note = {
  id: string;
  body: string;
  category: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  author_id: string | null;
  author?: { full_name: string | null; role: string | null } | null;
};

const CATEGORIES: { value: string; label: string; emoji: string }[] = [
  { value: 'note',            label: 'Note',           emoji: '📝' },
  { value: 'appel',           label: 'Appel',          emoji: '📞' },
  { value: 'reunion',         label: 'Réunion',        emoji: '🤝' },
  { value: 'suivi_chantier',  label: 'Suivi chantier', emoji: '🔨' },
  { value: 'interne',         label: 'Interne',        emoji: '🏢' },
  { value: 'client',          label: 'Client',         emoji: '👤' },
  { value: 'partenaire',      label: 'Partenaire',     emoji: '🤝' },
  { value: 'alerte',          label: 'Alerte',         emoji: '⚠️' },
];

const CAT_LABEL = Object.fromEntries(CATEGORIES.map(c => [c.value, c]));

export function ProjectNotes({
  projectId, notes, currentUserId, currentUserRole,
}: {
  projectId: string;
  notes: Note[];
  currentUserId: string;
  currentUserRole: string;
}) {
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('note');
  const [pinned, setPinned] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  // CEO 2026-06-18 : modale "voir toutes les notes" pour éviter de scroller.
  const [showAllNotes, setShowAllNotes] = useState(false);
  const PREVIEW_COUNT = 3;

  function applyTemplate(id: string) {
    const tpl = MESSAGE_TEMPLATES.find(t => t.id === id);
    if (!tpl) return;
    setBody(tpl.body);
    if (tpl.defaultCategory) setCategory(tpl.defaultCategory);
    setShowTemplates(false);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!body.trim()) return;
    start(async () => {
      const r = await addProjectNoteAction({ project_id: projectId, body, category, pinned });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setBody('');
      setCategory('note');
      setPinned(false);
    });
  }

  // Trier : épinglées d'abord, puis par date desc
  const sorted = [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Notes & journal de suivi</CardTitle>
          <span className="text-xs text-stoniz-gray-500">{notes.length} entrée{notes.length > 1 ? 's' : ''}</span>
        </div>
      </CardHeader>
      <CardContent>
        {/* Form d'ajout */}
        <form onSubmit={submit} className="space-y-2 mb-4 pb-4 border-b">
          <div className="flex items-center justify-end mb-1">
            <button type="button" onClick={() => setShowTemplates(!showTemplates)}
              className="text-xs text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> {showTemplates ? 'Masquer les modèles' : 'Insérer un modèle…'}
            </button>
          </div>
          {showTemplates && (
            <div className="bg-stoniz-gray-50 border rounded-md p-3 space-y-3 max-h-60 overflow-auto">
              {TEMPLATE_CATEGORIES.map(cat => (
                <div key={cat}>
                  <div className="text-xs uppercase text-stoniz-gray-500 font-medium mb-1">{cat}</div>
                  <div className="space-y-1">
                    {MESSAGE_TEMPLATES.filter(t => t.category === cat).map(t => (
                      <button key={t.id} type="button" onClick={() => applyTemplate(t.id)}
                        className="block w-full text-left text-sm hover:bg-white rounded px-2 py-1 transition-colors">
                        → {t.title}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <Textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Ajouter une note (appel, réunion, suivi chantier…)"
            rows={body.split('\n').length > 3 ? Math.min(body.split('\n').length + 1, 12) : 2}
            className="resize-none"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="h-8 rounded-md border bg-white px-2 text-sm">
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.emoji} {c.label}</option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-stoniz-gray-600 cursor-pointer">
                <input type="checkbox" checked={pinned} onChange={e => setPinned(e.target.checked)} />
                <Pin className="w-3.5 h-3.5" /> Épingler
              </label>
            </div>
            <Button type="submit" size="sm" disabled={pending || !body.trim()}>
              <Send className="w-3.5 h-3.5" /> {pending ? '…' : 'Ajouter'}
            </Button>
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </form>

        {/* Liste */}
        {sorted.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500 py-4 text-center">
            Aucune note pour le moment. Démarrez le journal en ajoutant la première entrée.
          </p>
        ) : (
          <>
            <ul className="space-y-3">
              {sorted.slice(0, PREVIEW_COUNT).map(n => (
                <NoteRow key={n.id} note={n} projectId={projectId}
                  canEdit={n.author_id === currentUserId || currentUserRole === 'ceo'} />
              ))}
            </ul>
            {sorted.length > PREVIEW_COUNT && (
              <button
                type="button"
                onClick={() => setShowAllNotes(true)}
                className="mt-3 w-full text-sm text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-md py-2"
              >
                Voir toutes les notes ({sorted.length}) →
              </button>
            )}
          </>
        )}
      </CardContent>

      {/* Modale plein écran : toutes les notes */}
      {showAllNotes && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowAllNotes(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-stoniz-gray-200 p-4 flex items-center justify-between">
              <div>
                <h2 className="font-display text-lg">📝 Journal complet du projet</h2>
                <p className="text-xs text-stoniz-gray-500 mt-0.5">{sorted.length} note{sorted.length > 1 ? 's' : ''} · épinglées en haut</p>
              </div>
              <button
                onClick={() => setShowAllNotes(false)}
                className="text-stoniz-gray-500 hover:text-stoniz-black p-1"
                title="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <ul className="space-y-3">
                {sorted.map(n => (
                  <NoteRow key={n.id} note={n} projectId={projectId}
                    canEdit={n.author_id === currentUserId || currentUserRole === 'ceo'} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function NoteRow({
  note, projectId, canEdit,
}: {
  note: Note;
  projectId: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.body);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const cat = CAT_LABEL[note.category] ?? CAT_LABEL.note;

  function save() {
    setError(null);
    start(async () => {
      const r = await updateProjectNoteAction(note.id, { body: draft });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setEditing(false);
    });
  }

  function togglePin() {
    start(async () => {
      await updateProjectNoteAction(note.id, { pinned: !note.pinned });
    });
  }

  function remove() {
    if (!confirm('Supprimer cette note ?')) return;
    start(async () => {
      const r = await deleteProjectNoteAction(note.id);
      if (!r.ok) setError(r.error ?? 'Erreur');
    });
  }

  return (
    <li className={`rounded-lg border p-3 ${note.pinned ? 'border-accent bg-accent-light/30' : 'border-stoniz-gray-200'}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border text-stoniz-gray-700">
            <span>{cat.emoji}</span>
            <span>{cat.label}</span>
          </span>
          <span className="text-stoniz-gray-600 font-medium">{note.author?.full_name ?? '—'}</span>
          {note.author?.role && (
            <span className="text-stoniz-gray-400">· {note.author.role}</span>
          )}
          <span className="text-stoniz-gray-400">
            · {formatDateTime(note.created_at)}
            {note.updated_at && note.updated_at !== note.created_at && (
              <span className="italic"> · modifiée</span>
            )}
          </span>
          {note.pinned && (
            <Badge variant="warning" className="text-[10px]">épinglée</Badge>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button onClick={togglePin} disabled={pending}
              className="text-stoniz-gray-500 hover:text-stoniz-black p-1 rounded"
              title={note.pinned ? 'Désépingler' : 'Épingler'}>
              {note.pinned ? <PinOff className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}
            </button>
            {!editing && (
              <button onClick={() => setEditing(true)} disabled={pending}
                className="text-stoniz-gray-500 hover:text-stoniz-black p-1 rounded"
                title="Modifier">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={remove} disabled={pending}
              className="text-stoniz-gray-500 hover:text-red-600 p-1 rounded"
              title="Supprimer">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea value={draft} onChange={e => setDraft(e.target.value)} rows={3} className="resize-none" />
          {error && <div className="text-sm text-red-600">{error}</div>}
          <div className="flex justify-end gap-1">
            <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(note.body); }} disabled={pending}>
              <X className="w-3.5 h-3.5" /> Annuler
            </Button>
            <Button size="sm" onClick={save} disabled={pending || draft.trim() === note.body.trim()}>
              <Check className="w-3.5 h-3.5" /> {pending ? '…' : 'Enregistrer'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm whitespace-pre-wrap text-stoniz-gray-800">{note.body}</p>
      )}
    </li>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.round(diffMs / 60000);
  const diffH = Math.round(diffMs / 3600000);
  const diffD = Math.round(diffMs / 86400000);
  if (diffMin < 1) return 'à l\'instant';
  if (diffMin < 60) return `il y a ${diffMin} min`;
  if (diffH < 24) return `il y a ${diffH}h`;
  if (diffD < 7) return `il y a ${diffD}j`;
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
