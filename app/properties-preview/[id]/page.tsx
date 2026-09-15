import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Eye, ArrowLeft } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PropertyPresentation } from '@/components/properties/property-presentation';
import { getPropertyMediaSignedUrls } from '@/app/(team)/properties/[id]/media/actions';

/**
 * Preview "Vue client" d'un bien (CEO 2026-06-11).
 *
 * Affiche la fiche bien telle qu'un client la verrait quand on lui propose
 * ce bien — utilise le même composant <PropertyPresentation /> que la
 * vraie page de proposition côté /client/projects/[id]/proposals.
 *
 * Accès restreint au staff (l'idée est de pouvoir verifier le rendu avant
 * d'envoyer la proposition au client).
 *
 * Différence avec la vraie proposition : on lit les données LIVE depuis
 * `properties_enriched` (pas un snapshot figé), donc les chiffres reflètent
 * l'état actuel du bien.
 */
export default async function PropertyClientPreviewPage({
  params,
}: {
  params: { id: string };
}) {
  // Tout staff peut prévisualiser (pas seulement sourcing).
  await requireRole([
    'ceo', 'chef_projet', 'developer', 'sourcing', 'commercial',
    'finance', 'marketing', 'assistante',
  ]);
  const supabase = createClient();

  // properties_enriched expose tous les calculs derived (rendement brut,
  // frais notaire, etc.) — exactement ce que voit le client.
  const { data: property } = await supabase
    .from('properties_enriched')
    .select('*')
    .eq('id', params.id)
    .single();
  if (!property) notFound();

  const media = await getPropertyMediaSignedUrls(params.id);

  return (
    <div>
      {/* Bandeau "preview" — visible uniquement par le staff */}
      <div className="sticky top-0 z-50 bg-amber-100 border-b border-amber-300 px-4 py-2">
        <div className="max-w-4xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs md:text-sm text-amber-900 inline-flex items-center gap-2">
            <Eye className="w-4 h-4" />
            <span className="font-medium">Vue client (prévisualisation)</span>
            <span className="hidden sm:inline text-amber-700">— ce que verra votre client quand on lui proposera ce bien</span>
          </div>
          <Link
            href={`/properties/${params.id}`}
            className="inline-flex items-center gap-1 text-xs text-amber-900 hover:text-amber-950 underline"
          >
            <ArrowLeft className="w-3 h-3" /> Retour à la fiche équipe
          </Link>
        </div>
      </div>

      {/* Rendu strictement identique à la fiche proposition côté client */}
      <div className="max-w-4xl mx-auto px-4 md:px-8 py-8 md:py-12">
        <PropertyPresentation property={property as any} media={media as any} />
      </div>
    </div>
  );
}
