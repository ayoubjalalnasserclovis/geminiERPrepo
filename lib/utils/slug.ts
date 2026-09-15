/**
 * Slug helper — mirror de la fonction SQL `slugify()` côté TypeScript.
 *
 * Utilisé pour :
 *   - Preview UI ("voici le code qui sera généré : bennani")
 *   - Validation Zod du format `code` (lowercase, alphanumeric, dashes)
 *
 * NE PAS utiliser pour générer le code définitif côté app — la SQL est la
 * source de vérité (trigger BEFORE INSERT + fonction next_available_code).
 * Le slug côté TS sert UNIQUEMENT à donner un aperçu visuel à l'utilisateur.
 */

/**
 * Normalise une chaîne en slug ASCII lowercase.
 * Retourne null si l'entrée est vide ou ne contient aucun caractère alphanumérique.
 */
export function slugify(input: string | null | undefined): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;

  const normalized = trimmed.normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const lower = normalized.toLowerCase();
  let slug = lower.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^-+|-+$/g, '');

  return slug.length > 0 ? slug : null;
}

/**
 * Format de code valide : lowercase alphanumeric + tirets, pas de tiret en
 * début/fin, pas de doubles tirets, longueur 1 à 60 caractères.
 */
export const CODE_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Valide qu'un code respecte le format slug. Utilisé par Zod.
 */
export function isValidCode(input: string): boolean {
  return input.length >= 1 && input.length <= 60 && CODE_REGEX.test(input);
}

/**
 * Capitalise un slug pour affichage humain ("bennani" → "Bennani",
 * "bennani-2" → "Bennani 2"). Usage : badges, sélecteurs, headers.
 * Ne pas utiliser pour stocker en base.
 */
export function humanizeCode(code: string | null | undefined): string {
  if (!code) return '';
  return code
    .split('-')
    .map((part) =>
      /^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ');
}
