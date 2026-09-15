'use client';

import { useState, useTransition } from 'react';
import { UserCog, Check, X } from 'lucide-react';
import { updateProjectChefAction } from '@/app/(team)/projects/actions';

type Chef = { id: string; full_name: string };

/**
 * Affiche le chef de projet assigné et permet à un CEO/commercial de le
 * changer en inline (sélecteur déroulant + bouton Enregistrer). Émet
 * l'email d'assignation côté serveur si le chef change.
 */
export function ProjectChefAssign({
  projectId,
  currentChefId,
  currentChefName,
  chefs,
  canEdit,
}: {
  projectId: string;
  currentChefId: string | null;
  currentChefName: string | null;
  chefs: Chef[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [value, setValue] = useState<string>(currentChefId ?? '');

  // Mode lecture : on affiche juste l'info, avec un bouton d'édition si autorisé.
  if (!editing) {
    return (
      <div className="inline-flex items-center gap-2 text-sm">
        <UserCog className="w-4 h-4 text-stoniz-gray-500" />
        <span className="text-stoniz-gray-600">Chef de projet :</span>
        <span className="font-medium">
          {currentChefName ?? <span className="italic text-stoniz-gray-400">non assigné</span>}
        </span>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setEditing(true); setErr(null); setValue(currentChefId ?? ''); }}
            className="text-xs text-stoniz-black underline hover:no-underline ml-1"
          >
            {currentChefId ? 'Changer' : 'Assigner'}
          </button>
        )}
      </div>
    );
  }

  // Mode édition : select + Enregistrer / Annuler.
  function save() {
    setErr(null);
    start(async () => {
      const res = await updateProjectChefAction({
        project_id: projectId,
        chef_id: value || null,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!res?.ok) { setErr(res?.error ?? 'Échec'); return; }
      setEditing(false);
    });
  }

  return (
    <div className="inline-flex items-center gap-2 text-sm">
      <UserCog className="w-4 h-4 text-stoniz-gray-500" />
      <span className="text-stoniz-gray-600">Chef de projet :</span>
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={pending}
        className="h-8 rounded-md border bg-white px-2 text-sm"
      >
        <option value="">— non assigné —</option>
        {chefs.map((c) => (
          <option key={c.id} value={c.id}>{c.full_name}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={save}
        disabled={pending}
        title="Enregistrer"
        className="p-1 rounded hover:bg-emerald-50 text-emerald-700 disabled:opacity-50"
      >
        <Check className="w-4 h-4" />
      </button>
      <button
        type="button"
        onClick={() => { setEditing(false); setErr(null); }}
        disabled={pending}
        title="Annuler"
        className="p-1 rounded hover:bg-stoniz-gray-100 text-stoniz-gray-500"
      >
        <X className="w-4 h-4" />
      </button>
      {err && <span className="text-xs text-red-600">{err}</span>}
    </div>
  );
}
