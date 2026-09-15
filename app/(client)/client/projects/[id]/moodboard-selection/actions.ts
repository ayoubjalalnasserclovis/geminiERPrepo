'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendClientMoodboardSelection } from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

const schema = z.object({
  project_id: z.string().uuid(),
  selections: z.array(z.object({
    template_id: z.string().uuid(),
    preference_order: z.number().int().min(1).max(2),
    client_comment: z.string().optional().nullable(),
  })).min(1).max(2),
  global_comment: z.string().min(10, 'Merci de partager au moins 10 caractères de commentaire global.'),
});

export async function submitMoodboardSelectionAction(input: unknown) {
  await assertRole(['client']);
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const userSupabase = createClient();
  const { data: { user } } = await userSupabase.auth.getUser();
  if (!user) return { ok: false, error: 'Non authentifié.' };

  const { project_id, selections, global_comment } = parsed.data;

  // On vérifie que ce client a bien accès à ce projet (anti-bypass d'ID)
  const { data: ownCheck } = await userSupabase.from('projects')
    .select('id').eq('id', project_id).maybeSingle();
  if (!ownCheck) return { ok: false, error: 'Projet introuvable ou accès refusé.' };

  // Le reste passe en admin : les colonnes projects.moodboard_* ne sont pas
  // modifiables par les clients via RLS, ce qui faisait silencieusement échouer
  // l'UPDATE et laissait le gate s'afficher en boucle.
  const admin = createAdminClient();

  // 1. Supprime les sélections existantes (re-soumission éventuelle)
  await admin.from('client_moodboard_selections')
    .delete().eq('project_id', project_id);

  // 2. Insère les nouvelles
  const rows = selections.map(s => ({
    project_id,
    template_id: s.template_id,
    preference_order: s.preference_order,
    client_comment: s.client_comment ?? null,
  }));
  const { error: insErr } = await admin.from('client_moodboard_selections').insert(rows);
  if (insErr) return { ok: false, error: insErr.message };

  // 3. Marque le projet comme ayant complété la sélection
  //    On demande explicitement les lignes affectées pour s'assurer qu'au moins
  //    une ligne a été touchée (sinon l'UPDATE est silencieux et le gate boucle).
  const { data: updated, error: upErr } = await admin.from('projects').update({
    moodboard_selection_completed_at: new Date().toISOString(),
    moodboard_selection_global_comment: global_comment,
  }).eq('id', project_id).select('id');
  if (upErr) return { ok: false, error: `UPDATE projects échec : ${upErr.message}` };
  if (!updated || updated.length === 0) {
    return { ok: false, error: `Projet ${project_id} introuvable côté admin. Vérifiez SUPABASE_SERVICE_ROLE_KEY.` };
  }

  // 4. Email à l'équipe (chef projet + tous les CEO)
  try {
    const { data: project } = await admin
      .from('projects')
      .select(`
        reference, assigned_chef_projet,
        client:clients(full_name, email)
      `)
      .eq('id', project_id).single();

    const { data: templates } = await admin
      .from('moodboard_templates')
      .select('id, name, style')
      .in('id', selections.map(s => s.template_id));

    const choicesForEmail = selections
      .map(s => ({
        order: s.preference_order,
        name: templates?.find(t => t.id === s.template_id)?.name ?? '—',
        comment: s.client_comment ?? null,
      }))
      .sort((a, b) => a.order - b.order);

    const recipients: { email: string; name: string }[] = [];
    if ((project as any)?.assigned_chef_projet) {
      const { data: chef } = await admin.from('profiles')
        .select('email, full_name').eq('id', (project as any).assigned_chef_projet).single();
      if (chef?.email) recipients.push({ email: chef.email, name: chef.full_name });
    }
    const { data: ceos } = await admin.from('profiles')
      .select('email, full_name').eq('role', 'ceo').eq('is_active', true);
    (ceos ?? []).forEach((c: any) => {
      if (!recipients.find(r => r.email === c.email)) {
        recipients.push({ email: c.email, name: c.full_name });
      }
    });

    for (const r of recipients) {
      await sendClientMoodboardSelection({
        to: r.email,
        recipient_name: r.name,
        client_name: (project as any)?.client?.full_name ?? '—',
        project_reference: (project as any)?.reference ?? project_id,
        choices: choicesForEmail,
        global_comment,
        project_url: `${APP_URL}/projects/${project_id}`,
        project_id,
      });
    }
  } catch (e) {
    console.warn('[email-moodboard-selection] echec', e);
  }

  revalidatePath(`/client/projects/${project_id}`);
  revalidatePath(`/projects/${project_id}`);
  redirect(`/client/projects/${project_id}`);
}
