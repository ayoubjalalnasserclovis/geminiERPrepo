import { ClientForm } from '@/components/clients/client-form';
import { PageHeader } from '@/components/ui/page-header';
import { requireRole } from '@/lib/auth/require';

export default async function NewClientPage() {
  await requireRole(['ceo','chef_projet','commercial']);
  return (
    <div className="max-w-2xl">
      <PageHeader title="Nouveau client" description="Créer une fiche investisseur" />
      <ClientForm />
    </div>
  );
}
