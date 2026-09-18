'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { partnerCreateSchema } from '@/lib/validators/schemas';
import { logDeletion } from '@/lib/audit/deletion';

export async function createPartnerAction(input: unknown) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const parsed = partnerCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const payload: any = { ...parsed.data };
  // email est normalisé en null par optionalEmail (cf. zod-helpers).
  if (payload.contract_date === '') payload.contract_date = null;

  const { data, error } = await supabase
    .from('partners').insert(payload).select('id').single();
  if (error) return { ok: false, error: error.message };
  revalidatePath('/partners');
  return { ok: true, id: data.id };
}

export async function updatePartnerAction(id: string, input: unknown) {
  await assertRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();

  const { data: existing } = await supabase
    .from('partners')
    .select('id, deleted_at')
    .eq('id', id)
    .single();
  if (!existing || existing.deleted_at) {
    return { ok: false, error: 'Partenaire introuvable ou archivé' };
  }

  const parsed = partnerCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const payload: any = { ...parsed.data };
  // email est normalisé en null par optionalEmail (cf. zod-helpers).
  if (payload.contract_date === '') payload.contract_date = null;

  const { error } = await supabase.from('partners').update(payload).eq('id', id).is('deleted_at', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/partners/${id}`);
  return { ok: true };
}

export async function deletePartnerAction(id: string) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { data: partner } = await supabase.from('partners').select('*').eq('id', id).single();
  if (!partner || partner.deleted_at) {
    return { ok: false, error: 'Partenaire introuvable ou déjà supprimé' };
  }
  const { error } = await supabase.from('partners')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await logDeletion({
    table: 'partners',
    recordId: id,
    actorId: user.id,
    label: `Partenaire ${(partner as any).agency_name ?? (partner as any).contact_name ?? ''}`.trim() || 'Partenaire',
    snapshot: partner,
  });

  revalidatePath('/partners');
  return { ok: true };
}
