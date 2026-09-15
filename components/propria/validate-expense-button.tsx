'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { validateExpenseAction } from '@/app/(team)/propria/caisse/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Bouton "valider" pour une dépense avec PJ — CEO uniquement côté action.
 * Composant client pour éviter le crash render des `<form action={fn.bind}>`.
 */
export function ValidateExpenseButton({
  expenseId,
  walletId,
}: {
  expenseId: string;
  walletId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function validate() {
    setError(null);
    start(async () => {
      try {
        const r = await validateExpenseAction(expenseId, walletId);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-center">
      <button
        type="button"
        onClick={validate}
        disabled={pending}
        className="text-xs text-stoniz-black hover:underline font-semibold disabled:opacity-50"
      >
        {pending ? '…' : 'valider'}
      </button>
      {error && (
        <span className="mt-1 block">
          <SessionExpiredBanner error={error} />
        </span>
      )}
    </span>
  );
}
