import { PageHeader } from '@/components/ui/page-header';
import { PartnerForm } from '@/components/partners/partner-form';
import { requireRole } from '@/lib/auth/require';

export default async function NewPartnerPage() {
  await requireRole(['ceo','chef_projet','sourcing']);
  return (
    <div className="max-w-2xl">
      <PageHeader title="Nouveau partenaire" />
      <PartnerForm />
    </div>
  );
}
