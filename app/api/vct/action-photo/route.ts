import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/require';

/**
 * Redirige vers une signed URL pour télécharger une photo d'action VCT.
 * Sécurité : vérifie que le path existe bien dans `project_vct_corrective_actions.photo_paths`.
 */
export async function GET(request: NextRequest) {
  await requireRole(['ceo','chef_projet','developer']);
  const path = request.nextUrl.searchParams.get('path');
  if (!path) return new NextResponse('path manquant', { status: 400 });

  // Anti-bypass : vérifie que ce path est bien dans une action VCT existante
  const supabase = createClient();
  const { data: rows } = await supabase
    .from('project_vct_corrective_actions')
    .select('id, photo_paths')
    .contains('photo_paths', [path])
    .limit(1);
  if (!rows || rows.length === 0) {
    return new NextResponse('Photo introuvable', { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('documents').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    return new NextResponse(error?.message ?? 'Erreur signature', { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
