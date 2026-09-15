'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

const softDeleteSchema = z.object({
  property_id: z.string().uuid(),
  reason: z.string().min(5, 'Raison requise (min 5 caractères)'),
});

type Result = { ok: true; deleted_units_count: number } | { ok: false; error: string };

/**
 * Soft-delete un bien Propria.
 * Réservé au CEO. Appelle la RPC soft_delete_property qui :
 *   - Vérifie le rôle côté serveur (SECURITY DEFINER)
 *   - Pose deleted_at sur properties + propria_units du bien
 *   - INSERT dans property_deletion_log avec snapshot complet
 *
 * Restauration manuelle possible via SQL si erreur.
 */
export async function softDeletePropertyAction(formData: FormData): Promise<Result> {
  try {
    await assertRole(['ceo']);
    const input = softDeleteSchema.parse(Object.fromEntries(formData));

    const supabase = createClient();
    const { data, error } = await supabase.rpc('soft_delete_property', {
      p_property_id: input.property_id,
      p_reason: input.reason,
    });

    if (error) return { ok: false, error: error.message };
    const result = data as { ok: boolean; deleted_units_count: number };

    revalidatePath('/propria/biens');
    revalidatePath(`/propria/biens/${input.property_id}`);
    revalidatePath('/dashboard');

    return { ok: true, deleted_units_count: result.deleted_units_count };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}
