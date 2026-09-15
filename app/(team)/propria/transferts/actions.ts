'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalUuid } from '@/lib/validators/zod-helpers';

const schema = z.object({
  propria_unit_id: optionalUuid,
  travel_date: z.string(),
  voyageur_name: z.string().optional().nullable(),
  amount_mad: z.coerce.number().optional().nullable(),
  driver_name: z.string().optional().nullable(),
  collect_responsible_id: optionalUuid,
  comment: z.string().optional().nullable(),
  // Chantier 14 : code résa propagé (hostaway_id ou code DIR- d'une résa directe)
  hostaway_ref: z.string().optional().nullable(),
  status: z.enum(['a_faire','fait','offert','anomalie','annule']).default('a_faire'),
});

export async function createTransferAction(formData: FormData) {
  await assertRole(['ceo','assistante','propria']);
  const data = schema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();
  const { error } = await supabase.from('propria_transfers').insert(data as any);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/transferts');
}

export async function setTransferStatusAction(id: string, status: string) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase.from('propria_transfers')
    .update({ status } as any).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/transferts');
}

export async function toggleBonSigneAction(id: string, signed: boolean) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase.from('propria_transfers')
    .update({ bon_signe: signed } as any).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/transferts');
}

/**
 * Étape 1 du workflow cash : le terrain a collecté le cash auprès du chauffeur.
 * On enregistre la date de collecte. Le cash n'est PAS encore remis au CEO.
 */
export async function markCashCollectedAction(id: string, collected: boolean) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const update: any = {
    cash_collected: collected,
    collected_at: collected ? new Date().toISOString().slice(0, 10) : null,
  };
  // Si on dé-marque la collecte, on doit aussi annuler la remise
  if (!collected) {
    update.cash_remitted_at = null;
    update.remitted_confirmed_by = null;
  }
  const { error } = await supabase.from('propria_transfers').update(update).eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/transferts');
}

/**
 * Étape 2 du workflow cash : SEUL le CEO peut confirmer la remise du cash.
 * Aligné avec la logique caisse / réservations cash.
 */
export async function markCashRemittedToCeoAction(id: string) {
  const user = await assertRole(['ceo']);
  const supabase = createClient();

  // Vérifie que le cash a bien été collecté avant de pouvoir le marquer remis
  const { data: tr } = await supabase
    .from('propria_transfers')
    .select('id, cash_collected').eq('id', id).single();
  if (!tr) throw new Error('Transfert introuvable');
  if (!tr.cash_collected) {
    throw new Error('Le cash doit d\'abord être marqué comme collecté par le terrain.');
  }

  const { error } = await supabase
    .from('propria_transfers')
    .update({
      cash_remitted_at: new Date().toISOString().slice(0, 10),
      remitted_confirmed_by: user.id,
    } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/transferts');
}

/**
 * Permet d'assigner / réassigner le responsable de la collecte sur un transfert
 * existant (ex: si l'assistant a changé en dernière minute).
 */
export async function setCollectResponsibleAction(id: string, profileId: string | null) {
  await assertRole(['ceo','assistante','propria']);
  const supabase = createClient();
  const { error } = await supabase
    .from('propria_transfers')
    .update({ collect_responsible_id: profileId } as any)
    .eq('id', id);
  if (error) throw new Error(error.message);
  revalidatePath('/propria/transferts');
}

// ⚠ Legacy alias pour rétrocompatibilité avec d'anciens imports — utilise markCashCollectedAction
export const toggleCashCollectedAction = markCashCollectedAction;
