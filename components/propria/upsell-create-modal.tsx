'use client';

import { useMemo, useState, useTransition } from 'react';
import { X } from 'lucide-react';
import { UPSELL_CATEGORIES, UPSELL_CATEGORY_LABELS } from '@/lib/propria/upsell';

export type UpsellLotOption = { id: string; label: string };
export type UpsellResaOption = {
  hostaway_id: number;
  unit_id: string | null;
  guest_name: string | null;
  arrival_date: string;
  departure_date: string;
};

/**
 * Modale de création interne d'un upsell (chantier 9, décision B6).
 * Le sélecteur de résa = "code résa systématique" : il liste les résas en
 * cours / à venir du lot choisi (statuts new/modified, arrivée proche).
 */
export function UpsellCreateModal({
  lots,
  reservations,
  createAction,
}: {
  lots: UpsellLotOption[];
  reservations: UpsellResaOption[];
  createAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const lotResas = useMemo(
    () => reservations.filter((r) => r.unit_id && r.unit_id === unitId),
    [reservations, unitId],
  );

  function fmtDate(d: string) {
    const dt = new Date(d);
    return Number.isNaN(dt.getTime()) ? d : dt.toLocaleDateString('fr-FR');
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      try {
        await createAction(fd);
        setOpen(false);
        setUnitId('');
      } catch (ex: any) {
        setErr(ex?.message ?? 'Erreur lors de la création');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-stoniz-black text-white px-4 py-2 rounded text-sm hover:bg-stoniz-gray-800"
      >
        + Nouvel upsell
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg">Nouvel upsell (saisie interne)</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-stoniz-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              <div>
                <label className="text-xs text-stoniz-gray-600">Lot *</label>
                <select
                  name="propria_unit_id"
                  required
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="">— Choisir un lot —</option>
                  {lots.map((l) => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-stoniz-gray-600">
                  Réservation (en cours / à venir du lot)
                </label>
                <select
                  name="hostaway_reservation_id"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  disabled={!unitId}
                >
                  <option value="">— Sans résa identifiée —</option>
                  {lotResas.map((r) => (
                    <option key={r.hostaway_id} value={r.hostaway_id}>
                      #{r.hostaway_id} · {r.guest_name ?? 'Voyageur'} · {fmtDate(r.arrival_date)} → {fmtDate(r.departure_date)}
                    </option>
                  ))}
                </select>
                {unitId && lotResas.length === 0 && (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Aucune résa en cours/à venir trouvée pour ce lot.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-stoniz-gray-600">Catégorie *</label>
                  <select
                    name="category"
                    required
                    className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  >
                    {UPSELL_CATEGORIES.map((c) => (
                      <option key={c} value={c}>{UPSELL_CATEGORY_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-stoniz-gray-600">Montant MAD *</label>
                  <input
                    name="amount_mad"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    placeholder="ex : 250"
                    className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-stoniz-gray-600">Voyageur (si pas de résa)</label>
                <input
                  name="guest_name"
                  maxLength={120}
                  placeholder="Nom du voyageur"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-stoniz-gray-600">Description</label>
                <textarea
                  name="description"
                  rows={2}
                  maxLength={1000}
                  placeholder="Ex : transfert aéroport 14h, 4 personnes"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>

              {err && <p className="text-xs text-red-600">{err}</p>}

              <button
                type="submit"
                disabled={pending}
                className="w-full bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
              >
                {pending ? 'Création…' : '+ Créer l’upsell'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
