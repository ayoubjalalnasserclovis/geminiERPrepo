import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireRole, PROJECT_CSV_IMPORT_ROLES } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { TravauxImportClient } from './import-client';

export default async function TravauxImportPage({ params }: { params: { id: string } }) {
  // Import CSV : CEO + chef_projet + achats (CEO 2026-09-02)
  await requireRole(PROJECT_CSV_IMPORT_ROLES);
  const supabase = createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, reference, client:clients(full_name), property:properties(name)')
    .eq('id', params.id)
    .maybeSingle();
  if (!project) notFound();

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${params.id}/travaux`}
        className="text-sm text-stoniz-gray-600 hover:underline inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-3 h-3" /> Retour suivi travaux
      </Link>

      <PageHeader
        title="Importer le suivi travaux depuis un CSV"
        description={`${(project.client as any)?.full_name ?? '—'} · ${(project.property as any)?.name ?? ''} · ${project.reference ?? ''}`}
      />

      <Card>
        <div className="space-y-3 text-sm">
          <p className="font-semibold">Comment ça marche</p>
          <ol className="list-decimal pl-5 space-y-1 text-stoniz-gray-700">
            <li>Exporte ton Google Sheet en CSV : <code className="bg-stoniz-gray-100 px-1 rounded">Fichier → Télécharger → .csv</code></li>
            <li>L'onglet principal "Suivi travaux" → champ "Feuille principale" ci-dessous</li>
            <li>L'onglet "💰 Cashflow" → champ "Feuille cashflow" (optionnel)</li>
            <li>Clique sur <strong>Prévisualiser</strong> : tu vois exactement ce qui sera créé</li>
            <li>Si tout est bon, clique sur <strong>Confirmer l'import</strong></li>
          </ol>
          <p className="text-stoniz-gray-500 text-xs pt-2">
            L'import est tracé dans <code className="bg-stoniz-gray-100 px-1 rounded">data_fix_log</code> et bloque tout ré-import sur le même projet (idempotence). Pour ré-importer, contacte un dev pour rollback.
          </p>
        </div>
      </Card>

      <TravauxImportClient projectId={params.id} />
    </div>
  );
}
