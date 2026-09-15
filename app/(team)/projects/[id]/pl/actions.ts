'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole } from '@/lib/auth/require';
import {
  setProjectOverride,
  deleteProjectOverride,
} from '@/lib/finance/pl-settings';

/**
 * Server actions du tab P&L projet (CEO 2026-06-30 Phase B3).
 *
 * Permissions :
 *   - CEO + finance : écriture (override projet)
 *   - chef_projet / developer : lecture seule (refusée ici)
 *
 * Pattern défensif partagé avec /settings/pl-config :
 *   - try/catch intégral
 *   - throw les redirects Next pour ne pas les avaler
 *   - enveloppe { ok, error } systématique
 */

function isNextRedirect(e: unknown): boolean {
  return (
    !!e &&
    typeof e === 'object' &&
    'digest' in e &&
    typeof (e as any).digest === 'string' &&
    (e as any).digest.startsWith('NEXT_REDIRECT')
  );
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

export type ActionResult = { ok: true } | { ok: false; error: string };

// ─── Override projet (saisie depuis le tab P&L) ─────────────────────────────

const setSchema = z.object({
  project_id: z.string().uuid('ID projet invalide'),
  weight_multiplier: z.coerce
    .number({ invalid_type_error: 'Multiplicateur invalide' })
    .min(0, 'Le multiplicateur doit être ≥ 0')
    .max(10, 'Le multiplicateur doit être ≤ 10'),
  notes: z.string().optional().nullable(),
});

/**
 * Sauvegarde l'override de multiplicateur pour ce projet.
 * Utilisée par <PLOverrideForm/> sur /projects/[id]/pl.
 */
export async function setProjectPLOverrideAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = setSchema.parse({
      project_id: formData.get('project_id'),
      weight_multiplier: formData.get('weight_multiplier'),
      notes: formData.get('notes'),
    });
    const notes =
      parsed.notes && parsed.notes.trim() !== '' ? parsed.notes.trim() : null;
    await setProjectOverride(
      parsed.project_id,
      parsed.weight_multiplier,
      notes,
      me.id,
    );
    revalidatePath(`/projects/${parsed.project_id}/pl`);
    revalidatePath('/settings/pl-config');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

const deleteSchema = z.object({
  project_id: z.string().uuid('ID projet invalide'),
});

export async function deleteProjectPLOverrideAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = deleteSchema.parse({
      project_id: formData.get('project_id'),
    });
    await deleteProjectOverride(parsed.project_id, me.id);
    revalidatePath(`/projects/${parsed.project_id}/pl`);
    revalidatePath('/settings/pl-config');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
