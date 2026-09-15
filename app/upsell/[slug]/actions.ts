'use server';

import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { UPSELL_CATEGORIES, UPSELL_CATEGORY_LABELS } from '@/lib/propria/upsell';

// ============================================================================
// Commande upsell PUBLIQUE (voyageur via QR code — chantier 9, décision B6).
//
// Sécurité :
//  - AUCUNE table propria_* exposée à anon : tout passe par le serveur via
//    createAdminClient (service_role), après validation stricte du slug.
//  - Zod strict + longueurs max sur tous les champs + honeypot anti-bot.
//  - Aucun détail interne ne sort : réponse générique ok / erreur générique.
//  - Pas de paiement en ligne (décision B6) : la commande arrive à 0 MAD,
//    le bureau chiffre après contact.
// ============================================================================

const orderSchema = z.object({
  slug: z.string().min(8).max(64).regex(/^[a-f0-9]+$/),
  category: z.enum(UPSELL_CATEGORIES),
  message: z.string().max(1000).optional().default(''),
  guest_name: z.string().min(1).max(120),
  guest_contact: z.string().min(3).max(120),
  reservation_code: z.string().max(40).optional().default(''),
  // Honeypot : champ caché qui DOIT rester vide (les bots le remplissent).
  website: z.string().max(0).optional().default(''),
});

const GENERIC_ERROR = {
  ok: false as const,
  error: 'Votre commande n’a pas pu être envoyée. Merci de réessayer ou de contacter votre hôte. / Something went wrong, please try again.',
};

export async function createUpsellOrderAction(input: unknown) {
  try {
    const parsed = orderSchema.safeParse(input);
    if (!parsed.success) return GENERIC_ERROR;
    const data = parsed.data;

    // Honeypot rempli → on répond "ok" sans rien écrire (le bot ne sait pas).
    if (data.website !== '') return { ok: true as const };

    const admin = createAdminClient();

    // 1) Slug → lot actif uniquement.
    const { data: unit } = await admin
      .from('propria_units')
      .select('id, property_id, code')
      .eq('upsell_slug', data.slug)
      .eq('is_active', true)
      .is('deleted_at', null)
      .maybeSingle();
    if (!unit) return GENERIC_ERROR;

    // 2) Si le code résa saisi est numérique et correspond à une résa Hostaway
    //    connue, on lie directement. Sinon il reste en texte dans la description.
    let reservationId: number | null = null;
    const codeRaw = data.reservation_code.trim();
    if (/^\d{4,15}$/.test(codeRaw)) {
      const { data: resa } = await admin
        .from('hostaway_reservations')
        .select('hostaway_id')
        .eq('hostaway_id', Number(codeRaw))
        .is('deleted_at', null)
        .maybeSingle();
      if (resa) reservationId = (resa as any).hostaway_id as number;
    }

    const catLabel = UPSELL_CATEGORY_LABELS[data.category];
    const descParts = [
      data.message.trim() || null,
      codeRaw && !reservationId ? `Code résa saisi : ${codeRaw}` : null,
    ].filter(Boolean);
    const description = descParts.join(' — ') || null;

    // 3) Tâche back-office liée (kind='tache', urgence normale) pour traitement.
    const { data: tache, error: tacheErr } = await admin
      .from('propria_interventions')
      .insert({
        property_id: (unit as any).property_id,
        propria_unit_id: (unit as any).id,
        kind: 'tache',
        description:
          `Commande upsell ${catLabel} — ${(unit as any).code}` +
          ` · Voyageur : ${data.guest_name} (${data.guest_contact})` +
          (description ? ` · ${description}` : ''),
        urgency: 'normale',
        status: 'a_traiter',
        occurred_at: new Date().toISOString().slice(0, 10),
      } as any)
      .select('id')
      .single();
    if (tacheErr) return GENERIC_ERROR;

    // 4) La commande upsell elle-même (source qr, montant 0 — bureau chiffrera).
    const { error: upsellErr } = await admin.from('propria_upsells').insert({
      propria_unit_id: (unit as any).id,
      hostaway_reservation_id: reservationId,
      guest_name: data.guest_name.trim(),
      guest_contact: data.guest_contact.trim(),
      category: data.category,
      description,
      amount_mad: 0,
      status: 'commande',
      source: 'qr',
      linked_intervention_id: (tache as any).id,
    } as any);
    if (upsellErr) return GENERIC_ERROR;

    return { ok: true as const };
  } catch {
    // Jamais de détail serveur côté visiteur.
    return GENERIC_ERROR;
  }
}
