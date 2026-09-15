'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { assertRole } from '@/lib/auth/require';
import {
  setPhaseWeight,
  setTargetPayroll,
  setProjectOverride,
  deleteProjectOverride,
} from '@/lib/finance/pl-settings';

/**
 * Server actions — page /settings/pl-config (CEO 2026-06-30 Phase B2).
 *
 * Permissions :
 *   - CEO + finance : écriture (toutes les actions)
 *   - developer : lecture seule (la page le permet, les actions le refusent)
 *
 * Pattern défensif partagé : redirects Next.js doivent re-throw.
 */

// ─── Helpers défensifs partagés ─────────────────────────────────────────────

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

// ─── 1. Coefficient de phase ────────────────────────────────────────────────

const phaseWeightSchema = z.object({
  phase: z.string().min(1, 'Phase manquante'),
  weight: z.coerce
    .number({ invalid_type_error: 'Coefficient invalide' })
    .min(0, 'Le coefficient doit être ≥ 0')
    .max(10, 'Le coefficient doit être ≤ 10'),
});

export async function updatePhaseWeightAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = phaseWeightSchema.parse({
      phase: formData.get('phase'),
      weight: formData.get('weight'),
    });
    await setPhaseWeight(parsed.phase, parsed.weight, me.id);
    revalidatePath('/settings/pl-config');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── 2. Masse salariale cible mensuelle ─────────────────────────────────────

const targetPayrollSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Format de mois invalide (attendu YYYY-MM)'),
  amount: z.coerce
    .number({ invalid_type_error: 'Montant invalide' })
    .min(0, 'Le montant doit être ≥ 0'),
  notes: z.string().optional().nullable(),
});

export async function updateTargetPayrollAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = targetPayrollSchema.parse({
      month: formData.get('month'),
      amount: formData.get('amount'),
      notes: formData.get('notes'),
    });
    const notes =
      parsed.notes && parsed.notes.trim() !== '' ? parsed.notes.trim() : null;
    await setTargetPayroll(parsed.month, parsed.amount, notes, me.id);
    revalidatePath('/settings/pl-config');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

// ─── 3. Override projet ─────────────────────────────────────────────────────

const projectOverrideSchema = z.object({
  project_id: z.string().uuid('ID projet invalide'),
  multiplier: z.coerce
    .number({ invalid_type_error: 'Multiplicateur invalide' })
    .min(0, 'Le multiplicateur doit être ≥ 0')
    .max(10, 'Le multiplicateur doit être ≤ 10'),
  notes: z.string().optional().nullable(),
});

export async function setProjectOverrideAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = projectOverrideSchema.parse({
      project_id: formData.get('project_id'),
      multiplier: formData.get('multiplier'),
      notes: formData.get('notes'),
    });
    const notes =
      parsed.notes && parsed.notes.trim() !== '' ? parsed.notes.trim() : null;
    await setProjectOverride(parsed.project_id, parsed.multiplier, notes, me.id);
    revalidatePath('/settings/pl-config');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}

const deleteOverrideSchema = z.object({
  project_id: z.string().uuid('ID projet invalide'),
});

export async function deleteProjectOverrideAction(
  formData: FormData,
): Promise<ActionResult> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = deleteOverrideSchema.parse({
      project_id: formData.get('project_id'),
    });
    await deleteProjectOverride(parsed.project_id, me.id);
    revalidatePath('/settings/pl-config');
    return { ok: true };
  } catch (e) {
    if (isNextRedirect(e)) throw e;
    return { ok: false, error: errorMessage(e) };
  }
}
