import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  Building2, ClipboardList, CalendarCheck, Wallet, Boxes,
  BedDouble, Car, AlertTriangle, TrendingUp, ClipboardCheck, Sparkles,
} from 'lucide-react';

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' DH';
}

export default async function PropriaDashboardPage() {
  await requireRole(['ceo','developer','finance','assistante','propria']);
  const supabase = createClient();

  // Décision CEO 2026-06-02 : on compte les LOTS (propria_units), pas les biens.
  // Un lot est "géré" si son bien parent est en gestion Propria (propria_managed_at IS NOT NULL).
  // Un lot est "à compléter" si l'un des 21 critères de v_propria_unit_completeness manque.
  const [
    lotsRes, intActiveRes, intCritRes, intUnassignedRes,
    cleanActiveRes, cleanUnassignedRes, cleanIncidentsRes,
    maintRes,
    stockRes, cashResvRes, transfersRes, walletsRes, incompleteRes,
  ] = await Promise.all([
    supabase.from('propria_units')
      .select('id, properties!inner(propria_managed_at, propria_refused_at, deleted_at)', { count: 'exact', head: true })
      .is('deleted_at', null)
      .not('properties.propria_managed_at', 'is', null)
      .is('properties.propria_refused_at', null)
      .is('properties.deleted_at', null),
    supabase.from('propria_interventions').select('id', { count: 'exact', head: true })
      .in('status', ['a_traiter','en_cours']).is('deleted_at', null),
    supabase.from('propria_interventions').select('id', { count: 'exact', head: true })
      .eq('urgency', 'critique').in('status', ['a_traiter','en_cours']).is('deleted_at', null),
    // Interventions sans assigné — exclut clôturées/annulées (CEO 2026-06-09)
    supabase.from('propria_interventions').select('id', { count: 'exact', head: true })
      .is('assigned_to_id', null)
      .not('status','in','(cloture,annule)')
      .is('deleted_at', null),
    // Ménages actifs (CEO 2026-06-09)
    supabase.from('propria_cleanings').select('id', { count: 'exact', head: true })
      .in('status', ['a_traiter','en_cours','a_valider']).is('deleted_at', null),
    // Ménages sans assigné
    supabase.from('propria_cleanings').select('id', { count: 'exact', head: true })
      .is('assigned_to_id', null)
      .not('status','in','(cloture,annule)')
      .is('deleted_at', null),
    // Incidents ménage non résolus (CEO 2026-06-09)
    supabase.from('propria_cleaning_incidents').select('id', { count: 'exact', head: true })
      .not('status', 'eq', 'resolved')
      .is('deleted_at', null),
    supabase.from('propria_maintenance_visits').select('id', { count: 'exact', head: true })
      .in('status', ['a_planifier','en_retard']).is('deleted_at', null),
    supabase.from('propria_stock_status').select('id, status, qty_to_order, unit_price_mad'),
    supabase.from('propria_cash_reservations').select('id, amount_mad, recovered, remitted_to_ceo').is('deleted_at', null),
    supabase.from('propria_transfers').select('id', { count: 'exact', head: true })
      .eq('status', 'a_faire').is('deleted_at', null),
    supabase.from('propria_wallet_balances').select('wallet_id, solde_mad, total_expenses, total_reimbursed'),
    // Lots avec au moins 1 critère manquant (vue v_propria_unit_completeness — 21 critères)
    supabase.from('v_propria_unit_completeness').select('unit_id', { count: 'exact', head: true })
      .eq('is_complete', false),
  ]);

  // Compteur suites avec nb_keys ≤ 2 ou non renseigné (CEO 2026-06-09).
  // PostgREST : .or() combine les 2 conditions (NULL ou valeur faible).
  const keyAlertRes = await supabase
    .from('propria_units')
    .select('id, properties!inner(propria_managed_at, propria_refused_at, deleted_at)' as any, { count: 'exact', head: true })
    .is('deleted_at', null)
    .eq('is_active', true)
    .not('properties.propria_managed_at', 'is', null)
    .is('properties.propria_refused_at', null)
    .is('properties.deleted_at', null)
    .or('propria_nb_keys.is.null,propria_nb_keys.lte.2');
  const incompleteCount = incompleteRes.count ?? 0;

  // Avis non-5/5 à traiter (CEO 2026-06-10) : sur les 30 derniers jours, en
  // statut "to_review", non supprimés. Mis en avant car objectif = que des 5/5.
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const reviewsToTreatRes = await supabase
    .from('hostaway_reviews')
    .select('id, rating_normalized, guest_name, public_review, submitted_at, propria_unit_id, channel_name', { count: 'exact' })
    .eq('internal_status', 'to_review')
    .lt('rating_normalized', 5)
    .is('removed_at', null)
    .is('deleted_at', null)
    .gte('submitted_at', since30)
    .order('submitted_at', { ascending: false })
    .limit(3);
  const reviewsToTreatCount = reviewsToTreatRes.count ?? 0;
  const reviewsToTreatPreview = (reviewsToTreatRes.data ?? []) as any[];

  const stockRows = (stockRes.data ?? []) as any[];
  const stockAlerte = stockRows.filter(s => s.status !== 'ok').length;
  const stockBudget = stockRows.reduce((sum, s) =>
    sum + (Number(s.qty_to_order ?? 0) * Number(s.unit_price_mad ?? 0)), 0);

  const cashRows = (cashResvRes.data ?? []) as any[];
  const cashPendingRemise = cashRows
    .filter(r => r.recovered && !r.remitted_to_ceo)
    .reduce((sum, r) => sum + Number(r.amount_mad ?? 0), 0);
  const cashPendingPickup = cashRows
    .filter(r => !r.recovered)
    .reduce((sum, r) => sum + Number(r.amount_mad ?? 0), 0);

  const wallets = (walletsRes.data ?? []) as any[];
  const totalSoldeCaisses = wallets.reduce((sum, w) => sum + Number(w.solde_mad ?? 0), 0);
  const totalNonRembourse = wallets.reduce((sum, w) =>
    sum + (Number(w.total_expenses ?? 0) - Number(w.total_reimbursed ?? 0)), 0);

  const Kpi = ({
    href, icon: Icon, label, value, accent, sub,
  }: any) => (
    <Link
      href={href}
      className="bg-white border border-stoniz-gray-200 rounded-xl p-5 hover:border-stoniz-gray-400 transition group block"
    >
      <div className="flex items-start justify-between mb-3">
        <Icon className={`w-5 h-5 ${accent ?? 'text-stoniz-gray-500'}`} />
        <span className="text-[11px] text-stoniz-gray-400 group-hover:text-stoniz-black">→</span>
      </div>
      <div className="text-2xl font-display">{value}</div>
      <div className="text-xs text-stoniz-gray-600 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-stoniz-gray-500 mt-2">{sub}</div>}
    </Link>
  );

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">Propria</div>
        <h1 className="text-2xl md:text-3xl font-display">Conciergerie & gestion locative</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Vue d'ensemble du portefeuille — lots gérés, interventions, caisses, stock et performances.
        </p>
      </div>

      {/* Bandeau alerte avis non-5/5 (CEO 2026-06-10) */}
      {reviewsToTreatCount > 0 && (
        <Link
          href="/propria/avis?filter=to-review"
          className="block bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6 hover:border-orange-400 transition"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-orange-900">
                {reviewsToTreatCount} avis non-5/5 à traiter (30 derniers jours)
              </div>
              <div className="text-xs text-orange-800 mt-1 space-y-0.5">
                {reviewsToTreatPreview.map((r) => (
                  <div key={r.id} className="truncate">
                    ⭐ {Number(r.rating_normalized).toFixed(1)}/5 · {r.guest_name ?? 'Voyageur'} ({r.channel_name ?? '?'})
                    {r.public_review && <span className="text-orange-700"> — « {String(r.public_review).slice(0, 80)}{r.public_review.length > 80 ? '…' : ''} »</span>}
                  </div>
                ))}
                {reviewsToTreatCount > reviewsToTreatPreview.length && (
                  <div className="text-orange-600 mt-1">
                    + {reviewsToTreatCount - reviewsToTreatPreview.length} autre{reviewsToTreatCount - reviewsToTreatPreview.length > 1 ? 's' : ''} →
                  </div>
                )}
              </div>
            </div>
          </div>
        </Link>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Kpi
          href="/propria/biens"
          icon={Building2}
          accent="text-blue-600"
          value={lotsRes.count ?? 0}
          label="lots gérés"
        />
        <Kpi
          href="/propria/interventions?status=actives"
          icon={ClipboardList}
          accent="text-orange-600"
          value={intActiveRes.count ?? 0}
          label="interventions actives"
          sub={
            (intCritRes.count ?? 0) > 0
              ? `🔴 ${intCritRes.count} critique(s)`
              : 'Aucune critique'
          }
        />
        <Kpi
          href="/propria/menage?status=actives"
          icon={Sparkles}
          accent="text-pink-600"
          value={cleanActiveRes.count ?? 0}
          label="ménages actifs"
          sub={
            (cleanUnassignedRes.count ?? 0) > 0
              ? `🟠 ${cleanUnassignedRes.count} sans assigné`
              : 'Tous assignés'
          }
        />
        <Kpi
          href="/propria/maintenance"
          icon={CalendarCheck}
          accent="text-purple-600"
          value={maintRes.count ?? 0}
          label="visites maintenance à faire"
        />
        <Kpi
          href="/propria/stock"
          icon={Boxes}
          accent="text-amber-600"
          value={stockAlerte}
          label="articles en alerte / rupture"
          sub={`Budget cmd : ${fmtMad(stockBudget)}`}
        />
        <Kpi
          href="/propria/caisse"
          icon={Wallet}
          accent="text-emerald-600"
          value={fmtMad(totalSoldeCaisses)}
          label="solde total caisses collaborateurs"
          sub={`À rembourser : ${fmtMad(totalNonRembourse)}`}
        />
        <Kpi
          href="/propria/reservations-cash"
          icon={BedDouble}
          accent="text-pink-600"
          value={fmtMad(cashPendingRemise)}
          label="cash récupéré / pas remis"
          sub={`À récupérer : ${fmtMad(cashPendingPickup)}`}
        />
        <Kpi
          href="/propria/transferts"
          icon={Car}
          accent="text-indigo-600"
          value={transfersRes.count ?? 0}
          label="transferts à faire"
        />
        <Kpi
          href="/propria/listings"
          icon={TrendingUp}
          accent="text-teal-600"
          value="—"
          label="notes annonces"
          sub="Mettre à jour mensuellement"
        />
        <Kpi
          href="/propria/biens?completion=incomplete"
          icon={ClipboardCheck}
          accent={incompleteCount > 0 ? 'text-amber-600' : 'text-emerald-600'}
          value={incompleteCount}
          label={incompleteCount > 0 ? 'lots à compléter' : 'lots à compléter — tous OK'}
          sub={incompleteCount > 0 ? 'Au moins 1 critère manquant sur 21' : 'Tous les lots sont complets'}
        />
      </div>

      {(intUnassignedRes.count ?? 0) > 0 && (
        <div className="bg-orange-50 border border-orange-300 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-orange-900">
                {intUnassignedRes.count} intervention{(intUnassignedRes.count ?? 0) > 1 ? 's' : ''} sans assigné
              </div>
              <p className="text-xs text-orange-800/80 mt-0.5">
                Personne n’a encore pris la main. Ouvre la liste pour assigner en lot à un collaborateur terrain ou back-office.
              </p>
              <Link
                href="/propria/interventions"
                className="text-sm text-orange-700 underline hover:text-orange-900 mt-1 inline-block"
              >
                Voir et assigner en lot →
              </Link>
            </div>
          </div>
        </div>
      )}

      {(cleanUnassignedRes.count ?? 0) > 0 && (
        <div className="bg-pink-50 border border-pink-300 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <Sparkles className="w-5 h-5 text-pink-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-pink-900">
                {cleanUnassignedRes.count} ménage{(cleanUnassignedRes.count ?? 0) > 1 ? 's' : ''} sans assigné
              </div>
              <p className="text-xs text-pink-800/80 mt-0.5">
                Aucune dame de ménage n’a encore été assignée. Ouvre la liste pour les répartir.
              </p>
              <Link
                href="/propria/menage"
                className="text-sm text-pink-700 underline hover:text-pink-900 mt-1 inline-block"
              >
                Voir et assigner en lot →
              </Link>
            </div>
          </div>
        </div>
      )}

      {(cleanIncidentsRes.count ?? 0) > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-red-900">
                {cleanIncidentsRes.count} incident{(cleanIncidentsRes.count ?? 0) > 1 ? 's' : ''} ménage à traiter
              </div>
              <p className="text-xs text-red-800/80 mt-0.5">
                Canapé sale, télé cassée, dégradation… Vivants indépendamment du ménage source (peuvent rester ouverts après validation).
              </p>
              <Link
                href="/propria/menage/incidents"
                className="text-sm text-red-700 underline hover:text-red-900 mt-1 inline-block"
              >
                Voir et traiter les incidents →
              </Link>
            </div>
          </div>
        </div>
      )}

      {(keyAlertRes.count ?? 0) > 0 && (
        <Link
          href="/propria/biens?alerte=cles_faibles"
          className="block bg-orange-50 border border-orange-300 rounded-xl p-5 mb-6 hover:bg-orange-100 transition"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-start gap-3 flex-1 min-w-0">
              <span className="text-2xl flex-shrink-0">🔑</span>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-orange-900">
                  {keyAlertRes.count} suite{(keyAlertRes.count ?? 0) > 1 ? 's' : ''} avec 2 clés ou moins
                </div>
                <p className="text-xs text-orange-800/80 mt-0.5">
                  Inclut les suites où le nombre de clés n'est pas renseigné. Avoir au moins 3 clés permet une marge (proprio, Stoniz, voyageur).
                </p>
              </div>
            </div>
            <span className="text-sm text-orange-700 underline flex-shrink-0">Voir et corriger →</span>
          </div>
        </Link>
      )}

      {(intCritRes.count ?? 0) > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-5 mb-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-600 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-red-900">
                {intCritRes.count} intervention(s) critique(s) à traiter
              </div>
              <Link
                href="/propria/interventions?urgency=critique"
                className="text-sm text-red-700 underline hover:text-red-900 mt-1 inline-block"
              >
                Voir les interventions critiques →
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/propria/biens/new"
          className="bg-stoniz-black text-white rounded-xl p-5 hover:bg-stoniz-gray-800 transition"
        >
          <div className="font-medium mb-1">+ Ajouter un bien externe</div>
          <div className="text-xs text-stoniz-gray-300">
            Pour un bien qui n'est pas issu d'un projet clé en main Stoniz
          </div>
        </Link>
        <Link
          href="/propria/interventions/new"
          className="bg-white border-2 border-dashed border-stoniz-gray-300 rounded-xl p-5 hover:border-stoniz-black transition"
        >
          <div className="font-medium mb-1">+ Nouvelle intervention</div>
          <div className="text-xs text-stoniz-gray-600">
            Plomberie, électricité, ménage, urgence...
          </div>
        </Link>
        <Link
          href="/propria/inventaires"
          className="bg-white border-2 border-dashed border-stoniz-gray-300 rounded-xl p-5 hover:border-stoniz-black transition"
        >
          <div className="font-medium mb-1">+ Nouvel inventaire</div>
          <div className="text-xs text-stoniz-gray-600">
            Contrôle d'état après séjour, entrée / sortie
          </div>
        </Link>
      </div>
    </div>
  );
}
