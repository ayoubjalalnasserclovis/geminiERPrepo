'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { optionalEmail } from '@/lib/validators/zod-helpers';
import { logDeletion } from '@/lib/audit/deletion';

const LEGAL_FORMS = ['personne_physique','sarl','sa','sas','sci','auto_entrepreneur','autre'] as const;
const TYPES = ['artisan_local','entreprise_generale','sous_traitant_ext','autre'] as const;
const BUSINESS_SCOPES = ['travaux','deco','both'] as const;
const SPECIALITIES = [
  // Travaux
  'demolition_cloisons','gros_oeuvre_maconnerie','electricite','plomberie_sanitaire',
  'carrelage_revetements','menuiserie_interieure','menuiserie_aluminium',
  'peinture','faux_plafond','climatisation_vmc','ferronnerie',
  'amenagements_exterieurs','cuisine','divers','multi_corps_etat',
  // Déco / mobilier
  'mobilier_salon','mobilier_chambre','mobilier_sdb','mobilier_cuisine',
  'electromenager','luminaire','textile_decoration','vaisselle_arts_table',
  'linge_maison','plomberie_robinetterie','sanitaires','carrelage_marbre',
  'jardinage_exterieur',
] as const;
const STATUSES = ['actif','inactif','blacklist','prospect'] as const;

const artisanSchema = z.object({
  name: z.string().min(2, 'Nom requis'),
  legal_form: z.enum(LEGAL_FORMS).optional().nullable(),
  type: z.enum(TYPES),
  business_scope: z.enum(BUSINESS_SCOPES).default('travaux'),
  speciality: z.enum(SPECIALITIES).optional().nullable(),
  ice: z.string().optional().nullable(),
  rc: z.string().optional().nullable(),
  if_number: z.string().optional().nullable(),
  patente: z.string().optional().nullable(),
  cnss: z.string().optional().nullable(),
  contact_name: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  email: optionalEmail,
  whatsapp: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postal_code: z.string().optional().nullable(),
  country: z.string().optional().nullable(),
  bank_name: z.string().optional().nullable(),
  rib: z.string().optional().nullable(),
  bank_account_holder: z.string().optional().nullable(),
  status: z.enum(STATUSES).default('actif'),
  evaluation: z.coerce.number().int().min(1).max(5).optional().nullable(),
  notes: z.string().optional().nullable(),
});

function clean(input: any) {
  const out: any = { ...input };
  for (const k of Object.keys(out)) {
    if (out[k] === '') out[k] = null;
  }
  if (out.evaluation === '' || out.evaluation === null) out.evaluation = null;
  else if (out.evaluation != null) out.evaluation = Number(out.evaluation);
  return out;
}

export async function createArtisanAction(input: unknown) {
  await assertRole(['ceo','chef_projet','finance','assistante']);
  const parsed = artisanSchema.safeParse(clean(input));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { data, error } = await supabase.from('artisans').insert(parsed.data).select('id').single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/artisans');
  return { ok: true, id: data.id };
}

/**
 * Création minimale d'un artisan (inline depuis un autre formulaire).
 * Crée juste le nom + type par défaut, l'utilisateur enrichit la fiche plus tard.
 * Utilisé par le combobox d'artisans dans le formulaire des lots de travaux.
 */
export async function createArtisanMinimalAction(name: string): Promise<
  { ok: true; id: string; name: string } | { ok: false; error: string }
> {
  await assertRole(['ceo','chef_projet','finance','assistante']);
  const trimmed = (name ?? '').trim();
  if (trimmed.length < 2) return { ok: false, error: 'Nom de l\'artisan trop court (2 caractères minimum).' };

  const supabase = createClient();

  // Évite les doublons sur le nom (case-insensitive)
  const { data: existing } = await supabase
    .from('artisans')
    .select('id, name')
    .ilike('name', trimmed)
    .is('deleted_at', null)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, id: existing[0].id, name: existing[0].name };
  }

  const { data, error } = await supabase
    .from('artisans')
    .insert({ name: trimmed, type: 'autre', status: 'actif' })
    .select('id, name').single();
  if (error) return { ok: false, error: error.message };

  revalidatePath('/artisans');
  return { ok: true, id: data.id, name: data.name };
}

export async function updateArtisanAction(id: string, input: unknown) {
  await assertRole(['ceo','chef_projet','finance','assistante']);
  const parsed = artisanSchema.safeParse(clean(input));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase.from('artisans').update(parsed.data).eq('id', id);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/artisans');
  revalidatePath(`/artisans/${id}`);
  return { ok: true };
}

export async function deleteArtisanAction(id: string) {
  const user = await assertRole(['ceo','chef_projet']);
  const supabase = createClient();
  const { data: artisan } = await supabase.from('artisans').select('*').eq('id', id).single();
  const { error } = await supabase.from('artisans')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  await logDeletion({
    table: 'artisans',
    recordId: id,
    actorId: user.id,
    label: artisan ? `Artisan/fournisseur - ${(artisan as any).name ?? ''}` : 'Artisan/fournisseur',
    snapshot: artisan,
  });

  revalidatePath('/artisans');
  return { ok: true };
}
