import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { KpiCard, KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import { AchatsLotsTable } from '@/components/achats/achats-lots-table';
import { AchatsSettingsCard } from '@/components/achats/achats-settings-card';
import { AchatsEncaissementsCard } from '@/components/achats/achats-encaissements-card';
import { BulkPlanAcomptes } from '@/components/achats/bulk-plan-acomptes';
import { AchatsBulkPanel } from '@/components/achats/achats-bulk-panel';
import { FinanceSectionAuditTimeline } from '@/components/finance/finance-section-audit-timeline';
import { calculateAchatsKPIs } from '@/lib/finance/achats-calc';
import { BudgetVenduBanner } from '@/components/finance/budget-vendu-banner';
import { RequestPaymentTrigger } from '@/components/validations/request-payment-trigger';
import { getAcomptesForBulkRequest } from '@/lib/finance/bulk-payment-request';
import { formatMad } from '@/lib/utils/format';
import { getSessionUser, requireRole, canImportProjectCsv } from '@/lib/auth/require';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { multi, search, type SP } from '@/lib/list-filters/parse';

/** Petit type local — sous-ensemble de achats_payments suffisant pour les helpers de filtre. */
type AcomptePayment = {
  id: string;
  lot_id: string | null;
  acompte_number: number | null;
  status: string;
};

/**
 * Prochain acompte à verser pour un lot = plus petit `acompte_number` non payé.
 * Renvoie `null` si tous les acomptes sont payés (ou aucun acompte).
 */
function getNextAcompteForLot(lotPayments: AcomptePayment[]): number | null {
  const unpaid = lotPayments
    .filter((p) => p.status !== 'paid' && p.acompte_number != null)
    .sort((a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0));
  return unpaid[0]?.acompte_number ?? null;
}

/**
 * Dernier acompte effectivement payé pour un lot = plus grand `acompte_number` au statut paid.
 * Renvoie `null` si aucun n'est payé.
 */
function getLastPaidAcompteForLot(lotPayments: AcomptePayment[]): number | null {
  const paid = lotPayments
    .filter((p) => p.status === 'paid' && p.acompte_number != null)
    .sort((a, b) => (b.acompte_number ?? 0) - (a.acompte_number ?? 0));
  return paid[0]?.acompte_number ?? null;
}

/**
 * Numéros d'acompte créés pour un lot (présence, peu importe le statut).
 */
function getPresentAcomptesForLot(lotPayments: AcomptePayment[]): number[] {
  return Array.from(
    new Set(
      lotPayments
        .map((p) => p.acompte_number)
        .filter((n): n is number => n != null),
    ),
  );
}

export default async function ProjectAchatsPage({ params, searchParams }: { params: { id: string }; searchParams: SP }) {
  await requireRole(['ceo','chef_projet','developer','finance','assistante','achats']);
  const supabase = createClient();
  const me = await getSessionUser();
  const isCeo = me?.role === 'ceo';
  // Import CSV : CEO + chef_projet + achats (CEO 2026-09-02)
  const canImportCsv = canImportProjectCsv(me?.role);
  const { data: project } = await supabase
    .from('projects')
    .select('id, reference, property_id, achats_budget_mad, achats_marge_cible_pct, achats_adresse_livraison, client:clients(full_name)')
    .eq('id', params.id)
    .single();
  if (!project) notFound();

  const [lotsRes, paymentsRes, encaissementsRes, suppliersRes, unitsRes, partnersRes, recentDocsRes] = await Promise.all([
    supabase.from('achats_lots').select('*').eq('project_id', params.id).is('deleted_at', null).order('numero'),
    supabase.from('achats_payments').select('*').eq('project_id', params.id).not('lot_id','is',null).is('deleted_at', null),
    supabase.from('achats_encaissements').select('*').eq('project_id', params.id).is('deleted_at', null).order('received_at', { ascending: false }),
    supabase.from('artisans').select('id, name')
      .eq('status', 'actif').is('deleted_at', null).order('name'),
    // Suites (propria_units) du bien rattaché — pour filtrer et lier les lots achats
    project.property_id
      ? supabase.from('propria_units')
          .select('id, code, order_index')
          .eq('property_id', project.property_id)
          .is('deleted_at', null)
          .eq('is_active', true)
          .order('order_index')
      : Promise.resolve({ data: [] } as any),
    // Fournisseurs (partners) pour le bulk assign
    supabase.from('partners').select('id, agency_name')
      .is('deleted_at', null).order('agency_name'),
    // Documents fournisseur récents (3 mois) pour pré-charger le picker
    supabase.from('vendor_documents')
      .select('id, doc_type, reference, document_date, total_amount, currency, partner_id, artisan_id, vendor_label, file_path')
      .is('deleted_at', null)
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false }),
  ]);

  const lots = lotsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const encaissements = encaissementsRes.data ?? [];
  const suppliers = suppliersRes.data ?? [];
  const units = (unitsRes.data ?? []) as any[];
  const partners = (partnersRes.data ?? []) as any[];
  const recentDocs = (recentDocsRes.data ?? []) as any[];

  // Acomptes éligibles à une demande de paiement groupée (drawer Phase B3+B4).
  const bulkRequestAcomptes = await getAcomptesForBulkRequest(project.id, 'achats');

  // ─── Filtres acomptes (URL state, CEO 2026-06-22) ──────────────────────
  // 3 dimensions multi-select 1..6 :
  //   - next_acompte : prochain acompte à verser (= plus petit non payé)
  //   - last_paid    : dernier acompte payé (= plus grand payé), "none" si aucun
  //   - has_acompte  : acompte de ce numéro existe (présence, peu importe statut)
  const nextAcompteFilter = multi(searchParams, 'next_acompte');
  const lastPaidFilter = multi(searchParams, 'last_paid');
  const hasAcompteFilter = multi(searchParams, 'has_acompte');
  const q = search(searchParams);

  // Indexer les payments par lot une seule fois pour les filtres ci-dessous.
  const paymentsByLotId = new Map<string, AcomptePayment[]>();
  for (const p of payments as AcomptePayment[]) {
    if (!p.lot_id) continue;
    const arr = paymentsByLotId.get(p.lot_id) ?? [];
    arr.push(p);
    paymentsByLotId.set(p.lot_id, arr);
  }

  // KPI doivent rester sur l'ensemble des lots du projet — on ne filtre QUE la
  // liste affichée par la table.
  const filteredLots = (lots as any[]).filter((l) => {
    const lp = paymentsByLotId.get(l.id) ?? [];
    if (nextAcompteFilter.length > 0) {
      const next = getNextAcompteForLot(lp);
      if (next == null || !nextAcompteFilter.includes(String(next))) return false;
    }
    if (lastPaidFilter.length > 0) {
      const last = getLastPaidAcompteForLot(lp);
      const lastKey = last == null ? 'none' : String(last);
      if (!lastPaidFilter.includes(lastKey)) return false;
    }
    if (hasAcompteFilter.length > 0) {
      const present = new Set(getPresentAcomptesForLot(lp).map(String));
      const matchesAny = hasAcompteFilter.some((n) => present.has(n));
      if (!matchesAny) return false;
    }
    if (q) {
      const needle = q.toLowerCase();
      const hay = [l.description, l.supplier_name, l.devis_number, String(l.numero ?? '')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // Définition des chips de filtre acomptes pour <ListToolbar>.
  const acompteNumOptions = [1, 2, 3, 4, 5, 6].map((n) => ({ v: String(n), label: `Acompte ${n}` }));
  const achatsFilters: FilterDef[] = [
    {
      kind: 'multi',
      key: 'next_acompte',
      label: 'Prochain acompte',
      options: acompteNumOptions,
    },
    {
      kind: 'multi',
      key: 'last_paid',
      label: 'Dernier payé',
      options: [...acompteNumOptions, { v: 'none', label: 'Aucun payé' }],
    },
    {
      kind: 'multi',
      key: 'has_acompte',
      label: 'Numéro présent',
      options: acompteNumOptions,
    },
  ];
  const anyAcompteFilterActive =
    nextAcompteFilter.length + lastPaidFilter.length + hasAcompteFilter.length > 0;

  // Bandeau alerte : lots sans doc (devis ou facture)
  const lotsWithoutDoc = lots.filter((l: any) => !l.quote_doc_id && !l.invoice_doc_id);

  // Rapprochements bancaires sur les paiements fournisseurs (CEO 2026-06-16)
  const paymentIds = payments.map((p: any) => p.id);
  const bankByAchatPayment: Record<string, { txId: string; bankLabel: string | null; opDate: string | null }> = {};
  if (paymentIds.length > 0) {
    const { data: btas } = await supabase
      .from('bank_transaction_allocations')
      .select(`
        id, achats_payment_id,
        transaction:bank_transactions(id, label, operation_date)
      `)
      .in('achats_payment_id', paymentIds)
      .is('deleted_at', null);
    for (const a of (btas ?? []) as any[]) {
      const tx = a.transaction;
      if (!tx || !a.achats_payment_id) continue;
      bankByAchatPayment[a.achats_payment_id] = {
        txId: tx.id, bankLabel: tx.label, opDate: tx.operation_date,
      };
    }
  }

  const kpis = calculateAchatsKPIs({
    lots,
    payments,
    encaissements,
    budgetVenduClient: Number(project.achats_budget_mad ?? 0),
    margeCiblePct: Number(project.achats_marge_cible_pct ?? 25),
  });

  return (
    <div className="space-y-6">
      <BudgetVenduBanner projectId={params.id} poles={['achats']} />
      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" />
        Retour au projet {project.reference}
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Suivi achats"
          description={`${project.reference} · ${(project as any).client?.full_name ?? ''}`}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <RequestPaymentTrigger
            projectId={project.id}
            source="achats"
            acomptes={bulkRequestAcomptes}
          />
          {/* CEO 2026-08-19 (session B) : page Estimations — prévisionnel
              cloisonné, n'entre dans aucun KPI de cette page. */}
          <Link
            href={`/projects/${project.id}/achats/estimations`}
            className="text-sm px-3 py-2 rounded-md border border-grey-line hover:bg-cream-soft transition-colors"
          >
            🧮 Estimations
          </Link>
          {canImportCsv && (
            <Link
              href={`/projects/${project.id}/achats/import`}
              className="text-sm px-3 py-2 rounded-md border border-grey-line hover:bg-cream-soft transition-colors"
            >
              📥 Importer depuis CSV
            </Link>
          )}
        </div>
      </div>

      <AchatsSettingsCard
        projectId={project.id}
        budget={Number(project.achats_budget_mad ?? 0)}
        margeCiblePct={Number(project.achats_marge_cible_pct ?? 25)}
        adresseLivraison={project.achats_adresse_livraison}
      />

      <DashboardSection title="Synthèse financière">
        <KpiGrid>
          {/* Affiche `reference_client_mad` pour être cohérent avec le dashboard achats
              (repli sur somme facture par lot si forfait projet non renseigné). */}
          <KpiCard label="Budget vendu client" value={formatMad(kpis.reference_client_mad)}
            hint={kpis.budget_vendu_client > 0
              ? "Forfait total facturé au client (référence de tous les calculs)"
              : "Repli sur facture par lot (forfait projet non renseigné — saisir dans Paramètres achats)"} />
          <KpiCard label="Devis fournisseurs" value={formatMad(kpis.devis_fournisseurs_total)}
            hint="Somme des devis signés par lot" />
          <KpiCard label="Marge cible" value={formatMad(kpis.marge_cible_mad)}
            hint={`${project.achats_marge_cible_pct ?? 25}% du forfait (objectif fixé en paramètre projet)`} />
          <KpiCard label="Marge réelle" value={formatMad(kpis.marge_reelle)}
            hint={`${kpis.marge_pct}% · écart ${kpis.ecart_marge >= 0 ? '+' : ''}${formatMad(kpis.ecart_marge)} vs cible`}
            variant={kpis.marge_reelle >= 0 ? 'success' : 'danger'} />
        </KpiGrid>
        <div className="mt-4">
          <KpiGrid>
            <KpiCard label="Encaissé client" value={formatMad(kpis.total_encaisse_client)} variant="success" />
            <KpiCard label="Reste à encaisser" value={formatMad(kpis.reste_a_encaisser_client)}
              hint="Budget vendu − Encaissé"
              variant={kpis.reste_a_encaisser_client > 0 ? 'warning' : 'success'} />
            <KpiCard label="Payé fournisseurs" value={formatMad(kpis.total_paye_fournisseurs)} />
            <KpiCard label="Reste à payer fournisseurs" value={formatMad(kpis.reste_a_payer_fournisseurs)}
              hint="Devis fournisseurs − Payé"
              variant={kpis.reste_a_payer_fournisseurs > 0 ? 'warning' : 'success'} />
          </KpiGrid>
        </div>
        <div className="mt-4">
          <KpiGrid cols={3}>
            <KpiCard label="Cashflow à date" value={formatMad(kpis.cashflow_a_date)}
              hint="Encaissé − Payé"
              variant={kpis.cashflow_a_date >= 0 ? 'success' : 'danger'} />
            <KpiCard label="Position nette future" value={formatMad(kpis.position_nette_future)}
              hint="Reste à encaisser − Reste à payer"
              variant={kpis.position_nette_future >= 0 ? 'success' : 'danger'} />
            <KpiCard label="Lots livrés / installés" value={`${kpis.lots_livres} / ${kpis.lots_total}`}
              variant={kpis.lots_livres === kpis.lots_total && kpis.lots_total > 0 ? 'success' : 'default'} />
          </KpiGrid>
        </div>
      </DashboardSection>

      {/* Bandeau alerte documents manquants (CEO 2026-06-10) */}
      {lotsWithoutDoc.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-xl">📎</span>
          <div className="flex-1 text-sm">
            <div className="font-medium text-orange-900">
              {lotsWithoutDoc.length} lot{lotsWithoutDoc.length > 1 ? 's' : ''} sans devis ni facture
            </div>
            <p className="text-xs text-orange-800 mt-1">
              Utilise « Actions en bulk » ci-dessous pour attacher un document partagé à plusieurs lots du même fournisseur.
            </p>
          </div>
        </div>
      )}

      <BulkPlanAcomptes
        projectId={project.id}
        lots={lots as any}
        payments={payments as any}
      />

      {/* CEO 2026-06-18 B1 : le sélecteur fournisseur doit lire `artisans`
          (FK achats_lots.supplier_id → artisans.id), pas `partners`
          (agences immobilières). Mappage name → agency_name pour rester
          rétrocompat avec la prop attendue. */}
      <AchatsBulkPanel
        lots={lots as any}
        payments={payments as any}
        suppliers={suppliers.map((a: any) => ({ id: a.id, agency_name: a.name }))}
        recentDocs={recentDocs}
        projectId={project.id}
        bulkRequestAcomptes={bulkRequestAcomptes}
        units={units as any}
      />

      {/* Filtres acomptes par lot — URL state (CEO 2026-06-22).
          Les chips ne filtrent QUE la liste des lots ci-dessous ; les KPI plus haut
          restent calculés sur l'ensemble du projet. */}
      <ListToolbar
        moduleKey={`project_achats_${project.id}`}
        filters={achatsFilters}
        searchHint="Filtres acomptes — affinent la table ci-dessous"
        count={anyAcompteFilterActive
          ? { filtered: filteredLots.length, total: lots.length }
          : undefined}
      />

      <AchatsLotsTable
        projectId={project.id}
        lots={filteredLots}
        payments={payments}
        suppliers={suppliers}
        units={units}
        bankLinks={bankByAchatPayment}
        recentDocs={recentDocs}
      />

      <AchatsEncaissementsCard projectId={project.id} encaissements={encaissements} />

      <FinanceSectionAuditTimeline
        tables={['achats_lots', 'achats_payments', 'achats_encaissements']}
        recordIds={[
          ...(lots ?? []).map((l: any) => l.id),
          ...(payments ?? []).map((p: any) => p.id),
          ...(encaissements ?? []).map((e: any) => e.id),
        ]}
        title="Historique des actions achats"
      />
    </div>
  );
}
