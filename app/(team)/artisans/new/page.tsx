import { PageHeader } from '@/components/ui/page-header';
import { ArtisanForm } from '@/components/artisans/artisan-form';
import { requireRole } from '@/lib/auth/require';

export default async function NewArtisanPage() {
  await requireRole(['ceo','chef_projet','finance','assistante']);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Nouvel artisan" />
      <ArtisanForm />
    </div>
  );
}
