'use client';

import { useState } from 'react';
import { addServicePaymentAction } from './actions';
import { formatServiceCategory } from '@/lib/finance/services-calc';

type Lot = {
  id: string;
  service_category: string;
  provider: { name: string } | null;
};

export function AddPaymentForm({ projectId, lots }: { projectId: string; lots: Lot[] }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'planifie' | 'paye'>('planifie');
  const today = new Date().toISOString().slice(0, 10);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await addServicePaymentAction(new FormData(e.currentTarget));
      (e.target as HTMLFormElement).reset();
      setMode('planifie');
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />

      {/* Mode : programmer / enregistrer */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-stoniz-gray-600">État :</span>
        <button
          type="button"
          onClick={() => setMode('planifie')}
          className={`px-3 py-1 rounded-md border text-xs ${
            mode === 'planifie'
              ? 'bg-stoniz-black text-white border-stoniz-black'
              : 'bg-white text-stoniz-gray-700'
          }`}
        >
          À décaisser (planifié)
        </button>
        <button
          type="button"
          onClick={() => setMode('paye')}
          className={`px-3 py-1 rounded-md border text-xs ${
            mode === 'paye'
              ? 'bg-stoniz-black text-white border-stoniz-black'
              : 'bg-white text-stoniz-gray-700'
          }`}
        >
          Déjà payé
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <div className="md:col-span-2">
          <label className="text-xs text-stoniz-gray-600 block mb-1">Lot *</label>
          <select
            name="lot_id"
            required
            defaultValue=""
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="" disabled>— Choisir —</option>
            {lots.map((l) => (
              <option key={l.id} value={l.id}>
                {formatServiceCategory(l.service_category)}
                {l.provider?.name ? ` · ${l.provider.name}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Montant (MAD) *</label>
          <input
            type="text"
            name="amount_paid"
            required
            placeholder="ex : 5000.00"
            pattern="^-?\d+(\.\d{1,2})?$"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>

        {/* Date dynamique selon le mode choisi */}
        {mode === 'paye' ? (
          <div>
            <label className="text-xs text-stoniz-gray-600 block mb-1">Date du paiement *</label>
            <input
              type="date"
              name="paid_at"
              defaultValue={today}
              required
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
        ) : (
          <div>
            <label className="text-xs text-stoniz-gray-600 block mb-1">
              Échéance prévue *
            </label>
            <input
              type="date"
              name="scheduled_date"
              required
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
          </div>
        )}

        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Acompte n°</label>
          <input
            type="number"
            name="acompte_index"
            min={1}
            max={6}
            placeholder="1-6"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="md:col-span-4">
          <label className="text-xs text-stoniz-gray-600 block mb-1">Description (optionnel)</label>
          <input
            type="text"
            name="description"
            placeholder="Ex : Acompte 1 de 30%"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        <div className="md:col-span-5 flex items-center justify-between">
          {error && <div className="text-sm text-red-600">{error}</div>}
          <button
            type="submit"
            disabled={submitting}
            className="ml-auto bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50"
          >
            {submitting ? 'Ajout…' : mode === 'paye' ? 'Enregistrer le paiement' : 'Planifier le paiement'}
          </button>
        </div>
      </div>
    </form>
  );
}
