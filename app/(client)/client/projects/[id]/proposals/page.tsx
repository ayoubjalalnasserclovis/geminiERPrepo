import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ProposalCard } from '@/components/proposals/proposal-card';
import { EmptyState } from '@/components/ui/empty-state';
import { PropertyMap } from '@/components/maps/property-map';
import { Card } from '@/components/ui/card';
import { getProposalMedia } from './actions';

export default async function ClientProposalsPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: proposals } = await supabase
    .from('property_proposals')
    .select('*')
    .eq('project_id', params.id)
    .order('sent_at', { ascending: false })
    .order('selection_order', { ascending: true });

  if (proposals === null) notFound();

  // Regroupe par selection_batch_id (les propositions envoyées ensemble)
  // Le dernier batch reçu est mis en avant avec sa team_note.
  const latestBatchId = proposals.find(p => p.selection_batch_id)?.selection_batch_id;
  const latestBatch = latestBatchId
    ? proposals.filter(p => p.selection_batch_id === latestBatchId)
    : [];
  const latestNote = latestBatch.find(p => p.team_note)?.team_note ?? null;

  // Récupère les médias en parallèle pour chaque proposition (avec URLs signées)
  const proposalsWithMedia = await Promise.all(
    proposals.map(async (p) => {
      try {
        const media = await getProposalMedia(p.id);
        return { ...p, media };
      } catch (e) {
        // Si la récupération des médias échoue, on continue sans
        console.warn(`[getProposalMedia] échec pour proposition ${p.id}`, e);
        return { ...p, media: [] };
      }
    })
  );

  return (
    <div>
      <h1 className="font-display text-3xl mb-2">Propositions de biens</h1>
      <p className="text-stoniz-gray-500 mb-6">Consultez les biens sélectionnés pour vous et indiquez votre intérêt.</p>

      {latestNote && (
        <Card className="mb-6 bg-accent-light/40 border-accent">
          <div className="text-xs uppercase tracking-wider text-stoniz-gray-600 mb-2">
            Le mot de votre conseiller
          </div>
          <p className="italic text-stoniz-black leading-relaxed whitespace-pre-line">
            {latestNote}
          </p>
        </Card>
      )}

      {proposalsWithMedia.length === 0 ? (
        <EmptyState
          title="Aucune proposition pour le moment"
          description="Vous serez notifié dès qu'un bien correspondant à vos critères sera identifié."
        />
      ) : (
        <>
          {/* Pin map des biens proposes (si au moins 1 a des coordonnees) */}
          {proposalsWithMedia.some(p => p.financial_snapshot?.latitude && p.financial_snapshot?.longitude) && (
            <Card className="mb-6">
              <h2 className="font-display text-lg mb-3">📍 Vue carte des biens proposés</h2>
              <PropertyMap
                height={360}
                showLegend={false}
                properties={proposalsWithMedia.map(p => ({
                  id: p.id,
                  name: p.financial_snapshot?.name ?? 'Bien',
                  quartier: p.financial_snapshot?.quartier ?? null,
                  price: p.financial_snapshot?.price ?? null,
                  latitude: p.financial_snapshot?.latitude ?? null,
                  longitude: p.financial_snapshot?.longitude ?? null,
                  badge_label: p.financial_snapshot?.badge_label ?? null,
                  evaluation: p.financial_snapshot?.evaluation ?? null,
                  status: p.client_response,
                }))}
              />
            </Card>
          )}

          <div className="space-y-8">
            {proposalsWithMedia.map(p => <ProposalCard key={p.id} proposal={p} media={p.media} />)}
          </div>
        </>
      )}
    </div>
  );
}
