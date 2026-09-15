import Link from 'next/link';
import { Wifi, KeyRound, ExternalLink, Camera, ImageIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { PropriaUnitEditForm } from '@/components/propria/propria-unit-edit-form';
import { createPropriaUnitAction } from '@/app/(team)/propria/biens/[id]/units/actions';

type Provider = { id: string; name: string; function: string | null };

/** Petit formulaire « + Ajouter un lot » (back office). */
function AddUnitForm({ propertyId }: { propertyId: string }) {
  return (
    <details className="px-5 py-3 border-t border-stoniz-gray-100">
      <summary className="cursor-pointer text-xs text-stoniz-gray-600 hover:text-stoniz-black">
        + Ajouter un lot
      </summary>
      <form action={createPropriaUnitAction} className="mt-2 flex gap-2">
        <input type="hidden" name="property_id" value={propertyId} />
        <input
          name="code"
          placeholder="Code du lot (ex: AF 2)"
          className="flex-1 border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
        />
        <button className="bg-stoniz-black text-white px-3 py-2 rounded-md text-sm hover:bg-stoniz-gray-800">
          Ajouter
        </button>
      </form>
    </details>
  );
}

/**
 * Liste des lots (propria_units) d'un bien.
 *
 * Utilisable sur :
 *   - La fiche bien `/propria/biens/[id]` (compact=false) → vue détaillée
 *   - La fiche projet `/projects/[id]` (compact=true) → résumé top 3 lots
 *
 * Les données sont passées en props (fetchées au niveau page parent pour
 * éviter un double round-trip).
 */

export type PropriaUnit = {
  id: string;
  code: string;
  propria_apartment_door?: string | null;
  propria_capacity_voyageurs?: number | null;
  propria_nb_chambres?: number | null;
  propria_type_lits?: string | null;
  propria_lock_code?: string | null;
  propria_key_box_suite?: string | null;
  propria_nb_keys?: number | null;
  propria_wifi_ssid?: string | null;
  propria_airbnb_url?: string | null;
  propria_booking_url?: string | null;
  propria_base_price_per_night?: number | null;
  propria_drive_photos_url?: string | null;
  propria_observations?: string | null;
};

function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'MAD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PropriaUnitsList({
  units,
  propertyId,
  compact = false,
  maxRows = 3,
  providers = [],
}: {
  units: PropriaUnit[];
  propertyId: string;
  compact?: boolean;
  maxRows?: number;
  providers?: Provider[];
}) {
  if (units.length === 0) {
    return (
      <Card>
        <div className="p-4 text-sm text-stoniz-gray-500 italic">
          Aucun lot enregistré pour ce bien.
        </div>
        {!compact && <AddUnitForm propertyId={propertyId} />}
      </Card>
    );
  }

  const displayedUnits = compact ? units.slice(0, maxRows) : units;
  const hiddenCount = units.length - displayedUnits.length;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-stoniz-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-medium">Lots gérés ({units.length})</h3>
          <p className="text-xs text-stoniz-gray-500 mt-0.5">
            Chaque lot correspond à un listing locatif distinct (Airbnb, Booking, etc.)
          </p>
        </div>
        {compact && (
          <Link
            href={`/propria/biens/${propertyId}`}
            className="text-xs text-stoniz-gray-600 hover:underline flex items-center gap-1"
          >
            Voir tous
            <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      <div className="divide-y divide-stoniz-gray-100">
        {displayedUnits.map((u) => (
          <div key={u.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="font-medium text-stoniz-black">{u.code}</span>
                  {u.propria_capacity_voyageurs && (
                    <span className="text-xs text-stoniz-gray-500">
                      · {u.propria_capacity_voyageurs} voy.
                    </span>
                  )}
                  {u.propria_nb_chambres && (
                    <span className="text-xs text-stoniz-gray-500">
                      · {u.propria_nb_chambres} ch.
                    </span>
                  )}
                  {u.propria_type_lits && (
                    <span className="text-xs text-stoniz-gray-500">· {u.propria_type_lits}</span>
                  )}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-medium">{formatMoney(Number(u.propria_base_price_per_night))}</div>
                <div className="text-xs text-stoniz-gray-500">/ nuit</div>
              </div>
            </div>

            {!compact && (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-stoniz-gray-600 mt-2">
                {/* WiFi et code serrure principale sont au niveau BIEN, pas LOT */}
                {u.propria_key_box_suite && (
                  <div className="flex items-center gap-1.5">
                    <KeyRound className="w-3 h-3 flex-shrink-0" />
                    <span>Boîte suite : {u.propria_key_box_suite}</span>
                  </div>
                )}
                {u.propria_nb_keys !== null && u.propria_nb_keys !== undefined && (
                  <div className="flex items-center gap-1.5">
                    <KeyRound className="w-3 h-3 flex-shrink-0" />
                    <span>{u.propria_nb_keys} clé(s)</span>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center gap-2 mt-2 flex-wrap">
              {u.propria_airbnb_url && (
                <a
                  href={u.propria_airbnb_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs bg-pink-100 text-pink-800 px-2 py-0.5 rounded hover:bg-pink-200"
                >
                  Airbnb <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {u.propria_booking_url && (
                <a
                  href={u.propria_booking_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded hover:bg-blue-200"
                >
                  Booking <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {u.propria_drive_photos_url && (
                <a
                  href={u.propria_drive_photos_url}
                  target="_blank"
                  rel="noopener"
                  className="inline-flex items-center gap-1 text-xs bg-stoniz-gray-100 text-stoniz-gray-700 px-2 py-0.5 rounded hover:bg-stoniz-gray-200"
                >
                  <ImageIcon className="w-2.5 h-2.5" />
                  Photos
                </a>
              )}
            </div>

            {!compact && u.propria_observations && (
              <p className="text-xs text-stoniz-gray-500 italic mt-2 border-l-2 border-stoniz-gray-200 pl-2">
                {u.propria_observations}
              </p>
            )}

            {!compact && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-stoniz-gray-600 hover:text-stoniz-black">
                  ✏️ Éditer ce lot (prix, annonces, capacité…)
                </summary>
                <PropriaUnitEditForm unit={u} propertyId={propertyId} providers={providers} />
              </details>
            )}
          </div>
        ))}
      </div>

      {hiddenCount > 0 && (
        <div className="px-5 py-3 border-t border-stoniz-gray-100 text-center">
          <Link
            href={`/propria/biens/${propertyId}`}
            className="text-xs text-stoniz-gray-600 hover:underline"
          >
            + {hiddenCount} autre{hiddenCount > 1 ? 's' : ''} lot{hiddenCount > 1 ? 's' : ''} sur la fiche bien
          </Link>
        </div>
      )}

      {!compact && <AddUnitForm propertyId={propertyId} />}
    </Card>
  );
}
