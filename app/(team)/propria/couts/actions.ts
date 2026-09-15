'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { COST_PARAM_KEYS } from '@/lib/propria/cost-matrix';

/**
 * Actions de la matrice de coûts ménage (chantier 15 — décision CEO B7).
 *
 * Modèle HISTORISÉ : un changement de coût = NOUVELLE ligne avec date d'effet.
 * On ne modifie JAMAIS une valeur passée (les rentabilités passées en
 * dépendent). Une erreur de saisie se corrige par soft-delete + re-saisie.
 *
 * Rôles : la RLS BDD est CEO-only (paramétrage des coûts = action sensible,
 * convention n°4). Le rôle developer passe par ces Server Actions vérifiées
 * (assertRole) avec le client admin — même pattern que le module ménage.
 * Le soft-delete (destructif) reste strictement CEO.
 */

const WRITE_ROLES = ['ceo', 'developer'] as const;

function revalidateCouts() {
  revalidatePath('/propria/couts');
  revalidatePath('/propria/rentabilite');
  revalidatePath('/propria');
}

const addParamSchema = z
  .object({
    param_key: z.enum(COST_PARAM_KEYS),
    propria_unit_id: z.preprocess(
      (v) => (v == null || v === '' ? null : v),
      z.string().uuid().nullable(),
    ),
    value_mad: z.coerce.number().min(0, 'Le coût doit être ≥ 0'),
    effective_from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date d’effet invalide'),
    comment: z.preprocess(
      (v) => (v == null || String(v).trim() === '' ? null : String(v).trim()),
      z.string().max(500).nullable(),
    ),
  });

/** Nouvelle valeur de coût (globale ou override lot) — crée une nouvelle ligne. */
export async function addCostParamAction(formData: FormData) {
  const user = await assertRole([...WRITE_ROLES]);

  const parsed = addParamSchema.safeParse({
    param_key: formData.get('param_key'),
    propria_unit_id: formData.get('propria_unit_id'),
    value_mad: formData.get('value_mad'),
    effective_from: formData.get('effective_from'),
    comment: formData.get('comment'),
  });
  if (!parsed.success) {
    throw new Error(parsed.error.errors[0]?.message ?? 'Saisie invalide');
  }
  const input = parsed.data;

  const admin = createAdminClient();
  const { error } = await admin.from('propria_cost_params').insert({
    scope: input.propria_unit_id ? 'unit' : 'global',
    propria_unit_id: input.propria_unit_id,
    param_key: input.param_key,
    value_mad: input.value_mad,
    effective_from: input.effective_from,
    comment: input.comment,
    created_by: user.id,
  } as any);
  if (error) throw new Error(`Enregistrement impossible : ${error.message}`);

  revalidateCouts();
}

/**
 * Soft-delete d'une ligne (erreur de saisie) — CEO uniquement, jamais de
 * hard-delete (convention n°3 : audit + rollback préservés).
 */
export async function softDeleteCostParamAction(id: string) {
  await assertRole(['ceo']);
  const parsedId = z.string().uuid().safeParse(id);
  if (!parsedId.success) throw new Error('Identifiant invalide');

  const admin = createAdminClient();
  const { error } = await admin
    .from('propria_cost_params')
    .update({ deleted_at: new Date().toISOString() } as any)
    .eq('id', parsedId.data)
    .is('deleted_at', null);
  if (error) throw new Error(`Suppression impossible : ${error.message}`);

  revalidateCouts();
}
