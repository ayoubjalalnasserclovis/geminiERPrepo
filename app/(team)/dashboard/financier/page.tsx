import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { RecouvrementBanner } from '@/components/dashboard/recouvrement-banner';
import { VendorDocsAlertBanner } from '@/components/dashboard/vendor-docs-alert-banner';
import { Card } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { KpiGrid, DashboardSection, KpiCard, HorizontalBar } from '@/components/dashboard/kpi-card';
import { KpiDrawerCard, type KpiDrawerRow } from '@/components/dashboard/kpi-drawer';
import { formatPaymentType, formatDate, formatMoney, formatPhase } from '@/lib/utils/format';
import { excludeLostByProject, LOST_STATUS } from '@/lib/projects/lost';
import { ACHATS_LOT_EXCLUDED_FROM_KPI_PG, ACHATS_LOT_STATUSES_EXCLUDED_FROM_KPI } from '@/lib/finance/projection-invariants';
import {
  computeCockpit,
  MAD_TO_EUR,
  TAUX_MARGE_CHANTIER_CIBLE,
  type CockpitHonoraire,
  type CockpitLot,
  type CockpitPayment,
  type CockpitEncaissement,
  type CockpitForfait,
} from '@/lib/finance/cockpit-calc';

/**
 * Histogramme mensuel (CSS pur). Barres alignées en bas, valeur en k€ au-dessus.
 * Hauteur généreuse pour que même un petit mois reste lisible.
 */
function MonthBars({ months, data, max }: {
  months: string[];
  data: Record<string, number>;
  max: number;
}) {
  return (
    <div>
      <div className="flex items-end gap-1.5 h-56">
        {months.map(m => {
          const v = data[m] ?? 0;
          const h = max > 0 ? (v / max) * 85 : 0; // 85 % max pour laisser la place au label
          return (
            <div key={m} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <div className="text-xs font-medium text-stoniz-black">
                {v > 0 ? Math.round(v / 1000) + 'k€' : ''}
              </div>
              <div
                className="w-full rounded-t bg-stoniz-black"
                style={{ height: `${h}%`, minHeight: v > 0 ? '8px' : '0' }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1.5">
        {months.map(m => (
          <div key={m} className="flex-1 text-center text-xs text-stoniz-gray-500">
            {m.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Dashboard financier CEO — cockpit 3 étages.
 * Spéc : docs/KPI-FINANCIERS-REFERENTIEL.md
 *   1. Santé cash    — trésorerie, restes, retards, sorties 90j
 *   2. Rentabilité   — marge (facturé − devis), taux, écart vs cible
 *   3. Croissance    — projets, CA honoraires, volume facturé, pipeline, perdus
 *
 * Tout est consolidé en EUR (taux fixe 1 € = 10 MAD). Projets perdus exclus
 * partout (sauf carte dédiée). Rouge réservé aux pertes réelles / retards.
 */
export default async function FinancierDashboardPage() {
  await requireRole(['ceo', 'developer', 'finance']);
  const supabase = createClient();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();

  // Stats d'allocation bancaire — pour le bandeau d'alerte "X MAD non alloués"
  // Si une part significative des flux bancaires n'est pas allouée, le dashboard
  // sous-estime le P&L cabinet et sur-estime certaines marges projet.
  const { data: bankAllocStats } = await supabase
    .from('bank_transactions')
    .select(`debit_mad, credit_mad, allocations:bank_transaction_allocations(amount_mad, deleted_at)`)
    .is('deleted_at', null)
    .eq('is_pending', false)
    .limit(3000);
  let totalUnallocatedMad = 0;
  let totalAllocatedMad = 0;
  let totalAmount = 0;
  let nbUnallocated = 0;
  for (const t of (bankAllocStats ?? []) as any[]) {
    const amount = Math.abs(Number(t.debit_mad ?? t.credit_mad ?? 0));
    const allocated = (t.allocations ?? [])
      .filter((a: any) => a.deleted_at == null)
      .reduce((s: number, a: any) => s + Math.abs(Number(a.amount_mad)), 0);
    const remaining = Math.max(0, amount - allocated);
    totalAmount += amount;
    totalAllocatedMad += allocated;
    totalUnallocatedMad += remaining;
    if (remaining >= 0.01) nbUnallocated += 1;
  }
  const unallocatedPct = totalAmount > 0 ? Math.round((totalUnallocatedMad / totalAmount) * 100) : 0;
  const showAllocBanner = unallocatedPct >= 30;

  const projectJoin = 'project:projects(status, deleted_at, reference, client:clients(full_name))';

  const [
    paymentsRes,
    travauxLotsRes,
    travauxPayRes,
    travauxEncRes,
    achatsLotsRes,
    achatsPayRes,
    achatsEncRes,
    projectsRes,
    honorairesRes,
  ] = await Promise.all([
    supabase.from('payments').select(`*, ${projectJoin}`).is('deleted_at', null),
    supabase.from('travaux_lots')
      .select(`project_id, budget_estimate_mad, devis_artisan_mad, facture_client_mad, status, ${projectJoin}`)
      .is('deleted_at', null),
    supabase.from('travaux_payments')
      .select(`project_id, amount_total, amount_paid, scheduled_date, paid_at, status, ${projectJoin}`)
      .is('deleted_at', null),
    supabase.from('travaux_encaissements')
      .select(`project_id, amount_mad, received_at, ${projectJoin}`).eq('status', 'recu').is('deleted_at', null),
    // CEO 2026-06-18 — exclusion 'a_commander' (prix inconnu) et 'annule' des
    // KPI cashflow. Constante centralisée dans projection-invariants.
    supabase.from('achats_lots')
      .select(`id, project_id, budget_estimate_mad, devis_fournisseur_mad, facture_client_mad, status, ${projectJoin}`)
      .is('deleted_at', null)
      .not('status', 'in', ACHATS_LOT_EXCLUDED_FROM_KPI_PG),
    supabase.from('achats_payments')
      .select(`project_id, amount_total, amount_paid, scheduled_date, paid_at, status, lot_id, lot:achats_lots(status), ${projectJoin}`)
      .is('deleted_at', null),
    supabase.from('achats_encaissements')
      .select(`project_id, amount_mad, received_at, ${projectJoin}`).eq('status', 'recu').is('deleted_at', null),
    supabase.from('projects')
      .select('id, reference, status, current_phase, travaux_budget_mad, achats_budget_mad, travaux_marge_cible_pct, achats_marge_cible_pct, client:clients(full_name)')
      .is('deleted_at', null),
    supabase.from('project_honoraires_totals').select('project_id, honoraires_expected'),
  ]);

  // ─── Exclusion des projets perdus (règle permanente, lib/projects/lost.ts) ──
  const paymentsAll = excludeLostByProject(paymentsRes.data, (r: any) => r.project);
  const travauxLots = excludeLostByProject(travauxLotsRes.data, (r: any) => r.project);
  const travauxPay  = excludeLostByProject(travauxPayRes.data, (r: any) => r.project);
  const travauxEnc  = excludeLostByProject(travauxEncRes.data, (r: any) => r.project);
  const achatsLots  = excludeLostByProject(achatsLotsRes.data, (r: any) => r.project);
  // CEO 2026-06-18 — filtre côté TS sur les statuts exclus (constante centralisée).
  // Les paiements SANS lot (lot_id null) sont gardés (acompte direct fournisseur).
  const EXCLUDED: readonly string[] = ACHATS_LOT_STATUSES_EXCLUDED_FROM_KPI;
  const achatsPay   = excludeLostByProject(achatsPayRes.data, (r: any) => r.project)
    .filter((p: any) => !p.lot || !EXCLUDED.includes(p.lot.status));
  const achatsEnc   = excludeLostByProject(achatsEncRes.data, (r: any) => r.project);
  const projectsAll = projectsRes.data ?? [];

  // Honoraires = paiements hors type 'autre' (cohérent avec project_honoraires_totals).
  const honorairesPayments = paymentsAll.filter((p: any) => p.type !== 'autre');

  // ─── Construction des entrées consolidées pour le helper ──────────────────
  const honoraires: CockpitHonoraire[] = honorairesPayments.map((p: any) => ({
    project_id: p.project_id,
    amount_expected: p.amount_expected,
    amount_paid: p.amount_paid,
    status: p.status,
    due_date: p.due_date,
    paid_at: p.paid_at,
  }));

  const lots: CockpitLot[] = [
    ...travauxLots.map((l: any) => ({
      project_id: l.project_id,
      budget_mad: l.budget_estimate_mad,
      devis_mad: l.devis_artisan_mad,
      facture_mad: l.facture_client_mad,
    })),
    ...achatsLots.map((l: any) => ({
      project_id: l.project_id,
      budget_mad: l.budget_estimate_mad,
      devis_mad: l.devis_fournisseur_mad,
      facture_mad: l.facture_client_mad,
    })),
  ];

  const payments: CockpitPayment[] = [...travauxPay, ...achatsPay].map((p: any) => ({
    project_id: p.project_id,
    amount_total: p.amount_total,
    amount_paid: p.amount_paid,
    scheduled_date: p.scheduled_date,
    paid_at: p.paid_at,
    status: p.status,
  }));

  const encaissements: CockpitEncaissement[] = [...travauxEnc, ...achatsEnc].map((e: any) => ({
    project_id: e.project_id,
    amount_mad: e.amount_mad,
    received_at: e.received_at,
  }));

  // ─── Référence chantier par projet = forfait vendu (canon QA-BUG-020) ──────
  // Repli sur la somme des factures par lot quand le forfait n'est pas saisi,
  // exactement comme travaux-calc / achats-calc. Marge cible par discipline
  // (forfait × 30 % travaux / 25 % achats par défaut).
  const sumByProject = (rows: any[], key: string): Map<string, number> => {
    const m = new Map<string, number>();
    rows.forEach((r: any) => m.set(r.project_id, (m.get(r.project_id) ?? 0) + Number(r[key] ?? 0)));
    return m;
  };
  const travFacByProj = sumByProject(travauxLots, 'facture_client_mad');
  const achatsFacByProj = sumByProject(achatsLots, 'facture_client_mad');
  const forfaits: CockpitForfait[] = projectsAll
    .filter((p: any) => p.status !== LOST_STATUS)
    .map((p: any) => {
      const travRef = Number(p.travaux_budget_mad ?? 0) > 0
        ? Number(p.travaux_budget_mad) : (travFacByProj.get(p.id) ?? 0);
      const achatsRef = Number(p.achats_budget_mad ?? 0) > 0
        ? Number(p.achats_budget_mad) : (achatsFacByProj.get(p.id) ?? 0);
      const margeCible = travRef * (Number(p.travaux_marge_cible_pct ?? 30) / 100)
        + achatsRef * (Number(p.achats_marge_cible_pct ?? 25) / 100);
      return { project_id: p.id, reference_mad: travRef + achatsRef, marge_cible_mad: margeCible };
    });

  // Flux datés pris en compte à partir du 1ᵉʳ janvier 2026 (legacy 2025 exclu).
  const since2026 = new Date('2026-01-01');
  const k = computeCockpit({ honoraires, lots, forfaits, payments, encaissements, today: now, since: since2026 });

  // ─── Étage 3 : CA honoraires temporel (sur les règlements honoraires) ─────
  const caMonth = honorairesPayments
    .filter((p: any) => p.paid_at && new Date(p.paid_at) >= new Date(startOfMonth))
    .reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
  const caYTD = honorairesPayments
    .filter((p: any) => p.paid_at && new Date(p.paid_at) >= new Date(startOfYear))
    .reduce((s: number, p: any) => s + Number(p.amount_paid), 0);

  // ─── Projets : compteurs et performance ───────────────────────────────────
  const honByProject = new Map<string, number>(
    (honorairesRes.data ?? []).map((r: any) => [r.project_id, Number(r.honoraires_expected ?? 0)]),
  );
  const honTotal = (id: string): number => honByProject.get(id) ?? 0;

  const projetsNonPerdus = projectsAll.filter((p: any) => p.status !== LOST_STATUS);
  const projetsActifs = projetsNonPerdus.filter((p: any) => p.status !== 'termine');
  const projetsLivres = projectsAll.filter((p: any) => p.status === 'termine');
  const projetsPerdus = projectsAll.filter((p: any) => p.status === LOST_STATUS);

  const honorairesMoyenLivres = projetsLivres.length === 0
    ? 0
    : projetsLivres.reduce((s: number, p: any) => s + honTotal(p.id), 0) / projetsLivres.length;

  const phaseCount: Record<string, number> = {};
  projetsActifs.forEach((p: any) => {
    phaseCount[p.current_phase] = (phaseCount[p.current_phase] ?? 0) + 1;
  });
  const phaseRows = Object.entries(phaseCount).sort((a, b) => b[1] - a[1]);
  const maxPhase = Math.max(...phaseRows.map(([, c]) => c), 1);

  const topProjects = [...projetsNonPerdus]
    .sort((a: any, b: any) => honTotal(b.id) - honTotal(a.id))
    .slice(0, 5);

  // ─── Évolution CA honoraires (12 mois) ────────────────────────────────────
  const monthly: Record<string, number> = {};
  honorairesPayments.filter((p: any) => p.paid_at).forEach((p: any) => {
    const key = String(p.paid_at).slice(0, 7);
    monthly[key] = (monthly[key] ?? 0) + Number(p.amount_paid);
  });
  // Fenêtre = mois de l'année en cours (à partir de janvier 2026, legacy 2025 exclu).
  const monthsThisYear: string[] = [];
  for (let mo = 0; mo <= now.getMonth(); mo++) {
    monthsThisYear.push(new Date(now.getFullYear(), mo, 1).toISOString().slice(0, 7));
  }
  const maxMonthly = Math.max(...monthsThisYear.map(m => monthly[m] ?? 0), 1);

  // ─── Évolution CA travaux + achats (encaissements clients, par mois, EUR) ──
  const monthlyTravaux: Record<string, number> = {};
  [...travauxEnc, ...achatsEnc]
    .filter((e: any) => e.received_at)
    .forEach((e: any) => {
      const key = String(e.received_at).slice(0, 7);
      monthlyTravaux[key] = (monthlyTravaux[key] ?? 0) + Number(e.amount_mad ?? 0) * MAD_TO_EUR;
    });
  const maxMonthlyTravaux = Math.max(...monthsThisYear.map(m => monthlyTravaux[m] ?? 0), 1);

  // ─── Lignes de drill-down (tiroirs) ───────────────────────────────────────
  const projectLabel = (proj: any): string =>
    [proj?.reference, proj?.client?.full_name].filter(Boolean).join(' · ') || 'Projet';

  const tresorerieRows: KpiDrawerRow[] = [
    { id: 'enc-hon', label: 'Encaissé honoraires clients', amount: `+ ${formatMoney(k.enc_honoraires)}`, tone: 'positive' },
    { id: 'enc-cha', label: 'Encaissé travaux + achats clients', amount: `+ ${formatMoney(k.enc_chantier)}`, tone: 'positive' },
    { id: 'pay-cha', label: 'Versé aux artisans + fournisseurs', amount: `− ${formatMoney(k.pay_chantier)}` },
  ];

  // Reste à encaisser — détail cliquable : honoraires non réglés (par échéance)
  // puis solde chantier par projet (facturé − encaissé). Chaque ligne pointe
  // vers la fiche projet concernée.
  const honoRestantRows: KpiDrawerRow[] = honorairesPayments
    .filter((p: any) => p.status !== 'paid' && (Number(p.amount_expected) - Number(p.amount_paid)) > 0.5)
    .sort((a: any, b: any) => String(a.due_date ?? '').localeCompare(String(b.due_date ?? '')))
    .map((p: any) => ({
      id: `hon-${p.id}`,
      label: formatPaymentType(p.type),
      sublabel: projectLabel(p.project),
      date: p.due_date ? `Échéance ${formatDate(p.due_date)}` : undefined,
      amount: formatMoney(Number(p.amount_expected) - Number(p.amount_paid)),
      href: `/projects/${p.project_id}/payments`,
    }));

  type ChantierAgg = { facture: number; encaisse: number; project: any };
  const projById = new Map<string, any>(projectsAll.map((p: any) => [p.id, p]));
  const chantierByProject = new Map<string, ChantierAgg>();
  const bumpChantier = (id: string, project: any, facture: number, encaisse: number) => {
    const cur = chantierByProject.get(id) ?? { facture: 0, encaisse: 0, project };
    cur.facture += facture;
    cur.encaisse += encaisse;
    if (!cur.project) cur.project = project;
    chantierByProject.set(id, cur);
  };
  // QA-BUG-020 : le reste à encaisser chantier se mesure sur le forfait vendu
  // (référence canon), pas sur la facture par lot — cohérent avec la tuile.
  forfaits.forEach(f =>
    bumpChantier(f.project_id, projById.get(f.project_id), Number(f.reference_mad) * MAD_TO_EUR, 0));
  [...travauxEnc, ...achatsEnc].forEach((e: any) =>
    bumpChantier(e.project_id, e.project, 0, Number(e.amount_mad ?? 0) * MAD_TO_EUR));

  const chantierRestantRows: KpiDrawerRow[] = [...chantierByProject.entries()]
    .map(([id, a]) => ({ id, remaining: a.facture - a.encaisse, project: a.project }))
    .filter(x => x.remaining > 0.5)
    .sort((a, b) => b.remaining - a.remaining)
    .map(x => ({
      id: `cha-${x.id}`,
      label: 'Travaux + achats',
      sublabel: projectLabel(x.project),
      amount: formatMoney(x.remaining),
      href: `/projects/${x.id}/travaux`,
    }));

  const resteEncaisserRows: KpiDrawerRow[] = [...honoRestantRows, ...chantierRestantRows];

  const margeRows: KpiDrawerRow[] = [
    { id: 'm-hon', label: 'Honoraires Stoniz (marge pure)', amount: `+ ${formatMoney(k.fac_honoraires)}`, tone: 'positive' },
    { id: 'm-cha', label: 'Marge chantier (forfait − devis)', amount: `${k.marge_chantier >= 0 ? '+ ' : '− '}${formatMoney(Math.abs(k.marge_chantier))}`, tone: k.marge_chantier < 0 ? 'negative' : 'positive' },
  ];

  // QA-BUG-023 : retard recalculé (échéance <= aujourd'hui + non soldé), pas le statut stocké.
  const todayStrOverdue = now.toISOString().slice(0, 10);
  const overdueRows: KpiDrawerRow[] = honorairesPayments
    .filter((p: any) =>
      p.due_date != null &&
      String(p.due_date).slice(0, 10) <= todayStrOverdue &&
      Number(p.amount_paid ?? 0) < Number(p.amount_expected ?? 0))
    .sort((a: any, b: any) => String(a.due_date ?? '').localeCompare(String(b.due_date ?? '')))
    .map((p: any) => ({
      id: p.id,
      label: formatPaymentType(p.type),
      sublabel: projectLabel(p.project),
      date: p.due_date ? `Échéance ${formatDate(p.due_date)}` : undefined,
      amount: formatMoney(Number(p.amount_expected) - Number(p.amount_paid)),
      tone: 'negative' as const,
      href: `/projects/${p.project_id}/payments`,
    }));

  const perdusRows: KpiDrawerRow[] = projetsPerdus.map((p: any) => ({
    id: p.id,
    label: p.reference,
    sublabel: p.client?.full_name,
    amount: formatMoney(honTotal(p.id)),
    href: `/projects/${p.id}`,
  }));

  const honorairesLivresRows: KpiDrawerRow[] = [...projetsLivres]
    .sort((a: any, b: any) => honTotal(b.id) - honTotal(a.id))
    .map((p: any) => ({
      id: p.id,
      label: p.reference,
      sublabel: p.client?.full_name,
      amount: formatMoney(honTotal(p.id)),
      href: `/projects/${p.id}`,
    }));

  // Couleurs (canon : rouge = perte réelle / retard uniquement) ──────────────
  const tauxMargeVariant = k.taux_marge_chantier < 0
    ? 'danger'
    : k.taux_marge_chantier < TAUX_MARGE_CHANTIER_CIBLE ? 'warning' : 'success';

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard financier"
        description="Vue exclusive CEO · Montants consolidés en euros (taux fixe 1 € = 10 MAD)"
      />

      {/* Bandeau recouvrement client travaux + achats (CEO 2026-06-11) */}
      <RecouvrementBanner kind="all" />
      <VendorDocsAlertBanner kind="all" />

      {showAllocBanner && (
        <div className="bg-orange-50 border border-orange-200 rounded-md p-4 text-sm text-orange-900">
          <div className="flex items-start gap-3">
            <div className="text-2xl leading-none">⚠</div>
            <div className="flex-1">
              <div className="font-medium mb-1">
                {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(totalUnallocatedMad)} MAD de flux bancaires
                ne sont pas encore alloués à un projet ou un poste cabinet ({unallocatedPct}% du total importé · {nbUnallocated} transactions).
              </div>
              <div className="text-xs text-orange-800 mb-2">
                Tant que ces flux ne sont pas rattachés, ta marge cabinet (charges salaires / loyer / DGI / CNSS) est <strong>surestimée</strong>,
                et certains paiements artisans / encaissements clients ne remontent pas dans le P&L par projet.
              </div>
              <Link
                href="/finance/tresorerie/reconciliation"
                className="inline-flex items-center gap-1 bg-orange-700 hover:bg-orange-800 text-white text-xs font-medium px-3 py-1.5 rounded"
              >
                Allouer les transactions →
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* ─── Étage 1 ─────────────────────────────────────────────────────── */}
      <DashboardSection title="Santé cash" description="Ce que tu as en poche, ce qu'on te doit, ce que tu dois.">
        <KpiGrid>
          <KpiDrawerCard
            label="Trésorerie à date"
            value={<Money amount={k.tresorerie} />}
            variant={k.tresorerie >= 0 ? 'success' : 'danger'}
            hint="Encaissé − payé · depuis 2026"
            detail={{
              title: 'Trésorerie à date',
              subtitle: 'Cash net encaissé depuis janvier 2026',
              headline: formatMoney(k.tresorerie),
              headlineTone: k.tresorerie < 0 ? 'negative' : 'positive',
              rows: tresorerieRows,
              note: 'Trésorerie = encaissé clients − versé aux prestataires, sur les mouvements datés à partir du 1ᵉʳ janvier 2026 (legacy 2025 exclu). C\'est le cash du moment, pas la marge. Rouge si négatif.',
            }}
          />
          <KpiDrawerCard
            label="Reste à encaisser"
            value={<Money amount={k.reste_a_encaisser} />}
            hint="Dû par les clients"
            detail={{
              title: 'Reste à encaisser (clients)',
              subtitle: 'Facturé − déjà encaissé',
              headline: formatMoney(k.reste_a_encaisser),
              rows: resteEncaisserRows,
              note: 'Montant normal en attente de règlement. Neutre, jamais rouge.',
            }}
          />
          <KpiCard
            label="Reste à payer"
            value={<Money amount={k.reste_a_payer} />}
            hint="Dû aux artisans + fournisseurs"
          />
          <KpiCard
            label="Reste net à venir"
            value={<Money amount={k.reste_net} />}
            variant={k.reste_net >= 0 ? 'success' : 'danger'}
            hint="À encaisser − à payer"
          />
        </KpiGrid>
        <div className="mt-4">
          <KpiGrid cols={2}>
            <KpiDrawerCard
              label="Clients en retard"
              value={<Money amount={k.clients_en_retard} />}
              variant={k.clients_en_retard > 0 ? 'danger' : 'default'}
              hint={`${overdueRows.length} échéance(s) dépassée(s)`}
              detail={{
                title: 'Clients en retard',
                subtitle: 'Échéances d\'honoraires dépassées',
                headline: formatMoney(k.clients_en_retard),
                headlineTone: k.clients_en_retard > 0 ? 'negative' : 'default',
                rows: overdueRows,
                emptyLabel: 'Aucun paiement en retard.',
                note: 'Seuls les honoraires portent une échéance datée. Les chantiers ne sont pas suivis en retard client.',
              }}
            />
            <KpiCard
              label="Sorties cash 90 jours"
              value={<Money amount={k.sorties_90j} />}
              variant={k.sorties_90j > k.tresorerie ? 'warning' : 'default'}
              hint={k.sorties_90j > k.tresorerie ? 'Dépasse la trésorerie disponible' : 'À verser aux prestataires'}
            />
          </KpiGrid>
        </div>
      </DashboardSection>

      {/* ─── Étage 2 ─────────────────────────────────────────────────────── */}
      <DashboardSection title="Rentabilité" description="Tes affaires sont-elles bien margées ? (forfait − devis, insensible au cash)">
        <KpiGrid cols={3}>
          <KpiDrawerCard
            label="Marge brute consolidée"
            value={<Money amount={k.marge_brute} />}
            variant={k.marge_brute > 0 ? 'success' : 'danger'}
            hint="Honoraires + marge chantier"
            detail={{
              title: 'Marge brute consolidée',
              subtitle: 'Honoraires + (forfait − devis) chantier',
              headline: formatMoney(k.marge_brute),
              headlineTone: k.marge_brute < 0 ? 'negative' : 'positive',
              rows: margeRows,
              note: k.projets_sans_reference > 0
                ? `Marge chantier = forfait vendu − devis prestataire. ${k.projets_sans_reference} projet(s) sans référence (ni forfait ni facture) sont exclus du calcul (sinon marge faussée).`
                : 'Honoraires = marge pure (sans coût). Marge chantier = forfait vendu − devis prestataire.',
            }}
          />
          <KpiCard
            label="Taux de marge chantier"
            value={`${k.taux_marge_chantier} %`}
            variant={tauxMargeVariant}
            hint={`Cible ${TAUX_MARGE_CHANTIER_CIBLE} %`}
          />
          <KpiCard
            label="Écart de marge vs cible"
            value={<Money amount={k.ecart_marge} />}
            variant={k.ecart_marge >= 0 ? 'success' : 'danger'}
            hint="Marge réelle − marge cible"
          />
        </KpiGrid>
        <div className="mt-4">
          <KpiGrid cols={3}>
            <KpiDrawerCard
              label="Honoraires moyen / livré"
              value={<Money amount={honorairesMoyenLivres} />}
              hint={`${projetsLivres.length} projet(s) livré(s)`}
              detail={{
                title: 'Honoraires moyen / livré',
                subtitle: 'Projets terminés et leurs honoraires',
                headline: formatMoney(honorairesMoyenLivres),
                rows: honorairesLivresRows,
                emptyLabel: 'Aucun projet livré pour l\'instant.',
              }}
            />
            <KpiCard
              label="Anomalies d'intégrité"
              value={k.anomalies}
              variant={k.anomalies > 0 ? 'warning' : 'default'}
              hint={k.anomalies > 0 ? 'Sur-encaissement / sur-paiement' : 'Aucune'}
            />
            <KpiCard
              label="Projets sans référence"
              value={k.projets_sans_reference}
              variant={k.projets_sans_reference > 0 ? 'warning' : 'default'}
              hint={k.projets_sans_reference > 0 ? 'Ni forfait ni facture · à configurer' : 'Tous les projets ont un forfait'}
            />
          </KpiGrid>
        </div>
      </DashboardSection>

      {/* ─── Étage 3 ─────────────────────────────────────────────────────── */}
      <DashboardSection title="Croissance" description="Le moteur tourne-t-il ?">
        <KpiGrid>
          <KpiCard
            label="Projets actifs"
            value={projetsActifs.length}
            hint="En production (hors perdus / livrés)"
          />
          <KpiCard
            label="CA honoraires (mois)"
            value={<Money amount={caMonth} />}
            hint="Honoraires encaissés ce mois"
          />
          <KpiCard
            label="CA honoraires (YTD)"
            value={<Money amount={caYTD} />}
            hint="Depuis le 1ᵉʳ janvier"
          />
          <KpiCard
            label="Volume facturé total"
            value={<Money amount={k.volume_facture_total} />}
            hint="Honoraires + forfaits chantier (≠ marge)"
          />
        </KpiGrid>
        <div className="mt-4">
          <KpiGrid cols={2}>
            <KpiCard
              label="Pipeline entrées 90 jours"
              value={<Money amount={k.pipeline_90j} />}
              hint="Règlements clients attendus"
            />
            <KpiDrawerCard
              label="Projets perdus"
              value={projetsPerdus.length}
              variant={projetsPerdus.length > 0 ? 'warning' : 'default'}
              hint={`≈ ${formatMoney(projetsPerdus.reduce((s: number, p: any) => s + honTotal(p.id), 0))} non concrétisés`}
              detail={{
                title: 'Projets perdus',
                subtitle: 'Honoraires non concrétisés',
                rows: perdusRows,
                emptyLabel: 'Aucun projet perdu.',
              }}
            />
          </KpiGrid>
        </div>
      </DashboardSection>

      {projetsActifs.length > 0 && (
        <DashboardSection title="Portefeuille actif par phase">
          <Card>
            <div className="space-y-2">
              {phaseRows.map(([phase, count]) => (
                <HorizontalBar key={phase} label={formatPhase(phase)} value={count} max={maxPhase} />
              ))}
            </div>
          </Card>
        </DashboardSection>
      )}

      <DashboardSection title="Évolution du CA honoraires" description="Honoraires encaissés · depuis janvier 2026">
        <Card>
          <MonthBars months={monthsThisYear} data={monthly} max={maxMonthly} />
        </Card>
      </DashboardSection>

      <DashboardSection title="Évolution du CA travaux + achats" description="Encaissements chantiers (clients) · depuis janvier 2026">
        <Card>
          <MonthBars months={monthsThisYear} data={monthlyTravaux} max={maxMonthlyTravaux} />
        </Card>
      </DashboardSection>

      <DashboardSection title="Top 5 projets par valeur">
        <Card>
          {topProjects.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun projet</p>
          ) : (
            <ul className="divide-y text-sm">
              {topProjects.map((p: any) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <Link href={`/projects/${p.id}`} className="hover:underline">
                    <span className="font-mono">{p.reference}</span>
                    <span className="ml-3 text-stoniz-gray-600">{p.client?.full_name}</span>
                  </Link>
                  <Money amount={honTotal(p.id)} className="font-medium" />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </DashboardSection>
    </div>
  );
}
