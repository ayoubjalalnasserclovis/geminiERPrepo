import { NextResponse, type NextRequest } from 'next/server';
import { type EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Route handler pour les liens d'invitation, recovery, magiclink, email-confirmation.
 *
 * Le template Supabase doit pointer vers cette route avec :
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/update-password
 *
 * Pour les types `invite` et `recovery`, on force la redirection vers /update-password
 * afin que l'utilisateur définisse un mot de passe.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const token_hash = searchParams.get('token_hash');
  const type = searchParams.get('type') as EmailOtpType | null;
  const next = searchParams.get('next') ?? '/';

  if (token_hash && type) {
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash });
    if (!error) {
      // Pour invite & recovery : forcer la page de définition du mot de passe
      const target = (type === 'invite' || type === 'recovery')
        ? '/update-password'
        : next;
      return NextResponse.redirect(`${origin}${target}`);
    }
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    );
  }
  return NextResponse.redirect(`${origin}/login?error=invalid-link`);
}
