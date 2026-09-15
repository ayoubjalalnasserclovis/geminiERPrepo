// ─── Chantier 2 marathon — Infos d'accès auto sur les tâches ────────────────
// Composant LECTURE SEULE injecté dans chaque tâche ménage / intervention /
// contrôle. L'équipe terrain ne cherche plus les codes : tout est là.
// Source : properties (niveau immeuble) + propria_units (niveau lot).
// Aucune donnée dupliquée — pur affichage des champs existants.

import { MapPin, KeyRound, Building2, Wifi, DoorOpen, User, Video } from 'lucide-react';

export type AccessProperty = {
  name?: string | null;
  address?: string | null;
  floor?: string | number | null;
  google_maps_url?: string | null;
  propria_google_maps_url?: string | null;
  propria_building_access_type?: string | null;
  propria_elevator_code?: string | null;
  propria_badge_building?: string | null;
  propria_key_box_building?: string | null;
  propria_key_box_home?: string | null;
  propria_guardian_name?: string | null;
  propria_guardian_phone?: string | null;
  propria_parking_info?: string | null;
  propria_arrival_instructions?: string | null;
  propria_arrival_video_url?: string | null;
  propria_wifi_ssid?: string | null;
  propria_wifi_password?: string | null;
};

export type AccessUnit = {
  code?: string | null;
  propria_apartment_door?: string | null;
  propria_lock_code?: string | null;
  propria_key_box_suite?: string | null;
  propria_key_box_location?: string | null;
  propria_arrival_instructions?: string | null;
  propria_wifi_ssid?: string | null;
  propria_wifi_password?: string | null;
  propria_security_key_location?: string | null;
} | null;

function Row({ label, value }: { label: string; value?: string | number | null }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex gap-2 text-sm">
      <span className="text-stoniz-gray-500 shrink-0">{label} :</span>
      <span className="font-medium break-words">{String(value)}</span>
    </div>
  );
}

/**
 * showWifi : true pour les interventions techniques (box internet…),
 * configurable par contexte d'appel.
 */
export function PropriaAccessInfoCard({
  property,
  unit,
  showWifi = true,
}: {
  property: AccessProperty;
  unit?: AccessUnit;
  showWifi?: boolean;
}) {
  const mapsUrl = property.propria_google_maps_url || property.google_maps_url;
  const wifiSsid = unit?.propria_wifi_ssid || property.propria_wifi_ssid;
  const wifiPass = unit?.propria_wifi_password || property.propria_wifi_password;
  const instructions = unit?.propria_arrival_instructions || property.propria_arrival_instructions;

  return (
    <section className="bg-amber-50/60 border border-amber-200 rounded-lg p-4 mb-4">
      <div className="flex items-center gap-2 mb-3">
        <KeyRound className="w-4 h-4 text-amber-700" />
        <h3 className="font-medium text-sm text-amber-900">
          Infos d&apos;accès {unit?.code ? `· ${unit.code}` : ''}
        </h3>
        <span className="text-[10px] text-amber-700/70 ml-auto">lecture seule</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5">
        <div className="space-y-1.5">
          <div className="flex items-start gap-2 text-sm">
            <MapPin className="w-3.5 h-3.5 mt-0.5 text-stoniz-gray-500 shrink-0" />
            <div>
              <div className="font-medium">{property.address || property.name || 'Adresse non renseignée'}</div>
              {property.floor != null && property.floor !== '' && (
                <div className="text-xs text-stoniz-gray-600">Étage : {property.floor}</div>
              )}
              {mapsUrl && (
                <a href={mapsUrl} target="_blank" rel="noopener" className="text-xs text-blue-700 underline">
                  Ouvrir dans Maps
                </a>
              )}
            </div>
          </div>

          <div className="pt-1">
            <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500 mb-1 flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Immeuble
            </div>
            <Row label="Type d'accès" value={property.propria_building_access_type} />
            <Row label="Code ascenseur" value={property.propria_elevator_code} />
            <Row label="Badge immeuble" value={property.propria_badge_building} />
            <Row label="Boîte à clés immeuble" value={property.propria_key_box_building} />
            <Row label="Parking" value={property.propria_parking_info} />
            {(property.propria_guardian_name || property.propria_guardian_phone) && (
              <div className="flex gap-2 text-sm">
                <User className="w-3.5 h-3.5 mt-0.5 text-stoniz-gray-500 shrink-0" />
                <span>
                  Gardien : <span className="font-medium">{property.propria_guardian_name ?? '—'}</span>
                  {property.propria_guardian_phone && (
                    <> · <a href={`tel:${property.propria_guardian_phone}`} className="text-blue-700 underline">{property.propria_guardian_phone}</a></>
                  )}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500 mb-1 flex items-center gap-1">
            <DoorOpen className="w-3 h-3" /> Logement
          </div>
          <Row label="Porte" value={unit?.propria_apartment_door} />
          <Row label="Code serrure" value={unit?.propria_lock_code} />
          <Row label="Boîte à clés" value={unit?.propria_key_box_suite || property.propria_key_box_home} />
          <Row label="Emplacement boîte" value={unit?.propria_key_box_location} />
          <Row label="Clé sécurité" value={unit?.propria_security_key_location} />
          {showWifi && wifiSsid && (
            <div className="flex gap-2 text-sm">
              <Wifi className="w-3.5 h-3.5 mt-0.5 text-stoniz-gray-500 shrink-0" />
              <span>
                <span className="font-medium">{wifiSsid}</span>
                {wifiPass && <> · <span className="font-mono text-xs">{wifiPass}</span></>}
              </span>
            </div>
          )}
          {instructions && (
            <div className="text-sm pt-1">
              <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500 mb-0.5">Procédure d&apos;entrée</div>
              <p className="text-stoniz-gray-800 whitespace-pre-wrap text-xs leading-relaxed">{instructions}</p>
            </div>
          )}
          {property.propria_arrival_video_url && (
            <a
              href={property.propria_arrival_video_url}
              target="_blank"
              rel="noopener"
              className="inline-flex items-center gap-1 text-xs text-blue-700 underline"
            >
              <Video className="w-3 h-3" /> Vidéo d&apos;arrivée
            </a>
          )}
        </div>
      </div>
    </section>
  );
}
