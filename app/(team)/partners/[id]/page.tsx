import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { BackLink } from '@/components/ui/back-link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/ui/money';
import { requireRole } from '@/lib/auth/require';
import { PartnerDeleteButton } from './delete-button';

export default async function PartnerDetailPage({ params }: { params: { id: string } }) {
  const user = await requireRole(['ceo','chef_projet','developer','sourcing','commercial','assistante']);
  const canDelete = user.role === 'ceo' || user.role === 'chef_projet';
  const supabase = createClient();
  const { data: partner } = await supabase.from('partners')
    .select('*').eq('id', params.id).is('deleted_at', null).single();
  if (!partner) notFound();

  const { data: properties } = await supabase
    .from('properties')
    .select('id, name, status, price, evaluation, quartier')
    .eq('partner_id', params.id)
    .is('deleted_at', null);

  const total = properties?.length ?? 0;
  const sold = properties?.filter(p => p.status === 'vendu').length ?? 0;
  const taux = total > 0 ? Math.round((sold / total) * 100) : 0;

  return (
    <div className="space-y-6">
      <BackLink href="/partners" label="Retour aux partenaires" />
      <PageHeader
        title={partner.agency_name}
        description={partner.contact_name ? `Contact : ${partner.contact_name}` : undefined}
        action={
          <div className="flex gap-2 items-center">
            <Link href={`/partners/${partner.id}/edit`}><Button variant="secondary">Modifier</Button></Link>
            {canDelete && (
              <PartnerDeleteButton partnerId={partner.id} partnerName={partner.agency_name} />
            )}
          </div>
        }
      />

      <div className="grid md:grid-cols-4 gap-4">
        <KPI label="Biens sourcés" value={total} />
        <KPI label="Biens vendus" value={sold} />
        <KPI label="Taux conversion" value={`${taux}%`} />
        <KPI label="Évaluation" value={partner.evaluation ? '⭐'.repeat(partner.evaluation) : '—'} />
      </div>

      <Card>
        <CardHeader><CardTitle>Identité</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <Row label="Téléphone" value={partner.phone} />
            <Row label="Email" value={partner.email} />
            <Row label="Adresse" value={partner.address} />
            <Row label="Statut" value={<Badge>{partner.status}</Badge>} />
            <Row label="Quartiers couverts" value={partner.quartiers_covered?.join(', ')} />
            <Row label="Contrat signé" value={partner.contract_signed ? 'Oui' : 'Non'} />
            <Row label="Dernier contact" value={partner.last_contact_at} />
            <Row label="WhatsApp" value={partner.has_whatsapp_group ? 'Oui' : 'Non'} />
          </dl>
          {partner.notes && (
            <div className="mt-4 pt-4 border-t">
              <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Notes</div>
              <div className="text-sm whitespace-pre-wrap">{partner.notes}</div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Biens sourcés ({total})</CardTitle></CardHeader>
        <CardContent>
          {total === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun bien sourcé par ce partenaire</p>
          ) : (
            <ul className="divide-y">
              {properties!.map(p => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <Link href={`/properties/${p.id}`} className="font-medium hover:underline">{p.name}</Link>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="text-stoniz-gray-500">{p.quartier}</span>
                    <Money amount={p.price} />
                    <Badge>{p.status}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <div className="text-xs uppercase text-stoniz-gray-500">{label}</div>
        <div className="font-display text-3xl">{value}</div>
      </CardHeader>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-stoniz-gray-500">{label}</dt>
      <dd className="font-medium text-right">{value || '—'}</dd>
    </div>
  );
}
