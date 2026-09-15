import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { PropertyForm } from '@/components/properties/property-form';
import { requireRole } from '@/lib/auth/require';

export default async function EditPropertyPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const [propertyRes, partnersRes] = await Promise.all([
    supabase.from('properties').select('*').eq('id', params.id).single(),
    supabase.from('partners').select('id, agency_name').is('deleted_at', null).order('agency_name'),
  ]);
  if (!propertyRes.data) notFound();

  return (
    <div className="max-w-3xl">
      <PageHeader title="Modifier le bien" description={propertyRes.data.name} />
      <PropertyForm property={propertyRes.data} partners={partnersRes.data ?? []} />
    </div>
  );
}
