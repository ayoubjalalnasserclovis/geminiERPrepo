'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { uploadExpenseReceiptAction } from '@/app/(team)/propria/caisse/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Bouton d'upload de justificatif (PJ) pour une dépense.
 * Composant client car on doit utiliser `onChange` pour auto-submit le formulaire
 * dès qu'un fichier est sélectionné.
 *
 * Submit via useTransition + FormData manuelle pour gérer le retour
 * { ok, error } de la server action (pattern défensif session expirée).
 */
export function ExpenseReceiptUpload({
  expenseId,
  walletId,
}: {
  expenseId: string;
  walletId: string;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('expense_id', expenseId);
    fd.append('wallet_id', walletId);
    setError(null);
    start(async () => {
      try {
        const r = await uploadExpenseReceiptAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
      } catch (ex) {
        setError(ex instanceof Error ? ex.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <label className="cursor-pointer text-xs text-stoniz-gray-500 hover:text-stoniz-black underline">
        {pending ? '⏳ envoi…' : '📎 ajouter PJ'}
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
          onChange={onChange}
          disabled={pending}
          className="hidden"
        />
      </label>
      {error && (
        <span className="block mt-1">
          <SessionExpiredBanner error={error} />
        </span>
      )}
    </span>
  );
}
