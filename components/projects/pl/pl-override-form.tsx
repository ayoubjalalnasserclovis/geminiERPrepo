'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  setProjectPLOverrideAction,
  deleteProjectPLOverrideAction,
} from '@/app/(team)/projects/[id]/pl/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';
import { Button } from '@/components/ui/button';

/**
 * Saisie de l'override de multiplicateur pour ce projet.
 *
 * Le multiplicateur indique combien de fois la "part moyenne" de masse
 * salariale ce projet a consommé. Valeur 1.0 = moyenne (pas d'override
 * effectif), 1.5 = 50 % de plus, 0.5 = 50 % de moins.
 *
 * Visible uniquement pour les rôles qui peuvent écrire (CEO + finance).
 * Pour les autres rôles, on peut afficher en lecture seule.
 *
 * CEO 2026-06-30 Phase B3.
 */
export function PLOverrideForm({
  projectId,
  initialMultiplier,
  initialNotes,
  canEdit,
}: {
  projectId: string;
  initialMultiplier: number | null;
  initialNotes: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mult, setMult] = useState<string>(
    initialMultiplier != null ? String(initialMultiplier) : '1.0',
  );
  const [notes, setNotes] = useState<string>(initialNotes ?? '');

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canEdit) return;
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('project_id', projectId);
    fd.set('weight_multiplier', mult);
    fd.set('notes', notes);
    start(async () => {
      try {
        const r = await setProjectPLOverrideAction(fd);
        if (!r || !r.ok) {
          setError((r as any)?.error ?? 'Erreur — merci de réessayer.');
          return;
        }
        setSuccess('Override enregistré.');
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur réseau — merci de réessayer.');
      }
    });
  }

  function handleReset() {
    if (!canEdit) return;
    if (initialMultiplier == null) {
      // Rien à supprimer, on remet juste les champs.
      setMult('1.0');
      setNotes('');
      return;
    }
    if (!confirm('Supprimer l\'override personnalisé de ce projet ?')) return;
    setError(null);
    setSuccess(null);
    const fd = new FormData();
    fd.set('project_id', projectId);
    start(async () => {
      try {
        const r = await deleteProjectPLOverrideAction(fd);
        if (!r || !r.ok) {
          setError((r as any)?.error ?? 'Erreur — merci de réessayer.');
          return;
        }
        setMult('1.0');
        setNotes('');
        setSuccess('Override supprimé.');
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur réseau — merci de réessayer.');
      }
    });
  }

  return (
    <form onSubmit={handleSave} className="space-y-3">
      <div className="grid gap-3 md:grid-cols-[180px_1fr] items-start">
        <label className="text-sm font-medium pt-2">
          Multiplicateur
          <span className="block text-xs font-normal text-stoniz-gray-500">
            1.0 = moyenne, 1.5 = 1.5× plus, 0.5 = 2× moins
          </span>
        </label>
        <input
          type="number"
          step="0.05"
          min={0}
          max={10}
          value={mult}
          onChange={(e) => setMult(e.target.value)}
          disabled={!canEdit || pending}
          className="w-32 rounded border border-grey-line px-2 py-1.5 text-sm disabled:bg-stoniz-gray-50 disabled:text-stoniz-gray-500"
        />
      </div>
      <div className="grid gap-3 md:grid-cols-[180px_1fr] items-start">
        <label className="text-sm font-medium pt-2">Notes</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={!canEdit || pending}
          rows={2}
          placeholder="Ex: gros chantier MEP, beaucoup d'aller-retours équipe"
          className="w-full rounded border border-grey-line px-2 py-1.5 text-sm disabled:bg-stoniz-gray-50"
        />
      </div>

      {canEdit && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button type="submit" disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={handleReset}
            disabled={pending}
          >
            {initialMultiplier == null ? 'Réinitialiser' : 'Supprimer l\'override'}
          </Button>
          {success && (
            <span className="text-xs text-green-700">{success}</span>
          )}
        </div>
      )}
      {!canEdit && (
        <p className="text-xs text-stoniz-gray-500">
          Lecture seule — seuls le CEO et la finance peuvent modifier
          l'override d'un projet.
        </p>
      )}
      {error && <SessionExpiredBanner error={error} />}
    </form>
  );
}
