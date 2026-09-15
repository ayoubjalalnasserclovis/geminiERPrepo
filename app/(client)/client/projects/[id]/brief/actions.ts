'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { sendBriefValidatedToTeam, sendBriefRejectedToTeam } from '@/lib/email/templates';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

export async function clientValidateBriefAction(projectId: string) {
  const me = await assertRole(['client']);
  const supabase = createClient();

  // Verifie que le client est bien le proprietaire du projet
  const { data: project } = await supabase
    .from('projects')
    .select('id, client:clients!inner(profile_id)')
    .eq('id', projectId).single();
  if (!project || (project as any).client?.profile_id !== me.id) {
    return { ok: false, error: 'Projet introuvable ou non autorisé' };
  }

  const { data: brief } = await supabase.from('project_briefs')
    .select('id, status').eq('project_id', projectId).single();
  if (!brief) return { ok: false, error: 'Cahier des charges introuvable' };
  if (brief.status !== 'sent_to_client') {
    return { ok: false, error: 'Ce cahier des charges n\'est pas en attente de votre validation' };
  }

  const { error } = await supabase.from('project_briefs').update({
    status: 'validated',
    validated_at: new Date().toISOString(),
  }).eq('id', brief.id);
  if (error) return { ok: false, error: error.message };

  // Cree un document trace dans la liste docs du projet (admin pour bypass RLS)
  try {
    const admin = createAdminClient();
    await admin.from('documents').insert({
      project_id: projectId,
      client_id: (project as any).client?.id ?? null,
      name: `Cahier des charges validé - ${new Date().toLocaleDateString('fr-FR')}`,
      type: 'cahier_des_charges',
      uploaded_by: me.id,
      uploaded_by_role: 'client',
      storage_path: `briefs/${projectId}/validated.json`,
      mime_type: 'application/json',
      is_visible_to_client: true,
      status: 'valide',
    });
  } catch (e) {
    console.warn('[brief-validated] doc-trace echec :', e);
  }

  // Email à l'équipe (chef de projet + CEO)
  try {
    const adminEmail = createAdminClient();
    const { data: proj } = await adminEmail.from('projects')
      .select('reference, assigned_chef_projet, client:clients(full_name)').eq('id', projectId).single();
    const recipients = await getStaffEmails(adminEmail, (proj as any)?.assigned_chef_projet);
    for (const r of recipients) {
      await sendBriefValidatedToTeam({
        to: r.email, chef_name: r.full_name,
        client_name: (proj as any)?.client?.full_name ?? '',
        project_reference: (proj as any)?.reference ?? '',
        project_url: `${APP_URL}/projects/${projectId}/brief`,
        project_id: projectId,
      });
    }
  } catch (e) { console.warn('[email-brief-validated] echec', e); }

  revalidatePath(`/client/projects/${projectId}/brief`);
  revalidatePath(`/client/projects/${projectId}`);
  revalidatePath(`/client`);
  return { ok: true };
}

async function getStaffEmails(admin: any, chefId: string | null) {
  const out: { email: string; full_name: string }[] = [];
  if (chefId) {
    const { data } = await admin.from('profiles')
      .select('email, full_name').eq('id', chefId).single();
    if (data?.email) out.push(data);
  }
  const { data: ceos } = await admin.from('profiles')
    .select('email, full_name').eq('role', 'ceo').eq('is_active', true);
  (ceos ?? []).forEach((c: any) => {
    if (!out.find(o => o.email === c.email)) out.push(c);
  });
  return out;
}

export async function clientRejectBriefAction(projectId: string, reason: string) {
  const me = await assertRole(['client']);
  const supabase = createClient();

  if (!reason || reason.trim().length < 5) {
    return { ok: false, error: 'Merci d\'indiquer une raison (au moins 5 caractères)' };
  }

  const { data: project } = await supabase
    .from('projects')
    .select('id, client:clients!inner(profile_id)')
    .eq('id', projectId).single();
  if (!project || (project as any).client?.profile_id !== me.id) {
    return { ok: false, error: 'Projet introuvable ou non autorisé' };
  }

  const { data: brief } = await supabase.from('project_briefs')
    .select('id, status').eq('project_id', projectId).single();
  if (!brief) return { ok: false, error: 'Cahier des charges introuvable' };
  if (brief.status !== 'sent_to_client') {
    return { ok: false, error: 'Ce cahier des charges n\'est pas en attente de votre validation' };
  }

  const { error } = await supabase.from('project_briefs').update({
    status: 'rejected_by_client',
    rejected_at: new Date().toISOString(),
    rejection_reason: reason.trim(),
  }).eq('id', brief.id);
  if (error) return { ok: false, error: error.message };

  // Email à l'équipe
  try {
    const adminEmail = createAdminClient();
    const { data: proj } = await adminEmail.from('projects')
      .select('reference, assigned_chef_projet, client:clients(full_name)').eq('id', projectId).single();
    const recipients = await getStaffEmails(adminEmail, (proj as any)?.assigned_chef_projet);
    for (const r of recipients) {
      await sendBriefRejectedToTeam({
        to: r.email, chef_name: r.full_name,
        client_name: (proj as any)?.client?.full_name ?? '',
        project_reference: (proj as any)?.reference ?? '',
        reason: reason.trim(),
        project_url: `${APP_URL}/projects/${projectId}/brief`,
        project_id: projectId,
      });
    }
  } catch (e) { console.warn('[email-brief-rejected] echec', e); }

  revalidatePath(`/client/projects/${projectId}/brief`);
  revalidatePath(`/client/projects/${projectId}`);
  return { ok: true };
}
