'use client';

import { useState, useTransition } from 'react';
import { createListingMetricAction } from '@/app/(team)/propria/listings/actions';

const PLATFORM_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking', vrbo: 'VRBO', direct: 'Direct',
};

/**
 * Form de saisie d'un point de mesure Airbnb / Booking — en composant client
 * pour contourner le crash render des `<form action={serverAction}>` sur
 * Server Components pour le rôle propria (constaté en prod 2026-06-08).
 */
export function ListingMetricForm({
  lotOptions,
}: {
  lotOptions: { id: string; label: string }[];
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setErr(null);
    start(async () => {
      try {
        await createListingMetricAction(fd);
        (e.target as HTMLFormElement).reset();
      } catch (ex: any) {
        setErr(ex?.message ?? 'Erreur');
      }
    });
  }

  return (
    <details open className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
      <summary className="cursor-pointer font-medium">+ Enregistrer un point de mesure</summary>
      <form onSubmit={submit} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
        <select name="propria_unit_id" required className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
          <option value="">— Lot (listing) *</option>
          {lotOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <select name="platform" required defaultValue="airbnb" className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
          {Object.entries(PLATFORM_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input
          name="measured_at" type="date" required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="rating" type="number" step="0.01" min="0" max="5"
          placeholder="Note /5 (ex 4.87)"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="nb_reviews" type="number" placeholder="Nombre d'avis"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="occupancy_rate" type="number" step="0.01" min="0" max="100"
          placeholder="Taux occup. (%)"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
        />
        <input
          name="notes" placeholder="Notes / contexte"
          className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm md:col-span-2"
        />
        <button
          type="submit" disabled={pending}
          className="bg-stoniz-black text-white py-2 rounded text-sm disabled:opacity-50"
        >
          {pending ? '…' : '+ Ajouter'}
        </button>
        {err && <div className="md:col-span-3 text-sm text-red-600">{err}</div>}
      </form>
    </details>
  );
}
