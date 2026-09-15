'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closeWalletAction } from '@/app/(team)/propria/caisse/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Bouton "Clôturer la caisse" en composant client. Réutilise closeWalletAction
 * (CEO/finance) — la confirmation utilisateur évite les fermetures accidentelles.
 *
 * NB : on n'utilise PAS le pattern `<form action={fn.bind(...)}>` qui plantait
 * intermittemment au SSR pour le rôle propria. Le submit via useTransition est
 * stable pour tous les rôles.
 */
export function CloseWalletButton({ walletId }: { walletId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (!confirm('Clôturer cette caisse ? L’opération est réservée au CEO/finance.')) return;
    setError(null);
    start(async () => {
      try {
        const r = await closeWalletAction(walletId);
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
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={close}
        disabled={pending}
        className="text-xs text-red-700 hover:underline disabled:opacity-50"
      >
        {pending ? 'Clôture…' : 'Clôturer la caisse'}
      </button>
      {error && (
        <span className="block mt-1">
          <SessionExpiredBanner error={error} />
        </span>
      )}
    </div>
  );
}
