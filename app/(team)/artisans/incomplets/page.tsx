import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';

/**
 * Redirect canonique vers la nouvelle page unifiée /admin/completude (tab
 * Artisans, mode strict — qui reproduit exactement le comportement de
 * l'ancienne /artisans/incomplets).
 *
 * Préserve `scope` (si l'utilisateur arrivait avec un filtre business_scope).
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LegacyArtisansIncompletsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'finance', 'assistante', 'achats']);

  const params = new URLSearchParams();
  params.set('tab', 'artisans');
  params.set('mode', 'strict');
  const scope = searchParams.scope;
  if (typeof scope === 'string' && scope !== '') {
    params.set('scope', scope);
  } else if (Array.isArray(scope) && typeof scope[0] === 'string' && scope[0] !== '') {
    params.set('scope', scope[0]);
  }
  redirect(`/admin/completude?${params.toString()}`);
}
