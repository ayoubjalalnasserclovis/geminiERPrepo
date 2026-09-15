import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * Sert une photo via signed URL. Sécurité par RLS Supabase :
 *   - On utilise le client serveur authentifié pour vérifier l'accès
 *   - Si la photo n'est pas accessible (RLS), pas de signed URL
 *   - Sinon, redirige vers une signed URL d'1 heure
 */
export async function GET(request: NextRequest) {
  const photoId = request.nextUrl.searchParams.get('id');
  const path = request.nextUrl.searchParams.get('path');
  if (!photoId && !path) return new NextResponse('id ou path requis', { status: 400 });

  const supabase = createClient();

  let storagePath: string | null = null;
  if (photoId) {
    const { data } = await supabase
      .from('project_photos')
      .select('storage_path').eq('id', photoId).is('deleted_at', null).maybeSingle();
    storagePath = data?.storage_path ?? null;
  } else if (path) {
    const { data } = await supabase
      .from('project_photos')
      .select('storage_path').eq('storage_path', path).is('deleted_at', null).maybeSingle();
    storagePath = data?.storage_path ?? null;
  }

  if (!storagePath) return new NextResponse('Photo introuvable', { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('documents').createSignedUrl(storagePath, 3600);
  if (error || !data?.signedUrl) {
    return new NextResponse(error?.message ?? 'Erreur signature', { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
