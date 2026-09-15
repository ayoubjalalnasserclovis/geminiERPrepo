import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireRole } from '@/lib/auth/require';

/**
 * Renvoie un redirect vers une signed URL temporaire pour télécharger
 * le justificatif d'une dépense (PJ caisse Propria).
 *
 * Sécurité : on vérifie que le path existe bien dans propria_wallet_expenses
 * avant de signer (anti enum / scraping).
 */
export async function GET(request: NextRequest) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'finance', 'assistante', 'propria']);
  const path = request.nextUrl.searchParams.get('path');
  if (!path) return new NextResponse('path manquant', { status: 400 });

  // Vérifie que ce path est bien associé à une dépense (anti-bypass)
  const supabase = createClient();
  const { data: exp } = await supabase
    .from('propria_wallet_expenses')
    .select('id').eq('receipt_path', path).is('deleted_at', null).maybeSingle();
  if (!exp) return new NextResponse('Justificatif introuvable', { status: 404 });

  // Génère le signed URL via admin pour éviter les limitations RLS sur storage
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('documents').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) {
    return new NextResponse(error?.message ?? 'Erreur signature', { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
