import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { getAllArtisansAttestationStatus } from '@/lib/artisans/attestation-status';
import { AttestationsFiscalesBanner } from '@/components/dashboard/attestations-fiscales-banner';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { RecouvrementBanner } from '@/components/dashboard/recouvrement-banner';
import { VendorDocsAlertBanner } from '@/components/dashboard/vendor-docs-alert-banner';
import { TravauxOpsAlertsBanner } from '@/components/dashboard/travaux-ops-alerts-banner';
import { collectTravauxOpsAlerts } from '@/lib/dashboard/travaux-ops-alerts';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import { KpiDrawerCard, type KpiDrawerRow } from '@/components/dashboard/kpi-drawer';
import { calculateTravauxKPIs, type TravauxKPIs } from '@/lib/finance/travaux-calc';
import { formatMad } from '@/lib/utils/format';
import { LOST_STATUS } from '@/lib/projects/lost';
import { DashboardProjectFilter } from '@/components/dashboard/dashboard-project-filter';
import { parseProjectFilter } from '@/components/dashboard/dashboard-project-filter-utils';

export default async function TravauxDashboardPage({
  searchParams,
}: {
  searchParams: { projects?: string };
}) {
  await requireRole(['ceo','chef_projet','developer','finance']);
  const supabase = createClient();
  // Filtre projet CEO 2026-06-16 : ?projects=... → on n'agrège que ces projets.
  const selectedSet = parseProjectFilter(searchParams.projects);

  // CEO 2026-06-18 : statut attestations fiscales pour le bandeau alerte.
  const attestationRows = await getAllArtisansAttestationStatus(supabase);

  // Règle métier : projets perdus exclus du dashboard (totaux + détail).
  // On filtre dès la query projects → tous les agrégats en aval sont propres.
  const [projectsRes, lotsRes, paymentsRes, encaissementsRes, opsAlerts] = await Promise.all([
    supabase.from('projects')
      .select('id, reference, status, travaux_budget_mad, travaux_marge_cible_pct, client:clients(full_name)')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
    supabase.from('travaux_lots').select('*').is('deleted_at', null),
    supabase.from('travaux_payments').select('*').not('lot_id','is',null).is('deleted_at', null),
    supabase.from('travaux_encaissements').select('*').is('deleted_at', null),
    // Récupère également les stats agrégées (délai moyen, etc.) en parallèle
    collectTravauxOpsAlerts(),
  ]);

  const projects = projectsRes.data ?? [];
  const allLots = lotsRes.data ?? [];
  const allPayments = paymentsRes.data ?? [];
  const allEncaissements = encaissementsRes.data ?? [];

  // Calculs par projet — on construit TOUS les rows non-perdues puis on applique le filtre
  const allRows = projects
    .map((p: any) => {
      const lots = allLots.filter(l => l.project_id === p.id);
      const payments = allPayments.filter(pay => pay.project_id === p.id);
      const encaissements = allEncaissements.filter(e => e.project_id === p.id);
      const kpis = calculateTravauxKPIs({
        lots,
        payments,
        encaissements,
        // BUG FIX CEO 2026-06-16 : sans budgetVenduClient le calcul retombait
        // sur le repli facture-par-lot et affichait des chiffres incohérents
        // avec la fiche projet (qui passait bien le forfait vendu).
        budgetVenduClient: Number(p.travaux_budget_mad ?? 0),
        margeCiblePct: Number(p.travaux_marge_cible_pct ?? 30),
      });
      return {
        projectId: p.id,
        reference: p.reference,
        client: p.client?.full_name ?? '—',
        status: p.status,
        budget_global: Number(p.travaux_budget_mad ?? 0),
        kpis,
      };
    })
    .filter(r => r.budget_global > 0 || r.kpis.lots_total > 0 || r.kpis.total_encaisse_client > 0);

  // Options pour le filtre client
  const filterOptions = allRows.map((r) => ({
    id: r.projectId,
    reference: r.reference,
    client: r.client,
    status: r.status,
  }));

  // Application du filtre — null = pas de filtre actif = tous les projets
  const rows = selectedSet === null
    ? allRows
    : allRows.filter((r) => selectedSet.has(r.projectId));

  // Totaux consolidés (somme des lignes — section 5 du canon : totaux = somme lignes)
  // Canon CEO 2026-06-02 : référence client = forfait vendu, plus la facture par lot.
  const totals = rows.reduce<TravauxKPIs & { devis_previsionnel_total: number; reference_client_mad: number; marge_reelle: number }>((acc, r) => ({
    budget_estime_total:        acc.budget_estime_total        + r.kpis.budget_estime_total,
    devis_previsionnel_total:   acc.devis_previsionnel_total   + r.kpis.devis_previsionnel_total,
    devis_artisans_total:       acc.devis_artisans_total       + r.kpis.devis_artisans_total,
    facture_client_total:       acc.facture_client_total       + r.kpis.facture_client_total,
    reference_client_mad:       acc.reference_client_mad       + r.kpis.reference_client_mad,
    total_encaisse_client:      acc.total_encaisse_client      + r.kpis.total_encaisse_client,
    total_paye_artisans:        acc.total_paye_artisans        + r.kpis.total_paye_artisans,
    budget_vendu_client:        acc.budget_vendu_client        + r.kpis.budget_vendu_client,
    marge_cible_mad:            acc.marge_cible_mad            + r.kpis.marge_cible_mad,
    marge_cible_pct:            0,
    marge_brute:                acc.marge_brute                + r.kpis.marge_brute,
    marge_reelle:               acc.marge_reelle               + r.kpis.marge_reelle,
    ecart_marge:                acc.ecart_marge                + r.kpis.ecart_marge,
    reste_a_encaisser_client:   acc.reste_a_encaisser_client   + r.kpis.reste_a_encaisser_client,
    reste_a_payer_artisans:     acc.reste_a_payer_artisans     + r.kpis.reste_a_payer_artisans,
    tresorerie_a_date:          acc.tresorerie_a_date          + r.kpis.tresorerie_a_date,
    reste_net_a_venir:          acc.reste_net_a_venir          + r.kpis.reste_net_a_venir,
    anomalie_surencaissement:   acc.anomalie_surencaissement || r.kpis.anomalie_surencaissement,
    anomalie_surpaiement:       acc.anomalie_surpaiement     || r.kpis.anomalie_surpaiement,
    lots_termines:              acc.lots_termines              + r.kpis.lots_termines,
    lots_total:                 acc.lots_total                 + r.kpis.lots_total,
    marge_pct: 0,
    cashflow_a_date:            acc.cashflow_a_date            + r.kpis.cashflow_a_date,
    position_nette_future:      acc.position_nette_future      + r.kpis.position_nette_future,
  } as any), {
    budget_estime_total: 0, devis_previsionnel_total: 0, devis_artisans_total: 0, facture_client_total: 0,
    reference_client_mad: 0,
    total_encaisse_client: 0, total_paye_artisans: 0, budget_vendu_client: 0,
    marge_cible_mad: 0, marge_cible_pct: 0, marge_brute: 0, marge_reelle: 0, ecart_marge: 0,
    reste_a_encaisser_client: 0, reste_a_payer_artisans: 0,
    tresorerie_a_date: 0, reste_net_a_venir: 0,
    anomalie_surencaissement: false, anomalie_surpaiement: false,
    lots_termines: 0, lots_total: 0, marge_pct: 0,
    cashflow_a_date: 0, position_nette_future: 0,
  } as any);
  // % de marge calculé sur le forfait vendu (référence client), pas sur la facture par lot.
  const totalMargePct = totals.reference_client_mad > 0
    ? Math.round((totals.marge_reelle / totals.reference_client_mad) * 1000) / 10
    : 0;

  // QA-BUG-021 — même définition que le dashboard général et le cockpit :
  // « en production » = non perdu (déjà exclu de `rows`) ET non livré.
  // Un chantier en pause reste au portefeuille.
  const projetsEnProduction = rows.filter(r => r.status !== 'termine');
  const projetsActifs = projetsEnProduction.length;

  // ─── Répartition par projet pour le drill-down (drawer) ────────────────
  // Réutilise les mêmes `rows` déjà filtrés (perdus exclus) ; aucun recalcul.
  type TravauxRow = (typeof rows)[number];
  const moneyRows = (
    pick: (r: TravauxRow) => number,
    tone?: (v: number) => 'default' | 'negative',
  ): KpiDrawerRow[] =>
    [...rows]
      .filter(r => pick(r) !== 0)
      .sort((a, b) => pick(b) - pick(a))
      .map(r => ({
        id: r.projectId,
        label: r.client,
        sublabel: r.reference,
        amount: formatMad(pick(r)),
        tone: tone ? tone(pick(r)) : 'default',
        href: `/projects/${r.projectId}/travaux`,
      }));
  const lossTone = (v: number): 'default' | 'negative' => (v < 0 ? 'negative' : 'default');

  const projectListRows = (list: TravauxRow[]): KpiDrawerRow[] =>
    list.map(r => ({
      id: r.projectId,
      label: r.client,
      sublabel: r.reference,
      amount: formatMad(r.kpis.facture_client_total),
      href: `/projects/${r.projectId}/travaux`,
    }));

  const lotRows = (pick: (r: TravauxRow) => string, filter?: (r: TravauxRow) => boolean): KpiDrawerRow[] =>
    [...rows]
      .filter(r => (filter ? filter(r) : true))
      .map(r => ({
        id: r.projectId,
        label: r.client,
        sublabel: r.reference,
        amount: pick(r),
        href: `/projects/${r.projectId}/travaux`,
      }));

  // Compteur global lots travaux sans devis (CEO 2026-06-10)
  const lotsWithoutQuoteCount = allLots.filter((l: any) => !l.deleted_at && !l.quote_doc_id).length;

  const isFiltered = selectedSet !== null;
  const desc = isFiltered
    ? `${rows.length} / ${allRows.length} projet${allRows.length > 1 ? 's' : ''} affiché${rows.length > 1 ? 's' : ''} dans les totaux`
    : `Consolidation des chantiers — ${rows.length} projet${rows.length > 1 ? 's' : ''} suivi${rows.length > 1 ? 's' : ''}`;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Dashboard travaux" description={desc} />
        <div className="pt-1 inline-flex items-center gap-2">
          <Link
            href="/dashboard/travaux/performance"
            className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-stoniz-gray-300 bg-white hover:bg-stoniz-gray-50"
          >
            📈 Performance
          </Link>
          <DashboardProjectFilter
            options={filterOptions}
            currentSelected={selectedSet === null ? null : Array.from(selectedSet)}
          />
        </div>
      </div>

      {/* Bandeau attestations fiscales (CEO 2026-06-18) */}
      <AttestationsFiscalesBanner rows={attestationRows} />

      {/* Bandeau recouvrement client (CEO 2026-06-11) */}
      <RecouvrementBanner kind="travaux" />
      {/* Bandeaux opérationnels CEO 2026-06-17 : temps, anomalies, data sale */}
      <TravauxOpsAlertsBanner />
      {/* Bandeau drill-down par artisan (CEO 2026-06-16, remplace l'ancien non-cliquable) */}
      <VendorDocsAlertBanner kind="travaux" />

      <DashboardSection title="Synthèse réseau">
        <KpiGrid>
          <KpiDrawerCard label="CA travaux encaissé" value={formatMad(totals.total_encaisse_client)} variant="success"
            detail={{
              title: 'CA travaux encaissé',
              subtitle: 'Règlements clients reçus, par projet',
              headline: formatMad(totals.total_encaisse_client),
              rows: moneyRows(r => r.kpis.total_encaisse_client),
              emptyLabel: 'Aucun encaissement travaux.',
            }} />
          <KpiDrawerCard label="Reste à encaisser client" value={formatMad(totals.reste_a_encaisser_client)}
            hint={totals.reste_a_encaisser_client < 0 ? '⚠ Sur-encaissement client' : 'Facturé − Encaissé'}
            variant={totals.reste_a_encaisser_client < 0 ? 'danger' : totals.reste_a_encaisser_client > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Reste à encaisser client',
              subtitle: 'Facturé − encaissé, par projet',
              headline: formatMad(totals.reste_a_encaisser_client),
              rows: moneyRows(r => r.kpis.reste_a_encaisser_client, lossTone),
              emptyLabel: 'Rien à encaisser.',
              note: 'Un montant négatif signale un sur-encaissement (le client a payé plus que facturé).',
            }} />
          <KpiDrawerCard label="Payé artisans" value={formatMad(totals.total_paye_artisans)}
            detail={{
              title: 'Payé artisans',
              subtitle: 'Versements aux artisans, par projet',
              headline: formatMad(totals.total_paye_artisans),
              rows: moneyRows(r => r.kpis.total_paye_artisans),
              emptyLabel: 'Aucun versement artisan.',
            }} />
          <KpiDrawerCard label="Reste à payer artisans" value={formatMad(totals.reste_a_payer_artisans)}
            hint={totals.reste_a_payer_artisans < 0 ? '⚠ Sur-paiement artisan' : 'Devis − Payé'}
            variant={totals.reste_a_payer_artisans < 0 ? 'danger' : totals.reste_a_payer_artisans > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Reste à payer artisans',
              subtitle: 'Devis − payé, par projet',
              headline: formatMad(totals.reste_a_payer_artisans),
              rows: moneyRows(r => r.kpis.reste_a_payer_artisans, lossTone),
              emptyLabel: 'Rien à payer.',
              note: 'Un montant négatif signale un sur-paiement (versé à l’artisan > devis).',
            }} />
        </KpiGrid>
        <div className="mt-4">
          <KpiGrid cols={3}>
            <KpiDrawerCard label="Trésorerie à date" value={formatMad(totals.tresorerie_a_date)}
              hint="Encaissé − Payé (cash net déjà en banque)"
              variant={totals.tresorerie_a_date >= 0 ? 'success' : 'danger'}
              detail={{
                title: 'Trésorerie à date',
                subtitle: 'Encaissé − payé, par projet',
                headline: formatMad(totals.tresorerie_a_date),
                headlineTone: totals.tresorerie_a_date < 0 ? 'negative' : 'default',
                rows: moneyRows(r => r.kpis.tresorerie_a_date, lossTone),
                emptyLabel: 'Aucun flux à date.',
              }} />
            <KpiDrawerCard label="Marge réelle consolidée" value={formatMad(totals.marge_reelle)}
              hint={`${totalMargePct}% sur ${formatMad(totals.reference_client_mad)} de forfait vendu`}
              variant={totals.marge_reelle >= 0 ? 'success' : 'danger'}
              detail={{
                title: 'Marge réelle consolidée',
                subtitle: 'Forfait vendu − devis artisans, par projet',
                headline: formatMad(totals.marge_reelle),
                headlineTone: totals.marge_reelle < 0 ? 'negative' : 'default',
                rows: moneyRows(r => r.kpis.marge_reelle, lossTone),
                emptyLabel: 'Aucune marge à afficher.',
                note: 'Rouge uniquement quand la marge est réellement négative.',
              }} />
            <KpiDrawerCard label="Reste net à venir" value={formatMad(totals.reste_net_a_venir)}
              hint="Reste à encaisser − Reste à payer (flux net futur)"
              variant={totals.reste_net_a_venir >= 0 ? 'success' : 'warning'}
              detail={{
                title: 'Reste net à venir',
                subtitle: 'Reste à encaisser − reste à payer, par projet',
                headline: formatMad(totals.reste_net_a_venir),
                rows: moneyRows(r => r.kpis.reste_net_a_venir, lossTone),
                emptyLabel: 'Aucun flux futur.',
              }} />
          </KpiGrid>
        </div>
        <div className="mt-4">
          <KpiGrid cols={4}>
            <KpiDrawerCard label="Projets avec travaux" value={rows.length}
              detail={{
                title: 'Projets avec travaux',
                subtitle: 'Projets ayant un suivi travaux',
                rows: projectListRows([...rows]),
                emptyLabel: 'Aucun projet avec travaux.',
              }} />
            <KpiDrawerCard label="Projets en production" value={projetsActifs}
              detail={{
                title: 'Projets en production',
                subtitle: 'Projets travaux hors perdus et livrés (pause incluse)',
                rows: projectListRows(projetsEnProduction),
                emptyLabel: 'Aucun projet en production.',
              }} />
            <KpiDrawerCard label="Lots ouverts" value={totals.lots_total - totals.lots_termines}
              variant={(totals.lots_total - totals.lots_termines) > 0 ? 'warning' : 'success'}
              detail={{
                title: 'Lots ouverts',
                subtitle: 'Lots non terminés, par projet',
                rows: lotRows(
                  r => `${r.kpis.lots_total - r.kpis.lots_termines} ouvert(s)`,
                  r => (r.kpis.lots_total - r.kpis.lots_termines) > 0,
                ),
                emptyLabel: 'Tous les lots sont terminés.',
              }} />
            <KpiDrawerCard label="Lots terminés" value={`${totals.lots_termines} / ${totals.lots_total}`} variant="success"
              detail={{
                title: 'Lots terminés',
                subtitle: 'Lots terminés / total, par projet',
                rows: lotRows(r => `${r.kpis.lots_termines} / ${r.kpis.lots_total}`, r => r.kpis.lots_total > 0),
                emptyLabel: 'Aucun lot.',
              }} />
          </KpiGrid>
        </div>
        {/* KPI ops CEO 2026-06-17 : délai moyen + chantiers à risque temps */}
        <div className="mt-4">
          <KpiGrid cols={3}>
            <KpiDrawerCard
              label="Délai moyen chantier"
              value={opsAlerts.avgDelayDays != null ? `${opsAlerts.avgDelayDays} j` : '— données'}
              hint="Sur les chantiers terminés avec dates renseignées"
              detail={{
                title: 'Délai moyen chantier',
                subtitle: 'Moyenne historique (date début → date fin) sur projets terminés',
                headline: opsAlerts.avgDelayDays != null ? `${opsAlerts.avgDelayDays} jours` : '— pas assez de données',
                rows: [],
                emptyLabel: opsAlerts.avgDelayDays == null
                  ? 'Pas assez de chantiers terminés avec dates renseignées pour calculer une moyenne fiable.'
                  : '',
              }}
            />
            <KpiDrawerCard
              label="Chantiers en retard"
              value={opsAlerts.timeAtRisk.overdue.length}
              variant={opsAlerts.timeAtRisk.overdue.length > 0 ? 'danger' : 'success'}
              hint="Date de fin prévue dépassée"
              detail={{
                title: 'Chantiers en retard sur date prévue',
                rows: opsAlerts.timeAtRisk.overdue.map((r) => ({
                  id: r.id, label: r.client_name, sublabel: r.reference,
                  amount: r.detail ?? '',
                  href: r.href,
                })),
                emptyLabel: 'Aucun retard 🎉',
              }}
            />
            <KpiDrawerCard
              label="Chantiers > 90j"
              value={opsAlerts.timeAtRisk.older90.length}
              variant={opsAlerts.timeAtRisk.older90.length > 0 ? 'warning' : 'success'}
              hint="Lancés depuis plus de 90 jours, non clos"
              detail={{
                title: 'Chantiers actifs depuis plus de 90 jours',
                rows: opsAlerts.timeAtRisk.older90.map((r) => ({
                  id: r.id, label: r.client_name, sublabel: r.reference,
                  amount: r.detail ?? '',
                  href: r.href,
                })),
                emptyLabel: 'Aucun chantier ancien.',
              }}
            />
          </KpiGrid>
        </div>
      </DashboardSection>

      <DashboardSection title="Vue détaillée par projet" description="Cliquez sur un projet pour ouvrir son suivi travaux">
        <Card>
          {rows.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun projet avec travaux pour le moment.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Client / Projet</th>
                    <th className="text-center py-2 px-2" title="% lots terminés sur le projet">Avancement</th>
                    <th className="text-right py-2 px-2">Budget vendu client</th>
                    <th className="text-right py-2 px-2">Devis prévisionnel</th>
                    <th className="text-right py-2 px-2">Devis artisans</th>
                    <th className="text-right py-2 px-2">Marge cible</th>
                    <th className="text-right py-2 px-2">Marge réelle</th>
                    <th className="text-right py-2 px-2">Écart</th>
                    <th className="text-right py-2 px-2">Encaissé</th>
                    <th className="text-right py-2 px-2">Reste à encaisser</th>
                    <th className="text-right py-2 px-2">Payé artisans</th>
                    <th className="text-right py-2 px-2">Reste à payer</th>
                    <th className="text-right py-2 px-2">Trésorerie à date</th>
                    <th className="text-right py-2 px-2">Reste net à venir</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(r => (
                    <tr key={r.projectId} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2">
                        <Link href={`/projects/${r.projectId}/travaux`} className="hover:underline">
                          <div className="font-medium">{r.client}</div>
                          <div className="text-xs text-stoniz-gray-500 font-mono">{r.reference}</div>
                        </Link>
                      </td>
                      {/* % avancement physique (lots terminés / total) CEO 2026-06-17 */}
                      <td className="text-center py-2 px-2">
                        {r.kpis.lots_total > 0 ? (() => {
                          const pct = Math.round((r.kpis.lots_termines / r.kpis.lots_total) * 100);
                          const variant = pct === 100 ? 'bg-emerald-100 text-emerald-800'
                            : pct >= 50 ? 'bg-amber-100 text-amber-800'
                            : 'bg-stoniz-gray-100 text-stoniz-gray-700';
                          return (
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${variant}`}
                              title={`${r.kpis.lots_termines} / ${r.kpis.lots_total} lots terminés`}>
                              {pct}%
                            </span>
                          );
                        })() : <span className="text-stoniz-gray-400 text-[10px]">—</span>}
                      </td>
                      {/* Canon CEO 2026-06-02 : budget vendu client (forfait), repli sur somme par lot si non saisi. */}
                      <td className="text-right py-2 px-2"
                          title={r.kpis.budget_vendu_client > 0
                            ? 'Forfait vendu (référence client active)'
                            : 'Forfait non saisi — repli sur somme des factures par lot'}>
                        <span className={r.kpis.budget_vendu_client > 0 ? 'font-medium' : 'text-stoniz-gray-500 italic'}>
                          {formatMad(r.kpis.reference_client_mad)}
                        </span>
                        {r.kpis.budget_vendu_client === 0 && (
                          <div className="text-[10px] text-stoniz-gray-400 normal-case">repli lots</div>
                        )}
                      </td>
                      {/* Canon CEO 2026-06-02 : devis prévisionnel (pré-devis avant signature). */}
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.devis_previsionnel_total)}</td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.devis_artisans_total)}</td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.marge_cible_mad)}</td>
                      <td className={`text-right py-2 px-2 font-medium ${r.kpis.marge_reelle < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {formatMad(r.kpis.marge_reelle)}
                      </td>
                      <td className={`text-right py-2 px-2 ${r.kpis.ecart_marge < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {r.kpis.ecart_marge >= 0 ? '+' : ''}{formatMad(r.kpis.ecart_marge)}
                      </td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.total_encaisse_client)}</td>
                      <td className={`text-right py-2 px-2 ${r.kpis.anomalie_surencaissement ? 'text-red-600 font-medium' : ''}`}
                          title={r.kpis.anomalie_surencaissement ? 'Sur-encaissement : client a payé > facturé' : undefined}>
                        {formatMad(r.kpis.reste_a_encaisser_client)}
                        {r.kpis.anomalie_surencaissement && <span className="ml-1">⚠</span>}
                      </td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.total_paye_artisans)}</td>
                      <td className={`text-right py-2 px-2 ${r.kpis.anomalie_surpaiement ? 'text-red-600 font-medium' : ''}`}
                          title={r.kpis.anomalie_surpaiement ? 'Sur-paiement : versé aux artisans > devis' : undefined}>
                        {formatMad(r.kpis.reste_a_payer_artisans)}
                        {r.kpis.anomalie_surpaiement && <span className="ml-1">⚠</span>}
                      </td>
                      <td className={`text-right py-2 px-2 font-medium ${r.kpis.tresorerie_a_date < 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {formatMad(r.kpis.tresorerie_a_date)}
                      </td>
                      <td className={`text-right py-2 px-2 ${r.kpis.reste_net_a_venir < 0 ? 'text-orange-700' : ''}`}>
                        {formatMad(r.kpis.reste_net_a_venir)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-stoniz-gray-100 font-medium">
                    <td className="py-3 px-2 uppercase text-xs">Total tous projets</td>
                    {/* Avancement moyen pondéré par nb lots */}
                    <td className="text-center py-3 px-2">
                      {totals.lots_total > 0 ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-stoniz-gray-200">
                          {Math.round((totals.lots_termines / totals.lots_total) * 100)}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="text-right py-3 px-2">{formatMad(totals.reference_client_mad)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.devis_previsionnel_total)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.devis_artisans_total)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.marge_cible_mad)}</td>
                    <td className={`text-right py-3 px-2 ${totals.marge_reelle < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {formatMad(totals.marge_reelle)}
                    </td>
                    <td className={`text-right py-3 px-2 ${totals.ecart_marge < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {totals.ecart_marge >= 0 ? '+' : ''}{formatMad(totals.ecart_marge)}
                    </td>
                    <td className="text-right py-3 px-2">{formatMad(totals.total_encaisse_client)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.reste_a_encaisser_client)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.total_paye_artisans)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.reste_a_payer_artisans)}</td>
                    <td className={`text-right py-3 px-2 ${totals.tresorerie_a_date < 0 ? 'text-red-600' : 'text-green-700'}`}>
                      {formatMad(totals.tresorerie_a_date)}
                    </td>
                    <td className={`text-right py-3 px-2 ${totals.reste_net_a_venir < 0 ? 'text-orange-700' : ''}`}>
                      {formatMad(totals.reste_net_a_venir)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DashboardSection>

      <DashboardSection title="Marge & cashflow (vue simplifiée)" description="Vue Consolidé — marge par projet">
        <Card>
          {rows.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">—</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Projet</th>
                    <th className="text-right py-2 px-2">Prix vendu</th>
                    <th className="text-right py-2 px-2">Devis artisans</th>
                    <th className="text-right py-2 px-2">Marge brute</th>
                    <th className="text-right py-2 px-2">Marge (%)</th>
                    <th className="text-right py-2 px-2">Trésorerie à date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(r => (
                    <tr key={r.projectId} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2">
                        <Link href={`/projects/${r.projectId}/travaux`} className="hover:underline font-medium">
                          {r.client}
                        </Link>
                      </td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.reference_client_mad)}</td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.devis_artisans_total)}</td>
                      <td className={`text-right py-2 px-2 font-medium ${r.kpis.marge_reelle >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {formatMad(r.kpis.marge_reelle)}
                      </td>
                      <td className="text-right py-2 px-2">{r.kpis.marge_pct.toFixed(1)}%</td>
                      <td className={`text-right py-2 px-2 ${r.kpis.tresorerie_a_date >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {formatMad(r.kpis.tresorerie_a_date)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-stoniz-gray-100 font-medium">
                    <td className="py-3 px-2 uppercase text-xs">Total</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.reference_client_mad)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.devis_artisans_total)}</td>
                    <td className={`text-right py-3 px-2 ${totals.marge_reelle >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {formatMad(totals.marge_reelle)}
                    </td>
                    <td className="text-right py-3 px-2">{totalMargePct.toFixed(1)}%</td>
                    <td className={`text-right py-3 px-2 ${totals.tresorerie_a_date >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {formatMad(totals.tresorerie_a_date)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DashboardSection>
    </div>
  );
}
