import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { Button } from '@/components/ui/button';
import { PropertyMediaGallery } from '@/components/properties/property-media-gallery';
import { PropertyPublicationBanner } from '@/components/properties/property-publication-banner';
import { CommercialHistoryPanel } from '@/components/properties/commercial-history-panel';
import { BackLink } from '@/components/ui/back-link';
import { getPropertyMediaSignedUrls } from '@/app/(team)/properties/[id]/media/actions';
import { requireRole } from '@/lib/auth/require';
import { PropertyDeleteButton } from './delete-button';

export default async function PropertyDetailPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['ceo','chef_projet','developer','sourcing','commercial','finance','marketing','assistante']);
  const canDelete = user.role === 'ceo' || user.role === 'chef_projet' || user.role === 'sourcing';
  const supabase = createClient();
  const [propRes, pubRes, visitsRes, offersRes, projectsWithCompromisRes] = await Promise.all([
    supabase.from('properties_enriched').select('*').eq('id', params.id).single(),
    supabase.from('properties_publication_status').select('is_published, published_at, missing_for_publication').eq('id', params.id).maybeSingle(),
    // Historique commercial : visites du bien (tous projets confondus)
    supabase.from('property_visits')
      .select('id, visited_at, notes, project_id, project:projects(client_id, client:clients(full_name))')
      .eq('property_id', params.id).is('deleted_at', null).order('visited_at', { ascending: false }),
    // Offres reçues sur ce bien
    supabase.from('project_offers')
      .select('id, offer_date, offer_amount, status, counter_amount, notes, project_id, project:projects(client_id, client:clients(full_name))')
      .eq('property_id', params.id).is('deleted_at', null).order('offer_date', { ascending: false }),
    // Projets avec compromis signé sur ce bien
    supabase.from('projects')
      .select('id, compromis_date, client:clients(full_name)')
      .eq('property_id', params.id).is('deleted_at', null).not('compromis_date', 'is', null),
  ]);
  const property = propRes.data;
  if (!property) notFound();

  const { data: partner } = property.partner_id
    ? await supabase.from('partners').select('agency_name').eq('id', property.partner_id).single()
    : { data: null };

  const media = await getPropertyMediaSignedUrls(params.id);

  return (
    <div className="space-y-6">
      <BackLink href="/properties" label="Retour aux biens" />
      <PageHeader
        title={property.name}
        description={`${property.type ?? ''} · ${property.quartier ?? ''}`}
        action={
          <div className="flex gap-2 items-center flex-wrap">
            {pubRes.data?.is_published
              ? <Badge variant="success">✓ Publié</Badge>
              : <Badge variant="warning">Brouillon</Badge>}
            <Badge>{property.status}</Badge>
            {/* Preview "Vue client" (CEO 2026-06-11) : ouvre la fiche bien
                exactement comme le client la verra dans une proposition. */}
            <Link
              href={`/properties-preview/${property.id}`}
              target="_blank"
              rel="noopener"
              title="Ouvre la fiche bien telle qu'un client la verrait (nouvelle fenêtre)"
            >
              <Button variant="secondary" className="inline-flex items-center gap-1.5">
                👁 Voir comme un client
              </Button>
            </Link>
            <Link href={`/properties/${property.id}/edit`}><Button variant="secondary">Modifier</Button></Link>
            {canDelete && (
              <PropertyDeleteButton propertyId={property.id} propertyName={property.name} />
            )}
          </div>
        }
      />

      <PropertyPublicationBanner
        propertyId={params.id}
        isPublished={pubRes.data?.is_published ?? false}
        missingForPublication={pubRes.data?.missing_for_publication ?? []}
        publishedAt={pubRes.data?.published_at ?? null}
      />

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Caractéristiques</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Superficie habitable" value={property.superficie ? `${property.superficie} m²` : '—'} />
              <Row label="Terrasse" value={property.terrasse_m2 ? `${property.terrasse_m2} m²` : '—'} />
              <Row label="Étage" value={property.floor} />
              <Row label="Suites" value={property.nb_suites} />
              <Row label="Lots dans l'immeuble" value={property.nb_lots_residence} />
              <Row label="Ascenseur" value={property.has_elevator ? 'Oui' : 'Non'} />
              <Row label="Parking" value={property.has_parking ? 'Oui' : 'Non'} />
              <Row label="Évaluation" value={property.evaluation ? '⭐'.repeat(property.evaluation) : '—'} />
              <Row label="Google Maps" value={property.google_maps_url
                ? <a href={property.google_maps_url} target="_blank" rel="noreferrer" className="underline">Voir sur la carte</a>
                : '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Financier</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Prix vendeur initial" value={property.initial_asking_price ? <Money amount={property.initial_asking_price} /> : <span className="text-stoniz-gray-400">— (non renseigné)</span>} />
              <Row label="Prix retenu" value={<Money amount={property.price} />} />
              <Row
                label="Négociation"
                value={
                  property.negotiation_amount && property.negotiation_amount > 0
                    ? <span className="text-green-700"><Money amount={property.negotiation_amount} />{property.negotiation_pct ? ` (-${property.negotiation_pct}%)` : ''}</span>
                    : <span className="text-stoniz-gray-400">—</span>
                }
              />
              <Row label="Loyer estimé" value={property.estimated_rent ? <span><Money amount={property.estimated_rent} /> /mois</span> : '—'} />
              <Row label="Rendement brut" value={property.gross_yield ? `${property.gross_yield}%` : '—'} />
              <Row label="Frais agence" value={property.agency_fees ? <Money amount={property.agency_fees} /> : `~ ${Math.round((property.price ?? 0) * 0.03).toLocaleString('fr-FR')} € (auto 3% TTC)`} />
              <Row label="Frais notaire" value={property.notary_fees ? <Money amount={property.notary_fees} /> : `~ ${Math.round((property.price ?? 0) * 0.07).toLocaleString('fr-FR')} € (auto 7%)`} />
              <Row label="Budget travaux" value={property.travaux_budget_estimate ? <Money amount={property.travaux_budget_estimate} /> : '—'} />
              <Row
                label="Prix d'achat + travaux"
                value={
                  property.price && property.travaux_budget_estimate
                    ? <span className="font-semibold"><Money amount={Number(property.price) + Number(property.travaux_budget_estimate)} /></span>
                    : '—'
                }
              />
              <Row
                label="Prix m² fini"
                value={
                  property.price && property.travaux_budget_estimate && property.superficie && property.superficie > 0
                    ? <span className="font-semibold"><Money amount={Math.round((Number(property.price) + Number(property.travaux_budget_estimate)) / Number(property.superficie))} /> / m²</span>
                    : '—'
                }
              />
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Partenariat</CardTitle></CardHeader>
        <CardContent>
          <dl className="space-y-2 text-sm">
            <Row label="Agence" value={partner?.agency_name ?? '—'} />
            <Row label="% commission" value={`${property.sourcing_commission_rate} %`} />
            <Row label="Commission estimée" value={property.sourcing_commission_amount ? <Money amount={property.sourcing_commission_amount} /> : '—'} />
            <Row label="Date sourcing" value={property.sourcing_date} />
            <Row label="Délai sourcing → offre" value={property.days_sourcing_to_offer ? `${property.days_sourcing_to_offer} j` : '—'} />
          </dl>
        </CardContent>
      </Card>

      {/* Historique commercial (visites/offres/compromis par les clients) */}
      <CommercialHistoryPanel
        visits={(visitsRes.data ?? []).map((v: any) => ({
          id: v.id,
          visited_at: v.visited_at,
          notes: v.notes,
          project_id: v.project_id,
          client_name: v.project?.client?.full_name ?? '— Client',
        }))}
        offers={(offersRes.data ?? []).map((o: any) => ({
          id: o.id,
          offer_date: o.offer_date,
          offer_amount: o.offer_amount,
          status: o.status,
          counter_amount: o.counter_amount,
          notes: o.notes,
          project_id: o.project_id,
          client_name: o.project?.client?.full_name ?? '— Client',
        }))}
        compromis={(projectsWithCompromisRes.data ?? []).map((p: any) => ({
          project_id: p.id,
          client_name: p.client?.full_name ?? '— Client',
          compromis_date: p.compromis_date,
        }))}
      />

      <PropertyMediaGallery propertyId={params.id} media={media} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value ?? '—'}</dd>
    </div>
  );
}
