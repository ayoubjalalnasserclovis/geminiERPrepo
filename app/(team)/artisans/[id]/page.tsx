import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArtisanForm } from '@/components/artisans/artisan-form';
import { ArtisanDocuments } from '@/components/artisans/artisan-documents';
import { ArtisanIncompleteBanner } from '@/components/artisans/artisan-incomplete-banner';
import { BackLink } from '@/components/ui/back-link';
import {
  ARTISAN_TYPE_LABELS, ARTISAN_LEGAL_FORMS,
  ARTISAN_SPECIALITIES, ARTISAN_STATUSES,
} from '@/lib/finance/artisans-constants';
import { checkArtisanCompleteness, formatBusinessScope } from '@/lib/artisans/specialities';
import { formatMad } from '@/lib/utils/format';
import { requireRole } from '@/lib/auth/require';
import { ArtisanDeleteButton } from './delete-button';

export default async function ArtisanDetailPage({
  params, searchParams,
}: {
  params: { id: string };
  searchParams: { edit?: string };
}) {
  const user = await requireRole(['ceo','chef_projet','developer','finance','assistante','achats']);
  const canDelete = user.role === 'ceo' || user.role === 'chef_projet';
  const supabase = createClient();
  const { data: artisan } = await supabase
    .from('artisans').select('*').eq('id', params.id).single();
  if (!artisan) notFound();

  // Historique : lots travaillés + lots achats fournis par cet artisan
  const [travauxLotsRes, achatsLotsRes, docsRes] = await Promise.all([
    supabase.from('travaux_lots')
      .select('id, numero, description, status, devis_artisan_mad, facture_client_mad, project:projects(id, reference, client:clients(full_name))')
      .eq('artisan_id', params.id).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('achats_lots')
      .select('id, numero, description, status, devis_fournisseur_mad, facture_client_mad, project:projects(id, reference, client:clients(full_name))')
      .eq('supplier_id', params.id).is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('documents')
      .select('id, name, type, document_number, document_date, created_at')
      .eq('artisan_id', params.id).is('deleted_at', null).order('created_at', { ascending: false }),
  ]);

  const travauxLots = travauxLotsRes.data ?? [];
  const achatsLots = achatsLotsRes.data ?? [];
  const artisanDocs = docsRes.data ?? [];

  // Calcul du statut de complétude pour le bandeau d'alerte
  const completeness = checkArtisanCompleteness({
    legal_form: artisan.legal_form,
    bank_name: artisan.bank_name,
    rib: artisan.rib,
    has_attestation_rib: artisanDocs.some(d => d.type === 'attestation_rib'),
    has_attestation_regularite_fiscale: artisanDocs.some(d => d.type === 'attestation_regularite_fiscale'),
  });

  const totalDevisTravaux = travauxLots.reduce((s, l: any) => s + Number(l.devis_artisan_mad ?? 0), 0);
  const totalDevisAchats = achatsLots.reduce((s, l: any) => s + Number(l.devis_fournisseur_mad ?? 0), 0);
  const totalDevis = totalDevisTravaux + totalDevisAchats;
  const totalFactureTravaux = travauxLots.reduce((s, l: any) => s + Number(l.facture_client_mad ?? 0), 0);
  const totalFactureAchats = achatsLots.reduce((s, l: any) => s + Number(l.facture_client_mad ?? 0), 0);
  const totalFacture = totalFactureTravaux + totalFactureAchats;

  if (searchParams.edit === '1') {
    return (
      <div className="max-w-3xl">
        <PageHeader
          title={`Modifier ${artisan.name}`}
          action={<Link href={`/artisans/${params.id}`}><Button variant="secondary">Annuler</Button></Link>}
        />
        <ArtisanForm artisan={artisan} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <BackLink href="/artisans" label="Retour aux artisans" />
      <PageHeader
        title={artisan.name}
        description={`${ARTISAN_TYPE_LABELS[artisan.type] ?? artisan.type} · ${formatBusinessScope(artisan.business_scope)} · ${artisan.speciality ? ARTISAN_SPECIALITIES[artisan.speciality] : 'Spécialité non renseignée'}`}
        action={
          <div className="flex gap-2 items-center">
            {completeness.is_complete_for_payment ? (
              <Badge variant="success">✓ Prêt pour paiement</Badge>
            ) : (
              <Badge variant="error">Incomplet pour paiement</Badge>
            )}
            <Badge variant={
              artisan.status === 'actif' ? 'success' :
              artisan.status === 'blacklist' ? 'error' :
              artisan.status === 'prospect' ? 'warning' : 'default'
            }>{ARTISAN_STATUSES[artisan.status]}</Badge>
            <Link href={`/artisans/${artisan.id}?edit=1`}>
              <Button variant="secondary">Modifier</Button>
            </Link>
            {canDelete && (
              <ArtisanDeleteButton artisanId={artisan.id} artisanName={artisan.name} />
            )}
          </div>
        }
      />

      <ArtisanIncompleteBanner completeness={completeness} />

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Identification</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Forme juridique" value={artisan.legal_form ? ARTISAN_LEGAL_FORMS[artisan.legal_form] : '—'} />
              <Row label="Spécialité" value={artisan.speciality ? ARTISAN_SPECIALITIES[artisan.speciality] : '—'} />
              <Row label="Évaluation" value={artisan.evaluation ? '⭐'.repeat(artisan.evaluation) : '—'} />
              <Row label="ICE" value={artisan.ice ?? '—'} />
              <Row label="RC" value={artisan.rc ?? '—'} />
              <Row label="IF" value={artisan.if_number ?? '—'} />
              <Row label="Patente" value={artisan.patente ?? '—'} />
              <Row label="CNSS" value={artisan.cnss ?? '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Contact</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Contact principal" value={artisan.contact_name ?? '—'} />
              <Row label="Téléphone" value={artisan.phone ?? '—'} />
              <Row label="WhatsApp" value={artisan.whatsapp ?? '—'} />
              <Row label="Email" value={artisan.email ?? '—'} />
              <Row label="Adresse" value={artisan.address ?? '—'} />
              <Row label="Ville" value={`${artisan.city ?? ''} ${artisan.postal_code ?? ''}`.trim() || '—'} />
              <Row label="Pays" value={artisan.country ?? '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Bancaire</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Banque" value={artisan.bank_name ?? '—'} />
              <Row label="RIB" value={artisan.rib ?? '—'} />
              <Row label="Titulaire" value={artisan.bank_account_holder ?? '—'} />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Activité</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-2 text-sm">
              <Row label="Lots travaux" value={travauxLots.length} />
              <Row label="Lots achats" value={achatsLots.length} />
              <Row label="Total devis cumulés" value={formatMad(totalDevis)} />
              <Row label="Total facturé client" value={formatMad(totalFacture)} />
              <Row label="Marge cumulée" value={formatMad(totalFacture - totalDevis)} />
            </dl>
          </CardContent>
        </Card>
      </div>

      {artisan.notes && (
        <Card>
          <CardHeader><CardTitle>Notes internes</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{artisan.notes}</p>
          </CardContent>
        </Card>
      )}

      <ArtisanDocuments artisanId={params.id} documents={artisanDocs} />

      <Card>
        <CardHeader><CardTitle>Historique lots travaux ({travauxLots.length})</CardTitle></CardHeader>
        <CardContent>
          {travauxLots.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun lot travaux rattaché.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Projet</th>
                    <th className="text-left py-2 px-2">Client</th>
                    <th className="text-left py-2 px-2">Lot</th>
                    <th className="text-right py-2 px-2">Devis</th>
                    <th className="text-right py-2 px-2">Facturé</th>
                    <th className="text-left py-2 px-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {travauxLots.map((l: any) => (
                    <tr key={l.id} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2">
                        <Link href={`/projects/${l.project?.id}/travaux`} className="underline">
                          {l.project?.reference}
                        </Link>
                      </td>
                      <td className="py-2 px-2">{l.project?.client?.full_name ?? '—'}</td>
                      <td className="py-2 px-2">#{l.numero} {l.description}</td>
                      <td className="text-right py-2 px-2">{formatMad(l.devis_artisan_mad)}</td>
                      <td className="text-right py-2 px-2">{formatMad(l.facture_client_mad)}</td>
                      <td className="py-2 px-2"><Badge>{l.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Historique lots achats ({achatsLots.length})</CardTitle></CardHeader>
        <CardContent>
          {achatsLots.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun lot achat rattaché.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Projet</th>
                    <th className="text-left py-2 px-2">Client</th>
                    <th className="text-left py-2 px-2">Lot</th>
                    <th className="text-right py-2 px-2">Devis</th>
                    <th className="text-right py-2 px-2">Facturé</th>
                    <th className="text-left py-2 px-2">Statut</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {achatsLots.map((l: any) => (
                    <tr key={l.id} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2">
                        <Link href={`/projects/${l.project?.id}/achats`} className="underline">
                          {l.project?.reference}
                        </Link>
                      </td>
                      <td className="py-2 px-2">{l.project?.client?.full_name ?? '—'}</td>
                      <td className="py-2 px-2">#{l.numero} {l.description}</td>
                      <td className="text-right py-2 px-2">{formatMad(l.devis_fournisseur_mad)}</td>
                      <td className="text-right py-2 px-2">{formatMad(l.facture_client_mad)}</td>
                      <td className="py-2 px-2"><Badge>{l.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
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
