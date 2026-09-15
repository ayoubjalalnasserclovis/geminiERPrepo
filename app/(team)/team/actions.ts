'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { assertRole } from '@/lib/auth/require';

const inviteSchema = z.object({
  email: z.string().email('Email invalide'),
  full_name: z.string().min(2, 'Nom complet requis'),
  role: z.enum([
    'ceo','chef_projet','sourcing','commercial',
    'finance','marketing','assistante','propria','developer','achats','menage',
  ]),
  mfa_required: z.string().optional().nullable(), // checkbox: 'on' | null
});

/**
 * Invite un nouveau collaborateur à rejoindre Stoniz.
 *
 * Workflow :
 *   1. CEO uniquement (sécurité)
 *   2. Crée le user dans auth.users via le client admin (envoi d'email d'invitation auto)
 *   3. Insère le profil correspondant dans `profiles` avec le rôle assigné
 *   4. Le collaborateur reçoit un email avec un lien pour définir son mot de passe
 *
 * Note : on ne permet PAS de créer un rôle 'client' via cette action — les clients
 * sont créés via le module Clients (table `clients` séparée).
 */
export async function inviteTeamMemberAction(formData: FormData) {
  await assertRole(['ceo']);

  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v === '' ? null : v;
  const data = inviteSchema.parse(raw);

  const admin = createAdminClient();

  // 1. Vérifie qu'aucun profil n'existe déjà pour cet email
  const { data: existing } = await admin
    .from('profiles')
    .select('id, email')
    .eq('email', data.email.toLowerCase())
    .maybeSingle();
  if (existing) {
    throw new Error(`Un compte existe déjà pour ${data.email}`);
  }

  // 2. Crée le user dans auth.users + envoie l'invitation par email
  // (Supabase enverra automatiquement un magic link pour définir le mot de passe)
  //
  // NOTE — Un trigger DB `on_auth_user_created` (handle_new_auth_user) crée
  // AUTOMATIQUEMENT une ligne dans `profiles` dès l'insert dans auth.users,
  // avec role='client' par défaut si rien n'est passé dans raw_user_meta_data.
  // On passe donc `role` ET `full_name` dans les metadata : le trigger pose
  // tout de suite la bonne valeur. L'UPSERT plus bas reste comme filet de
  // sécurité au cas où la fonction du trigger évoluerait.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://studio.stoniz.co';
  // Le redirectTo est la page d'atterrissage APRÈS la vérification du magic
  // link Supabase. Pour une invitation, on envoie sur /update-password pour
  // forcer la définition du mot de passe (la page vérifie qu'une session
  // existe ; sinon affiche "lien expiré"). NE PAS pointer vers /reset-password
  // (qui est la page "mot de passe oublié" — destination différente).
  const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(
    data.email.toLowerCase(),
    {
      data: { full_name: data.full_name, role: data.role },
      redirectTo: `${siteUrl}/update-password`,
    }
  );
  if (inviteErr || !invited?.user) {
    throw new Error(`Échec de l'invitation : ${inviteErr?.message ?? 'erreur inconnue'}`);
  }

  // 3. UPSERT du profil : si le trigger a déjà créé la ligne (cas nominal),
  // on met à jour avec le rôle + mfa_required ; sinon on insère.
  const mfaRequired = data.mfa_required === 'on' || data.mfa_required === 'true';
  const { error: profileErr } = await admin
    .from('profiles')
    .upsert({
      id: invited.user.id,
      email: data.email.toLowerCase(),
      full_name: data.full_name,
      role: data.role,
      is_active: true,
      mfa_required: mfaRequired,
    } as any, { onConflict: 'id' });

  if (profileErr) {
    // Rollback : supprime le user auth si l'upsert profil a échoué
    await admin.auth.admin.deleteUser(invited.user.id);
    throw new Error(`Impossible de créer le profil : ${profileErr.message}`);
  }

  revalidatePath('/team');
}

/**
 * Désactive un membre de l'équipe (sans supprimer ses données).
 * Le user ne pourra plus se connecter mais l'historique est conservé.
 */
export async function deactivateTeamMemberAction(profileId: string) {
  await assertRole(['ceo']);
  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ is_active: false } as any)
    .eq('id', profileId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
}

/**
 * Ré-active un membre désactivé.
 */
export async function reactivateTeamMemberAction(profileId: string) {
  await assertRole(['ceo']);
  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ is_active: true } as any)
    .eq('id', profileId);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
}

/**
 * Change le rôle d'un membre. Utile pour promotion / changement de fonction.
 */
const changeRoleSchema = z.object({
  profile_id: z.string().uuid(),
  role: z.enum([
    'ceo','chef_projet','sourcing','commercial',
    'finance','marketing','assistante','propria','developer','achats','menage',
  ]),
});

export async function changeTeamMemberRoleAction(formData: FormData) {
  await assertRole(['ceo']);
  const raw: Record<string, any> = {};
  for (const [k, v] of formData.entries()) raw[k] = v;
  const data = changeRoleSchema.parse(raw);

  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({ role: data.role } as any)
    .eq('id', data.profile_id);
  if (error) throw new Error(error.message);
  revalidatePath('/team');
}
