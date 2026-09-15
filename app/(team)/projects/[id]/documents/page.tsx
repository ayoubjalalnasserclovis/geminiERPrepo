import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { DocumentUpload } from '@/components/documents/document-upload';
import { DocumentDownloadLink } from '@/components/documents/document-download-link';
import { DeleteProjectDocButton } from '@/components/documents/delete-project-doc-button';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';
import { formatDate } from '@/lib/utils/format';
import { requireRole, getSessionUser } from '@/lib/auth/require';

export default async function DocumentsPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','finance','marketing','assistante','achats']);
  const me = await getSessionUser();
  // Suppression réservée à 4 rôles canon (CEO 2026-06-30, symétrique vendor_documents)
  const canDelete = !!me && ['ceo','chef_projet','achats','assistante'].includes(me.role);
  const supabase = createClient();
  const { data: project } = await supabase.from('projects')
    .select('id, reference').eq('id', params.id).single();
  if (!project) notFound();

  const { data: documents } = await supabase.from('documents')
    .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name)')
    .eq('project_id', params.id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6">
      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour au projet {project.reference}
      </Link>
      <PageHeader title="Documents" description={project.reference} action={<DocumentUpload projectId={project.id} />} />

      <Card>
        {!documents || documents.length === 0 ? (
          <p className="text-stoniz-gray-500 text-sm">Aucun document</p>
        ) : (
          <Table>
            <THead>
              <TR><TH>Nom</TH><TH>Type</TH><TH>Source</TH><TH>Visible</TH><TH>Validation client</TH><TH>Date</TH><TH></TH></TR>
            </THead>
            <TBody>
              {documents.map((d: any) => (
                <TR key={d.id}>
                  <TD className="font-medium">
                    {/* CEO 2026-08-19 (session C) : libellé personnalisé prioritaire + tags */}
                    <div>{d.label ?? d.name}</div>
                    {d.label && <div className="text-xs text-stoniz-gray-400 font-normal">{d.name}</div>}
                    {Array.isArray(d.tags) && d.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {d.tags.map((t: string) => (
                          <span key={t} className="text-[10px] bg-stoniz-gray-100 border border-stoniz-gray-200 rounded-full px-1.5 py-0.5 text-stoniz-gray-600">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </TD>
                  <TD>{d.type}</TD>
                  <TD>
                    <Badge variant={d.uploaded_by_role === 'client' ? 'info' : 'default'}>
                      {d.uploaded_by_role === 'client' ? 'Client' : 'Stoniz'}
                    </Badge>
                  </TD>
                  <TD>{d.is_visible_to_client ? '👁 Oui' : 'Non'}</TD>
                  <TD>
                    {d.requires_client_validation
                      ? <Badge variant={
                          d.client_validation_status === 'validated' ? 'success' :
                          d.client_validation_status === 'refused' ? 'error' :
                          d.client_validation_status === 'more_info' ? 'warning' : 'warning'
                        }>
                          {d.client_validation_status === 'validated' ? '✓ Validé' :
                           d.client_validation_status === 'refused' ? 'Refusé' :
                           d.client_validation_status === 'more_info' ? 'Infos demandées' :
                           'En attente'}
                        </Badge>
                      : <span className="text-xs text-stoniz-gray-400">—</span>}
                  </TD>
                  <TD className="text-xs text-stoniz-gray-500">{formatDate(d.created_at)}</TD>
                  <TD>
                    <div className="flex items-center gap-3 flex-wrap">
                      <DocumentDownloadLink documentId={d.id} />
                      <FinanceAuditButton table="documents" recordId={d.id} size="sm" />
                      {canDelete && (
                        <DeleteProjectDocButton
                          docId={d.id}
                          label={d.type}
                          size="sm"
                        />
                      )}
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
