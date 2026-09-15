'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { updatePropriaUnitAction } from '@/app/(team)/propria/biens/[id]/units/actions';

type Provider = { id: string; name: string; function: string | null };

/**
 * Édition des champs LISTING d'un lot (propria_units) — prix, annonces,
 * capacité, photos… Source de vérité = le lot.
 */
export function PropriaUnitEditForm({
  unit,
  propertyId,
  providers = [],
}: {
  unit: Record<string, any>;
  propertyId: string;
  providers?: Provider[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    setSaved(false);
    start(async () => {
      try {
        await updatePropriaUnitAction(unit.id, fd);
        setSaved(true);
        router.refresh();
      } catch (err: any) {
        setError(err?.message ?? 'Erreur lors de l\'enregistrement');
      }
    });
  }

  const input = 'mt-1 w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm';
  const label = 'text-xs text-stoniz-gray-600';
  const dft = (k: string) => unit[k] ?? '';

  return (
    <form onSubmit={handleSubmit} className="mt-3 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-lg p-4">
      {/* property_id requis par le schéma de mise à jour (ignoré ensuite) */}
      <input type="hidden" name="property_id" value={propertyId} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={label}>Prix / nuit (MAD)</label>
          <input type="number" step="0.01" name="propria_base_price_per_night"
            defaultValue={dft('propria_base_price_per_night')} className={input} />
        </div>
        <div>
          <label className={label}>Capacité voyageurs</label>
          <input type="number" name="propria_capacity_voyageurs"
            defaultValue={dft('propria_capacity_voyageurs')} className={input} />
        </div>
        <div>
          <label className={label}>Nb chambres</label>
          <input type="number" name="propria_nb_chambres" min={0}
            defaultValue={dft('propria_nb_chambres')} className={input} />
        </div>
        <div>
          <label className={label}>Nb salles de bain</label>
          <input type="number" name="propria_nb_sdb" min={0}
            defaultValue={dft('propria_nb_sdb')} className={input} />
        </div>
        <div>
          <label className={label}>Type & nombre de lits</label>
          <input type="text" name="propria_type_lits" placeholder="ex: 1 king + 2 simples"
            defaultValue={dft('propria_type_lits')} className={input} />
        </div>
        <div>
          <label className={label}>N° de porte (lot)</label>
          <input type="text" name="propria_apartment_door"
            defaultValue={dft('propria_apartment_door')} className={input} />
        </div>
        <div>
          <label className={label}>Boîte à clés du lot</label>
          <input type="text" name="propria_key_box_suite"
            defaultValue={dft('propria_key_box_suite')} className={input} />
        </div>
        <div>
          <label className={label}>URL Airbnb</label>
          <input type="url" name="propria_airbnb_url"
            defaultValue={dft('propria_airbnb_url')} className={input} />
        </div>
        <div>
          <label className={label}>URL Booking</label>
          <input type="url" name="propria_booking_url"
            defaultValue={dft('propria_booking_url')} className={input} />
        </div>
        <div>
          <label className={label}>Date de mise en ligne</label>
          <input type="date" name="propria_listing_published_at"
            defaultValue={String(dft('propria_listing_published_at')).slice(0, 10)} className={input} />
        </div>
        <div>
          <label className={label}>Lien Drive photos</label>
          <input type="url" name="propria_drive_photos_url"
            defaultValue={dft('propria_drive_photos_url')} className={input} />
        </div>
        <div>
          <label className={label}>Prestataire référent</label>
          <select name="propria_default_provider_id" defaultValue={dft('propria_default_provider_id')} className={input}>
            <option value="">—</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.name}{p.function ? ` · ${p.function}` : ''}</option>
            ))}
          </select>
        </div>
        {/* ─── Accès & clés (par suite) ─── */}
        {/* CEO 2026-06-09 : "Admin serrure connectée" remonte au bien ; "Boîte
            à clés du logement" supprimée (doublon de "Boîte à clés du lot"
            déjà présent ci-dessus). */}
        <div className="md:col-span-2 mt-3 mb-1 text-xs uppercase tracking-wider text-stoniz-gray-500 border-t pt-3">
          Accès & clés (par suite)
        </div>
        <div>
          <label className={label}>Nombre de clés</label>
          <input type="number" name="propria_nb_keys" min={0}
            defaultValue={dft('propria_nb_keys')} className={input} />
        </div>
        <div>
          <label className={label}>Emplacement boîte à clés</label>
          <input type="text" name="propria_key_box_location"
            defaultValue={dft('propria_key_box_location')} className={input} />
        </div>

        {/* ─── Wifi (par suite) ─── */}
        <div className="md:col-span-2 mt-3 mb-1 text-xs uppercase tracking-wider text-stoniz-gray-500 border-t pt-3">
          Wifi (par suite)
        </div>
        <div>
          <label className={label}>SSID</label>
          <input type="text" name="propria_wifi_ssid"
            defaultValue={dft('propria_wifi_ssid')} className={input} />
        </div>
        <div>
          <label className={label}>Mot de passe</label>
          <input type="text" name="propria_wifi_password"
            defaultValue={dft('propria_wifi_password')} className={input} />
        </div>

        {/* ─── Check-in voyageur (par suite) ─── */}
        <div className="md:col-span-2 mt-3 mb-1 text-xs uppercase tracking-wider text-stoniz-gray-500 border-t pt-3">
          Check-in voyageur (par suite)
        </div>
        <div className="md:col-span-2">
          <label className={label}>URL vidéo d'arrivée</label>
          <input type="url" name="propria_arrival_video_url" placeholder="https://drive.google.com/…"
            defaultValue={dft('propria_arrival_video_url')} className={input} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>Instructions check-in (texte libre)</label>
          <textarea name="propria_arrival_instructions" rows={3}
            defaultValue={dft('propria_arrival_instructions')} className={input} />
        </div>

        <div className="md:col-span-2 mt-3 mb-1 text-xs uppercase tracking-wider text-stoniz-gray-500 border-t pt-3">
          Notes
        </div>
        <div className="md:col-span-2">
          <label className={label}>Observations</label>
          <textarea name="propria_observations" rows={2}
            defaultValue={dft('propria_observations')} className={input} />
        </div>
      </div>

      {error && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}

      <div className="flex items-center gap-3 mt-4">
        <button
          type="submit"
          disabled={pending}
          className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {pending ? 'Enregistrement…' : 'Enregistrer le lot'}
        </button>
        {saved && !pending && (
          <span className="text-xs text-emerald-700 inline-flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" /> Enregistré
          </span>
        )}
      </div>
    </form>
  );
}
