'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { optionalEmail } from '@/lib/validators/zod-helpers';
import { logPropriaAudit, computeAuditDiff } from '@/lib/propria/audit';

/**
 * Sentinelle d'observabilité (CEO 2026-06-11).
 *
 * À chaque sauvegarde de fiche bien propria, on persiste dans
 * `app_error_logs` : input brut reçu, parsé Zod, champs banque, résultat de
 * l'UPDATE. Si Ismail signale que ses RIB disparaissent, on a la PREUVE
 * en BDD de ce qui s'est REELLEMENT passé côté serveur — au lieu de tourner
 * en rond sur des hypothèses.
 *
 * Best-effort : on n'utilise PAS le client RLS (qui pourrait silencieusement
 * ne rien écrire) — on passe par le service-role admin client.
 */
async function logPropriaBienUpdate(payload: {
  user_id: string | null;
  property_id: string;
  raw: Record<string, any>;
  parsed: Record<string, any>;
  update_error: { code?: string; message?: string; details?: any } | null;
  rows_affected: number | null;
}) {
  try {
    const admin = createAdminClient();
    await admin.from('app_error_logs').insert({
      source: 'updatePropriaPropertyAction',
      user_id: payload.user_id,
      message: payload.update_error
        ? `UPDATE failed: ${payload.update_error.message}`
        : `UPDATE ok (${payload.rows_affected ?? '?'} row)`,
      details: {
        property_id: payload.property_id,
        bank_fields_in_raw: {
          propria_bank_name: payload.raw.propria_bank_name ?? null,
          propria_bank_rib: payload.raw.propria_bank_rib ?? null,
          propria_bank_iban: payload.raw.propria_bank_iban ?? null,
          propria_bank_swift: payload.raw.propria_bank_swift ?? null,
        },
        bank_fields_in_parsed: {
          propria_bank_name: payload.parsed.propria_bank_name ?? null,
          propria_bank_rib: payload.parsed.propria_bank_rib ?? null,
          propria_bank_iban: payload.parsed.propria_bank_iban ?? null,
          propria_bank_swift: payload.parsed.propria_bank_swift ?? null,
        },
        update_error: payload.update_error,
        rows_affected: payload.rows_affected,
      },
      payload: {
        property_id: payload.property_id,
      },
    } as any);
  } catch { /* never break the save */ }
}

const BUILDING_ACCESS_TYPES = ['ouvert_24_24','cle','badge_ascenseur','badge_immeuble','badge_asc_cle','digicode'] as const;

// ─── Schéma "soft" : seul `name` reste vraiment obligatoire (NOT NULL en BDD).
// Tout le reste peut être enregistré vide — le formulaire affiche un bandeau
// orange listant les champs marqués * non remplis (signal métier), mais
// n'empêche plus la sauvegarde. Cf. PropriaBienForm pour la validation soft.
const propriaPropertySchema = z.object({
  // Identité
  name: z.string().min(2),
  propria_internal_code: z.string().optional().nullable(),
  type: z.enum(['Appartement','Riad','Terrain','Villa']).optional().nullable(),
  superficie: z.coerce.number().optional().nullable(),
  // Localisation
  quartier: z.string().optional().nullable(),
  floor: z.string().optional().nullable(),
  propria_apartment_door: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  propria_google_maps_url: z.string().url().optional().nullable().or(z.literal('').transform(() => null)),
  // Propriétaire
  propria_owner_name: z.string().optional().nullable(),
  propria_owner_phone: z.string().optional().nullable(),
  propria_owner_email: optionalEmail,
  // Banque
  propria_bank_name: z.string().optional().nullable(),
  propria_bank_rib: z.string().optional().nullable(),
  propria_bank_iban: z.string().optional().nullable(),
  propria_bank_swift: z.string().optional().nullable(),
  // Mandat
  propria_mandate_start: z.string().optional().nullable(),
  propria_mandate_end: z.string().optional().nullable(),
  propria_commission_rate: z.coerce.number().optional().nullable(),
  propria_mandate_conditions: z.string().optional().nullable(),
  // Accès — booleans NOT NULL en BDD : défaut false si non-renseigné
  propria_smart_lock: z.boolean().optional().default(false),
  propria_building_access_type: z.enum(BUILDING_ACCESS_TYPES).optional().nullable(),
  propria_nb_elevator_badges: z.coerce.number().int().min(0).optional().nullable(),
  propria_lock_code: z.string().optional().nullable(),
  propria_nb_keys: z.coerce.number().int().optional().nullable(),
  propria_key_box_home: z.string().optional().nullable(),
  propria_key_box_building: z.string().optional().nullable(),
  propria_key_box_location: z.string().optional().nullable(),
  propria_elevator_code: z.string().optional().nullable(),
  propria_parking_info: z.string().optional().nullable(),
  propria_guardian_name: z.string().optional().nullable(),
  propria_guardian_phone: z.string().optional().nullable(),
  // Vidéo / instructions
  propria_arrival_video_url: z.string().url().optional().nullable().or(z.literal('').transform(() => null)),
  propria_arrival_instructions: z.string().optional().nullable(),
  // Utilities
  propria_water_contract: z.string().optional().nullable(),
  propria_water_meter: z.string().optional().nullable(),
  propria_electricity_contract: z.string().optional().nullable(),
  propria_electricity_meter: z.string().optional().nullable(),
  propria_internet_provider: z.string().optional().nullable(),
  propria_internet_contract: z.string().optional().nullable(),
  propria_wifi_ssid: z.string().optional().nullable(),
  propria_wifi_password: z.string().optional().nullable(),
  // Syndic & sécurité — booleans NOT NULL : défaut false
  propria_syndic_name: z.string().optional().nullable(),
  propria_syndic_phone: z.string().optional().nullable(),
  propria_syndic_to_pay: z.boolean().optional().default(false),
  propria_syndic_amount: z.coerce.number().optional().nullable(),
  propria_camera_installed: z.boolean().optional().default(false),
  propria_camera_info: z.string().optional().nullable(),
  // État fiche & accès app — booleans NOT NULL : défaut false
  propria_info_sheet_to_send: z.boolean().optional().default(false),
  propria_app_admin_access: z.boolean().optional().default(false),
});

const BOOLEAN_FIELDS = [
  'propria_smart_lock',
  'propria_syndic_to_pay',
  'propria_camera_installed',
  'propria_info_sheet_to_send',
  'propria_app_admin_access',
];

function cleanData(raw: Record<string, FormDataEntryValue>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (BOOLEAN_FIELDS.includes(k)) {
      // Converte 'oui' → true, 'non' → false, '' → undefined (laisse Zod gérer le défaut)
      if (v === 'oui') out[k] = true;
      else if (v === 'non') out[k] = false;
      else out[k] = undefined;
    } else if (v === '' || v === null) {
      out[k] = null;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function validateConditionalRequired(_parsed: any) {
  // Soft validation depuis 2026-06-09 : on n'empêche plus l'enregistrement
  // partiel d'une fiche bien. Les contrôles métier (badges obligatoires si
  // accès immeuble par badge, etc.) sont signalés via le bandeau dynamique
  // dans PropriaBienForm — pas via un throw côté server.
  // Conservé en no-op pour préserver les appels existants.
}

export async function createPropriaPropertyAction(formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo','assistante','propria']);
  const raw = cleanData(Object.fromEntries(formData));
  const parsed = propriaPropertySchema.parse(raw);
  validateConditionalRequired(parsed);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('properties')
    .insert({
      ...parsed,
      status: 'a_verifier',
      propria_managed_at: new Date().toISOString(),
    } as any)
    .select('id')
    .single();

  if (error) throw new Error(error.message);

  // Auto-création du lot #1 — un bien externe = un lot dans la majorité des cas.
  // Le listing (prix, annonces, capacité…) se remplira sur le lot à la mise en
  // location. Best-effort : si la création du lot échoue (ex: code en double),
  // on ne bloque pas la création du bien (un bouton « + Ajouter un lot » existe).
  await supabase.from('propria_units').insert({
    property_id: data.id,
    order_index: 1,
    code: `${parsed.propria_internal_code} 1`,
    is_active: true,
  } as any);

  await logPropriaAudit({
    supabase, table: 'properties', recordId: data.id,
    actorId: user.id, action: 'create',
    label: `Création du bien « ${parsed.name} »`,
    payload: { name: parsed.name, propria_internal_code: parsed.propria_internal_code },
  });

  revalidatePath('/propria/biens');
  redirect(`/propria/biens/${data.id}`);
}

export async function updatePropriaPropertyAction(propertyId: string, formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria (Ismael ne pouvait pas sauvegarder).
  const user = await assertRole(['ceo','assistante','propria']);
  const raw = cleanData(Object.fromEntries(formData));
  const parsed = propriaPropertySchema.parse(raw);
  validateConditionalRequired(parsed);
  const supabase = createClient();

  // Snapshot avant pour calculer le diff de l'audit
  const { data: before } = await supabase
    .from('properties')
    .select('*')
    .eq('id', propertyId)
    .single();

  // CEO 2026-06-11 : on demande RETURNING + count pour avoir la PREUVE
  // que la ligne a bien été mise à jour (et pas silencieusement
  // ignorée par une RLS WITH CHECK).
  const { data: afterRows, error, count } = await supabase
    .from('properties')
    .update(parsed as any, { count: 'exact' })
    .eq('id', propertyId)
    .select('id, propria_bank_name, propria_bank_rib, propria_bank_iban, propria_bank_swift');

  // Sentinelle d'observabilité — best-effort, n'interrompt jamais.
  await logPropriaBienUpdate({
    user_id: user.id,
    property_id: propertyId,
    raw,
    parsed: parsed as any,
    update_error: error ? {
      code: (error as any).code,
      message: error.message,
      details: (error as any).details,
    } : null,
    rows_affected: count ?? (afterRows?.length ?? null),
  });

  if (error) throw new Error(error.message);

  // CEO 2026-06-11 : si l'UPDATE a renvoyé 0 ligne mais sans erreur,
  // c'est qu'une RLS WITH CHECK a silencieusement rejeté. On lève une
  // erreur explicite pour que l'utilisateur voie le problème au lieu
  // d'un faux succès qui se révèle vide au rechargement.
  if ((count ?? afterRows?.length ?? 0) === 0) {
    throw new Error(
      "Enregistrement bloqué : la base a refusé silencieusement la mise à jour. " +
      "Merci de prévenir Othmane (ID du bien : " + propertyId + ")."
    );
  }

  const diff = computeAuditDiff(before as any, parsed as any);
  if (Object.keys(diff).length > 0) {
    await logPropriaAudit({
      supabase, table: 'properties', recordId: propertyId,
      actorId: user.id, action: 'update',
      label: `Modification fiche bien (${Object.keys(diff).length} champ${Object.keys(diff).length > 1 ? 's' : ''})`,
      payload: diff,
    });
  }

  revalidatePath(`/propria/biens/${propertyId}`);
  revalidatePath('/propria/biens');
}

export async function activatePropriaManagementAction(propertyId: string) {
  await assertRole(['ceo']);
  const supabase = createClient();
  const { error } = await supabase
    .from('properties')
    .update({ propria_managed_at: new Date().toISOString() } as any)
    .eq('id', propertyId)
    .is('propria_managed_at', null);

  if (error) throw new Error(error.message);

  // Filet : garantir au moins un lot (les biens issus de projets en ont déjà
  // via la phase design ; ce filet couvre les cas sans lot).
  const { data: units } = await supabase
    .from('propria_units').select('id')
    .eq('property_id', propertyId).is('deleted_at', null).limit(1);
  if (!units || units.length === 0) {
    const { data: prop } = await supabase
      .from('properties').select('propria_internal_code').eq('id', propertyId).single();
    await supabase.from('propria_units').insert({
      property_id: propertyId,
      order_index: 1,
      code: `${prop?.propria_internal_code ?? 'LOT'} 1`,
      is_active: true,
    } as any);
  }

  revalidatePath('/propria/biens');
  revalidatePath(`/properties/${propertyId}`);
}

export async function deactivatePropriaManagementAction(propertyId: string) {
  await assertRole(['ceo']);
  const supabase = createClient();
  const { error } = await supabase
    .from('properties')
    .update({ propria_managed_at: null } as any)
    .eq('id', propertyId);

  if (error) throw new Error(error.message);
  revalidatePath('/propria/biens');
  revalidatePath(`/properties/${propertyId}`);
}
