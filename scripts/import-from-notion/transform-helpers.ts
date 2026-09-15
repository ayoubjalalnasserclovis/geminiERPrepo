/**
 * Helpers de conversion Notion → valeurs typées TypeScript.
 *
 * Chaque property Notion a une structure imbriquée (`type` + objet selon le
 * type). Ces helpers normalisent l'extraction en valeurs primitives.
 */

import type { NotionPage } from './notion-client';

/**
 * Lit une property typée d'une page Notion. Retourne null si absente.
 * Utiliser les helpers spécifiques (notionTitle, notionSelect, etc.) plutôt
 * que de manipuler le retour brut.
 */
export function prop(page: NotionPage, name: string): any {
  return page.properties?.[name] ?? null;
}

export function notionTitle(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'title') return null;
  const text = (p.title as any[]).map((t: any) => t.plain_text ?? '').join('').trim();
  return text.length > 0 ? text : null;
}

export function notionRichText(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'rich_text') return null;
  const text = (p.rich_text as any[]).map((t: any) => t.plain_text ?? '').join('').trim();
  return text.length > 0 ? text : null;
}

export function notionSelect(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'select' || !p.select) return null;
  return p.select.name ?? null;
}

export function notionMultiSelect(page: NotionPage, name: string): string[] {
  const p = prop(page, name);
  if (!p || p.type !== 'multi_select' || !Array.isArray(p.multi_select)) return [];
  return p.multi_select.map((s: any) => s.name).filter(Boolean);
}

export function notionStatus(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'status' || !p.status) return null;
  return p.status.name ?? null;
}

export function notionNumber(page: NotionPage, name: string): number | null {
  const p = prop(page, name);
  if (!p || p.type !== 'number') return null;
  return typeof p.number === 'number' ? p.number : null;
}

export function notionCheckbox(page: NotionPage, name: string): boolean {
  const p = prop(page, name);
  if (!p || p.type !== 'checkbox') return false;
  return p.checkbox === true;
}

export function notionDate(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'date' || !p.date) return null;
  return p.date.start ?? null; // ISO date string
}

export function notionEmail(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'email') return null;
  const v = (p.email as string | null)?.trim();
  return v && v.length > 0 ? v.toLowerCase() : null;
}

export function notionPhone(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'phone_number') return null;
  const v = (p.phone_number as string | null)?.trim();
  return v && v.length > 0 ? v : null;
}

export function notionUrl(page: NotionPage, name: string): string | null {
  const p = prop(page, name);
  if (!p || p.type !== 'url') return null;
  const v = (p.url as string | null)?.trim();
  return v && v.length > 0 ? v : null;
}

/**
 * Retourne la liste des notion_page_id reliés via une property relation.
 */
export function notionRelationIds(page: NotionPage, name: string): string[] {
  const p = prop(page, name);
  if (!p || p.type !== 'relation' || !Array.isArray(p.relation)) return [];
  return p.relation.map((r: any) => r.id).filter(Boolean);
}

/**
 * Retourne la liste des fichiers attachés à une property files.
 * Chaque fichier a un nom et une URL (qui expire — à DL rapidement).
 */
export type NotionFile = { name: string; url: string; type: 'external' | 'file' };

export function notionFiles(page: NotionPage, name: string): NotionFile[] {
  const p = prop(page, name);
  if (!p || p.type !== 'files' || !Array.isArray(p.files)) return [];
  return p.files.map((f: any) => {
    const url = f.type === 'external' ? f.external?.url : f.file?.url;
    return {
      name: f.name ?? 'untitled',
      url: url ?? '',
      type: f.type,
    };
  }).filter((f: NotionFile) => f.url.length > 0);
}

/**
 * Applique un mapping enum avec fallback. Si la valeur Notion n'est pas
 * dans le mapping, logue un warning et retourne la valeur par défaut.
 */
export function mapEnum<T>(
  notionValue: string | null,
  mapping: Record<string, T>,
  fallback: T,
  warnContext: string,
): T {
  if (!notionValue) return fallback;
  if (notionValue in mapping) return mapping[notionValue];
  console.warn(`[mapping] valeur Notion inconnue dans ${warnContext}: "${notionValue}" → fallback`);
  return fallback;
}
