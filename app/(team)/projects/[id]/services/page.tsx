import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, AlertTriangle, Plus } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { KpiCard, KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import {
  calculateServicesKPIs,
  formatServiceCategory,
  formatServiceLotStatus,
  SERVICE_CATEGORIES,
} from '@/lib/finance/services-calc';
import { formatMad, formatDate } from '@/lib/utils/format';
import { AddLotForm } from './add-lot-form';
import { AddPaymentForm } from './add-payment-form';
import { LotRow } from './lot-row';
import { ServicesBulkAcomptesPanel } from './bulk-acomptes-panel';

export default async function ProjectServicesPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'finance', 'assistante', 'achats']);
  const supabase = createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, reference, client:clients(full_name)')
    .eq('id', params.id)
    .single();
  if (!project) notFound();

  const [lotsRes, paymentsRes, providersRes] = await Promise.all([
    supabase
      .from('services_lots')
      .select(`
        id, service_category, status, description,
        budget_estimate_mad, devis_prestataire_mad, facture_prestataire_mad,
        created_at, provider_id,
        provider:artisans(id, name, service_category)
      `)
      .eq('project_id', params.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase
      .from('services_payments')
      .select('id, lot_id, amount_paid, amount_total, paid_at, scheduled_date, acompte_index, description, notes, status')
      .eq('project_id', params.id)
      .is('deleted_at', null)
      .order('paid_at', { ascending: false, nullsFirst: false }),
    supabase
      .from('artisans')
      .select('id, name, provider_type, service_category')
      .is('deleted_at', null)
      .order('name'),
  ]);

  const lots = (lotsRes.data ?? []) as any[];
  const payments = (paymentsRes.data ?? []) as any[];
  const providers = (providersRes.data ?? []) as any[];

  const kpis = calculateServicesKPIs({ lots, payments });

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour au projet {project.reference}
      </Link>

      <PageHeader
        title="Suivi services"
        description={`${project.reference} · ${(project as any).client?.full_name ?? ''} — Architecte, géomètre, juridique, photo, déco… Payés par Stoniz, inclus dans tes honoraires.`}
      />

      {/* KPI résumé */}
      <DashboardSection title="Synthèse coûts services">
        <KpiGrid cols={4}>
          <KpiCard
            label="Devis prestataires (signés)"
            value={formatMad(kpis.devis_prestataires_total)}
            hint={`${kpis.lots_total} lot${kpis.lots_total > 1 ? 's' : ''}`}
          />
          <KpiCard
            label="Payé prestataires"
            value={formatMad(kpis.total_paye_prestataires)}
            variant="success"
          />
          <KpiCard
            label="Reste à payer"
            value={formatMad(kpis.reste_a_payer_prestataires)}
            hint="Devis − Payé"
            variant={kpis.reste_a_payer_prestataires > 0 ? 'warning' : 'success'}
          />
          <KpiCard
            label="Écart vs prévisionnel"
            value={`${kpis.ecart_devis >= 0 ? '+' : ''}${formatMad(kpis.ecart_devis)}`}
            hint={`${kpis.ecart_devis_pct >= 0 ? '+' : ''}${kpis.ecart_devis_pct}%`}
            variant={kpis.ecart_devis > 0 ? 'danger' : 'default'}
          />
        </KpiGrid>

        {kpis.anomalie_surpaiement && (
          <div className="mt-3 bg-red-50 border border-red-200 rounded p-3 text-sm text-red-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              <strong>Sur-paiement détecté</strong> : tu as versé {formatMad(kpis.total_paye_prestataires)} pour {formatMad(kpis.devis_prestataires_total)} de devis signés. Vérifie qu'il n'y a pas une erreur de saisie ou un avenant non documenté.
            </span>
          </div>
        )}

        {/* Répartition par catégorie */}
        {kpis.by_category.length > 0 && (
          <div className="mt-4">
            <h3 className="text-sm font-medium mb-2">Répartition par catégorie</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Catégorie</th>
                    <th className="text-right py-2 px-2">Nb lots</th>
                    <th className="text-right py-2 px-2">Devis</th>
                    <th className="text-right py-2 px-2">Payé</th>
                    <th className="text-right py-2 px-2">Reste</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {kpis.by_category.map((c) => (
                    <tr key={c.category} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2 font-medium">{formatServiceCategory(c.category)}</td>
                      <td className="text-right py-2 px-2">{c.nb_lots}</td>
                      <td className="text-right py-2 px-2">{formatMad(c.devis_total)}</td>
                      <td className="text-right py-2 px-2 text-emerald-700">{formatMad(c.paye_total)}</td>
                      <td className={`text-right py-2 px-2 ${c.devis_total - c.paye_total > 0 ? 'text-orange-700' : ''}`}>
                        {formatMad(Math.max(0, c.devis_total - c.paye_total))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </DashboardSection>

      {/* Actions en bulk sur les acomptes (CEO 2026-07-08) */}
      <ServicesBulkAcomptesPanel
        projectId={params.id}
        lots={lots as any}
        payments={payments as any}
      />

      {/* Liste des lots */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-display">Lots prestataires</h2>
            <p className="text-xs text-stoniz-gray-500 mt-1">
              1 lot = 1 prestataire. Tu peux ajouter plusieurs acomptes par lot.
            </p>
          </div>
        </div>

        {lots.length === 0 ? (
          <div className="text-center py-12">
            <Plus className="w-10 h-10 mx-auto mb-3 text-stoniz-gray-300" />
            <p className="text-sm text-stoniz-gray-600 mb-4">
              Aucun lot services pour ce projet.
              Ajoute ton premier prestataire ci-dessous (architecte, géomètre, etc.).
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {lots.map((lot) => (
              <LotRow
                key={lot.id}
                lot={lot}
                payments={payments.filter((p) => p.lot_id === lot.id)}
                projectId={params.id}
              />
            ))}
          </div>
        )}
      </Card>

      {/* Formulaire ajout lot */}
      <Card>
        <h2 className="text-lg font-display mb-1">+ Ajouter un lot prestataire</h2>
        <p className="text-xs text-stoniz-gray-500 mb-4">
          Choisis une catégorie, puis tape le nom du prestataire (création possible inline).
        </p>
        <AddLotForm
          projectId={params.id}
          providers={providers}
        />
      </Card>

      {/* Formulaire ajout paiement direct (sur un lot existant) */}
      {lots.length > 0 && (
        <Card>
          <h2 className="text-lg font-display mb-1">+ Ajouter un paiement (acompte)</h2>
          <p className="text-xs text-stoniz-gray-500 mb-4">
            Saisis un acompte versé à un prestataire (alternative à la création depuis une transaction bancaire).
          </p>
          <AddPaymentForm
            projectId={params.id}
            lots={lots}
          />
        </Card>
      )}
    </div>
  );
}
