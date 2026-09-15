import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';

/**
 * Redirect canonique vers la nouvelle page unifiée /admin/completude (tab Projets).
 * Tout le code historique a déménagé dans :
 *   - app/(team)/admin/completude/page.tsx
 *   - components/completude/projets-tab.tsx
 *
 * On préserve les query params éventuels (criticality, phase, chef, open,
 * historique) en les relayant tels quels au nouvel emplacement.
 */

export const dynamic = 'force-dynamic';

type SearchParams = Record<string, string | string[] | undefined>;

export default async function LegacyCompletudeProjetsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'assistante']);

  const params = new URLSearchParams();
  params.set('tab', 'projets');
  for (const [k, v] of Object.entries(searchParams)) {
    if (v === undefined || v === '' || k === 'tab') continue;
    if (Array.isArray(v)) {
      const first = v[0];
      if (first !== undefined && first !== '') params.set(k, first);
    } else {
      params.set(k, v);
    }
  }
  redirect(`/admin/completude?${params.toString()}`);
}
