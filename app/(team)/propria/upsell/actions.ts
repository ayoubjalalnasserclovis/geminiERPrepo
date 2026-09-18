'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalString } from '@/lib/validators/zod-helpers';
import { UPSELL_CATEGORIES, UPSELL_STATUSES } from '@/lib/propria/upsell';

// ============================================================================
// Server Actions internes du module Upsell (chantier 9 marathon, décision B6).
// La commande publique voyageur vit dans app/upsell/[slug]/actions.ts.
// ============================================================================

const createSchema = z.object({
  propria_unit_id: z.string().uuid(),
  // hostaway_reservations.hostaway_id (bigint) — optionnel.
  hostaway_reservation_id: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number().int().positive().nullable(),
  ),
  guest_name: optionalString,
  category: z.enum(UPSELL_CATEGORIES),
  description: optionalString,
  amount_mad: z.coerce.number().min(0),
});

/** Création interne (bureau) — lot + résa + catégorie + montant MAD. */
export async function createUpsellAction(formData: FormData) {
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const data = createSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase.from('propria_upsells').insert({
    ...data,
    source: 'interne',
    status: 'commande',
    created_by: user.id,
  } as any);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/upsell');
}

/** Changement de statut inline (commande → confirmé → livré / annulé). */
export async function setUpsellStatusAction(id: string, status: string) {
  await assertRole(['ceo', 'assistante', 'propria']);
  const parsed = z.enum(UPSELL_STATUSES).safeParse(status);
  if (!parsed.success) throw new Error('Statut invalide');
  const supabase = createClient();
  const { data: upsell } = await supabase
    .from('propria_upsells')
    .select('id, status')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!upsell) throw new Error('Commande upsell introuvable.');
  if (upsell.status === parsed.data) return;

  const { error } = await supabase
    .from('propria_upsells')
    .update({ status: parsed.data } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/upsell');
}

/**
 * Chiffrage d'une commande (notamment QR arrivée à 0 MAD) : le bureau fixe
 * le prix après contact avec le voyageur.
 */
export async function setUpsellAmountAction(id: string, amountMad: number) {
  await assertRole(['ceo', 'assistante', 'propria']);
  const amount = z.coerce.number().min(0).parse(amountMad);
  const supabase = createClient();
  const { data: upsell } = await supabase
    .from('propria_upsells')
    .select('id, status')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle();
  if (!upsell) throw new Error('Commande upsell introuvable.');
  if (upsell.status === 'annule') {
    throw new Error('Impossible de modifier le montant d\'un upsell annulé.');
  }

  const { error } = await supabase
    .from('propria_upsells')
    .update({ amount_mad: amount } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/upsell');
}
