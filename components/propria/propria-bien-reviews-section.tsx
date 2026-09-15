import Link from 'next/link';
import { Star } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';

/**
 * Section "Derniers avis" sur la fiche bien Propria.
 * Affiche les 5 derniers avis pour les suites du bien + note moyenne 12 mois.
 *
 * Server Component — lit en BDD à chaque rendu (cache Next gère le reste).
 */
export async function PropriaBienReviewsSection({ propertyId }: { propertyId: string }) {
  const supabase = createClient();

  // Charge les unit_ids du bien
  const { data: units } = await supabase
    .from('propria_units')
    .select('id, code')
    .eq('property_id', propertyId)
    .is('deleted_at', null);
  const unitIds = (units ?? []).map((u: any) => u.id);
  if (unitIds.length === 0) return null;

  const { data: reviews } = await supabase
    .from('hostaway_reviews')
    .select(`
      id, channel_name, guest_name, public_review, rating_normalized,
      submitted_at, removed_at, internal_status, propria_unit_id
    `)
    .in('propria_unit_id', unitIds)
    .is('deleted_at', null)
    .order('submitted_at', { ascending: false })
    .limit(5);

  // Stats pour le bien
  const { data: allForStats } = await supabase
    .from('hostaway_reviews')
    .select('rating_normalized, removed_at')
    .in('propria_unit_id', unitIds)
    .is('deleted_at', null)
    .gte('submitted_at', new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString());

  const validRatings = (allForStats ?? [])
    .filter((r: any) => r.rating_normalized != null && !r.removed_at)
    .map((r: any) => Number(r.rating_normalized));
  const avg = validRatings.length > 0
    ? (validRatings.reduce((s, n) => s + n, 0) / validRatings.length).toFixed(2)
    : null;
  const nbNotFive = validRatings.filter((r) => r < 5).length;

  const unitCodeMap = new Map((units ?? []).map((u: any) => [u.id, u.code]));

  return (
    <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <summary className="cursor-pointer font-medium flex items-center gap-2">
        <Star className="w-4 h-4 text-amber-500 fill-current" />
        <span>Avis voyageurs</span>
        {avg && (
          <span className="text-sm text-stoniz-gray-700 font-normal">
            · note moyenne 12 mois : <strong className={Number(avg) >= 4.95 ? 'text-emerald-700' : Number(avg) >= 4.5 ? 'text-amber-700' : 'text-red-700'}>{avg}/5</strong>
            <span className="text-xs text-stoniz-gray-500 ml-1">({validRatings.length} avis{nbNotFive > 0 && ` · ${nbNotFive} non-5/5`})</span>
          </span>
        )}
        {!avg && <span className="text-xs text-stoniz-gray-500 font-normal">· aucun avis</span>}
      </summary>

      {(reviews ?? []).length === 0 ? (
        <p className="text-sm text-stoniz-gray-500 mt-4">Aucun avis enregistré pour ce bien.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {(reviews ?? []).map((r: any) => {
            const rating = r.rating_normalized != null ? Number(r.rating_normalized) : null;
            const color = rating == null ? 'text-stoniz-gray-400' : rating >= 4.95 ? 'text-emerald-700' : rating <= 3 ? 'text-red-700' : 'text-amber-700';
            return (
              <li key={r.id} className={`pl-3 border-l-2 ${r.removed_at ? 'border-stoniz-gray-200 opacity-60' : 'border-stoniz-gray-300'}`}>
                <div className="flex items-center gap-2 text-xs flex-wrap">
                  {rating != null && (
                    <span className={`font-medium ${color}`}>
                      <Star className="w-3 h-3 fill-current inline" /> {rating.toFixed(1)}/5
                    </span>
                  )}
                  <span className="text-stoniz-gray-600">{r.guest_name ?? 'Voyageur'}</span>
                  {r.channel_name && <span className="text-stoniz-gray-500">· {r.channel_name}</span>}
                  {r.propria_unit_id && unitCodeMap.get(r.propria_unit_id) && (
                    <span className="text-stoniz-gray-500">· {unitCodeMap.get(r.propria_unit_id)}</span>
                  )}
                  <span className="text-stoniz-gray-400">· {new Date(r.submitted_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  {r.removed_at && <span className="text-stoniz-gray-500">🗑️ supprimé</span>}
                </div>
                {r.public_review && (
                  <p className="text-sm text-stoniz-gray-800 mt-1 line-clamp-2">{r.public_review}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4">
        <Link
          href={`/propria/avis?unit=${unitIds[0]}`}
          className="text-xs text-blue-600 hover:underline"
        >
          Voir tous les avis →
        </Link>
      </div>
    </details>
  );
}
