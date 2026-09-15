'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw } from 'lucide-react';
import { restoreStonizExpenseAction } from '@/app/(team)/caisse-stoniz/actions';

/**
 * Bouton "Restaurer" pour une dépense soft-deletée — CEO uniquement.
 * Visible uniquement quand l'utilisateur a activé "Afficher supprimées" et que
 * le rôle courant est `ceo` (les autres rôles n'auraient de toute façon pas le
 * droit côté server action).
 *
 * Pattern aligné sur DeleteExpenseButton : confirm natif + transition + toast
 * d'erreur si l'action renvoie { ok: false, error }.
 */
export function RestoreExpenseButton({
  expenseId,
  label,
}: {
  expenseId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!window.confirm(`Restaurer la dépense "${label}" ?\n\nElle réapparaîtra dans la liste active et sera à nouveau prise en compte dans les soldes.`)) return;
    setError(null);
    start(async () => {
      const r = await restoreStonizExpenseAction(expenseId);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title="Restaurer cette dépense"
        className="inline-flex items-center justify-center w-7 h-7 rounded text-emerald-600 hover:bg-emerald-50 disabled:opacity-50"
      >
        <RotateCcw className="w-3.5 h-3.5" />
      </button>
      {error && (
        <span className="text-[10px] text-red-600 ml-1" title={error}>
          ⚠
        </span>
      )}
    </>
  );
}
