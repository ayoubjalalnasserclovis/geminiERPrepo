/**
 * Utilitaires server-safe pour le filtre projet des dashboards (CEO 2026-06-16).
 *
 * Fichier sans 'use client' — peut être importé indifféremment depuis un
 * Server Component (les pages dashboard) ou un Client Component. Garde la
 * logique de parsing du query param URL en un seul endroit.
 */

/**
 * Parse `searchParams.projects` en Set<string> | null.
 *
 * - undefined / "" → null  (= pas de filtre actif, comportement défaut)
 * - "_none"        → Set vide (filtre actif sur 0 projet)
 * - "id1,id2,id3"  → Set des IDs
 */
export function parseProjectFilter(raw: string | string[] | undefined): Set<string> | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!v || v.trim() === '') return null;
  if (v === '_none') return new Set();
  return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
}
