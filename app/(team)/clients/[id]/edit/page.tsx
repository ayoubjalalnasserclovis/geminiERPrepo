import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { ClientForm } from '@/components/clients/client-form';
import { requireRole } from '@/lib/auth/require';

export default async function EditClientPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','commercial']);
  const supabase = createClient();
  const { data: client } = await supabase
    .from('clients').select('*').eq('id', params.id).is('deleted_at', null).single();
  if (!client) notFound();

  return (
    <div className="max-w-2xl">
      <PageHeader title="Modifier le client" description={client.full_name} />
      <ClientForm client={client} />
    </div>
  );
}
