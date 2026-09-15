'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { logFinanceAudit } from '@/lib/finance/audit';

/**
 * Server action pour changer la sous-phase chantier d'un projet.
 * CEO 2026-08-19c.
 *
 * Accès : CEO + chef_projet (comme les autres actions travaux).
 * NULL autorisé pour "remettre à non renseigné".
 */

const schema = z.object({
  project_id: z.string().uuid(),
  sous_phase: z.enum(['gros_oeuvre', 'second_oeuvre', 'finitions', 'livre']).nullable(),
});

export async function updateChantierSousPhaseAction(input: unknown) {
  try {
    await assertRole(['ceo', 'chef_projet']);
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();

    // Snapshot avant pour audit
    const { data: before } = await supabase
      .from('projects')
      .select('chantier_sous_phase')
      .eq('id', parsed.data.project_id)
      .maybeSingle();
    const oldPhase = (before as any)?.chantier_sous_phase ?? null;

    const { error } = await supabase
      .from('projects')
      .update({
        chantier_sous_phase: parsed.data.sous_phase,
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', parsed.data.project_id);
    if (error) return { ok: false as const, error: error.message };

    // Log audit si changement effectif — CEO 2026-08-24 (brief hebdo Projets bloc 3)
    if (oldPhase !== parsed.data.sous_phase) {
      const { data: user } = await supabase.auth.getUser();
      await logFinanceAudit({
        table: 'projects',
        recordId: parsed.data.project_id,
        action: 'update',
        actorId: user.user?.id ?? null,
        label: `Sous-phase chantier : ${oldPhase ?? '—'} → ${parsed.data.sous_phase ?? '—'}`,
        payload: {
          chantier_sous_phase: { before: oldPhase, after: parsed.data.sous_phase },
        },
      });
    }

    revalidatePath(`/projects/${parsed.data.project_id}/travaux`);
    revalidatePath(`/projects/${parsed.data.project_id}`);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur inconnue' };
  }
}

// ─── Édit inline des dates chantier (CEO 2026-08-19e) ─────────────────────
//
// Permet au CEO / chef_projet de modifier les 3 dates chantier depuis la
// timeline directement, sans passer par le bouton "Éditer" caché en haut de
// la fiche projet.
//
// Le trigger BDD trg_auto_fill_travaux_end_date ne s'active que si l'end
// est NULL — donc envoyer une valeur explicite (même changement de valeur
// existante) est toujours respecté.

const dateFieldSchema = z.object({
  project_id: z.string().uuid(),
  field: z.enum(['travaux_start_date', 'travaux_end_date', 'livraison_date']),
  value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu YYYY-MM-DD').nullable(),
});

export async function updateChantierDateAction(input: unknown) {
  try {
    await assertRole(['ceo', 'chef_projet']);
    const parsed = dateFieldSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false as const, error: parsed.error.issues[0].message };
    }
    const supabase = createClient();

    // Snapshot avant pour audit (before/after diff)
    const { data: before } = await supabase
      .from('projects')
      .select('travaux_start_date, travaux_end_date, livraison_date')
      .eq('id', parsed.data.project_id)
      .maybeSingle();
    const oldValue = (before as any)?.[parsed.data.field] ?? null;

    const patch: Record<string, unknown> = {
      [parsed.data.field]: parsed.data.value,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from('projects')
      .update(patch as any)
      .eq('id', parsed.data.project_id);
    if (error) return { ok: false as const, error: error.message };

    // Log audit si changement effectif — CEO 2026-08-24 (brief hebdo Projets bloc 7)
    if (oldValue !== parsed.data.value) {
      const { data: user } = await supabase.auth.getUser();
      const labelField: Record<string, string> = {
        travaux_start_date: 'Démarrage chantier',
        travaux_end_date: 'Fin chantier',
        livraison_date: 'Livraison',
      };
      await logFinanceAudit({
        table: 'projects',
        recordId: parsed.data.project_id,
        action: 'update',
        actorId: user.user?.id ?? null,
        label: `${labelField[parsed.data.field]} : ${oldValue ?? '—'} → ${parsed.data.value ?? '—'}`,
        payload: {
          [parsed.data.field]: { before: oldValue, after: parsed.data.value },
        },
      });
    }

    revalidatePath(`/projects/${parsed.data.project_id}/travaux`);
    revalidatePath(`/projects/${parsed.data.project_id}`);
    return { ok: true as const };
  } catch (e: any) {
    return { ok: false as const, error: e?.message ?? 'Erreur inconnue' };
  }
}
