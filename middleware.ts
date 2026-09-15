import { type NextRequest, NextResponse } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// '/upsell' = page publique voyageur via QR code (chantier 9, décision B6) —
// slug non-devinable, aucune donnée sensible exposée, écritures côté serveur uniquement.
const PUBLIC_ROUTES = ['/login', '/reset-password', '/update-password', '/auth/callback', '/auth/confirm', '/upsell'];
const STAFF_ROOTS = ['/dashboard', '/projects', '/properties', '/clients', '/partners', '/tasks', '/team', '/settings', '/caisse-stoniz', '/achats', '/artisans', '/validations'];
const CLIENT_ROOTS = ['/client'];
// Le rôle 'propria' n'a accès qu'aux écrans /propria + /artisans (pour les prestataires)
const PROPRIA_ALLOWED_ROOTS = ['/propria', '/artisans', '/settings/profile'];

export async function middleware(request: NextRequest) {
  const { response, supabase, user } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  // Routes publiques (auth, callback)
  if (PUBLIC_ROUTES.some(r => pathname.startsWith(r)) || pathname.startsWith('/api')) {
    return response;
  }

  // Non authentifié → redirection login
  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  // Récupérer le rôle
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  const isClient = profile.role === 'client';
  const isPropria = profile.role === 'propria';
  const isMenage = profile.role === 'menage';

  // Détection précise : la route DOIT être exactement le root OU continuer par "/".
  // Évite que "/clients" (staff) soit confondu avec "/client" (portail).
  const isOnStaff = STAFF_ROOTS.some(r => pathname === r || pathname.startsWith(r + '/'));
  const isOnClient = CLIENT_ROOTS.some(r => pathname === r || pathname.startsWith(r + '/'));
  const isOnPropriaAllowed = PROPRIA_ALLOWED_ROOTS.some(r => pathname === r || pathname.startsWith(r + '/'));

  if (isClient && isOnStaff) {
    return NextResponse.redirect(new URL('/client', request.url));
  }
  if (!isClient && isOnClient) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }
  // Rôle propria : restreint à /propria et écrans autorisés
  if (isPropria && !isOnPropriaAllowed) {
    return NextResponse.redirect(new URL('/propria', request.url));
  }

  // Redirect root selon rôle
  if (pathname === '/') {
    const home = isClient ? '/client' : isPropria ? '/propria' : isMenage ? '/propria/menage' : '/dashboard';
    return NextResponse.redirect(new URL(home, request.url));
  }

  // Propage le pathname dans un header pour le rendre lisible côté Server Components
  response.headers.set('x-pathname', pathname);
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)'],
};
