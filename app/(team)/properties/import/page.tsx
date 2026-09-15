import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { PropertyCSVImport } from '@/components/properties/property-csv-import';

export default async function ImportPropertiesPage() {
  await requireRole(['ceo', 'chef_projet', 'developer', 'sourcing']);

  return (
    <div className="max-w-3xl space-y-6">
      <Link href="/properties" className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour aux biens
      </Link>

      <PageHeader
        title="Importer des biens (CSV)"
        description="Crée plusieurs biens d'un coup en brouillon. Ensuite tu complètes sourcing + médias avant publication."
      />

      <PropertyCSVImport />
    </div>
  );
}
