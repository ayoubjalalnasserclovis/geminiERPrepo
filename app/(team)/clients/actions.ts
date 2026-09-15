'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';
import { clientCreateSchema } from '@/lib/validators/schemas';
import { sendWelcomePortal, sendPortalInviteResend } from '@/lib/email/templates';

export async function createClientAction(input: unknown) {
  await assertRole(['ceo','chef_projet','commercial']);
  const parsed = clientCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message };
  }

  const supabase = createClient();
  const { data, error } = await supabase
    .from('clients')
    .insert({ ...parsed.data, consent_at: new Date().toISOString(), consent_version: 'v1' })
    .select('id')
    .single();

  if (error) return { ok: false, error: error.message };
  revalidatePath('/clients');
  return { ok: true, id: data.id };
}

export async function updateClientAction(id: string, input: unknown) {
  await assertRole(['ceo','chef_projet','commercial']);
  const parsed = clientCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = createClient();
  const { error } = await supabase.from('clients').update(parsed.data).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/clients/${id}`);
  return { ok: true };
}

/**
 * Soft-delete d'un client. CEO uniquement (action sensible :
 * impact sur projets liés, paiements, historique). Conforme au canon
 * "soft-delete partout" — on pose juste deleted_at = now().
 */
export async function deleteClientAction(id: string) {
  await assertRole(['ceo']);
  const supabase = createClient();
  const { error } = await supabase.from('clients')
    .update({ deleted_at: new Date().toISOString() }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/clients');
  return { ok: true };
}

/**
 * Compteurs d'impact pour la modale de confirmation suppression client.
 * Renvoie le nombre de projets liés (tous statuts), nombre de projets non perdus,
 * nombre de paiements ouverts (non payés et non supprimés).
 *
 * Règle perdus : on inclut les perdus dans le compteur total ("ce client a EU N
 * projets") mais on isole les non-perdus pour expliquer l'impact business actif.
 */
export async function getClientDeletionImpactAction(id: string) {
  await assertRole(['ceo']);
  const supabase = createClient();

  const { data: client } = await supabase
    .from('clients').select('id, full_name').eq('id', id).is('deleted_at', null).maybeSingle();
  if (!client) return { ok: false, error: 'Client introuvable' };

  // Projets liés (toutes statuts confondus, non supprimés)
  const { count: projects_total } = await supabase
    .from('projects').select('id', { count: 'exact', head: true })
    .eq('client_id', id).is('deleted_at', null);

  // Projets non perdus (= business actif au sens canon)
  const { count: projects_actifs } = await supabase
    .from('projects').select('id', { count: 'exact', head: true })
    .eq('client_id', id).is('deleted_at', null).neq('status', 'perdu');

  // Paiements ouverts (non soldés, non supprimés) sur ses projets
  const { data: openPayments } = await supabase
    .from('payments')
    .select('amount_expected, amount_paid, project:projects!inner(client_id)')
    .eq('project.client_id', id)
    .is('deleted_at', null)
    .neq('status', 'paid');
  const payments_open = (openPayments ?? []).length;
  const payments_open_remaining = (openPayments ?? [])
    .reduce((s, p: any) => s + Math.max(0, Number(p.amount_expected) - Number(p.amount_paid)), 0);

  return {
    ok: true,
    impact: {
      client_name: client.full_name,
      projects_total: projects_total ?? 0,
      projects_actifs: projects_actifs ?? 0,
      payments_open,
      payments_open_remaining,
    },
  };
}

/**
 * Invite un client au portail : crée un compte auth via magic link + lie clients.profile_id.
 */
export async function inviteClientAction(client_id: string) {
  await assertRole(['ceo','chef_projet','commercial','assistante']);
  const admin = createAdminClient();

  // 1. Charger le client
  const { data: client, error: fetchErr } = await admin
    .from('clients')
    .select('id, email, full_name, profile_id')
    .eq('id', client_id)
    .single();

  if (fetchErr || !client) return { ok: false, error: 'Client introuvable' };
  if (client.profile_id) return { ok: false, error: 'Client déjà invité' };

  // 2. Inviter via magic link (Supabase Auth)
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    client.email,
    {
      data: { full_name: client.full_name, role: 'client' },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/client`,
    }
  );

  if (inviteErr || !invited.user) {
    return { ok: false, error: inviteErr?.message ?? 'Erreur invitation' };
  }

  // 3. Lier
  await admin.from('clients').update({ profile_id: invited.user.id }).eq('id', client_id);

  // 4. Mail de bienvenue (en plus du mail Supabase Auth)
  await sendWelcomePortal({
    to: client.email,
    client_name: client.full_name,
    portal_url: `${process.env.NEXT_PUBLIC_APP_URL}/client`,
  });

  revalidatePath(`/clients/${client_id}`);
  return { ok: true };
}

// ─── Renvoi du lien d'invitation (CEO 2026-08-19, session D) ───────────────
// Cas : le client n'a pas cliqué le lien d'invitation initial, qui a expiré.
// On génère un NOUVEAU lien de connexion (l'ancien devient caduc — Supabase
// invalide le jeton précédent du même type) et on l'envoie via notre email.
// Refusé si le client s'est déjà connecté (le renvoi n'a pas de sens — il
// peut se reconnecter par mot de passe ou « lien magique » du login).
export async function resendClientInviteAction(client_id: string) {
  await assertRole(['ceo', 'chef_projet', 'commercial', 'assistante']);
  const admin = createAdminClient();

  const { data: client, error: fetchErr } = await admin
    .from('clients')
    .select('id, email, full_name, profile_id')
    .eq('id', client_id)
    .single();
  if (fetchErr || !client) return { ok: false as const, error: 'Client introuvable' };
  if (!client.profile_id) {
    return { ok: false as const, error: 'Client jamais invité — utilise « Inviter au portail ».' };
  }

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(client.profile_id);
  if (userErr || !userRes?.user) {
    return { ok: false as const, error: userErr?.message ?? 'Compte portail introuvable' };
  }
  if (userRes.user.last_sign_in_at) {
    return {
      ok: false as const,
      error: 'Ce client s\'est déjà connecté au portail — inutile de renvoyer une invitation.',
    };
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: client.email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/client` },
  });
  const actionLink = linkData?.properties?.action_link;
  if (linkErr || !actionLink) {
    return { ok: false as const, error: linkErr?.message ?? 'Génération du lien échouée' };
  }

  await sendPortalInviteResend({
    to: client.email,
    client_name: client.full_name,
    action_link: actionLink,
  });

  revalidatePath(`/clients/${client_id}`);
  return { ok: true as const };
}
