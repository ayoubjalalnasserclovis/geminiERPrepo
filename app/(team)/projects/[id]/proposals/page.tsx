import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { formatDate } from '@/lib/utils/format';
import { SendProposalDialog } from '@/components/proposals/send-proposal-dialog';
import { SelectFinalPropertyButton } from '@/components/proposals/select-final-property-button';
import { calculateKPIs } from '@/lib/finance/property-calc';
import { requireRole } from '@/lib/auth/require';

export default async function ProjectProposalsPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','assistante']);
  const supabase = createClient();
  const { data: project } = await supabase.from('projects')
    .select('id, reference, property_id, client:clients(full_name)').eq('id', params.id).single();
  if (!project) notFound();

  const { data: proposals } = await supabase.from('property_proposals')
    .select('*, property:properties(id, name, quartier, status)')
    .eq('project_id', params.id)
    .order('sent_at', { ascending: false });

  const finalPropertyId = (project as any).property_id as string | null;
  const hasFinal = !!finalPropertyId;

  // Source de vérité d'un bien "déjà pris" = le lien projet (property_id) d'un
  // projet vivant (actif ou terminé). On exclut ces biens EN PLUS du filtre de
  // statut, car des données héritées (imports Notion) peuvent être rattachées à
  // un projet tout en restant marquées "disponible/proposé".
  const { data: takenRows } = await supabase
    .from('projects')
    .select('property_id')
    .not('property_id', 'is', null)
    .is('deleted_at', null)
    .in('status', ['actif', 'termine']);
  const takenIds = Array.from(
    new Set((takenRows ?? []).map((r: any) => r.property_id).filter(Boolean))
  );

  let availableQuery = supabase.from('properties_enriched')
    .select(`
      id, name, quartier, price, status, evaluation, badge_label,
      agency_fees, notary_fees, travaux_budget_estimate,
      estimated_rent, superficie, gross_yield
    `)
    .in('status', ['disponible','propose']);
  if (takenIds.length > 0) {
    availableQuery = availableQuery.not('id', 'in', `(${takenIds.join(',')})`);
  }
  const { data: availableProperties } = await availableQuery
    .order('created_at', { ascending: false })
    .limit(50);

  return (
    <div className="space-y-6">
      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour au projet {project.reference}
      </Link>
      <PageHeader
        title="Propositions"
        description={`${project.reference} · ${(project as any).client?.full_name}`}
        action={<SendProposalDialog projectId={project.id} properties={availableProperties ?? []} />}
      />

      {hasFinal && (
        <Card className="bg-green-50 border-green-200">
          <div className="flex items-center gap-2 text-sm text-green-800">
            ✅ <strong>Bien définitif sélectionné</strong> pour ce projet.
            Vous pouvez maintenant passer en phase Design depuis la fiche projet.
          </div>
        </Card>
      )}

      {!proposals || proposals.length === 0 ? (
        <Card><p className="text-stoniz-gray-500 text-sm">Aucune proposition envoyée. Sélectionnez un bien à proposer.</p></Card>
      ) : (
        <div className="space-y-3">
          {proposals.map((p: any) => {
            const isFinal = finalPropertyId === p.property?.id;
            // Le bien est-il déjà retenu/vendu pour un AUTRE projet ? Si oui, on
            // ne propose pas la sélection (la base la refuserait de toute façon).
            const propStatus = p.property?.status;
            const isTakenElsewhere =
              (propStatus === 'offre' || propStatus === 'vendu') && !isFinal;
            // Bouton visible dès que le bien est dispo. Si client_response !== 'accepted',
            // le bouton bascule automatiquement en mode "Valider au nom du client"
            // (modale motif obligatoire). CEO 2026-08-31.
            const clientAccepted = p.client_response === 'accepted';
            const showSelectBtn = !isTakenElsewhere && (
              clientAccepted || (!isFinal && p.client_response !== 'refused')
            );
            return (
            <Card key={p.id} className={isFinal ? 'border-green-400 border-2' : ''}>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <Link href={`/properties/${p.property?.id}`} className="font-medium hover:underline">{p.property?.name}</Link>
                  <div className="text-sm text-stoniz-gray-500">{p.property?.quartier}</div>
                </div>
                <div className="flex items-center gap-3 text-sm flex-wrap">
                  <span>Envoyée le {formatDate(p.sent_at)}</span>
                  {p.viewed_at && <span className="text-stoniz-gray-500">Vue {formatDate(p.viewed_at)}</span>}
                  <Badge variant={p.client_response === 'accepted' ? 'success' : p.client_response === 'refused' ? 'error' : 'default'}>
                    {p.client_response === 'accepted' ? 'Intéressé' :
                     p.client_response === 'refused' ? 'Refusé' :
                     p.client_response === 'more_info' ? 'Infos demandées' : 'En attente'}
                  </Badge>
                  {showSelectBtn && (
                    <SelectFinalPropertyButton
                      projectId={project.id}
                      propertyId={p.property.id}
                      propertyName={p.property.name}
                      isSelected={isFinal}
                      hasOtherFinal={hasFinal && !isFinal}
                      clientAccepted={clientAccepted}
                    />
                  )}
                  {isTakenElsewhere && (
                    <span className="text-xs text-stoniz-gray-500 italic">
                      Indisponible — retenu pour un autre client
                    </span>
                  )}
                </div>
              </div>
              {p.client_message && (
                <div className="mt-3 pt-3 border-t text-sm text-stoniz-gray-600">
                  <span className="font-medium">Message client :</span> {p.client_message}
                </div>
              )}
              {p.client_refusal_reason && (
                <div className="mt-3 pt-3 border-t text-sm text-stoniz-gray-600">
                  <span className="font-medium">Raison refus :</span> {p.client_refusal_reason}
                </div>
              )}
              {(() => {
                const kpis = calculateKPIs(p.financial_snapshot ?? {});
                const loyer = Number(p.financial_snapshot?.estimated_rent ?? 0);
                return (
                  <div className="mt-3 pt-3 border-t text-xs text-stoniz-gray-500 flex gap-x-5 gap-y-1 flex-wrap">
                    <span>Coût total projet : <span className="font-medium text-stoniz-black"><Money amount={kpis.cout_total_projet} /></span></span>
                    <span>Loyer/mois : <Money amount={loyer} /></span>
                    <span>Cashflow/mois : <span className={kpis.cashflow_mensuel >= 0 ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}><Money amount={kpis.cashflow_mensuel} /></span></span>
                    <span>Rdt brut : <span className="font-medium text-stoniz-black">{kpis.rendement_brut_pct.toFixed(2)}%</span></span>
                    <span>Rdt net : <span className="font-medium text-stoniz-black">{kpis.rendement_net_pct.toFixed(2)}%</span></span>
                  </div>
                );
              })()}
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
