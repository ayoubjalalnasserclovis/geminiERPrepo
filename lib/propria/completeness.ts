/**
 * Logique de complétude des infos bien — source de vérité côté TypeScript.
 *
 * Doit rester en miroir parfait avec la vue SQL `v_property_completeness`
 * (supabase/migrations/20260530002000_property_completeness_view.sql).
 *
 * Toute modification de la liste de champs DOIT se faire simultanément ici
 * et dans la vue SQL, sinon le widget fiche projet et le dashboard / liste
 * Propria afficheront des scores divergents.
 */

export type CompletenessField = {
  key: string;
  label: string;
  category: 'identite' | 'utilites' | 'acces';
  type: 'string' | 'boolean' | 'numeric';
};

export const COMPLETENESS_FIELDS: CompletenessField[] = [
  // Identité & localisation
  { key: 'address',                    label: 'Adresse complète',     category: 'identite', type: 'string' },
  { key: 'quartier',                   label: 'Quartier',             category: 'identite', type: 'string' },
  { key: 'floor',                      label: 'Étage',                category: 'identite', type: 'string' },
  { key: 'superficie',                 label: 'Superficie',           category: 'identite', type: 'numeric' },
  { key: 'propria_apartment_door',     label: 'N° de porte',          category: 'identite', type: 'string' },
  { key: 'propria_google_maps_url',    label: 'Lien Google Maps',     category: 'identite', type: 'string' },
  // Compteurs & contrats utilités
  { key: 'propria_water_contract',     label: 'N° contrat eau',       category: 'utilites', type: 'string' },
  { key: 'propria_water_meter',        label: 'N° compteur eau',      category: 'utilites', type: 'string' },
  { key: 'propria_electricity_contract', label: 'N° contrat électricité', category: 'utilites', type: 'string' },
  { key: 'propria_electricity_meter',  label: 'N° compteur électricité', category: 'utilites', type: 'string' },
  // Internet & accès
  { key: 'propria_internet_provider',  label: 'Fournisseur internet', category: 'acces', type: 'string' },
  { key: 'propria_internet_contract',  label: 'N° contrat internet',  category: 'acces', type: 'string' },
  { key: 'propria_wifi_ssid',          label: 'SSID Wifi',            category: 'acces', type: 'string' },
  { key: 'propria_wifi_password',      label: 'Mot de passe Wifi',    category: 'acces', type: 'string' },
  { key: 'propria_lock_code',          label: 'Code serrure',         category: 'acces', type: 'string' },
  { key: 'propria_smart_lock',         label: 'Serrure électronique', category: 'acces', type: 'boolean' },
  { key: 'propria_access_admin',       label: 'Codes accès immeuble', category: 'acces', type: 'string' },
];

export const TOTAL_FIELDS = COMPLETENESS_FIELDS.length;

/**
 * Définition "rempli" alignée sur la vue SQL :
 *   - null / undefined → vide
 *   - string : trim().length > 0
 *   - autre (boolean, numeric) : non-null suffit (false compte comme rempli)
 */
export function isFieldFilled(value: unknown, type: CompletenessField['type']): boolean {
  if (value == null) return false;
  if (type === 'string') {
    return typeof value === 'string' && value.trim().length > 0;
  }
  return true;
}

export type CompletenessResult = {
  filled: number;
  total: number;
  pct: number;
  isComplete: boolean;
  missing: string[];
};

/**
 * Calcule le score de complétude pour un bien.
 * Le widget React, le dashboard et la colonne liste consomment tous cette
 * fonction (au lieu de dupliquer la logique).
 */
export function computeCompleteness(property: Record<string, any> | null | undefined): CompletenessResult {
  if (!property) {
    return { filled: 0, total: TOTAL_FIELDS, pct: 0, isComplete: false, missing: COMPLETENESS_FIELDS.map(f => f.label) };
  }
  let filled = 0;
  const missing: string[] = [];
  for (const field of COMPLETENESS_FIELDS) {
    if (isFieldFilled(property[field.key], field.type)) {
      filled += 1;
    } else {
      missing.push(field.label);
    }
  }
  const pct = Math.round((filled / TOTAL_FIELDS) * 100);
  return {
    filled,
    total: TOTAL_FIELDS,
    pct,
    isComplete: filled === TOTAL_FIELDS,
    missing,
  };
}

/**
 * Liste des clés BDD à `SELECT` quand on veut calculer la complétude
 * côté serveur sans tout fetcher.
 */
export const COMPLETENESS_SELECT_KEYS = COMPLETENESS_FIELDS.map(f => f.key).join(', ');
