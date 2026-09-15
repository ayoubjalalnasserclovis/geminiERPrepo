'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { normalizeFormData as clean, optionalEmail, optionalUrl } from '@/lib/validators/zod-helpers';
import { logPropriaAudit } from '@/lib/propria/audit';

/**
 * Marque le mandat de gestion Propria comme refusé pour le bien associé au projet.
 * Le bien ne sera plus proposé à l'activation Propria — bandeau remplacé par
 * "Mandat refusé le X".
 *
 * Contrainte BDD : un bien ne peut pas être à la fois `propria_managed_at` ET
 * `propria_refused_at`. Si l'utilisateur veut revenir en arrière, il faudra
 * explicitement effacer le refus (action dédiée à créer si besoin métier).
 */
const refuseSchema = z.object({
  project_id: z.string().uuid(),
  reason: z.string().optional().nullable(),
});

export async function refusePropriaMandateAction(formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo','assistante','propria']);
  const data = refuseSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();

  // Charge le projet pour récupérer le property_id
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, property_id')
    .eq('id', data.project_id).single();
  if (projErr || !project) throw new Error('Projet introuvable');
  if (!project.property_id) {
    throw new Error('Ce projet n\'a pas de bien associé — refus impossible.');
  }

  // Vérifie qu'il n'est pas déjà géré Propria (cas impossible mais double sécurité)
  const { data: property } = await supabase
    .from('properties')
    .select('propria_managed_at')
    .eq('id', project.property_id).single();
  if (property?.propria_managed_at) {
    throw new Error('Ce bien est déjà sous gestion Propria — refus impossible.');
  }

  // Marque le refus
  const { error } = await supabase
    .from('properties')
    .update({
      propria_refused_at: new Date().toISOString(),
      propria_refused_reason: data.reason,
    } as any)
    .eq('id', project.property_id);
  if (error) throw new Error(error.message);

  await logPropriaAudit({
    supabase, table: 'properties', recordId: project.property_id,
    actorId: user.id, action: 'custom',
    label: `Mandat Propria refusé`,
    payload: { reason: data.reason ?? null, project_id: data.project_id },
  });

  revalidatePath(`/projects/${data.project_id}`);
  revalidatePath('/propria/biens');
}

const activateSchema = z.object({
  project_id: z.string().uuid(),

  // Identifiant interne Propria (obligatoire)
  propria_internal_code: z.string().min(1, 'Code interne requis'),

  // Propriétaire (souvent = client Stoniz, mais peut différer)
  propria_owner_name: z.string().optional().nullable(),
  propria_owner_phone: z.string().optional().nullable(),
  propria_owner_email: optionalEmail,

  // Capacités locatives
  propria_capacity_voyageurs: z.coerce.number().int().positive().optional().nullable(),
  propria_nb_chambres: z.coerce.number().int().positive().optional().nullable(),

  // Tarification & commission
  propria_commission_rate: z.coerce.number().optional().nullable(),
  propria_base_price_per_night: z.coerce.number().optional().nullable(),

  // Mandat
  propria_mandate_start: z.string().optional().nullable(),
  propria_mandate_conditions: z.string().optional().nullable(),

  // Annonces (souvent vides à l'activation, ajoutées plus tard)
  propria_airbnb_url: optionalUrl,
  propria_booking_url: optionalUrl,

  // Compteurs (peuvent venir du projet, repris ici pour édition rapide)
  propria_water_contract: z.string().optional().nullable(),
  propria_water_meter: z.string().optional().nullable(),
  propria_electricity_contract: z.string().optional().nullable(),
  propria_electricity_meter: z.string().optional().nullable(),
  propria_internet_provider: z.string().optional().nullable(),
  propria_internet_contract: z.string().optional().nullable(),
  propria_wifi_ssid: z.string().optional().nullable(),
  propria_wifi_password: z.string().optional().nullable(),

  // Syndic
  propria_syndic_name: z.string().optional().nullable(),
  propria_syndic_phone: z.string().optional().nullable(),
  propria_syndic_to_pay: z.string().optional().nullable(), // 'on' (checkbox) ou null
  propria_syndic_amount: z.coerce.number().optional().nullable(),
});

/**
 * Active la gestion Propria sur le bien associé à un projet Stoniz.
 *
 * Workflow :
 *   1. On part du projet (pas du bien) car le projet est l'entité métier qui
 *      a accompagné le client jusqu'à l'achat du bien.
 *   2. On vérifie que le projet a bien un property_id (sinon erreur).
 *   3. On vérifie que le bien n'est pas déjà Propria (idempotence).
 *   4. On met à jour `propria_managed_at` + tous les champs Propria-spécifiques.
 *   5. Les autres champs (adresse, surface, quartier, compteurs déjà saisis)
 *      sont déjà sur le bien — on n'y touche pas.
 */
export async function activatePropriaForProjectAction(formData: FormData) {
  // CEO 2026-06-10 : ouvert au rôle propria.
  const user = await assertRole(['ceo','assistante','propria']);
  const data = activateSchema.parse(clean(Object.fromEntries(formData)));
  const supabase = createClient();

  // 1. Charge le projet + vérifie qu'il a un bien
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select('id, reference, property_id, current_phase')
    .eq('id', data.project_id)
    .single();
  if (projErr || !project) throw new Error('Projet introuvable');
  if (!project.property_id) {
    throw new Error('Ce projet n\'a pas encore de bien associé. Lie d\'abord un bien au projet.');
  }

  // 2. Vérifie idempotence
  const { data: property } = await supabase
    .from('properties')
    .select('id, propria_managed_at')
    .eq('id', project.property_id)
    .single();
  if (!property) throw new Error('Bien introuvable');
  if (property.propria_managed_at) {
    throw new Error('Ce bien est déjà sous gestion Propria');
  }

  // 3. Prépare les updates — on ne pousse que les champs non-vides côté Propria
  // pour ne pas écraser ce qui a déjà été saisi en phase travaux
  const syndicToPay = data.propria_syndic_to_pay === 'on' || data.propria_syndic_to_pay === 'true';
  const updates: Record<string, any> = {
    propria_managed_at: new Date().toISOString(),
    propria_internal_code: data.propria_internal_code,
    propria_owner_name: data.propria_owner_name,
    propria_owner_phone: data.propria_owner_phone,
    propria_owner_email: data.propria_owner_email,
    propria_capacity_voyageurs: data.propria_capacity_voyageurs,
    propria_nb_chambres: data.propria_nb_chambres,
    propria_commission_rate: data.propria_commission_rate,
    propria_base_price_per_night: data.propria_base_price_per_night,
    propria_mandate_start: data.propria_mandate_start,
    propria_mandate_conditions: data.propria_mandate_conditions,
    propria_airbnb_url: data.propria_airbnb_url,
    propria_booking_url: data.propria_booking_url,
    propria_water_contract: data.propria_water_contract,
    propria_water_meter: data.propria_water_meter,
    propria_electricity_contract: data.propria_electricity_contract,
    propria_electricity_meter: data.propria_electricity_meter,
    propria_internet_provider: data.propria_internet_provider,
    propria_internet_contract: data.propria_internet_contract,
    propria_wifi_ssid: data.propria_wifi_ssid,
    propria_wifi_password: data.propria_wifi_password,
    propria_syndic_name: data.propria_syndic_name,
    propria_syndic_phone: data.propria_syndic_phone,
    propria_syndic_to_pay: syndicToPay,
    propria_syndic_amount: data.propria_syndic_amount,
  };

  const { error: upErr } = await supabase
    .from('properties')
    .update(updates as any)
    .eq('id', project.property_id);
  if (upErr) throw new Error(upErr.message);

  await logPropriaAudit({
    supabase, table: 'properties', recordId: project.property_id,
    actorId: user.id, action: 'create',
    label: `Activation gestion Propria (code ${data.propria_internal_code})`,
    payload: { project_id: data.project_id, propria_internal_code: data.propria_internal_code },
  });

  revalidatePath('/propria/biens');
  revalidatePath('/propria');
  revalidatePath(`/projects/${data.project_id}`);
  redirect(`/propria/biens/${project.property_id}`);
}
