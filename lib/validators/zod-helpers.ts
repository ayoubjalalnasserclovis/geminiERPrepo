/**
 * Helpers Zod canoniques pour normaliser la gestion des champs optionnels.
 *
 * ============================================================================
 * Convention canonique du repo (à appliquer systématiquement)
 * ============================================================================
 *
 * Un champ optionnel = `null` en base, jamais `''`.
 *
 * Anti-pattern banni :
 *   field: z.string().uuid().optional().or(z.literal(''))
 *
 *   Problème : `clean()` convertit '' → null AVANT que Zod ne valide.
 *   Le schéma reçoit donc `null`, qu'il n'accepte pas (le .or attend ''),
 *   donc Zod throw une ZodError non gérée qui crashe le rendu serveur.
 *
 * Pattern canonique :
 *   field: optionalUuid
 *
 * `z.preprocess` intercepte la valeur AVANT la validation des contraintes
 * (uuid/email/url) et la normalise en `null` si vide. Le schéma final
 * accepte explicitement `null`, donc plus jamais de ZodError sur valeur vide.
 * ============================================================================
 */

import { z } from 'zod';

/** Normalise → null si vide, sinon trim()-é. Accepte null. */
export const optionalString = z.preprocess(
  (v) => (v === '' || v == null ? null : typeof v === 'string' ? v.trim() : v),
  z.string().nullable(),
);

/** UUID optionnel. Vide ou null → null. */
export const optionalUuid = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  z.string().uuid().nullable(),
);

/** Email optionnel. Trim + lowercase + null si vide. */
export const optionalEmail = z.preprocess(
  (v) => (v === '' || v == null ? null : typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.string().email().nullable(),
);

/** URL optionnelle. Trim + null si vide. */
export const optionalUrl = z.preprocess(
  (v) => (v === '' || v == null ? null : typeof v === 'string' ? v.trim() : v),
  z.string().url().nullable(),
);

/**
 * Normalise un FormData entries en convertissant les chaînes vides en null.
 * À utiliser systématiquement à la place des `function clean(raw)` dupliqués
 * dans les Server Actions.
 *
 * Usage typique :
 *   const data = mySchema.parse(normalizeFormData(Object.fromEntries(formData)));
 */
export function normalizeFormData(raw: Record<string, FormDataEntryValue>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = v === '' ? null : v;
  }
  return out;
}
