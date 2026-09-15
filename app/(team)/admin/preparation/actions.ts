'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';

/**
 * Server actions du mode préparation.
 *
 * RÈGLE D'OR : toutes ces actions exigent un super-admin (is_super_admin=true
 * sur profiles). Le rôle métier seul (role='ceo') ne suffit PAS — c'est le
 * drapeau de pouvoir qui compte.
 */

async function assertSuperAdmin() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, is_super_admin')
    .eq('id', user.id)
    .single();
  if (!profile?.is_super_admin) {
    throw new Error('Action réservée aux super-admins.');
  }
  return { userId: user.id, profile };
}

// ─── Mode préparation : flip on / off ───────────────────────────────────────

const projectIdSchema = z.object({ project_id: z.string().uuid() });

export async function markProjectAsPreparationAction(formData: FormData) {
  const { userId } = await assertSuperAdmin();
  const { project_id } = projectIdSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({
      is_preparation: true,
      prepared_by: userId,
      prepared_at: new Date().toISOString(),
    } as any)
    .eq('id', project_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}`);
  revalidatePath('/admin/preparation');
}

export async function unmarkProjectAsPreparationAction(formData: FormData) {
  await assertSuperAdmin();
  const { project_id } = projectIdSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ is_preparation: false } as any)
    .eq('id', project_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}`);
  revalidatePath('/admin/preparation');
}

export async function markProjectAsLegacyAction(formData: FormData) {
  await assertSuperAdmin();
  const { project_id } = projectIdSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();
  const { error } = await supabase
    .from('projects')
    .update({ legacy_imported: true } as any)
    .eq('id', project_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${project_id}`);
  revalidatePath('/admin/preparation');
}

// ─── Dates approximatives ───────────────────────────────────────────────────

const APPROXIMATE_DATE_FIELDS = [
  'compromis_date',
  'acte_authentique_date',
  'travaux_start_date',
  'travaux_end_date',
  'livraison_date',
] as const;

const setApproxSchema = z.object({
  project_id: z.string().uuid(),
  field: z.enum(APPROXIMATE_DATE_FIELDS),
  is_approximate: z.coerce.boolean(),
});

export async function setDateApproximateAction(formData: FormData) {
  await assertSuperAdmin();
  const parsed = setApproxSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();
  const col = `${parsed.field}_is_approximate`;
  const { error } = await supabase
    .from('projects')
    .update({ [col]: parsed.is_approximate } as any)
    .eq('id', parsed.project_id);
  if (error) throw new Error(error.message);
  revalidatePath(`/projects/${parsed.project_id}`);
}

// ─── Dry-run activation : aperçu sans rien écrire ──────────────────────────

export async function dryRunActivateAction(projectId: string) {
  await assertSuperAdmin();
  const supabase = createClient();

  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select(`
      id, reference, code, current_phase, status, is_preparation, legacy_imported,
      activated_at, client_id,
      client:clients(id, full_name, email, profile_id),
      property:properties(id, name)
    `)
    .eq('id', projectId)
    .single();
  if (projErr || !project) {
    return { ok: false, error: projErr?.message ?? 'Projet introuvable' };
  }

  // Stats associées au projet
  const [docsRes, paymentsRes, tasksRes, bypassRes] = await Promise.all([
    supabase.from('documents').select('id, type, is_internal').eq('project_id', projectId).is('deleted_at', null),
    supabase.from('payments').select('id, type, amount_expected, amount_paid, status').eq('project_id', projectId),
    supabase.from('tasks').select('id, title, status, is_blocking').eq('project_id', projectId),
    supabase.from('project_phase_bypass_log').select('from_phase, to_phase, gates_skipped, bypassed_at').eq('project_id', projectId).order('bypassed_at', { ascending: true }),
  ]);

  // Supabase type la relation `client` comme un tableau ; ici c'est une relation
  // 1-à-1 (client_id) → on normalise en un seul objet.
  const client = (Array.isArray(project.client) ? project.client[0] : project.client) as
    { id: string; email: string | null; full_name: string | null; profile_id: string | null } | null | undefined;

  return {
    ok: true,
    project,
    counts: {
      documents_total: docsRes.data?.length ?? 0,
      documents_internal: (docsRes.data ?? []).filter((d: any) => d.is_internal).length,
      documents_exposed: (docsRes.data ?? []).filter((d: any) => !d.is_internal).length,
      payments: paymentsRes.data?.length ?? 0,
      tasks_open: (tasksRes.data ?? []).filter((t: any) => t.status !== 'done').length,
      tasks_blocking_open: (tasksRes.data ?? []).filter((t: any) => t.status !== 'done' && t.is_blocking).length,
    },
    bypasses: bypassRes.data ?? [],
    will_send_invitation_email: !project.legacy_imported && !!client?.email,
    will_create_auth_user: !client?.profile_id && !!client?.email,
  };
}

// ─── Activation réelle d'un projet ──────────────────────────────────────────

const activateSchema = z.object({
  project_id: z.string().uuid(),
  send_invitation_email: z.coerce.boolean().default(true),
});

export async function activateProjectAction(formData: FormData) {
  const { userId } = await assertSuperAdmin();
  const parsed = activateSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();
  const admin = createAdminClient();

  // 1. Charge le projet + client
  const { data: project, error: projErr } = await supabase
    .from('projects')
    .select(`
      id, reference, code, is_preparation, legacy_imported, activated_at, client_id,
      client:clients(id, email, full_name, profile_id)
    `)
    .eq('id', parsed.project_id)
    .single();
  if (projErr || !project) {
    return { ok: false, error: projErr?.message ?? 'Projet introuvable' };
  }
  if (project.activated_at) {
    return { ok: false, error: 'Projet déjà activé.' };
  }

  // Supabase type la relation `client` comme un tableau ; relation 1-à-1 → on
  // normalise en un seul objet.
  const client = (Array.isArray(project.client) ? project.client[0] : project.client) as
    { id: string; email: string | null; full_name: string | null; profile_id: string | null } | null | undefined;

  // 2. Crée l'utilisateur auth si nécessaire (sauf legacy)
  let authUserId: string | undefined = undefined;
  if (!project.legacy_imported && client?.email && !client.profile_id) {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
      client.email,
      {
        data: { full_name: client.full_name, role: 'client' },
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/client`,
      },
    );
    if (inviteErr) {
      console.error('[activate] invite échoué', inviteErr.message);
      // On continue : l'utilisateur pourra être créé manuellement, on log juste
    } else {
      authUserId = invited.user?.id;
      // Lie profile au client
      if (authUserId) {
        await admin.from('clients').update({ profile_id: authUserId }).eq('id', client.id);
      }
    }
  }

  // 3. Snapshot complet de l'état du projet à T0
  const [docsRes, paymentsRes, tasksRes, bypassRes] = await Promise.all([
    admin.from('documents').select('*').eq('project_id', parsed.project_id),
    admin.from('payments').select('*').eq('project_id', parsed.project_id),
    admin.from('tasks').select('*').eq('project_id', parsed.project_id),
    admin.from('project_phase_bypass_log').select('*').eq('project_id', parsed.project_id),
  ]);

  await admin.from('project_activation_snapshot').insert({
    project_id: parsed.project_id,
    activated_by: userId,
    was_legacy_imported: project.legacy_imported ?? false,
    snapshot: {
      project,
      documents: docsRes.data,
      payments: paymentsRes.data,
      tasks: tasksRes.data,
      bypasses: bypassRes.data,
      activated_auth_user_id: authUserId,
    },
    invitation_email_status: parsed.send_invitation_email && !project.legacy_imported
      ? 'pending'
      : 'skipped',
  });

  // 4. Flip les drapeaux : sortie du mode préparation
  const { error: updErr } = await admin
    .from('projects')
    .update({
      is_preparation: false,
      activated_at: new Date().toISOString(),
    } as any)
    .eq('id', parsed.project_id);
  if (updErr) return { ok: false, error: updErr.message };

  revalidatePath(`/projects/${parsed.project_id}`);
  revalidatePath('/admin/preparation');
  return { ok: true, auth_user_id: authUserId };
}

// ─── Batch activation pour big bang ─────────────────────────────────────────

const batchSchema = z.object({
  project_ids: z.array(z.string().uuid()).min(1).max(100),
  send_invitation_email: z.coerce.boolean().default(true),
});

export async function batchActivateAction(input: { project_ids: string[]; send_invitation_email?: boolean }) {
  await assertSuperAdmin();
  const parsed = batchSchema.parse(input);
  const results: { project_id: string; ok: boolean; error?: string }[] = [];

  for (const pid of parsed.project_ids) {
    const fd = new FormData();
    fd.append('project_id', pid);
    fd.append('send_invitation_email', String(parsed.send_invitation_email ?? true));
    try {
      const r = await activateProjectAction(fd);
      results.push({ project_id: pid, ok: !!r.ok, error: r.ok ? undefined : r.error });
    } catch (e) {
      results.push({ project_id: pid, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  revalidatePath('/admin/preparation');
  return {
    total: results.length,
    success: results.filter(r => r.ok).length,
    failed: results.filter(r => !r.ok).length,
    results,
  };
}

// ─── Rollback d'une activation par erreur ──────────────────────────────────

// ─── Édition email/phone client (utile pour fixer les placeholders) ────────

const updateClientContactSchema = z.object({
  client_id: z.string().uuid(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
});

export async function updateClientContactAction(formData: FormData) {
  await assertSuperAdmin();
  const parsed = updateClientContactSchema.parse(Object.fromEntries(formData));
  const supabase = createClient();

  const updates: Record<string, any> = {};
  if (parsed.email !== undefined) updates.email = parsed.email?.trim().toLowerCase() || null;
  if (parsed.phone !== undefined) updates.phone = parsed.phone?.trim() || null;

  if (Object.keys(updates).length === 0) {
    return { ok: false, error: 'Aucun champ à mettre à jour' };
  }

  const { error } = await supabase
    .from('clients')
    .update(updates)
    .eq('id', parsed.client_id);
  if (error) {
    if (error.message.includes('duplicate') || error.message.includes('unique')) {
      return { ok: false, error: 'Cet email est déjà utilisé par un autre client.' };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath('/admin/preparation');
  return { ok: true };
}

export async function rollbackActivationAction(formData: FormData) {
  const { userId } = await assertSuperAdmin();
  const { project_id } = projectIdSchema.parse(Object.fromEntries(formData));
  const admin = createAdminClient();

  // 1. Lit la dernière activation pour récupérer l'auth user éventuellement créé
  const { data: snapshot } = await admin
    .from('project_activation_snapshot')
    .select('snapshot')
    .eq('project_id', project_id)
    .order('activated_at', { ascending: false })
    .limit(1)
    .single();
  const authUserId = (snapshot?.snapshot as any)?.activated_auth_user_id;

  // 2. Si user auth créé, le supprimer (révoque l'accès, annule l'invitation)
  if (authUserId) {
    const { error: delErr } = await admin.auth.admin.deleteUser(authUserId);
    if (delErr) {
      console.error('[rollback] delete auth user échoué', delErr.message);
      // On continue le rollback du flag même si suppression auth échoue
    }
  }

  // 3. Délie le client de l'auth
  const { data: project } = await admin
    .from('projects')
    .select('client_id, client:clients(id, profile_id)')
    .eq('id', project_id)
    .single();
  if ((project?.client as any)?.profile_id === authUserId && project?.client_id) {
    await admin.from('clients').update({ profile_id: null }).eq('id', project.client_id);
  }

  // 4. Remet le projet en mode préparation
  const { error: updErr } = await admin
    .from('projects')
    .update({
      is_preparation: true,
      activated_at: null,
      prepared_by: userId,
      prepared_at: new Date().toISOString(),
    } as any)
    .eq('id', project_id);
  if (updErr) throw new Error(updErr.message);

  revalidatePath('/admin/preparation');
  revalidatePath(`/projects/${project_id}`);
}
