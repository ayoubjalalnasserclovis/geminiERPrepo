import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { RecouvrementBanner } from '@/components/dashboard/recouvrement-banner';
import { VendorDocsAlertBanner } from '@/components/dashboard/vendor-docs-alert-banner';
import { AttestationsFiscalesBanner } from '@/components/dashboard/attestations-fiscales-banner';
import { getAllArtisansAttestationStatus } from '@/lib/artisans/attestation-status';
import { Card } from '@/components/ui/card';
import { KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import { KpiDrawerCard, type KpiDrawerRow } from '@/components/dashboard/kpi-drawer';
import { calculateAchatsKPIs, type AchatsKPIs } from '@/lib/finance/achats-calc';
import { formatMad } from '@/lib/utils/format';
import { LOST_STATUS } from '@/lib/projects/lost';
import { ACHATS_LOT_EXCLUDED_FROM_KPI_PG } from '@/lib/finance/projection-invariants';
import { DashboardProjectFilter } from '@/components/dashboard/dashboard-project-filter';
import { parseProjectFilter } from '@/components/dashboard/dashboard-project-filter-utils';
import { single } from '@/lib/list-filters/parse';

export default async function AchatsDashboardPage({
  searchParams,
}: {
  searchParams: { projects?: string; q?: string };
}) {
  await requireRole(['ceo','chef_projet','developer','finance','achats']);
  const supabase = createClient();
  // Filtre projet CEO 2026-06-16 : si ?projects=... est fourni, on n'agrège que ces projets.
  const selectedSet = parseProjectFilter(searchParams.projects);

  // CEO 2026-06-24 : statut attestations fiscales pour le bandeau alerte achats
  // (réutilise le pattern travaux). Scope 'achats' = artisans business_scope IN ('deco','both').
  const attestationRows = await getAllArtisansAttestationStatus(supabase, 'achats');

  // Règle métier : projets perdus exclus du dashboard (totaux + détail).
  const [projectsRes, lotsRes, paymentsRes, encaissementsRes] = await Promise.all([
    supabase.from('projects')
      .select('id, reference, status, achats_budget_mad, achats_marge_cible_pct, client:clients(full_name)')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
    // CEO 2026-06-18 — KPI consolidés "Reste à payer fournisseurs" / "Marge
    // réelle" / "Trésorerie à date" : exclusion centralisée des lots
    // a_commander (prix inconnu) et annule (lot abandonné).
    supabase.from('achats_lots').select('*').is('deleted_at', null)
      .not('status', 'in', ACHATS_LOT_EXCLUDED_FROM_KPI_PG),
    supabase.from('achats_payments').select('*').not('lot_id','is',null).is('deleted_at', null),
    supabase.from('achats_encaissements').select('*').is('deleted_at', null),
  ]);

  const projects = projectsRes.data ?? [];
  const allLots = lotsRes.data ?? [];
  // CEO 2026-06-18 — paiements dont le lot a été filtré (a_commander/annule)
  // sont aussi exclus, sinon "Payé fournisseurs" ne matche plus les lots.
  const allLotIds = new Set(allLots.map((l: any) => l.id));
  const allPayments = (paymentsRes.data ?? []).filter((p: any) => allLotIds.has(p.lot_id));
  const allEncaissements = encaissementsRes.data ?? [];

  // Calcul de TOUTES les rows non-perdues (la base de référence du filtre)
  const allRows = projects
    .map((p: any) => {
      const lots = allLots.filter(l => l.project_id === p.id);
      const payments = allPayments.filter(pay => pay.project_id === p.id);
      const encaissements = allEncaissements.filter(e => e.project_id === p.id);
      const kpis = calculateAchatsKPIs({
        lots,
        payments,
        encaissements,
        budgetVenduClient: Number(p.achats_budget_mad ?? 0),
        margeCiblePct: Number(p.achats_marge_cible_pct ?? 25),
      });
      return {
        projectId: p.id,
        reference: p.reference,
        client: p.client?.full_name ?? '—',
        status: p.status,
        budget_global: Number(p.achats_budget_mad ?? 0),
        kpis,
      };
    })
    .filter(r => r.budget_global > 0 || r.kpis.lots_total > 0 || r.kpis.total_encaisse_client > 0);

  // Options exposées au composant client : on liste TOUS les projets non perdus
  // qui ont au moins une activité achats (= ceux affichables).
  const filterOptions = allRows.map((r) => ({
    id: r.projectId,
    reference: r.reference,
    client: r.client,
    status: r.status,
  }));

  // Application du filtre — si selectedSet est null, on garde tout.
  const rows = selectedSet === null
    ? allRows
    : allRows.filter((r) => selectedSet.has(r.projectId));

  // Recherche libre (CEO 2026-06-22) — filtre uniquement les tableaux détaillés
  // par projet (les totaux KPI consolidés en haut restent inchangés).
  const q = (single(searchParams as any, 'q') ?? '').trim();
  const qLower = q.toLowerCase();
  const filteredRows = q
    ? rows.filter((r) =>
        (r.client ?? '').toLowerCase().includes(qLower) ||
        (r.reference ?? '').toLowerCase().includes(qLower),
      )
    : rows;

  // Canon CEO 2026-06-02 : référence client = forfait vendu, plus la facture par lot.
  const totals = rows.reduce<AchatsKPIs & { devis_previsionnel_total: number; reference_client_mad: number }>((acc, r) => ({
    budget_estime_total:           acc.budget_estime_total           + r.kpis.budget_estime_total,
    devis_previsionnel_total:      acc.devis_previsionnel_total      + r.kpis.devis_previsionnel_total,
    devis_fournisseurs_total:      acc.devis_fournisseurs_total      + r.kpis.devis_fournisseurs_total,
    facture_client_total:          acc.facture_client_total          + r.kpis.facture_client_total,
    reference_client_mad:          acc.reference_client_mad          + r.kpis.reference_client_mad,
    total_encaisse_client:         acc.total_encaisse_client         + r.kpis.total_encaisse_client,
    total_paye_fournisseurs:       acc.total_paye_fournisseurs       + r.kpis.total_paye_fournisseurs,
    budget_vendu_client:           acc.budget_vendu_client           + r.kpis.budget_vendu_client,
    marge_cible_mad:               acc.marge_cible_mad               + r.kpis.marge_cible_mad,
    marge_cible_pct:               0,
    marge_brute:                   acc.marge_brute                   + r.kpis.marge_brute,
    ecart_marge:                   acc.ecart_marge                   + r.kpis.ecart_marge,
    marge_reelle:                  acc.marge_reelle                  + r.kpis.marge_reelle,
    marge_reelle_pct:              0,
    reste_a_encaisser_client:      acc.reste_a_encaisser_client      + r.kpis.reste_a_encaisser_client,
    reste_a_payer_fournisseurs:    acc.reste_a_payer_fournisseurs    + r.kpis.reste_a_payer_fournisseurs,
    tresorerie_a_date:             acc.tresorerie_a_date             + r.kpis.tresorerie_a_date,
    reste_net_a_venir:             acc.reste_net_a_venir             + r.kpis.reste_net_a_venir,
    anomalie_surencaissement:      acc.anomalie_surencaissement   || r.kpis.anomalie_surencaissement,
    anomalie_surpaiement:          acc.anomalie_surpaiement       || r.kpis.anomalie_surpaiement,
    lots_livres:                   acc.lots_livres                   + r.kpis.lots_livres,
    lots_total:                    acc.lots_total                    + r.kpis.lots_total,
    marge_pct: 0,
    cashflow_a_date:               acc.cashflow_a_date               + r.kpis.cashflow_a_date,
    position_nette_future:         acc.position_nette_future         + r.kpis.position_nette_future,
  } as any), {
    budget_estime_total: 0, devis_previsionnel_total: 0, devis_fournisseurs_total: 0, facture_client_total: 0,
    reference_client_mad: 0,
    total_encaisse_client: 0, total_paye_fournisseurs: 0, budget_vendu_client: 0,
    marge_cible_mad: 0, marge_cible_pct: 0, marge_brute: 0, ecart_marge: 0,
    reste_a_encaisser_client: 0, reste_a_payer_fournisseurs: 0,
    tresorerie_a_date: 0, reste_net_a_venir: 0,
    anomalie_surencaissement: false, anomalie_surpaiement: false,
    lots_livres: 0, lots_total: 0, marge_pct: 0,
    marge_reelle: 0, marge_reelle_pct: 0,
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
  type AchatsRow = (typeof rows)[number];
  const moneyRows = (
    pick: (r: AchatsRow) => number,
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
        href: `/projects/${r.projectId}/achats`,
      }));
  const lossTone = (v: number): 'default' | 'negative' => (v < 0 ? 'negative' : 'default');

  const projectListRows = (list: AchatsRow[]): KpiDrawerRow[] =>
    list.map(r => ({
      id: r.projectId,
      label: r.client,
      sublabel: r.reference,
      amount: formatMad(r.kpis.facture_client_total),
      href: `/projects/${r.projectId}/achats`,
    }));

  const lotRows = (pick: (r: AchatsRow) => string, filter?: (r: AchatsRow) => boolean): KpiDrawerRow[] =>
    [...rows]
      .filter(r => (filter ? filter(r) : true))
      .map(r => ({
        id: r.projectId,
        label: r.client,
        sublabel: r.reference,
        amount: pick(r),
        href: `/projects/${r.projectId}/achats`,
      }));

  // Compteur global lots achats sans doc (CEO 2026-06-10)
  const lotsWithoutDocCount = allLots.filter((l: any) =>
    !l.deleted_at && !l.quote_doc_id && !l.invoice_doc_id
  ).length;

  const isFiltered = selectedSet !== null;
  const desc = isFiltered
    ? `${rows.length} / ${allRows.length} projet${allRows.length > 1 ? 's' : ''} affiché${rows.length > 1 ? 's' : ''} dans les totaux`
    : `Consolidation des achats — ${rows.length} projet${rows.length > 1 ? 's' : ''} suivi${rows.length > 1 ? 's' : ''}`;

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <PageHeader title="Dashboard achats" description={desc} />
        <div className="pt-1">
          <DashboardProjectFilter
            options={filterOptions}
            currentSelected={selectedSet === null ? null : Array.from(selectedSet)}
          />
        </div>
      </div>

      {/* Bandeau attestations fiscales fournisseurs (CEO 2026-06-24) — réutilise le pattern travaux */}
      <AttestationsFiscalesBanner rows={attestationRows} />

      {/* Bandeau recouvrement client (CEO 2026-06-11) */}
      <RecouvrementBanner kind="achats" />
      {/* Bandeau drill-down par fournisseur (CEO 2026-06-16, remplace l'ancien non-cliquable) */}
      <VendorDocsAlertBanner kind="achats" />

      <DashboardSection title="Synthèse réseau">
        <KpiGrid>
          <KpiDrawerCard label="CA achats encaissé" value={formatMad(totals.total_encaisse_client)} variant="success"
            detail={{
              title: 'CA achats encaissé',
              subtitle: 'Règlements clients reçus, par projet',
              headline: formatMad(totals.total_encaisse_client),
              rows: moneyRows(r => r.kpis.total_encaisse_client),
              emptyLabel: 'Aucun encaissement achats.',
            }} />
          <KpiDrawerCard label="Reste à encaisser client" value={formatMad(totals.reste_a_encaisser_client)}
            hint={totals.reste_a_encaisser_client < 0 ? '⚠ Sur-encaissement client' : 'Client → Stoniz'}
            variant={totals.reste_a_encaisser_client < 0 ? 'danger' : totals.reste_a_encaisser_client > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Reste à encaisser client',
              subtitle: 'Facturé − encaissé, par projet',
              headline: formatMad(totals.reste_a_encaisser_client),
              rows: moneyRows(r => r.kpis.reste_a_encaisser_client, lossTone),
              emptyLabel: 'Rien à encaisser.',
              note: 'Un montant négatif signale un sur-encaissement (le client a payé plus que facturé).',
            }} />
          <KpiDrawerCard label="Payé fournisseurs" value={formatMad(totals.total_paye_fournisseurs)}
            detail={{
              title: 'Payé fournisseurs',
              subtitle: 'Versements aux fournisseurs, par projet',
              headline: formatMad(totals.total_paye_fournisseurs),
              rows: moneyRows(r => r.kpis.total_paye_fournisseurs),
              emptyLabel: 'Aucun versement fournisseur.',
            }} />
          <KpiDrawerCard label="Reste à payer fournisseurs" value={formatMad(totals.reste_a_payer_fournisseurs)}
            hint={totals.reste_a_payer_fournisseurs < 0 ? '⚠ Sur-paiement fournisseur' : 'Stoniz → fournisseurs'}
            variant={totals.reste_a_payer_fournisseurs < 0 ? 'danger' : totals.reste_a_payer_fournisseurs > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Reste à payer fournisseurs',
              subtitle: 'Devis − payé, par projet',
              headline: formatMad(totals.reste_a_payer_fournisseurs),
              rows: moneyRows(r => r.kpis.reste_a_payer_fournisseurs, lossTone),
              emptyLabel: 'Rien à payer.',
              note: 'Un montant négatif signale un sur-paiement (versé au fournisseur > devis).',
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
                subtitle: 'Forfait vendu − devis fournisseurs, par projet',
                headline: formatMad(totals.marge_reelle),
                headlineTone: totals.marge_reelle < 0 ? 'negative' : 'default',
                rows: moneyRows(r => r.kpis.marge_reelle, lossTone),
                emptyLabel: 'Aucune marge à afficher.',
                note: 'Vraie rentabilité commerciale : basée sur le forfait vendu.',
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
            <KpiDrawerCard label="Projets avec achats" value={rows.length}
              detail={{
                title: 'Projets avec achats',
                subtitle: 'Projets ayant un suivi achats',
                rows: projectListRows([...rows]),
                emptyLabel: 'Aucun projet avec achats.',
              }} />
            <KpiDrawerCard label="Projets en production" value={projetsActifs}
              detail={{
                title: 'Projets en production',
                subtitle: 'Projets achats hors perdus et livrés (pause incluse)',
                rows: projectListRows(projetsEnProduction),
                emptyLabel: 'Aucun projet en production.',
              }} />
            <KpiDrawerCard label="Lots ouverts" value={totals.lots_total - totals.lots_livres}
              variant={(totals.lots_total - totals.lots_livres) > 0 ? 'warning' : 'success'}
              detail={{
                title: 'Lots ouverts',
                subtitle: 'Lots non encore livrés, par projet',
                rows: lotRows(
                  r => `${r.kpis.lots_total - r.kpis.lots_livres} ouvert(s)`,
                  r => (r.kpis.lots_total - r.kpis.lots_livres) > 0,
                ),
                emptyLabel: 'Tous les lots sont livrés.',
              }} />
            <KpiDrawerCard label="Lots livrés" value={`${totals.lots_livres} / ${totals.lots_total}`} variant="success"
              detail={{
                title: 'Lots livrés',
                subtitle: 'Lots livrés / total, par projet',
                rows: lotRows(r => `${r.kpis.lots_livres} / ${r.kpis.lots_total}`, r => r.kpis.lots_total > 0),
                emptyLabel: 'Aucun lot.',
              }} />
          </KpiGrid>
        </div>
      </DashboardSection>

      <DashboardSection title="Vue détaillée par projet" description="Cliquez sur un projet pour ouvrir son suivi achats">
        {/* Recherche libre par client ou référence projet (CEO 2026-06-22).
            Form GET → URL state ?q=… (rechargement page complète, simple et SSR-friendly).
            N'impacte QUE les tableaux détaillés ci-dessous ; les KPI consolidés au-dessus
            restent calculés sur le filtre projet global. */}
        <form method="get" className="mb-4 flex items-center gap-3 flex-wrap">
          {/* Conserve les autres params (notamment ?projects=…) en hidden. */}
          {searchParams.projects && (
            <input type="hidden" name="projects" defaultValue={searchParams.projects} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Rechercher par client ou réf projet (ex: Zaidi, STZ-2026-138)"
            className="w-full max-w-md px-3 py-2 border border-stoniz-gray-300 rounded text-sm"
          />
          {q && (
            <span className="text-xs text-stoniz-gray-600">
              {filteredRows.length} sur {rows.length} projet{rows.length > 1 ? 's' : ''}
            </span>
          )}
          {q && (
            <Link
              href={searchParams.projects ? `/dashboard/achats?projects=${encodeURIComponent(searchParams.projects)}` : '/dashboard/achats'}
              className="text-xs text-stoniz-gray-500 hover:text-stoniz-black underline"
            >
              Effacer
            </Link>
          )}
        </form>
        <Card>
          {filteredRows.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">
              {q ? `Aucun projet ne correspond à « ${q} ».` : 'Aucun projet avec achats pour le moment.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2 px-2">Client / Projet</th>
                    <th className="text-right py-2 px-2">Budget vendu client</th>
                    <th className="text-right py-2 px-2">Devis prévisionnel</th>
                    <th className="text-right py-2 px-2">Devis fournisseurs</th>
                    <th className="text-right py-2 px-2">Marge cible</th>
                    <th className="text-right py-2 px-2">Marge réelle</th>
                    <th className="text-right py-2 px-2">Écart</th>
                    <th className="text-right py-2 px-2">Encaissé</th>
                    <th className="text-right py-2 px-2">Reste à encaisser</th>
                    <th className="text-right py-2 px-2">Payé</th>
                    <th className="text-right py-2 px-2">Reste à payer</th>
                    <th className="text-right py-2 px-2">Trésorerie à date</th>
                    <th className="text-right py-2 px-2">Reste net à venir</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map(r => (
                    <tr key={r.projectId} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2">
                        <Link href={`/projects/${r.projectId}/achats`} className="hover:underline">
                          <div className="font-medium">{r.client}</div>
                          <div className="text-xs text-stoniz-gray-500 font-mono">{r.reference}</div>
                        </Link>
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
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.devis_fournisseurs_total)}</td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.marge_cible_mad)}</td>
                      <td className={`text-right py-2 px-2 font-medium ${r.kpis.marge_reelle >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {formatMad(r.kpis.marge_reelle)}
                      </td>
                      <td className={`text-right py-2 px-2 ${r.kpis.ecart_marge >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {r.kpis.ecart_marge >= 0 ? '+' : ''}{formatMad(r.kpis.ecart_marge)}
                      </td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.total_encaisse_client)}</td>
                      <td className={`text-right py-2 px-2 ${r.kpis.anomalie_surencaissement ? 'text-red-600 font-medium' : ''}`}
                          title={r.kpis.anomalie_surencaissement ? 'Sur-encaissement : client a payé > facturé' : undefined}>
                        {formatMad(r.kpis.reste_a_encaisser_client)}
                        {r.kpis.anomalie_surencaissement && <span className="ml-1">⚠</span>}
                      </td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.total_paye_fournisseurs)}</td>
                      <td className={`text-right py-2 px-2 ${r.kpis.anomalie_surpaiement ? 'text-red-600 font-medium' : ''}`}
                          title={r.kpis.anomalie_surpaiement ? 'Sur-paiement : versé au fournisseur > devis' : undefined}>
                        {formatMad(r.kpis.reste_a_payer_fournisseurs)}
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
                    <td className="text-right py-3 px-2">{formatMad(totals.reference_client_mad)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.devis_previsionnel_total)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.devis_fournisseurs_total)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.marge_cible_mad)}</td>
                    <td className={`text-right py-3 px-2 ${totals.marge_reelle >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {formatMad(totals.marge_reelle)}
                    </td>
                    <td className={`text-right py-3 px-2 ${totals.ecart_marge >= 0 ? 'text-green-700' : 'text-red-600'}`}>
                      {totals.ecart_marge >= 0 ? '+' : ''}{formatMad(totals.ecart_marge)}
                    </td>
                    <td className="text-right py-3 px-2">{formatMad(totals.total_encaisse_client)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.reste_a_encaisser_client)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.total_paye_fournisseurs)}</td>
                    <td className="text-right py-3 px-2">{formatMad(totals.reste_a_payer_fournisseurs)}</td>
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
                    <th className="text-right py-2 px-2">Devis fournisseurs</th>
                    <th className="text-right py-2 px-2">Marge réelle</th>
                    <th className="text-right py-2 px-2">Marge (%)</th>
                    <th className="text-right py-2 px-2">Trésorerie à date</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(r => (
                    <tr key={r.projectId} className="hover:bg-stoniz-gray-50">
                      <td className="py-2 px-2">
                        <Link href={`/projects/${r.projectId}/achats`} className="hover:underline font-medium">
                          {r.client}
                        </Link>
                      </td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.reference_client_mad)}</td>
                      <td className="text-right py-2 px-2">{formatMad(r.kpis.devis_fournisseurs_total)}</td>
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
                    <td className="text-right py-3 px-2">{formatMad(totals.devis_fournisseurs_total)}</td>
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
