'use client';

import { useState } from 'react';
import { ProviderCombobox, type Provider } from '@/components/artisans/provider-combobox';
import { createServiceLotAction } from './actions';
import { SERVICE_CATEGORIES, SERVICE_LOT_STATUSES } from '@/lib/finance/services-calc';

export function AddLotForm({ projectId, providers }: { projectId: string; providers: Provider[] }) {
  const [category, setCategory] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createServiceLotAction(new FormData(e.currentTarget));
      (e.target as HTMLFormElement).reset();
      setCategory('');
    } catch (err: any) {
      setError(err?.message ?? 'Erreur');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <input type="hidden" name="project_id" value={projectId} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Catégorie de service *</label>
          <select
            name="service_category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            required
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value="" disabled>— Choisir —</option>
            {SERVICE_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Statut</label>
          <select
            name="status"
            defaultValue="devis_recu"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          >
            {SERVICE_LOT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="text-xs text-stoniz-gray-600 block mb-1">Prestataire *</label>
        <ProviderCombobox
          providers={providers}
          providerType="prestataire_service"
          serviceCategory={category || null}
          required
        />
        <p className="text-[10px] text-stoniz-gray-500 mt-1">
          {category
            ? `Filtré sur les ${SERVICE_CATEGORIES.find(c => c.value === category)?.label.toLowerCase() ?? 'prestataires'}. Tape un nouveau nom pour créer.`
            : 'Choisis d\'abord une catégorie pour filtrer les prestataires.'}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">
            Devis prévisionnel (MAD)
          </label>
          <input
            type="text"
            name="budget_estimate_mad"
            placeholder="Pré-devis estimé avant signature"
            pattern="^-?\d+(\.\d{1,2})?$"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">
            Devis prestataire signé (MAD)
          </label>
          <input
            type="text"
            name="devis_prestataire_mad"
            placeholder="Devis officiel"
            pattern="^-?\d+(\.\d{1,2})?$"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-stoniz-gray-600 block mb-1">Description (optionnel)</label>
        <input
          type="text"
          name="description"
          placeholder="Ex : Plans d'avant-projet + permis de construire"
          className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={submitting}
          className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Création…' : 'Ajouter ce lot'}
        </button>
      </div>
    </form>
  );
}
