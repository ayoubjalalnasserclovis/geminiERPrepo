import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KpiCard, KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import { LotsTable } from '@/components/travaux/lots-table';
import { TravauxSettingsCard } from '@/components/travaux/travaux-settings-card';
import { EncaissementsCard } from '@/components/travaux/encaissements-card';
import { TravauxBulkPanel } from '@/components/travaux/travaux-bulk-panel';
import { FinanceSectionAuditTimeline } from '@/components/finance/finance-section-audit-timeline';
import { calculateTravauxKPIs } from '@/lib/finance/travaux-calc';
import { BudgetVenduBanner } from '@/components/finance/budget-vendu-banner';
import { RequestPaymentTrigger } from '@/components/validations/request-payment-trigger';
import { getAcomptesForBulkRequest } from '@/lib/finance/bulk-payment-request';
import { formatMad, formatDate } from '@/lib/utils/format';
import { getSessionUser, requireRole, canImportProjectCsv } from '@/lib/auth/require';
import { ChantierTimeline, type SousPhase } from '@/components/travaux/chantier-timeline';

// ─── Sentinelle BDD : on log toute erreur de rendu serveur ici ──────────
// (pattern qui a marché pour la caisse Propria). Sans ça, Next.js masque
// l'erreur réelle derrière un « Connection closed » générique.
export default async function ProjectTravauxPage({ params }: { params: { id: string } }) {
  try {
    return await renderTravauxPage(params);
  } catch (err: any) {
    try {
      const me = await getSessionUser().catch(() => null);
      const admin = createAdminClient();
      await admin.from('app_error_logs').insert({
        source: 'ProjectTravauxPage:render',
        user_id: me?.id ?? null,
        message: err?.message ?? 'unknown',
        details: {
          name: err?.name,
          stack: (err?.stack ?? '').slice(0, 4000),
          digest: (err as any)?.digest,
        },
        payload: {
          project_id: params.id,
          pathname: `/projects/${params.id}/travaux`,
          role: me?.role ?? 'unknown',
        },
      } as any);
    } catch { /* on ne casse pas le crash original */ }
    throw err;
  }
}

async function renderTravauxPage(params: { id: string }) {
  await requireRole(['ceo','chef_projet','developer','finance','assistante','achats']);
  const supabase = createClient();
  const me = await getSessionUser();
  const isCeo = me?.role === 'ceo';
  // Import CSV : CEO + chef_projet + achats (CEO 2026-09-02)
  const canImportCsv = canImportProjectCsv(me?.role);
  const { data: project } = await supabase
    .from('projects')
    .select(`
      id, reference,
      travaux_budget_mad, travaux_marge_cible_pct, travaux_adresse_chantier,
      travaux_start_date, travaux_end_date, livraison_date, chantier_sous_phase,
      client:clients(full_name),
      property:properties(id, name, address, google_maps_url, floor, apartment_number, quartier)
    `)
    .eq('id', params.id)
    .single();
  if (!project) notFound();
  const property = (project as any).property;

  const [lotsRes, paymentsRes, encaissementsRes, docsRes, artisansRes, recentDocsRes] = await Promise.all([
    supabase.from('travaux_lots').select('*').eq('project_id', params.id).is('deleted_at', null).order('numero'),
    supabase.from('travaux_payments').select('*').eq('project_id', params.id).not('lot_id','is',null).is('deleted_at', null),
    supabase.from('travaux_encaissements').select('*').eq('project_id', params.id).is('deleted_at', null).order('received_at', { ascending: false }),
    supabase.from('documents')
      .select('id, name, type, amount_mad, document_number, document_date, created_at, lot_id')
      .eq('project_id', params.id).in('type', ['devis_artisan','facture_artisan'])
      .is('deleted_at', null).order('created_at', { ascending: false }),
    supabase.from('artisans').select('id, name')
      .eq('status', 'actif').is('deleted_at', null).order('name'),
    // vendor_documents récents (3 mois) pour bulk panel
    supabase.from('vendor_documents')
      .select('id, doc_type, reference, document_date, total_amount, currency, partner_id, artisan_id, vendor_label, file_path')
      .is('deleted_at', null)
      .gte('created_at', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString())
      .order('created_at', { ascending: false }),
  ]);

  const lots = lotsRes.data ?? [];
  const payments = paymentsRes.data ?? [];
  const encaissements = encaissementsRes.data ?? [];
  const lotDocuments = docsRes.data ?? [];
  const artisans = artisansRes.data ?? [];
  const recentDocs = (recentDocsRes.data ?? []) as any[];

  // Acomptes éligibles à une demande de paiement groupée (drawer Phase B3+B4).
  const bulkRequestAcomptes = await getAcomptesForBulkRequest(project.id, 'travaux');

  // Bandeau alerte : lots sans devis attaché
  const lotsWithoutQuote = lots.filter((l: any) => !l.quote_doc_id);

  // Badge ⚠ (CEO 2026-09-07) : forfait vendu client > 0 MAIS aucun devis
  // artisan renseigné. Signale un projet vendu où le sourcing artisan n'est
  // pas encore lancé — risque de dérapage marge s'il commence tard.
  const budgetVenduClient = Number(project.travaux_budget_mad ?? 0);
  const totalDevisArtisans = lots.reduce(
    (s: number, l: any) => s + Number(l.devis_artisan_mad ?? 0), 0,
  );
  const showMissingQuotesBadge = budgetVenduClient > 0 && totalDevisArtisans === 0;

  // Récupère les allocations bancaires liées aux encaissements ET aux paiements
  // artisans de ce projet pour afficher un badge "🏦 Rapproché banque" + lien
  // vers la transaction (CEO 2026-06-16 — étendu aux payments).
  const encIds = encaissements.map((e: any) => e.id);
  const paymentIds = payments.map((p: any) => p.id);
  const bankByEncaissement: Record<string, { txId: string; bankLabel: string | null; opDate: string | null }> = {};
  const bankByPayment: Record<string, { txId: string; bankLabel: string | null; opDate: string | null }> = {};

  if (encIds.length > 0) {
    const { data: btas } = await supabase
      .from('bank_transaction_allocations')
      .select(`
        id, travaux_encaissement_id,
        transaction:bank_transactions(id, label, operation_date)
      `)
      .in('travaux_encaissement_id', encIds)
      .is('deleted_at', null);

    for (const a of (btas ?? []) as any[]) {
      const tx = a.transaction;
      if (!tx || !a.travaux_encaissement_id) continue;
      bankByEncaissement[a.travaux_encaissement_id] = {
        txId: tx.id,
        bankLabel: tx.label,
        opDate: tx.operation_date,
      };
    }
  }

  if (paymentIds.length > 0) {
    const { data: btas } = await supabase
      .from('bank_transaction_allocations')
      .select(`
        id, travaux_payment_id,
        transaction:bank_transactions(id, label, operation_date)
      `)
      .in('travaux_payment_id', paymentIds)
      .is('deleted_at', null);

    for (const a of (btas ?? []) as any[]) {
      const tx = a.transaction;
      if (!tx || !a.travaux_payment_id) continue;
      bankByPayment[a.travaux_payment_id] = {
        txId: tx.id,
        bankLabel: tx.label,
        opDate: tx.operation_date,
      };
    }
  }

  const kpis = calculateTravauxKPIs({
    lots,
    payments,
    encaissements,
    budgetVenduClient: Number(project.travaux_budget_mad ?? 0),
    margeCiblePct: Number(project.travaux_marge_cible_pct ?? 30),
  });

  return (
    <div className="space-y-6">
      <BudgetVenduBanner projectId={params.id} poles={['travaux']} />

      {showMissingQuotesBadge && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">⚠</div>
            <div className="flex-1">
              <div className="font-medium text-amber-900">
                Aucun devis artisan alors qu'un forfait travaux est vendu au client
              </div>
              <div className="text-sm text-amber-800 mt-1">
                Forfait client vendu : <strong>{new Intl.NumberFormat('fr-FR').format(budgetVenduClient)} MAD</strong>.
                Aucun devis artisan n'est encore renseigné pour ce chantier —
                impossible de piloter la marge tant que les devis ne sont pas saisis.
                Contactez les artisans / demandez leurs devis, puis créez les lots ici.
              </div>
            </div>
          </div>
        </div>
      )}

      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" />
        Retour au projet {project.reference}
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader
          title="Suivi travaux"
          description={`${project.reference} · ${(project as any).client?.full_name ?? ''}`}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <RequestPaymentTrigger
            projectId={project.id}
            source="travaux"
            acomptes={bulkRequestAcomptes}
          />
          {canImportCsv && (
            <Link
              href={`/projects/${project.id}/travaux/import`}
              className="text-sm px-3 py-2 rounded-md border border-grey-line hover:bg-cream-soft transition-colors"
            >
              📥 Importer depuis CSV
            </Link>
          )}
        </div>
      </div>

      <ChantierTimeline
        projectId={project.id}
        travauxStartDate={project.travaux_start_date ?? null}
        travauxEndDate={project.travaux_end_date ?? null}
        livraisonDate={(project as any).livraison_date ?? null}
        sousPhase={((project as any).chantier_sous_phase ?? null) as SousPhase | null}
        userRole={me?.role ?? ''}
      />

      <TravauxSettingsCard
        projectId={project.id}
        budget={Number(project.travaux_budget_mad ?? 0)}
        margeCiblePct={Number(project.travaux_marge_cible_pct ?? 30)}
        adresseChantier={project.travaux_adresse_chantier}
        dateDebut={project.travaux_start_date}
        dateFin={project.travaux_end_date}
        property={property}
      />

      <DashboardSection title="Synthèse financière">
        <KpiGrid>
          {/* Affiche toujours `reference_client_mad` (avec repli lots si forfait=0) — cohérent avec le dashboard.
              Source unique : helper `getDisplayReferenceClient` côté lib/finance. */}
          <KpiCard label="Budget vendu client" value={formatMad(kpis.reference_client_mad)}
            hint={kpis.budget_vendu_client > 0
              ? "Forfait total facturé au client (référence de tous les calculs)"
              : "Repli sur facture par lot (forfait projet non renseigné — saisir dans Paramètres chantier)"} />
          <KpiCard label="Devis artisans" value={formatMad(kpis.devis_artisans_total)}
            hint="Somme des devis signés par lot" />
          <KpiCard label="Marge cible" value={formatMad(kpis.marge_cible_mad)}
            hint={`${project.travaux_marge_cible_pct ?? 30}% du forfait (objectif fixé en paramètre projet)`} />
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
            <KpiCard label="Payé artisans" value={formatMad(kpis.total_paye_artisans)} />
            <KpiCard label="Reste à payer artisans" value={formatMad(kpis.reste_a_payer_artisans)}
              hint="Devis artisans − Payé"
              variant={kpis.reste_a_payer_artisans > 0 ? 'warning' : 'success'} />
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
            <KpiCard label="Lots terminés" value={`${kpis.lots_termines} / ${kpis.lots_total}`}
              variant={kpis.lots_termines === kpis.lots_total && kpis.lots_total > 0 ? 'success' : 'default'} />
          </KpiGrid>
        </div>
      </DashboardSection>

      {/* Bandeau alerte devis manquants (CEO 2026-06-10) */}
      {lotsWithoutQuote.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 flex items-start gap-3">
          <span className="text-xl">📎</span>
          <div className="flex-1 text-sm">
            <div className="font-medium text-orange-900">
              {lotsWithoutQuote.length} lot{lotsWithoutQuote.length > 1 ? 's' : ''} sans devis attaché
            </div>
            <p className="text-xs text-orange-800 mt-1">
              Utilise « Actions en bulk » ci-dessous pour attacher un devis partagé entre plusieurs lots du même artisan.
            </p>
          </div>
        </div>
      )}

      <TravauxBulkPanel
        lots={lots as any}
        artisans={artisans as any}
        recentDocs={recentDocs}
        projectId={project.id}
        bulkRequestAcomptes={bulkRequestAcomptes}
        payments={payments as any}
      />

      <LotsTable
        projectId={project.id}
        lots={lots}
        payments={payments}
        lotDocuments={lotDocuments}
        artisans={artisans}
        bankLinks={bankByPayment}
      />

      <EncaissementsCard
        projectId={project.id}
        encaissements={encaissements}
        bankLinks={bankByEncaissement}
      />

      <FinanceSectionAuditTimeline
        tables={['travaux_lots', 'travaux_payments', 'travaux_encaissements']}
        recordIds={[
          ...(lots ?? []).map((l: any) => l.id),
          ...(payments ?? []).map((p: any) => p.id),
          ...(encaissements ?? []).map((e: any) => e.id),
        ]}
        title="Historique des actions travaux"
      />
    </div>
  );
}
