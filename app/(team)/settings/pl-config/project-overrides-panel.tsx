'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2, Edit, X, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';
import {
  setProjectOverrideAction,
  deleteProjectOverrideAction,
} from './actions';

/**
 * Section 3 — Overrides projet (Phase B2 — CEO 2026-06-30).
 *
 * Tableau des projets ayant un override + modale d'ajout + édition inline.
 * Pattern défensif sur toutes les actions.
 */

export type ProjectOption = {
  id: string;
  reference: string;
  client_name: string | null;
  current_phase: string | null;
};

export type OverrideRow = {
  project_id: string;
  multiplier: number;
  notes: string | null;
  // Hydratation : meta projet (jointure depuis la page parent).
  reference: string;
  client_name: string | null;
  current_phase: string | null;
};

export type ProjectOverridesPanelProps = {
  overrides: OverrideRow[];
  allActiveProjects: ProjectOption[];
  readOnly?: boolean;
};

function projectLabel(p: { reference: string; client_name: string | null }) {
  const cli = p.client_name ? ` — ${p.client_name}` : '';
  return `${p.reference}${cli}`;
}

export function ProjectOverridesPanel({
  overrides,
  allActiveProjects,
  readOnly = false,
}: ProjectOverridesPanelProps) {
  const [modalOpen, setModalOpen] = useState(false);

  // IDs déjà overridés : on les exclut de la combobox d'ajout.
  const overriddenIds = useMemo(
    () => new Set(overrides.map((o) => o.project_id)),
    [overrides],
  );
  const candidates = useMemo(
    () => allActiveProjects.filter((p) => !overriddenIds.has(p.id)),
    [allActiveProjects, overriddenIds],
  );

  return (
    <div>
      {!readOnly && (
        <div className="flex justify-end mb-3">
          <Button
            type="button"
            size="sm"
            variant="primary"
            onClick={() => setModalOpen(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Ajouter un override
          </Button>
        </div>
      )}

      {overrides.length === 0 ? (
        <div className="text-sm text-stoniz-gray-500 italic bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-4 text-center">
          Aucun override actif — tous les projets utilisent le coefficient
          de leur phase, sans ajustement.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-stoniz-gray-500 border-b border-stoniz-gray-200">
                <th className="py-2 pr-4 font-medium">Projet</th>
                <th className="py-2 pr-4 font-medium">Phase</th>
                <th className="py-2 pr-4 font-medium">Multiplicateur</th>
                <th className="py-2 pr-4 font-medium">Notes</th>
                {!readOnly && <th className="py-2 pr-4 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {overrides.map((o) => (
                <OverrideRowEditor
                  key={o.project_id}
                  row={o}
                  readOnly={readOnly}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <AddOverrideModal
          candidates={candidates}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

// ─── Ligne éditable inline ──────────────────────────────────────────────────

function OverrideRowEditor({
  row,
  readOnly,
}: {
  row: OverrideRow;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [mult, setMult] = useState<string>(String(row.multiplier));
  const [notes, setNotes] = useState<string>(row.notes ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onSave() {
    setError(null);
    const fd = new FormData();
    fd.set('project_id', row.project_id);
    fd.set('multiplier', mult);
    fd.set('notes', notes);
    start(async () => {
      try {
        const r = await setProjectOverrideAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        setEditing(false);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur inconnue');
      }
    });
  }

  function onDelete() {
    if (!confirm(`Supprimer l'override pour ${row.reference} ?`)) return;
    setError(null);
    const fd = new FormData();
    fd.set('project_id', row.project_id);
    start(async () => {
      try {
        const r = await deleteProjectOverrideAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur inconnue');
      }
    });
  }

  return (
    <tr className="border-b border-stoniz-gray-100 last:border-0 align-top">
      <td className="py-3 pr-4">
        <div className="font-medium text-stoniz-gray-800">{row.reference}</div>
        {row.client_name && (
          <div className="text-xs text-stoniz-gray-500">{row.client_name}</div>
        )}
      </td>
      <td className="py-3 pr-4">
        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-700">
          {row.current_phase ?? '—'}
        </span>
      </td>
      <td className="py-3 pr-4">
        {editing ? (
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={10}
            step={0.1}
            value={mult}
            onChange={(e) => setMult(e.target.value)}
            disabled={pending}
            className="w-20 px-2 py-1 rounded-sm border border-stoniz-gray-300 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
          />
        ) : (
          <span className="font-mono tabular-nums text-stoniz-gray-800">
            × {row.multiplier.toFixed(2)}
          </span>
        )}
      </td>
      <td className="py-3 pr-4 text-xs text-stoniz-gray-600 max-w-md">
        {editing ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={pending}
            rows={2}
            className="w-full px-2 py-1 rounded-sm border border-stoniz-gray-300 text-xs focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
          />
        ) : (
          <span>{row.notes || <em className="text-stoniz-gray-400">—</em>}</span>
        )}
        {error && (
          <div className="mt-1.5">
            <SessionExpiredBanner error={error} />
          </div>
        )}
      </td>
      {!readOnly && (
        <td className="py-3 pr-4">
          <div className="flex items-center gap-1.5">
            {editing ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  disabled={pending}
                  onClick={onSave}
                >
                  <Check className="w-3.5 h-3.5" />
                  {pending ? '…' : 'OK'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() => {
                    setEditing(false);
                    setMult(String(row.multiplier));
                    setNotes(row.notes ?? '');
                  }}
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setEditing(true)}
                  disabled={pending}
                >
                  <Edit className="w-3.5 h-3.5" />
                  Modifier
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={onDelete}
                  disabled={pending}
                  className="text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </>
            )}
          </div>
        </td>
      )}
    </tr>
  );
}

// ─── Modale d'ajout ─────────────────────────────────────────────────────────

function AddOverrideModal({
  candidates,
  onClose,
}: {
  candidates: ProjectOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [projectId, setProjectId] = useState<string>('');
  const [mult, setMult] = useState<string>('1.5');
  const [notes, setNotes] = useState<string>('');
  const [query, setQuery] = useState<string>('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates.slice(0, 100);
    return candidates
      .filter(
        (p) =>
          p.reference.toLowerCase().includes(q) ||
          (p.client_name ?? '').toLowerCase().includes(q),
      )
      .slice(0, 100);
  }, [candidates, query]);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!projectId) {
      setError('Sélectionne un projet.');
      return;
    }
    const num = Number(mult);
    if (isNaN(num) || num < 0 || num > 10) {
      setError('Multiplicateur invalide (0 → 10).');
      return;
    }
    const fd = new FormData();
    fd.set('project_id', projectId);
    fd.set('multiplier', mult);
    fd.set('notes', notes);
    start(async () => {
      try {
        const r = await setProjectOverrideAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
        onClose();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur inconnue');
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-md shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-stoniz-gray-200">
          <h3 className="font-display text-lg">Ajouter un override projet</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="text-stoniz-gray-400 hover:text-stoniz-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-stoniz-gray-500 mb-1">
              Projet
            </label>
            <input
              type="search"
              placeholder="Rechercher (référence ou client)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full px-3 py-2 rounded-sm border border-stoniz-gray-300 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
            />
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              size={6}
              disabled={pending}
              className="w-full px-2 py-1 rounded-sm border border-stoniz-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
            >
              <option value="">— Sélectionner —</option>
              {filtered.map((p) => (
                <option key={p.id} value={p.id}>
                  {projectLabel(p)}
                  {p.current_phase ? ` [${p.current_phase}]` : ''}
                </option>
              ))}
            </select>
            <div className="text-[11px] text-stoniz-gray-500 mt-1">
              {candidates.length} projet(s) éligible(s)
              {query && ` — ${filtered.length} affiché(s)`}
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-stoniz-gray-500 mb-1">
              Multiplicateur (0 → 10)
            </label>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              max={10}
              step={0.1}
              value={mult}
              onChange={(e) => setMult(e.target.value)}
              disabled={pending}
              className="w-32 px-2 py-1.5 rounded-sm border border-stoniz-gray-300 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
            />
            <div className="text-[11px] text-stoniz-gray-500 mt-1">
              Ex : 1.8 si le projet a consommé 1,8× le temps moyen ;
              0.5 si bien moins demandant.
            </div>
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-stoniz-gray-500 mb-1">
              Notes (optionnel)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={pending}
              rows={3}
              placeholder="Justification de l'ajustement…"
              className="w-full px-3 py-2 rounded-sm border border-stoniz-gray-300 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30"
            />
          </div>

          {error && <SessionExpiredBanner error={error} />}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-stoniz-gray-200">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
