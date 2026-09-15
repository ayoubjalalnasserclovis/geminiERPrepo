'use server';

/**
 * Server actions du workflow lifecycle pause / perdu / actif.
 *
 * Toutes les actions appellent une RPC SECURITY DEFINER côté Postgres qui
 * fait le check rôle final. Côté Next on garde `assertRole` pour éviter de
 * RPC-spammer avec des users sans droit.
 *
 * Format de retour standard :
 *   { ok: true, data?: ... } | { ok: false, error: string }
 *
 * Sur succès, on revalide /projects/[id] + /admin/validations.
 */

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertRole } from '@/lib/auth/require';
import { sendCeoPauseRequestEmail } from '@/lib/email/templates-lifecycle';

// ─── Schémas Zod ────────────────────────────────────────────────────────────

const PAUSE_REASONS = [
  'financement_attendu',
  'sourcing_bloque',
  'client_indisponible',
  'litige_partenaire',
  'autre',
] as const;

const LOST_REASONS = [
  'client_retire',
  'concurrent',
  'desaccord_contractuel',
  'qualite_reprochee',
  'delai_excessif',
  'defaut_financement',
  'autre',
] as const;

const requestPauseSchema = z.object({
  project_id: z.string().uuid(),
  reason_code: z.enum(PAUSE_REASONS),
  expected_resume_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().min(5, 'Mémo requis (min 5 caractères)'),
});

const validateSchema = z.object({
  transition_id: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  decision_memo: z.string().optional().nullable(),
});

const markLostSchema = z.object({
  project_id: z.string().uuid(),
  reason_code: z.enum(LOST_REASONS),
  lost_revenue_amount: z.coerce.number().nonnegative('Montant >= 0 requis'),
  lessons_learned: z.string().min(50, 'Leçons apprises requises (min 50 caractères)'),
  memo: z.string().min(5),
});

const projectIdSchema = z.object({ project_id: z.string().uuid() });

const resurrectSchema = z.object({
  project_id: z.string().uuid(),
  justification: z.string().min(50, 'Justification requise (min 50 caractères)'),
});

// ─── Helper : revalidation centralisée ──────────────────────────────────────

function revalidateProjectPaths(projectId: string) {
  revalidatePath(`/projects/${projectId}`);
  revalidatePath('/projects');
  revalidatePath('/admin/validations');
  revalidatePath('/dashboard');
}

type Result<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

// ─── 1. Demander une pause ──────────────────────────────────────────────────

export async function requestPauseAction(formData: FormData): Promise<Result<{ auto_validated: boolean }>> {
  try {
    const user = await assertRole(['ceo', 'chef_projet', 'commercial']);
    const input = requestPauseSchema.parse(Object.fromEntries(formData));

    const supabase = createClient();
    const { data, error } = await supabase.rpc('request_lifecycle_pause', {
      p_project_id: input.project_id,
      p_reason_code: input.reason_code,
      p_expected_resume_at: input.expected_resume_at,
      p_memo: input.memo,
    });

    if (error) return { ok: false, error: error.message };
    const result = data as { ok: boolean; transition_id: string; auto_validated: boolean };

    // Si demande par non-CEO et pas auto-validée → notifier le CEO par email
    if (!result.auto_validated && user.role !== 'ceo') {
      const { data: project } = await supabase
        .from('projects')
        .select('code, reference, client:clients(full_name)')
        .eq('id', input.project_id)
        .single();

      const { data: ceos } = await supabase
        .from('profiles')
        .select('email, full_name')
        .eq('role', 'ceo')
        .eq('is_active', true);

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.stoniz.co';
      for (const ceo of (ceos ?? [])) {
        await sendCeoPauseRequestEmail({
          to: ceo.email,
          ceo_name: ceo.full_name,
          requester_name: user.full_name,
          project_code: (project as any)?.code ?? (project as any)?.reference ?? '—',
          client_name: (project as any)?.client?.full_name ?? '—',
          reason_code: input.reason_code,
          expected_resume_at: input.expected_resume_at,
          memo: input.memo,
          validations_url: `${appUrl}/admin/validations`,
          // NB: pas de project_id pour ne PAS appliquer le filtre can_notify
          // (c'est un email interne staff, pas un email client)
        });
      }
    }

    revalidateProjectPaths(input.project_id);
    return { ok: true, data: { auto_validated: result.auto_validated } };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── 2. Valider/rejeter une demande de transition (CEO) ─────────────────────

export async function validateLifecycleTransitionAction(formData: FormData): Promise<Result> {
  try {
    await assertRole(['ceo']);
    const input = validateSchema.parse(Object.fromEntries(formData));

    const supabase = createClient();
    const { data: transition } = await supabase
      .from('project_lifecycle_transition')
      .select('project_id')
      .eq('id', input.transition_id)
      .single();

    const { error } = await supabase.rpc('validate_lifecycle_transition', {
      p_transition_id: input.transition_id,
      p_decision: input.decision,
      p_decision_memo: input.decision_memo ?? null,
    });
    if (error) return { ok: false, error: error.message };

    if (transition?.project_id) revalidateProjectPaths(transition.project_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── 3. Marquer perdu directement (CEO) ─────────────────────────────────────

export async function markProjectLostAction(formData: FormData): Promise<Result> {
  try {
    await assertRole(['ceo']);
    const input = markLostSchema.parse(Object.fromEntries(formData));

    const supabase = createClient();
    const { error } = await supabase.rpc('mark_project_lost', {
      p_project_id: input.project_id,
      p_reason_code: input.reason_code,
      p_lost_revenue_amount: input.lost_revenue_amount,
      p_lessons_learned: input.lessons_learned,
      p_memo: input.memo,
    });
    if (error) return { ok: false, error: error.message };

    revalidateProjectPaths(input.project_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── 4. Reprendre depuis pause (CEO 1-clic) ─────────────────────────────────

export async function resumeLifecycleAction(formData: FormData): Promise<Result> {
  try {
    await assertRole(['ceo']);
    const { project_id } = projectIdSchema.parse(Object.fromEntries(formData));

    const supabase = createClient();
    const { error } = await supabase.rpc('resume_lifecycle', { p_project_id: project_id });
    if (error) return { ok: false, error: error.message };

    revalidateProjectPaths(project_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}

// ─── 5. Ressusciter depuis perdu (CEO + friction) ──────────────────────────

export async function resurrectFromLostAction(formData: FormData): Promise<Result> {
  try {
    await assertRole(['ceo']);
    const input = resurrectSchema.parse(Object.fromEntries(formData));

    const supabase = createClient();
    const { error } = await supabase.rpc('resurrect_from_lost', {
      p_project_id: input.project_id,
      p_justification: input.justification,
    });
    if (error) return { ok: false, error: error.message };

    revalidateProjectPaths(input.project_id);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message ?? 'Erreur inconnue' };
  }
}
