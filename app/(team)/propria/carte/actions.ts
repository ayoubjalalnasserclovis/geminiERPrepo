'use server';

import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logPropriaAudit } from '@/lib/propria/audit';

/**
 * Géolocalisation d'un bien Propria depuis la Vue Carte (CHANTIER 10).
 *
 * Why : aucun des biens Propria n'a de coordonnées GPS aujourd'hui —
 * la carte intègre donc le placement (clic sur la carte) et l'ajustement
 * (drag du marqueur). Les colonnes properties.latitude / longitude
 * existent déjà (migration 20260521000400) : AUCUNE migration nécessaire.
 *
 * Sécurité : rôles ceo / assistante / propria uniquement (developer en
 * lecture seule, conformément à la philosophie écriture sensible bloquée).
 */
const coordsSchema = z.object({
  propertyId: z.string().uuid(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export async function setPropertyCoordinatesAction(
  propertyId: string,
  lat: number,
  lng: number,
): Promise<void> {
  const user = await assertRole(['ceo', 'assistante', 'propria']);
  const parsed = coordsSchema.parse({ propertyId, lat, lng });
  const supabase = createClient();

  // Le bien doit exister, ne pas être soft-deleted, et être géré par Propria.
  const { data: prop, error: readErr } = await supabase
    .from('properties')
    .select('id, name, propria_managed_at, latitude, longitude')
    .eq('id', parsed.propertyId)
    .is('deleted_at', null)
    .single();

  if (readErr || !prop) throw new Error('Bien introuvable');
  if (!(prop as any).propria_managed_at) {
    throw new Error("Ce bien n'est pas sous gestion Propria");
  }

  const { error, count } = await supabase
    .from('properties')
    .update(
      {
        latitude: Math.round(parsed.lat * 1e6) / 1e6,
        longitude: Math.round(parsed.lng * 1e6) / 1e6,
      } as any,
      { count: 'exact' },
    )
    .eq('id', parsed.propertyId);

  if (error) throw new Error(error.message);
  if ((count ?? 0) === 0) {
    throw new Error(
      'Enregistrement bloqué : la base a refusé silencieusement la mise à jour. ' +
      'Merci de prévenir Othmane (ID du bien : ' + parsed.propertyId + ').',
    );
  }

  await logPropriaAudit({
    supabase,
    table: 'properties',
    recordId: parsed.propertyId,
    actorId: user.id,
    action: 'update',
    label: `Géolocalisation du bien « ${(prop as any).name} »`,
    payload: {
      latitude: { from: (prop as any).latitude, to: parsed.lat },
      longitude: { from: (prop as any).longitude, to: parsed.lng },
    },
  });

  revalidatePath('/propria/carte');
  revalidatePath(`/propria/biens/${parsed.propertyId}`);
}
