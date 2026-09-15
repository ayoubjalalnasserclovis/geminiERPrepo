/**
 * Helpers de matching Hostaway listings ↔ propria_units.
 *
 * Le matching automatique compare le nom + l'adresse Hostaway avec :
 *   • le code de la suite (ex: "MAJO 3")
 *   • le nom du bien parent (ex: "Hotel Yaad 88m2")
 *   • l'adresse du bien parent (immeuble, rue, étage…)
 *
 * Algorithme : similarité Jaccard sur les ensembles de mots normalisés,
 * avec bonus si l'un est sous-chaîne de l'autre.
 *
 * NOTE : ce matching est une SUGGESTION. Le CEO valide manuellement chaque
 * appariement avant qu'il ne soit persisté.
 */

/** Normalise une chaîne : lowercase, sans accents, sans ponctuation, mots ≥ 2 char. */
export function normalize(s: string | null | undefined): string[] {
  if (!s) return [];
  const stripped = s
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // retire les accents
    .replace(/[^a-z0-9\s]/g, ' ')                     // ponctuation → espace
    .replace(/\s+/g, ' ')                             // espaces multiples
    .trim();
  return stripped.split(' ').filter((w) => w.length >= 2);
}

/**
 * Score de similarité entre deux ensembles de mots (Jaccard normalisé).
 * Retourne un float entre 0 (rien en commun) et 1 (identique).
 */
function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Score combiné : Jaccard + bonus si l'une est sous-chaîne brute de l'autre.
 * Le bonus permet de matcher « Suite Majorelle » avec « majorelle »
 * sans avoir besoin de 50% de mots en commun.
 */
export function similarity(a: string, b: string): number {
  const wa = normalize(a);
  const wb = normalize(b);
  let score = jaccard(wa, wb);

  // Bonus substring (raw lowercase, sans normalisation Unicode)
  const sa = (a ?? '').toLowerCase().trim();
  const sb = (b ?? '').toLowerCase().trim();
  if (sa.length > 3 && sb.length > 3) {
    if (sa.includes(sb) || sb.includes(sa)) {
      score = Math.max(score, 0.5) + 0.2;
    }
  }
  return Math.min(1, score);
}

export type PropriaUnitForMatch = {
  id: string;
  code: string;
  property_name: string | null;
  property_address: string | null;
  property_quartier: string | null;
};

export type HostawayListingForMatch = {
  hostaway_id: number;
  name: string | null;
  address: string | null;
};

export type MatchSuggestion = {
  unit_id: string;
  unit_code: string;
  property_name: string | null;
  score: number;
};

/**
 * Calcule les top N suggestions pour un listing Hostaway donné.
 * On combine 3 angles (nom Hostaway vs code suite + nom bien + adresse bien)
 * et on garde le max.
 */
export function suggestMatches(
  listing: HostawayListingForMatch,
  candidates: PropriaUnitForMatch[],
  topN = 3,
): MatchSuggestion[] {
  const listingText = `${listing.name ?? ''} ${listing.address ?? ''}`;
  const scored = candidates.map((u) => {
    const unitText = [u.code, u.property_name, u.property_address, u.property_quartier]
      .filter(Boolean)
      .join(' ');
    // 4 scores possibles, on garde le max pour ne pas pénaliser les bons matches partiels
    const scores = [
      similarity(listingText, unitText),
      similarity(listing.name ?? '', u.property_name ?? ''),
      similarity(listing.address ?? '', u.property_address ?? ''),
      similarity(listing.name ?? '', u.code),
    ];
    return {
      unit_id: u.id,
      unit_code: u.code,
      property_name: u.property_name,
      score: Math.max(...scores),
    };
  });
  return scored
    .filter((s) => s.score > 0.1) // on ignore les non-matches évidents
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
