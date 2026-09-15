import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { PartnerForm } from '@/components/partners/partner-form';
import { requireRole } from '@/lib/auth/require';

export default async function EditPartnerPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','sourcing']);
  const supabase = createClient();
  const { data: partner } = await supabase.from('partners').select('*').eq('id', params.id).single();
  if (!partner) notFound();
  return (
    <div className="max-w-2xl">
      <PageHeader title="Modifier" description={partner.agency_name} />
      <PartnerForm partner={partner} />
    </div>
  );
}
