import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Route handler d'authentification — appelé après :
 *  - une invitation (type=invite)
 *  - un magic link (type=magiclink)
 *  - un reset password (type=recovery)
 *  - un OAuth provider
 *
 * Si l'utilisateur n'a pas encore défini de mot de passe (invite/magiclink),
 * on le redirige systématiquement vers /update-password pour forcer la
 * définition d'un mot de passe avant tout autre accès.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const type = searchParams.get('type');
  const next = searchParams.get('next') ?? '/';

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  // Récupère l'utilisateur fraîchement connecté pour décider de la redirection
  const { data: { user } } = await supabase.auth.getUser();

  // Si type est explicitement invite/recovery/signup → toujours update-password
  if (type === 'invite' || type === 'recovery' || type === 'signup') {
    return NextResponse.redirect(`${origin}/update-password`);
  }

  // Sinon, on vérifie via l'API admin si l'utilisateur a déjà un mot de passe.
  // Les utilisateurs créés par inviteUserByEmail n'ont AUCUN provider 'email'
  // tant qu'ils n'ont pas défini de mot de passe — on détecte ça.
  if (user) {
    try {
      const admin = createAdminClient();
      const { data: full } = await admin.auth.admin.getUserById(user.id);
      const identities = full?.user?.identities ?? [];
      const hasEmailIdentity = identities.some(i => i.provider === 'email');
      // Pas d'identité email = jamais défini de mot de passe → force update
      if (!hasEmailIdentity) {
        return NextResponse.redirect(`${origin}/update-password`);
      }
    } catch (e) {
      // En cas d'échec de l'admin check, par sécurité on envoie quand même
      // sur update-password (jamais pire qu'un user qui définit un mdp en trop).
      console.warn('[auth-callback] admin check failed, defaulting to /update-password', e);
      return NextResponse.redirect(`${origin}/update-password`);
    }
  }

  // Tout est bon : redirection vers la destination demandée
  return NextResponse.redirect(`${origin}${next}`);
}
