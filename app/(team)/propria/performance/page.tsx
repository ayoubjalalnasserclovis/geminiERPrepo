import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { madToEur } from '@/lib/finance/fx-fixed';
import { PerformanceDashboard } from '@/components/propria/performance-dashboard';

/**
 * Page Performance Propria (CEO 2026-06-10, refonte chantier 13 — 2026-06-12).
 *
 * Vue 12 mois glissants avec 3 KPI par logement :
 *   - Taux d'occupation (nuits louées / nuits du mois)
 *   - Revenus (somme prorata des nuits dans le mois) — MAD (devise Hostaway)
 *   - Note moyenne voyageurs (avis du mois)
 *
 * Source : vue v_propria_listing_monthly_performance (pré-calculée SQL).
 * Devises : hostaway_reservations.total_price est en MAD (vérifié en prod
 * 2026-06-12 : 100 % des résas currency = 'MAD'). Affichage MAD + ≈ € au
 * taux interne fixe (lib/finance/fx-fixed.ts), jamais de somme mixte.
 * Commission Propria : dérivée de properties.propria_commission_rate (mandat),
 * rien n'est stocké.
 */
export default async function PropriaPerformancePage() {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const { data, error } = await supabase
    .from('v_propria_listing_monthly_performance')
    .select('*')
    .order('listing_name')
    .order('month_start');

  const rows = (data ?? []) as any[];

  // Taux de commission mandat Propria par bien (pour le panneau détail).
  const propertyIds = Array.from(
    new Set(rows.map((r) => r.property_id).filter(Boolean)),
  ) as string[];
  let commissionRates: Record<string, number | null> = {};
  if (propertyIds.length > 0) {
    const { data: props } = await supabase
      .from('properties')
      .select('id, propria_commission_rate')
      .in('id', propertyIds)
      .is('deleted_at', null);
    for (const p of (props ?? []) as any[]) {
      commissionRates[p.id] =
        p.propria_commission_rate != null ? Number(p.propria_commission_rate) : null;
    }
  }

  // KPI globaux pour les cards (mois en cours)
  const now = new Date();
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);

  const currentMonthRows = rows.filter((r) => r.month_start === currentMonth);
  const prevMonthRows = rows.filter((r) => r.month_start === prevMonth);

  function avg(arr: number[]) {
    if (arr.length === 0) return null;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }
  function sum(arr: number[]) {
    return arr.reduce((s, v) => s + v, 0);
  }

  const occ = avg(currentMonthRows.map((r) => Number(r.occupancy_rate)).filter((v) => !isNaN(v)));
  const occPrev = avg(prevMonthRows.map((r) => Number(r.occupancy_rate)).filter((v) => !isNaN(v)));
  const rev = sum(currentMonthRows.map((r) => Number(r.revenue)).filter((v) => !isNaN(v)));
  const revPrev = sum(prevMonthRows.map((r) => Number(r.revenue)).filter((v) => !isNaN(v)));
  const rating = avg(
    currentMonthRows
      .map((r) => Number(r.avg_rating))
      .filter((v) => !isNaN(v) && v > 0),
  );
  const ratingPrev = avg(
    prevMonthRows
      .map((r) => Number(r.avg_rating))
      .filter((v) => !isNaN(v) && v > 0),
  );

  const monthLabel = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

  function arrow(curr: number | null, prev: number | null) {
    if (curr == null || prev == null) return null;
    const delta = curr - prev;
    if (Math.abs(delta) < 0.0001) return <span className="text-stoniz-gray-400 text-xs">·</span>;
    const isUp = delta > 0;
    return (
      <span className={`text-xs ${isUp ? 'text-emerald-600' : 'text-red-600'}`}>
        {isUp ? '↗' : '↘'} {Math.abs(delta) < 0.01 ? '' : isUp ? '+' : ''}{((curr - prev)).toFixed(curr < 10 ? 1 : 0)}
      </span>
    );
  }

  return (
    <div className="max-w-[1400px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Performance'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-2">📈 Performance</h1>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Suivi mensuel sur 12 mois glissants : taux d'occupation, revenus (MAD), note voyageurs.
        Données calculées depuis les réservations + avis Hostaway.
      </p>

      {/* KPI cards du mois courant */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Occupation moyenne · {monthLabel}</div>
          <div className="text-2xl font-display mt-1 flex items-center gap-2">
            {occ != null ? (occ * 100).toFixed(0) + ' %' : '—'}
            {arrow(occ, occPrev)}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">{currentMonthRows.length} listings actifs</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Revenus · {monthLabel}</div>
          <div className="text-2xl font-display mt-1 flex items-center gap-2">
            {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(rev)} <span className="text-sm text-stoniz-gray-400">MAD</span>
            {arrow(rev, revPrev)}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">
            ≈ {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(madToEur(rev))} € · somme prorata nuits
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Note moyenne · {monthLabel}</div>
          <div className="text-2xl font-display mt-1 flex items-center gap-2">
            {rating != null ? rating.toFixed(2) + ' /5' : '—'}
            {arrow(rating, ratingPrev)}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">avis soumis dans le mois</div>
        </div>
      </div>

      {error ? (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md px-3 py-2 text-sm">
          Erreur de chargement : {error.message}
        </div>
      ) : (
        <PerformanceDashboard rows={rows as any} commissionRates={commissionRates} />
      )}
    </div>
  );
}
