'use client';

import { useState } from 'react';
import { recordBalanceAction } from './actions';

type Account = {
  id: string;
  account_label: string;
  bank_label: string;
  currency: string;
};

export function RecordBalanceForm({ accounts }: { accounts: Account[] }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const formData = new FormData(e.currentTarget);
    try {
      await recordBalanceAction(formData);
      // Reset form
      (e.target as HTMLFormElement).reset();
    } catch (err: any) {
      setError(err?.message ?? 'Erreur inconnue');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
      <div>
        <label className="text-xs text-stoniz-gray-600">Compte *</label>
        <select
          name="account_id"
          required
          defaultValue=""
          className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        >
          <option value="" disabled>— Choisir un compte —</option>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.bank_label} · {a.account_label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-stoniz-gray-600">Date du solde *</label>
        <input
          type="date"
          name="balance_date"
          required
          defaultValue={today}
          max={today}
          className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="text-xs text-stoniz-gray-600">Solde (sans espaces, ex. 172000.50) *</label>
        <input
          type="text"
          name="balance_amount"
          required
          placeholder="172000.50"
          pattern="^-?\d+(\.\d{1,2})?$"
          className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
        />
      </div>
      <div>
        <label className="text-xs text-stoniz-gray-600">Note (optionnel)</label>
        <input
          type="text"
          name="notes"
          placeholder="Hors chèques en cours, etc."
          className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>
      <div className="md:col-span-4 flex items-center justify-between">
        {error && <div className="text-sm text-red-600">{error}</div>}
        <button
          type="submit"
          disabled={submitting}
          className="ml-auto bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : 'Enregistrer le solde'}
        </button>
      </div>
    </form>
  );
}
