'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { addAccountAction, addCompanyAction } from './actions';

type Company = {
  id: string;
  code: string;
  name: string;
  business_unit: string;
  currency: string;
};

/**
 * Formulaire d'ajout d'un compte bancaire à une société existante.
 * Permet aussi (sous bouton secondaire) d'ajouter une nouvelle société.
 */
export function AddAccountForm({ companies }: { companies: Company[] }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'account' | 'company'>('account');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmitAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await addAccountAction(new FormData(e.currentTarget));
      setOpen(false);
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitCompany(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await addCompanyAction(new FormData(e.currentTarget));
      setTab('account');
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm border border-stoniz-gray-300 rounded-md px-4 py-2 hover:bg-stoniz-gray-50"
      >
        <Plus className="w-4 h-4" />
        Ajouter un compte
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={() => setOpen(false)} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-xl shadow-xl p-6 z-50 w-full max-w-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-xl">
            {tab === 'account' ? 'Nouveau compte bancaire' : 'Nouvelle société'}
          </h3>
          <button onClick={() => setOpen(false)} className="text-stoniz-gray-400 hover:text-stoniz-black">✕</button>
        </div>

        {tab === 'account' ? (
          <form onSubmit={onSubmitAccount} className="space-y-3">
            <div>
              <label className="text-xs text-stoniz-gray-600">Société *</label>
              <select
                name="company_id"
                required
                defaultValue=""
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              >
                <option value="" disabled>— Choisir —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.business_unit === 'stoniz' ? 'Clé-en-main' : 'Conciergerie'})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setTab('company')}
                className="text-xs text-stoniz-gray-500 underline mt-1"
              >
                + Ajouter une nouvelle société
              </button>
            </div>
            <div>
              <label className="text-xs text-stoniz-gray-600">Code banque *</label>
              <input
                type="text"
                name="bank_code"
                required
                placeholder="chaabi, cih, bmce, qonto, lcl..."
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-stoniz-gray-600">Libellé banque *</label>
              <input
                type="text"
                name="bank_label"
                required
                placeholder="Banque Populaire (Chaabi Bank)"
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-stoniz-gray-600">Libellé du compte *</label>
              <input
                type="text"
                name="account_label"
                required
                placeholder="STZ OJ — Chaabi Casablanca — Compte 2"
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-stoniz-gray-600">Numéro de compte (optionnel)</label>
                <input
                  type="text"
                  name="account_number"
                  placeholder="21211 9800233 000 1"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-stoniz-gray-600">Devise *</label>
                <select
                  name="currency"
                  required
                  defaultValue="MAD"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="MAD">MAD (Dirham)</option>
                  <option value="EUR">EUR (Euro)</option>
                  <option value="USD">USD (Dollar)</option>
                </select>
              </div>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="pt-3 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="text-sm px-4 py-2 text-stoniz-gray-600">
                Annuler
              </button>
              <button type="submit" disabled={submitting} className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50">
                {submitting ? 'Ajout…' : 'Ajouter le compte'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={onSubmitCompany} className="space-y-3">
            <p className="text-xs text-stoniz-gray-500">
              Ex : STZ CLUB (conciergerie Propria) ou ELZ HOLVESTA (société France EUR).
            </p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-stoniz-gray-600">Code interne *</label>
                <input
                  type="text"
                  name="code"
                  required
                  pattern="^[a-z0-9_]+$"
                  placeholder="stz_club, elz_holvesta"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
                />
              </div>
              <div>
                <label className="text-xs text-stoniz-gray-600">Activité *</label>
                <select
                  name="business_unit"
                  required
                  defaultValue=""
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="" disabled>— Choisir —</option>
                  <option value="stoniz">Stoniz clé-en-main</option>
                  <option value="propria">Propria conciergerie</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-stoniz-gray-600">Nom court *</label>
              <input
                type="text"
                name="name"
                required
                placeholder="STZ CLUB SARL"
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-stoniz-gray-600">Raison sociale complète (optionnel)</label>
              <input
                type="text"
                name="legal_name"
                placeholder="STZ CLUB SARL au capital de..."
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-stoniz-gray-600">Pays *</label>
                <select
                  name="country_code"
                  required
                  defaultValue="MA"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="MA">Maroc</option>
                  <option value="FR">France</option>
                  <option value="ES">Espagne</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-stoniz-gray-600">Devise principale *</label>
                <select
                  name="currency"
                  required
                  defaultValue="MAD"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="MAD">MAD</option>
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="pt-3 flex items-center justify-between gap-2">
              <button type="button" onClick={() => setTab('account')} className="text-sm px-4 py-2 text-stoniz-gray-600 underline">
                ← Retour au compte
              </button>
              <button type="submit" disabled={submitting} className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50">
                {submitting ? 'Ajout…' : 'Ajouter la société'}
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
