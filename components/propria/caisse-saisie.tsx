'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createDotationAction, createExpenseAction } from '@/app/(team)/propria/caisse/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Forms de saisie (dotation + dépense) extraits en composant client.
 *
 * Pourquoi : quand on plaçait `<form action={createDotationAction}>` directement
 * dans la page server, Next.js 14 produisait un crash SSR ("Server Components
 * render error") intermittent pour le rôle `propria`. En les isolant dans un
 * client component qui submit via useTransition + FormData, on évite le bug de
 * sérialisation de la référence d'action côté serveur.
 */
export function CaisseSaisieForms({
  walletId,
  lotOptions,
}: {
  walletId: string;
  lotOptions: { id: string; label: string }[];
}) {
  return (
    <div className="grid md:grid-cols-2 gap-6 mb-8">
      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <summary className="cursor-pointer font-medium">+ Ajouter une dotation</summary>
        <DotationForm walletId={walletId} />
      </details>

      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <summary className="cursor-pointer font-medium">+ Enregistrer une dépense</summary>
        <ExpenseForm walletId={walletId} lotOptions={lotOptions} />
      </details>
    </div>
  );
}

function DotationForm({ walletId }: { walletId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    start(async () => {
      try {
        const r = await createDotationAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        form.reset();
        router.refresh();
      } catch (ex) {
        setError(ex instanceof Error ? ex.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <input type="hidden" name="wallet_id" value={walletId} />
      <div className="grid grid-cols-2 gap-3">
        <input
          name="given_at" type="date" required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="amount_mad" type="number" step="0.01" required placeholder="Montant MAD"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>
      <select
        name="type" defaultValue="dotation"
        className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
      >
        <option value="dotation">Dotation initiale</option>
        <option value="rechargement">Rechargement</option>
      </select>
      <input
        name="note" placeholder="Note (optionnel)"
        className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
      />
      <SessionExpiredBanner error={error} />
      <button
        type="submit" disabled={pending}
        className="w-full bg-stoniz-black text-white py-2 rounded text-sm disabled:opacity-50"
      >
        {pending ? '…' : 'Ajouter la dotation'}
      </button>
    </form>
  );
}

function ExpenseForm({
  walletId,
  lotOptions,
}: {
  walletId: string;
  lotOptions: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    setError(null);
    start(async () => {
      try {
        const r = await createExpenseAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        form.reset();
        router.refresh();
      } catch (ex) {
        setError(ex instanceof Error ? ex.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-3">
      <input type="hidden" name="wallet_id" value={walletId} />
      <div className="grid grid-cols-2 gap-3">
        <input
          name="spent_at" type="date" required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="amount_mad" type="number" step="0.01" required placeholder="Montant MAD"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>
      <select
        name="propria_unit_id"
        className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
      >
        <option value="">— Aucun lot (dépense générale) —</option>
        {lotOptions.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-3">
        <input
          name="category" placeholder="Catégorie (Courses, Réparation...)"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <select
          name="charge_to" defaultValue="propria"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        >
          <option value="propria">À la charge Propria</option>
          <option value="client">À la charge client</option>
          <option value="copropriete">Copropriété</option>
        </select>
      </div>
      <input
        name="description" required placeholder="Description courte *"
        className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
      />
      <div>
        <label className="text-xs text-stoniz-gray-600 block mb-1">
          Justificatif <span className="text-stoniz-gray-500">(optionnel · PDF, JPG, PNG · max 10 MB)</span>
        </label>
        <input
          name="receipt_file"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
          className="w-full text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:bg-stoniz-gray-100 file:text-stoniz-gray-800 file:text-xs file:font-medium hover:file:bg-stoniz-gray-200 file:cursor-pointer"
        />
      </div>
      <SessionExpiredBanner error={error} />
      <button
        type="submit" disabled={pending}
        className="w-full bg-stoniz-black text-white py-2 rounded text-sm disabled:opacity-50"
      >
        {pending ? '…' : 'Enregistrer la dépense'}
      </button>
    </form>
  );
}
