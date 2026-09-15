'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';

/**
 * Server actions pour la page /finance/tresorerie/honoraires-a-percevoir.
 * CEO 2026-08-17c.
 *
 * - toggleHonorairesConfirmedAction : (dé)coche un projet comme confirmé (le
 *   CEO/finance juge qu'il ira au bout du process honoraires). Affecte
 *   uniquement le calcul "CA confirmé" affiché à côté du "CA pipeline".
 *
 * - setMilestoneForecastMonthAction : saisit le mois prévisionnel
 *   d'encaissement pour un milestone donné d'un projet. Utilise la table
 *   stoniz_fees_forecast (UNIQUE partiel sur project_id + milestone_type
 *   WHERE deleted_at IS NULL — on fait donc un UPSERT en soft-delete +
 *   INSERT plutôt que ON CONFLICT car la contrainte est partielle).
 */

type Result<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

const MILESTONE_TYPES = [
  'acompte_stoniz',
  'honoraires_compromis',
  'honoraires_3d',
  'honoraires_chantier',
  'honoraires_livraison',
] as const;

const confirmedSchema = z.object({
  project_id: z.string().uuid(),
  confirmed: z.boolean(),
});

export async function toggleHonorairesConfirmedAction(input: unknown): Promise<Result> {
  try {
    await assertRole(['ceo', 'finance']);
    const parsed = confirmedSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();
    const { error } = await supabase
      .from('projects')
      .update({
        honoraires_confirmed: parsed.data.confirmed,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', parsed.data.project_id);
    if (error) return { ok: false, error: error.message };
    revalidatePath('/finance/tresorerie/honoraires-a-percevoir');
    revalidatePath(`/projects/${parsed.data.project_id}`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erreur inconnue' };
  }
}

const forecastSchema = z.object({
  project_id: z.string().uuid(),
  milestone_type: z.enum(MILESTONE_TYPES),
  /** Format YYYY-MM (input HTML month) — converti en YYYY-MM-01 côté BDD. */
  forecast_month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Format attendu YYYY-MM').nullable(),
});

export async function setMilestoneForecastMonthAction(input: unknown): Promise<Result> {
  try {
    const me = await assertRole(['ceo', 'finance']);
    const parsed = forecastSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();

    // Un enregistrement actif existe-t-il déjà pour (project, milestone) ?
    const { data: existing } = await supabase
      .from('stoniz_fees_forecast')
      .select('id')
      .eq('project_id', parsed.data.project_id)
      .eq('milestone_type', parsed.data.milestone_type)
      .is('deleted_at', null)
      .maybeSingle();

    // Cas "reset" : le user vide le champ → on soft-delete l'existant s'il y en a.
    if (parsed.data.forecast_month === null) {
      if (!existing) return { ok: true };
      const { error } = await supabase
        .from('stoniz_fees_forecast')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', (existing as any).id);
      if (error) return { ok: false, error: error.message };
      revalidatePath('/finance/tresorerie/honoraires-a-percevoir');
      return { ok: true };
    }

    // Cas normal : upsert. Convention : jour = 01 pour le mois cible.
    const forecast_date_iso = `${parsed.data.forecast_month}-01`;

    if (existing) {
      const { error } = await supabase
        .from('stoniz_fees_forecast')
        .update({
          forecast_month: forecast_date_iso,
          updated_by: me.id,
          updated_at: new Date().toISOString(),
        } as any)
        .eq('id', (existing as any).id);
      if (error) return { ok: false, error: error.message };
    } else {
      const { error } = await supabase
        .from('stoniz_fees_forecast')
        .insert({
          project_id: parsed.data.project_id,
          milestone_type: parsed.data.milestone_type,
          forecast_month: forecast_date_iso,
          updated_by: me.id,
        } as any);
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath('/finance/tresorerie/honoraires-a-percevoir');
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? 'Erreur inconnue' };
  }
}
