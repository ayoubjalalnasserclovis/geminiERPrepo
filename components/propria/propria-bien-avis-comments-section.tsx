import Link from 'next/link';
import { MessageCircle, Star, ExternalLink } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

/**
 * Section « Commentaires d'avis récents » sur la fiche bien Propria
 * (chantier 7 marathon U9) : derniers commentaires internes propria_comments
 * de type 'avis' dont l'avis (hostaway_reviews) appartient à un lot du bien.
 * Lecture seule, avec lien vers l'avis dans le kanban (deep-link ?review=).
 *
 * Server Component — lit en BDD à chaque rendu.
 */
export async function PropriaBienAvisCommentsSection({ propertyId }: { propertyId: string }) {
  const supabase = createClient();

  // Lots du bien
  const { data: units } = await supabase
    .from('propria_units')
    .select('id, code')
    .eq('property_id', propertyId)
    .is('deleted_at', null);
  const unitIds = (units ?? []).map((u: any) => u.id);
  if (unitIds.length === 0) return null;

  // Avis des lots du bien (jointure hostaway_reviews.propria_unit_id)
  const { data: reviews } = await supabase
    .from('hostaway_reviews')
    .select('id, guest_name, rating_normalized, submitted_at, propria_unit_id')
    .in('propria_unit_id', unitIds)
    .is('deleted_at', null);
  const reviewMap = new Map(((reviews ?? []) as any[]).map((r) => [r.id, r]));
  const reviewIds = Array.from(reviewMap.keys());
  if (reviewIds.length === 0) return null;

  // Derniers commentaires internes sur ces avis
  const { data: comments } = await supabase
    .from('propria_comments')
    .select('id, entity_id, body, author_id, created_at')
    .eq('entity_type', 'avis')
    .in('entity_id', reviewIds)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(10);
  const rows = (comments ?? []) as any[];
  if (rows.length === 0) return null;

  // Noms des auteurs
  const authorIds = Array.from(new Set(rows.map((c) => c.author_id).filter(Boolean)));
  const nameMap = new Map<string, string | null>();
  if (authorIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles').select('id, full_name').in('id', authorIds);
    for (const p of (profiles ?? []) as any[]) nameMap.set(p.id, p.full_name);
  }

  const unitCodeMap = new Map(((units ?? []) as any[]).map((u) => [u.id, u.code]));

  return (
    <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <summary className="cursor-pointer font-medium flex items-center gap-2">
        <MessageCircle className="w-4 h-4 text-blue-600" />
        <span>Commentaires d&apos;avis récents</span>
        <span className="text-xs text-stoniz-gray-500 font-normal">({rows.length})</span>
      </summary>

      <ul className="mt-4 space-y-3">
        {rows.map((c) => {
          const review = reviewMap.get(c.entity_id) as any;
          const rating = review?.rating_normalized != null ? Number(review.rating_normalized) : null;
          const unitCode = review?.propria_unit_id ? unitCodeMap.get(review.propria_unit_id) : null;
          return (
            <li key={c.id} className="pl-3 border-l-2 border-blue-200">
              <div className="flex items-center gap-2 text-xs flex-wrap text-stoniz-gray-500">
                <span className="font-medium text-stoniz-gray-700">
                  {c.author_id ? nameMap.get(c.author_id) ?? '—' : '—'}
                </span>
                <span>
                  · {new Date(c.created_at).toLocaleString('fr-FR', {
                    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
                  })}
                </span>
                {review && (
                  <>
                    <span>· sur l&apos;avis de {review.guest_name ?? 'Voyageur'}</span>
                    {rating != null && (
                      <span className={rating >= 4.5 ? 'text-emerald-700' : rating <= 3 ? 'text-red-700' : 'text-amber-700'}>
                        <Star className="w-3 h-3 fill-current inline" /> {rating.toFixed(1)}/5
                      </span>
                    )}
                    {unitCode && <span className="font-mono">· {unitCode}</span>}
                    <Link
                      href={`/propria/avis?period=all${review.propria_unit_id ? `&unit=${review.propria_unit_id}` : ''}&review=${review.id}`}
                      className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                    >
                      ouvrir l&apos;avis <ExternalLink className="w-2.5 h-2.5" />
                    </Link>
                  </>
                )}
              </div>
              <p className="text-sm text-stoniz-gray-800 mt-0.5 whitespace-pre-wrap">{c.body}</p>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
