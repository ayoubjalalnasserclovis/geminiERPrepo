'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { bulkAssignCleaningsAction } from '@/app/(team)/propria/menage/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

type Unassigned = {
  id: string;
  description: string | null;
  type_label: string;
  urgency: string;
  occurred_at: string;
  due_date: string | null;
  scope_label: string;
};

type Assignee = {
  id: string;
  full_name: string | null;
  role: string | null;
};

const URG_BADGE: Record<string, string> = {
  critique: 'bg-red-100 text-red-800',
  haute: 'bg-orange-100 text-orange-800',
  normale: 'bg-amber-100 text-amber-800',
  basse: 'bg-stoniz-gray-100 text-stoniz-gray-700',
};
const URG_LABEL: Record<string, string> = {
  critique: '🔴 Critique', haute: '🟠 Haute', normale: '🟡 Normale', basse: '🟢 Basse',
};

/**
 * Bandeau orange sur /propria/menage : liste les ménages sans assigné et
 * propose une mini-modale d'assignation en lot. Identique à
 * BulkAssignBanner (interventions) mais ciblé sur la table propria_cleanings.
 */
export function BulkAssignCleaningsBanner({
  unassigned,
  assignees,
}: {
  unassigned: Unassigned[];
  assignees: Assignee[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [assignedToId, setAssignedToId] = useState<string>('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const sorted = useMemo(() => {
    const order: Record<string, number> = { critique: 0, haute: 1, normale: 2, basse: 3 };
    return [...unassigned].sort((a, b) => {
      const u = (order[a.urgency] ?? 99) - (order[b.urgency] ?? 99);
      if (u !== 0) return u;
      return a.occurred_at.localeCompare(b.occurred_at);
    });
  }, [unassigned]);

  function openModal() {
    setSelected(new Set(sorted.map((u) => u.id)));
    setAssignedToId('');
    setMsg(null);
    setOpen(true);
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === sorted.length) setSelected(new Set());
    else setSelected(new Set(sorted.map((u) => u.id)));
  }

  function submit() {
    if (!assignedToId) {
      setMsg({ kind: 'err', text: 'Choisis une dame de ménage à qui assigner.' });
      return;
    }
    if (selected.size === 0) {
      setMsg({ kind: 'err', text: 'Sélectionne au moins un ménage.' });
      return;
    }
    setMsg(null);
    start(async () => {
      try {
        const r = await bulkAssignCleaningsAction({
          cleaning_ids: Array.from(selected),
          assigned_to_id: assignedToId,
        });
        if (!r || !r.ok) {
          setMsg({ kind: 'err', text: r?.error ?? 'Échec.' });
          return;
        }
        const assignee = assignees.find((a) => a.id === assignedToId);
        setMsg({
          kind: 'ok',
          text: `✓ ${r.updatedCount} ménage(s) assigné(s) à ${assignee?.full_name ?? 'l’assigné'}.`,
        });
        setTimeout(() => setOpen(false), 1500);
      } catch (e) {
        setMsg({ kind: 'err', text: e instanceof Error ? e.message : 'Erreur inconnue' });
      }
    });
  }

  if (unassigned.length === 0) return null;

  return (
    <>
      <div className="bg-orange-50 border border-orange-300 rounded-xl p-4 mb-6 flex items-center justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <AlertTriangle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-orange-900">
              {unassigned.length} ménage{unassigned.length > 1 ? 's' : ''} sans assigné
            </div>
            <p className="text-xs text-orange-800/80 mt-0.5">
              Assigne-les en lot pour qu’une dame de ménage puisse les prendre en charge.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={openModal}
          className="bg-orange-600 text-white px-4 py-2 rounded-md text-sm hover:bg-orange-700 flex-shrink-0"
        >
          Assigner en lot →
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white rounded-2xl max-w-2xl w-full p-6 max-h-[90vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-1">
              <h2 className="font-display text-xl">
                Assigner en lot · {unassigned.length} ménage{unassigned.length > 1 ? 's' : ''}
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stoniz-gray-500 hover:text-stoniz-black"
                aria-label="Fermer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-stoniz-gray-500 mb-4">
              Choisis une dame de ménage puis coche les ménages à lui confier. Tout est pré-coché.
            </p>

            <div className="mb-3">
              <label className="block text-xs text-stoniz-gray-600 mb-1">
                Assigner à <span className="text-red-600">*</span>
              </label>
              <select
                value={assignedToId}
                onChange={(e) => setAssignedToId(e.target.value)}
                className="w-full h-10 rounded-md border bg-white px-3 text-sm"
              >
                <option value="">— Choisir une dame de ménage —</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.full_name ?? '(sans nom)'}{a.role ? ` · ${a.role}` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="border rounded-lg overflow-hidden flex-1 flex flex-col min-h-0">
              <div className="bg-stoniz-gray-50 border-b px-3 py-2 flex items-center justify-between text-sm">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.size === sorted.length && sorted.length > 0}
                    onChange={toggleAll}
                  />
                  Tout cocher · {selected.size}/{sorted.length}
                </label>
              </div>
              <ul className="divide-y text-sm overflow-y-auto">
                {sorted.map((it) => (
                  <li key={it.id} className="px-3 py-2 flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected.has(it.id)}
                      onChange={() => toggle(it.id)}
                      className="mt-1 flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${URG_BADGE[it.urgency]}`}>
                          {URG_LABEL[it.urgency]}
                        </span>
                        <span className="text-xs text-stoniz-gray-700 font-medium">{it.type_label}</span>
                        <span className="text-xs text-stoniz-gray-500">{it.scope_label}</span>
                        <span className="text-xs text-stoniz-gray-400">
                          · {new Date(it.occurred_at).toLocaleDateString('fr-FR')}
                          {it.due_date && ` → échéance ${new Date(it.due_date).toLocaleDateString('fr-FR')}`}
                        </span>
                      </div>
                      {it.description && (
                        <div className="text-stoniz-gray-700 mt-0.5 truncate" title={it.description}>
                          {it.description}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            {msg && msg.kind === 'ok' && (
              <div className="mt-3 text-sm rounded-md px-3 py-2 bg-emerald-50 text-emerald-800 border border-emerald-200">
                {msg.text}
              </div>
            )}
            {msg && msg.kind === 'err' && (
              <div className="mt-3">
                <SessionExpiredBanner error={msg.text} />
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-4 py-2 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={pending || selected.size === 0 || !assignedToId}
                className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
              >
                {pending
                  ? 'Assignation…'
                  : `Assigner ${selected.size} ménage${selected.size > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
