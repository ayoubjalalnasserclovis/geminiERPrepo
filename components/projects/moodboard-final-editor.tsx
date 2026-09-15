'use client';

// Éditeur du moodboard final (CEO 2026-08-19, session D). Rôles ceo/chef_projet
// (vérifiés côté action serveur — le formulaire s'affiche mais échoue proprement
// pour les autres rôles).

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMoodboardFinalAction, clearMoodboardFinalAction } from '@/app/(team)/projects/[id]/moodboard/actions';

type Template = { id: string; name: string; style: string | null };

export function MoodboardFinalEditor({
  projectId,
  templates,
  currentTemplateId,
  currentLabel,
  hasFinal,
}: {
  projectId: string;
  templates: Template[];
  currentTemplateId: string | null;
  currentLabel: string | null;
  hasFinal: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(!hasFinal);
  const [templateId, setTemplateId] = useState(currentTemplateId ?? '');
  const [label, setLabel] = useState(currentLabel ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  function save() {
    start(async () => {
      const r = await setMoodboardFinalAction(projectId, {
        template_id: templateId || null,
        label: templateId ? null : label,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg((r as any).error ?? 'Échec'); return; }
      setMsg(null);
      setEditing(false);
      router.refresh();
    });
  }

  function clear() {
    if (!confirm('Effacer le moodboard sélectionné ? (le choix redeviendra « à définir »)')) return;
    start(async () => {
      const r = await clearMoodboardFinalAction(projectId).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg((r as any).error ?? 'Échec'); return; }
      setMsg(null);
      setTemplateId('');
      setLabel('');
      setEditing(true);
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <button type="button" onClick={() => setEditing(true)} className="text-stoniz-gray-600 hover:text-stoniz-black underline underline-offset-4">
          Modifier le choix
        </button>
        <button type="button" onClick={clear} disabled={pending} className="text-stoniz-gray-500 hover:text-red-600 underline underline-offset-4 disabled:opacity-50">
          Effacer
        </button>
        {msg && <span className="text-red-600">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {!hasFinal && (
        <p className="text-sm text-stoniz-gray-500">Aucun choix final acté pour l'instant.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
          className="text-sm border border-stoniz-gray-300 rounded px-2 py-1.5"
        >
          <option value="">— Moodboard du catalogue —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.style ? ` · ${t.style}` : ''}</option>
          ))}
        </select>
        <span className="text-xs text-stoniz-gray-500">ou</span>
        <input
          type="text"
          value={label}
          onChange={(e) => { setLabel(e.target.value); if (e.target.value) setTemplateId(''); }}
          placeholder="Libellé libre (ex : mix Terracotta + Riad moderne)"
          className="text-sm border border-stoniz-gray-300 rounded px-2 py-1.5 w-72"
          disabled={!!templateId}
        />
        <button
          type="button"
          onClick={save}
          disabled={pending || (!templateId && !label.trim())}
          className="bg-stoniz-black text-white px-3 py-1.5 rounded text-sm disabled:opacity-50"
        >
          {pending ? '…' : '✓ Acter ce choix'}
        </button>
        {hasFinal && (
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">
            Annuler
          </button>
        )}
      </div>
      {msg && <div className="text-xs text-red-600">{msg}</div>}
    </div>
  );
}
