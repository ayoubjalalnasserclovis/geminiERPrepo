import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/require';

/**
 * Renvoie un redirect vers une signed URL temporaire pour télécharger
 * le justificatif d'une dépense STONIZ (caisse cash).
 */
export async function GET(request: NextRequest) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'finance', 'assistante']);
  const path = request.nextUrl.searchParams.get('path');
  if (!path) return new NextResponse('path manquant', { status: 400 });

  // Anti-bypass : on vérifie que ce path est bien associé à une dépense
  const supabase = createClient();
  const { data: exp } = await supabase
    .from('stoniz_wallet_expenses')
    .select('id').eq('receipt_path', path).is('deleted_at', null).maybeSingle();
  if (!exp) return new NextResponse('Justificatif introuvable', { status: 404 });

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('documents').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    return new NextResponse(error?.message ?? 'Erreur signature', { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
