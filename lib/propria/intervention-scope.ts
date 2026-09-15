// ============================================================================
// Portée d'une intervention/tâche Propria — règle « Option B »
// ----------------------------------------------------------------------------
// Une intervention pointe vers EXACTEMENT une cible :
//   - un lot/suite  → propria_unit_id rempli, property_id NULL
//   - le bien entier → property_id rempli, propria_unit_id NULL
// (contrainte BDD propria_interventions_scope_check : (property_id IS NULL) <> (propria_unit_id IS NULL))
//
// Côté formulaire, on encode ce choix dans une seule valeur `scope` :
//   "unit:<uuid>"     → une suite précise
//   "property:<uuid>" → le bien entier
// ============================================================================

export type ScopeGroup = {
  propertyId: string;
  propertyLabel: string;
  units: { id: string; label: string }[];
};

type PropertyRow = { id: string; name: string; propria_internal_code: string | null };
type UnitRow = { id: string; code: string | null; order_index: number; property_id: string };

/** Construit les options groupées par bien pour le sélecteur « Lot concerné ». */
export function buildScopeGroups(properties: PropertyRow[], units: UnitRow[]): ScopeGroup[] {
  return properties
    .map((p) => ({
      propertyId: p.id,
      propertyLabel: p.propria_internal_code ?? p.name,
      units: units
        .filter((u) => u.property_id === p.id)
        .sort((a, b) => a.order_index - b.order_index)
        .map((u) => ({ id: u.id, label: u.code ?? `Suite ${u.order_index}` })),
    }))
    .sort((a, b) => a.propertyLabel.localeCompare(b.propertyLabel));
}

/** Valeur `scope` initiale d'une intervention existante (pour pré-remplir le select). */
export function scopeValue(row: { propria_unit_id?: string | null; property_id?: string | null }): string {
  if (row.propria_unit_id) return `unit:${row.propria_unit_id}`;
  if (row.property_id) return `property:${row.property_id}`;
  return '';
}

/** Décode `scope` en colonnes BDD (exactement une remplie). Lève si invalide. */
export function parseScope(scope: string): { property_id: string | null; propria_unit_id: string | null } {
  const [kind, id] = (scope ?? '').split(':');
  if (kind === 'unit' && id) return { property_id: null, propria_unit_id: id };
  if (kind === 'property' && id) return { property_id: id, propria_unit_id: null };
  throw new Error('Lot ou bien concerné invalide');
}
