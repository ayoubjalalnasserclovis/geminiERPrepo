import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/utils/format';
import { PaymentEditDialog } from '@/components/finance/payment-edit-dialog';
import { PaymentCreateButton } from '@/components/finance/payment-create-button';
import { TravauxPaymentDialog } from '@/components/finance/travaux-payment-dialog';
import { FinanceSectionAuditTimeline } from '@/components/finance/finance-section-audit-timeline';
import { STONIZ_FEE_SCHEDULE, resolveStonizLabel } from '@/lib/finance/stoniz-fees';
import { getProjectPaymentSummary } from '@/lib/finance/project-payment-summary';
import { getSessionUser, requireRole } from '@/lib/auth/require';

export default async function PaymentsPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','finance','assistante','achats']);
  const me = await getSessionUser();
  const supabase = createClient();
  const { data: project } = await supabase.from('projects')
    .select('id, reference').eq('id', params.id).single();
  if (!project) notFound();

  const [stonizRes, travauxRes, summary] = await Promise.all([
    supabase.from('payments').select('*')
      .eq('project_id', params.id).is('deleted_at', null).order('due_date'),
    supabase.from('travaux_payments').select('*')
      .eq('project_id', params.id).is('deleted_at', null).order('scheduled_date'),
    // Source unique de vérité — agrège par SUM par type (gère doublons sans les cacher).
    // Voir lib/finance/project-payment-summary.ts + cas Boutira.
    getProjectPaymentSummary(params.id),
  ]);

  // Map type → toutes les lignes brutes (pour PaymentEditDialog qui a besoin de l'objet brut).
  // Si un type a plusieurs lignes (doublon BDD), on garde toutes les lignes — l'UI rend
  // une seule rangée par type avec les SUMs, mais on prend la 1re ligne pour le dialog.
  const rawByType = new Map<string, any[]>();
  (stonizRes.data ?? []).forEach(p => {
    const list = rawByType.get(p.type) ?? [];
    list.push(p);
    rawByType.set(p.type, list);
  });

  const totalEncaisse = summary.totalPaid;
  const totalExpected = summary.totalExpected;
  const byType = new Map(summary.byType.map(b => [b.type, b]));

  return (
    <div className="space-y-6">
      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour au projet {project.reference}
      </Link>
      <PageHeader title="Paiements" description={project.reference} />

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg">Honoraires Stoniz (EUR)</h3>
            <p className="text-xs text-stoniz-gray-500">
              Total attendu {totalExpected.toLocaleString('fr-FR')} € en 5 jalons. Encaissé : {totalEncaisse.toLocaleString('fr-FR')} €
            </p>
          </div>
        </div>
        <Table>
          <THead>
            <TR>
              <TH>#</TH><TH>Jalon</TH><TH>Attendu</TH><TH>Payé</TH><TH>Échéance</TH><TH>Statut</TH><TH></TH>
            </TR>
          </THead>
          <TBody>
            {STONIZ_FEE_SCHEDULE.map((milestone, i) => {
              const row = byType.get(milestone.type);
              const rawList = rawByType.get(milestone.type) ?? [];
              const exists = rawList.length > 0;
              const firstRaw = rawList[0]; // pour PaymentEditDialog
              const showDuplicateBadge = (row?.hasDuplicates ?? false);
              return (
                <TR key={milestone.type}>
                  <TD className="font-mono text-sm">{i + 1}</TD>
                  <TD className="font-medium">
                    {resolveStonizLabel(milestone.type, firstRaw?.label)}
                    {showDuplicateBadge && (
                      <Badge variant="warning" className="ml-2">⚠ {rawList.length} lignes BDD</Badge>
                    )}
                  </TD>
                  <TD><Money amount={row?.expected ?? milestone.amount} /></TD>
                  <TD>{exists ? <Money amount={row?.paid ?? 0} /> : <span className="text-stoniz-gray-400">—</span>}</TD>
                  <TD>{row?.dueDate ? formatDate(row.dueDate) : <span className="text-stoniz-gray-400">—</span>}</TD>
                  <TD>
                    {exists && row ? (
                      <Badge variant={
                        row.status === 'paid' ? 'success' :
                        row.status === 'overdue' ? 'error' :
                        row.status === 'partial' ? 'warning' : 'default'
                      }>{row.status}</Badge>
                    ) : (
                      <Badge>À venir</Badge>
                    )}
                  </TD>
                  <TD>
                    {exists && firstRaw ? (
                      <PaymentEditDialog payment={firstRaw} userRole={me?.role ?? ''} />
                    ) : (
                      <PaymentCreateButton
                        projectId={params.id}
                        type={milestone.type}
                        label={milestone.label}
                        amountExpected={milestone.amount}
                        duePhase={milestone.due_at_phase}
                      />
                    )}
                  </TD>
                </TR>
              );
            })}
            <TR>
              <TD colSpan={2} className="font-medium uppercase text-xs bg-stoniz-gray-50">Total</TD>
              <TD className="font-medium bg-stoniz-gray-50"><Money amount={totalExpected} /></TD>
              <TD className="font-medium bg-stoniz-gray-50"><Money amount={totalEncaisse} /></TD>
              <TD colSpan={3} className="bg-stoniz-gray-50"></TD>
            </TR>
          </TBody>
        </Table>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="font-display text-lg">Paiements travaux (MAD)</h3>
            <p className="text-xs text-stoniz-gray-500">
              Taux fixe 1 EUR = 10 MAD. Pour le détail des lots et acomptes, voir{' '}
              <a href={`/projects/${params.id}/travaux`} className="underline">Suivi travaux</a>.
            </p>
          </div>
          <TravauxPaymentDialog projectId={params.id} />
        </div>
        <Table>
          <THead>
            <TR><TH>Artisan</TH><TH>Catégorie</TH><TH>Type</TH><TH>Total MAD</TH><TH>Équiv. EUR</TH><TH>Statut</TH><TH>Prévu</TH></TR>
          </THead>
          <TBody>
            {(travauxRes.data ?? []).map((p: any) => (
              <TR key={p.id}>
                <TD>{p.artisan_name}</TD>
                <TD className="text-xs">{p.category ?? '—'}</TD>
                <TD>{p.payment_type}</TD>
                <TD><Money amount={p.amount_total} currency="MAD" /></TD>
                <TD><Money amount={p.amount_total_eur} /></TD>
                <TD><Badge variant={p.status === 'paid' ? 'success' : 'default'}>{p.status}</Badge></TD>
                <TD>{formatDate(p.scheduled_date)}</TD>
              </TR>
            ))}
            {(travauxRes.data ?? []).length === 0 && (
              <TR><TD colSpan={7} className="text-stoniz-gray-500 text-center">Aucun paiement artisan</TD></TR>
            )}
          </TBody>
        </Table>
      </Card>

      <FinanceSectionAuditTimeline
        tables={['payments', 'travaux_payments']}
        recordIds={[
          ...((stonizRes.data ?? []) as any[]).map((p: any) => p.id),
          ...((travauxRes.data ?? []) as any[]).map((p: any) => p.id),
        ]}
        title="Historique des actions paiements"
      />
    </div>
  );
}
