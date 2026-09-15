'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, X } from 'lucide-react';
import { softDeleteStonizExpenseAction } from '@/app/(team)/caisse-stoniz/actions';

/**
 * Soft-delete d'une dépense Caisse STONIZ (CEO 2026-06-22).
 *
 * Affiche un bouton 🗑 qui ouvre une mini-confirmation, puis appelle
 * softDeleteStonizExpenseAction(id). Erreur affichée si l'utilisateur
 * n'est pas l'auteur (et n'est pas CEO).
 *
 * Visibilité gérée côté parent — n'affiche le bouton que si autorisé.
 */
export function DeleteExpenseButton({
  expenseId,
  label,
}: {
  expenseId: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function confirm() {
    setError(null);
    start(async () => {
      try {
        const res = await softDeleteStonizExpenseAction(expenseId);
        if (res && typeof res === 'object' && 'ok' in res && (res as any).ok === false) {
          setError((res as any).error ?? 'Erreur inconnue');
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur réseau');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-stoniz-gray-500 hover:text-red-600 text-[11px]"
        title="Supprimer cette dépense"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-stoniz-gray-200 p-4 flex items-center justify-between">
              <h2 className="font-display text-base inline-flex items-center gap-2">
                <Trash2 className="w-4 h-4 text-red-600" />
                Supprimer la dépense
              </h2>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="text-stoniz-gray-500 hover:text-stoniz-black p-1 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              <p className="text-sm text-stoniz-gray-700">
                Supprimer cette dépense (<strong>{label}</strong>) ? La ligne sera masquée
                immédiatement. Le CEO peut la restaurer depuis la page admin.
              </p>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2.5">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="px-3 py-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={confirm}
                  disabled={pending}
                  className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                >
                  {pending ? 'Suppression…' : 'Supprimer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
