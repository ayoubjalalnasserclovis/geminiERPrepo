'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean } from '@/lib/validators/zod-helpers';
import {
  propriaUnitCreateSchema,
  propriaUnitRenameCodeSchema,
} from '@/lib/validators/schemas';
import { logPropriaAudit, computeAuditDiff } from '@/lib/propria/audit';

/**
 * Crée un nouveau lot Propria sur un bien.
 * - order_index : auto-calculé par le trigger BDD si omis
 * - code : auto-généré par le trigger BDD si omis ({client_slug}-{order_index})
 *
 * L'équipe peut fournir un code custom à l'override (ex code historique
 * "Riad Majorelle"), il sera validé unique côté SQL.
 */
export async function createPropriaUnitAction(formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const data = propriaUnitCreateSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();

  // Si l'équipe a fourni un code custom, on le marque locked pour empêcher
  // le rename client de l'écraser.
  const payload: any = { ...data };
  if (data.code) {
    payload.code_locked = true;
  }

  const { data: row, error } = await supabase
    .from('propria_units')
    .insert(payload)
    .select('id, property_id, code')
    .single();
  if (error) throw new Error(error.message);

  await logPropriaAudit({
    supabase, table: 'propria_units', recordId: row.id,
    actorId: user.id, action: 'create',
    label: `Ajout du lot « ${row.code} »`,
    payload: { code: row.code, property_id: row.property_id },
  });
  // Trace aussi sur le bien parent pour timeline biens
  await logPropriaAudit({
    supabase, table: 'properties', recordId: row.property_id,
    actorId: user.id, action: 'create',
    label: `Ajout du lot « ${row.code} »`,
    payload: { unit_id: row.id, code: row.code },
  });

  revalidatePath(`/propria/biens/${row.property_id}`);
  revalidatePath('/propria/biens');
  redirect(`/propria/biens/${row.property_id}`);
}

/**
 * Met à jour un lot Propria (édition de la fiche).
 * Ne touche pas au code (utiliser renamePropriaUnitCodeAction pour ça).
 */
export async function updatePropriaUnitAction(unitId: string, formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const data = propriaUnitCreateSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();

  // Snapshot avant pour diff
  const { data: before } = await supabase
    .from('propria_units')
    .select('*')
    .eq('id', unitId)
    .single();

  const { property_id, code, order_index, ...rest } = data;
  const { error } = await supabase
    .from('propria_units')
    .update(rest as any)
    .eq('id', unitId);
  if (error) throw new Error(error.message);

  const diff = computeAuditDiff(before as any, rest as any);
  if (Object.keys(diff).length > 0) {
    await logPropriaAudit({
      supabase, table: 'propria_units', recordId: unitId,
      actorId: user.id, action: 'update',
      label: `Modification du lot « ${(before as any)?.code ?? unitId.slice(0,6)} » (${Object.keys(diff).length} champ${Object.keys(diff).length > 1 ? 's' : ''})`,
      payload: diff,
    });
  }

  revalidatePath(`/propria/biens/${property_id}`);
}

/**
 * Renomme le code d'un lot et le verrouille (code_locked = true) pour empêcher
 * le trigger de propagation de l'écraser au prochain rename client.
 */
export async function renamePropriaUnitCodeAction(formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria + assistante.
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const data = propriaUnitRenameCodeSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();

  const { data: before } = await supabase
    .from('propria_units')
    .select('code, property_id')
    .eq('id', data.unit_id)
    .single();

  const { data: row, error } = await supabase
    .from('propria_units')
    .update({ code: data.new_code, code_locked: true } as any)
    .eq('id', data.unit_id)
    .select('property_id')
    .single();
  if (error) throw new Error(error.message);

  await logPropriaAudit({
    supabase, table: 'propria_units', recordId: data.unit_id,
    actorId: user.id, action: 'update',
    label: `Renommage du lot : « ${(before as any)?.code ?? '?'} » → « ${data.new_code} »`,
    payload: { from: (before as any)?.code, to: data.new_code },
  });

  revalidatePath(`/propria/biens/${row.property_id}`);
  revalidatePath('/propria/biens');
}

/**
 * Active ou désactive un lot. Désactivé = retiré des sélecteurs Caisse,
 * inventaires, etc. mais l'historique reste intact (audit trail).
 */
export async function setPropriaUnitActiveAction(unitId: string, isActive: boolean) {
  await assertRole(['ceo']);
  const supabase = createClient();
  const { data: row, error } = await supabase
    .from('propria_units')
    .update({ is_active: isActive } as any)
    .eq('id', unitId)
    .select('property_id')
    .single();
  if (error) throw new Error(error.message);
  revalidatePath(`/propria/biens/${row.property_id}`);
}
