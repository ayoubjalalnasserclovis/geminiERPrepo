// ─── Matching tolérant fournisseur/artisan ↔ lot (CEO 2026-08-19, session B) ─
//
// Contexte : le garde-fou anti-orphelin de l'allocation banque matchait un lot
// existant par égalité STRICTE du nom ("Maison Azar" ≠ "MAISON AZAR SARL"
// ≠ "maison azar") → création d'un lot "divers" doublon alors qu'un lot réel
// existait (typiquement un lot converti depuis la page Estimations).
//
// Ce helper centralise un matching normalisé (casse, accents, ponctuation,
// suffixes juridiques) + repli par inclusion. Fonctions PURES — testables,
// aucun effet de bord (canon méthode de travail).

export function normalizeVendorName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // accents (diacritiques combinants après NFD)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')    // ponctuation → espace
    .replace(/\b(sarl|sa|sas|snc|ste|societe|ets|etablissements?)\b/g, ' ') // suffixes juridiques
    .replace(/\s+/g, ' ')
    .trim();
}

export type MatchableLot = { id: string; numero: number; vendor_name: string | null };

/**
 * Choisit le lot existant correspondant à un nom de bénéficiaire :
 *   1. Égalité normalisée exacte (prioritaire, plus petit numero d'abord)
 *   2. Inclusion normalisée dans un sens ou l'autre (noms ≥ 4 caractères,
 *      pour éviter les faux positifs sur des noms trop courts)
 * Retourne null si aucun candidat fiable → l'appelant crée un lot auto.
 */
export function pickLotByVendorName<T extends MatchableLot>(lots: T[], target: string | null | undefined): T | null {
  const t = normalizeVendorName(target);
  if (!t) return null;
  const sorted = [...lots].sort((a, b) => a.numero - b.numero);

  for (const lot of sorted) {
    if (normalizeVendorName(lot.vendor_name) === t) return lot;
  }
  if (t.length >= 4) {
    for (const lot of sorted) {
      const n = normalizeVendorName(lot.vendor_name);
      if (n.length >= 4 && (n.includes(t) || t.includes(n))) return lot;
    }
  }
  return null;
}
