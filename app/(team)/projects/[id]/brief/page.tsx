import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { BriefForm } from '@/components/brief/brief-form';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';
import { requireRole } from '@/lib/auth/require';

export default async function ProjectBriefPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','assistante']);
  const supabase = createClient();

  const [projectRes, briefRes, clientRes] = await Promise.all([
    supabase.from('projects')
      .select('id, reference, current_phase, client_id, client:clients(full_name, location_preferences, property_type_preferences, budget_min, budget_max, available_savings, credit_type, expected_rent, expected_gross_yield_pct, expected_net_yield_pct)')
      .eq('id', params.id).single(),
    supabase.from('project_briefs').select('*').eq('project_id', params.id).maybeSingle(),
    null,
  ]);

  const project = projectRes.data;
  if (!project) notFound();

  const brief = briefRes.data;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour au projet {project.reference}
      </Link>

      <PageHeader
        title="Cahier des charges"
        description={`Définition des critères de sélection du bien — ${(project as any).client?.full_name ?? ''}`}
        action={
          <div className="flex items-center gap-2">
            <BriefStatusBadge status={brief?.status} />
            {brief && (
              <Link href={`/projects/${params.id}/brief/print`} target="_blank">
                <Button size="sm" variant="secondary">📄 Exporter PDF</Button>
              </Link>
            )}
          </div>
        }
      />

      {brief?.status === 'sent_to_client' && (
        <Card className="bg-accent-light border-accent">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-display text-lg">⏳ En attente de validation client</h3>
              <p className="text-sm text-stoniz-gray-600 mt-1">
                Envoyé le {formatDate(brief.sent_at)}. Le client doit valider depuis son portail avant de passer en Sourcing.
              </p>
            </div>
          </div>
        </Card>
      )}

      {brief?.status === 'validated' && (
        <Card className="bg-green-50 border-green-200">
          <div>
            <h3 className="font-display text-lg">✅ Cahier des charges validé</h3>
            <p className="text-sm text-stoniz-gray-600 mt-1">
              Validé par le client le {formatDate(brief.validated_at)}. Vous pouvez passer en phase Sourcing.
            </p>
          </div>
        </Card>
      )}

      {brief?.status === 'rejected_by_client' && (
        <Card className="bg-red-50 border-red-200">
          <h3 className="font-display text-lg">❌ Refusé par le client</h3>
          <p className="text-sm text-stoniz-gray-700 mt-1">
            Le {formatDate(brief.rejected_at)} :
          </p>
          <p className="text-sm text-stoniz-gray-800 mt-2 italic bg-white p-3 rounded border">
            « {brief.rejection_reason} »
          </p>
          <p className="text-xs text-stoniz-gray-600 mt-3">
            Modifiez le cahier des charges ci-dessous et renvoyez-le.
          </p>
        </Card>
      )}

      <BriefForm
        projectId={project.id}
        brief={brief}
        clientPreFill={(project as any).client}
      />
    </div>
  );
}

function BriefStatusBadge({ status }: { status?: string }) {
  if (!status) return <Badge>Pas commencé</Badge>;
  const map: Record<string, { label: string; variant: any }> = {
    draft:              { label: 'Brouillon',         variant: 'default' },
    sent_to_client:     { label: 'Envoyé au client',  variant: 'warning' },
    validated:          { label: 'Validé',            variant: 'success' },
    rejected_by_client: { label: 'Refusé',            variant: 'error' },
  };
  const s = map[status] ?? map.draft;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
