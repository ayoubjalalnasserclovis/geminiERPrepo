'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

/**
 * Action d'édition rapide des métadonnées projet/bien :
 * - Prix bien (properties.price)
 * - Dates clés (compromis, acte authentique, travaux, livraison) sur projects
 *
 * Réservé CEO pour éviter qu'un chef projet écrase des dates par erreur.
 */

const editSchema = z.object({
  project_id: z.string().uuid(),
  property_id: z.string().uuid().optional().nullable(),
  // Prix bien
  price: z.coerce.number().nonnegative().optional().nullable(),
  // Dates projet (format YYYY-MM-DD ou vide)
  compromis_date: z.string().optional().nullable(),
  acte_authentique_date: z.string().optional().nullable(),
  travaux_start_date: z.string().optional().nullable(),
  travaux_end_date: z.string().optional().nullable(),
  livraison_date: z.string().optional().nullable(),
});

function nullIfEmpty(v: string | null | undefined): string | null {
  if (!v || v === '') return null;
  return v;
}

export async function updateProjectMetadataAction(input: unknown) {
  try {
    await assertRole(['ceo']);
    const parsed = editSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message };
    }
    const data = parsed.data;
    const supabase = createClient();

    // UPDATE projects (dates clés)
    const projectUpdate: any = {
      compromis_date: nullIfEmpty(data.compromis_date),
      acte_authentique_date: nullIfEmpty(data.acte_authentique_date),
      travaux_start_date: nullIfEmpty(data.travaux_start_date),
      travaux_end_date: nullIfEmpty(data.travaux_end_date),
      livraison_date: nullIfEmpty(data.livraison_date),
      updated_at: new Date().toISOString(),
    };
    const { error: projErr } = await supabase
      .from('projects')
      .update(projectUpdate)
      .eq('id', data.project_id);
    if (projErr) return { ok: false, error: projErr.message };

    // UPDATE properties (prix) si property_id fourni
    if (data.property_id && data.price !== undefined && data.price !== null) {
      const { error: propErr } = await supabase
        .from('properties')
        .update({ price: data.price, updated_at: new Date().toISOString() })
        .eq('id', data.property_id);
      if (propErr) return { ok: false, error: propErr.message };
    }

    revalidatePath(`/projects/${data.project_id}`);
    revalidatePath('/projects');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── Service type (clé_en_main vs coaching) — CEO 2026-08-17 ───────────────

const serviceTypeSchema = z.object({
  project_id: z.string().uuid(),
  service_type: z.enum(['cle_en_main', 'coaching']),
});

/**
 * Bascule le type de service d'un projet. CEO + chef_projet uniquement.
 * Coaching = 5 000 € forfaitaire, exclus des prévisions honoraires standard
 * (page /finance/tresorerie/honoraires-a-percevoir).
 */
export async function updateProjectServiceTypeAction(input: unknown) {
  try {
    await assertRole(['ceo', 'chef_projet']);
    const parsed = serviceTypeSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0].message };
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('projects')
      .update({
        service_type: parsed.data.service_type,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', parsed.data.project_id);

    if (error) return { ok: false as const, error: error.message };

    revalidatePath(`/projects/${parsed.data.project_id}`);
    revalidatePath('/projects');
    revalidatePath('/finance/tresorerie/honoraires-a-percevoir');
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur inconnue' };
  }
}
