import Link from 'next/link';
import { TrendingUp } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { madToEur } from '@/lib/finance/fx-fixed';

/**
 * Section "Performance" sur la fiche bien Propria.
 * Affiche un mini-graph 12 mois pour chacun des 3 KPI sur les suites du bien.
 *
 * Server Component.
 */

function monthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('fr-FR', { month: 'short' });
}

function MiniGraph({
  values,
  color,
  format,
}: {
  values: (number | null)[];
  color: string;
  format: 'pct' | 'num' | 'rating';
}) {
  const cleaned = values.map((v) => v ?? 0);
  const max = Math.max(...cleaned, format === 'rating' ? 5 : 0.001);
  const W = 360, H = 70, PAD = 6;
  const stepX = (W - PAD * 2) / Math.max(1, values.length - 1);
  const pts = cleaned.map((v, i) => {
    const x = PAD + i * stepX;
    const y = H - PAD - (v / max) * (H - PAD * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
      {/* Aire sous la courbe */}
      <polygon
        points={`${PAD},${H - PAD} ${pts.join(' ')} ${W - PAD},${H - PAD}`}
        fill={color}
        opacity={0.15}
      />
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        points={pts.join(' ')}
      />
    </svg>
  );
}

export async function PropriaBienPerformanceSection({ propertyId }: { propertyId: string }) {
  const supabase = createClient();

  // On charge la perf agrégée pour les suites de ce bien
  const { data } = await supabase
    .from('v_propria_listing_monthly_performance')
    .select('month_start, nights_occupied, nights_in_month, revenue, avg_rating, nb_reviews')
    .eq('property_id', propertyId);

  const rows = (data ?? []) as any[];
  if (rows.length === 0) return null;

  // Agrège par mois pour le bien entier (somme des suites)
  const byMonth = new Map<string, { nights: number; nightsTotal: number; revenue: number; ratingSum: number; ratingCount: number; reviews: number }>();
  for (const r of rows) {
    const m = r.month_start;
    const cur = byMonth.get(m) ?? { nights: 0, nightsTotal: 0, revenue: 0, ratingSum: 0, ratingCount: 0, reviews: 0 };
    cur.nights += Number(r.nights_occupied) || 0;
    cur.nightsTotal += Number(r.nights_in_month) || 0;
    cur.revenue += Number(r.revenue) || 0;
    if (r.avg_rating && r.nb_reviews) {
      cur.ratingSum += Number(r.avg_rating) * Number(r.nb_reviews);
      cur.ratingCount += Number(r.nb_reviews);
    }
    cur.reviews += Number(r.nb_reviews) || 0;
    byMonth.set(m, cur);
  }

  const months = Array.from(byMonth.keys()).sort();
  const occSeries = months.map((m) => {
    const c = byMonth.get(m)!;
    return c.nightsTotal > 0 ? c.nights / c.nightsTotal : null;
  });
  const revSeries = months.map((m) => byMonth.get(m)!.revenue || null);
  const ratingSeries = months.map((m) => {
    const c = byMonth.get(m)!;
    return c.ratingCount > 0 ? c.ratingSum / c.ratingCount : null;
  });

  // Stats globales 12 mois
  const totalNights = rows.reduce((s, r) => s + Number(r.nights_occupied || 0), 0);
  const totalNightsAvail = months.length > 0
    ? rows.reduce((s, r) => s + Number(r.nights_in_month || 0), 0)
    : 0;
  const occAvg = totalNightsAvail > 0 ? totalNights / totalNightsAvail : null;
  const revTotal = rows.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const reviewsTotal = rows.reduce((s, r) => s + Number(r.nb_reviews || 0), 0);
  const ratingAvg = reviewsTotal > 0
    ? rows.reduce((s, r) => {
        const c = Number(r.nb_reviews || 0);
        const v = Number(r.avg_rating || 0);
        return s + (c && v ? v * c : 0);
      }, 0) / reviewsTotal
    : null;

  return (
    <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <summary className="cursor-pointer font-medium flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-blue-600" />
        <span>Performance 12 mois</span>
        <span className="text-xs text-stoniz-gray-500 font-normal">
          · Occupation moy {occAvg != null ? (occAvg * 100).toFixed(0) + '%' : '—'} ·
          {' '}Revenus {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(revTotal)} MAD
          {' '}(≈ {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(madToEur(revTotal))} €) ·
          {' '}{reviewsTotal} avis {ratingAvg != null && `(${ratingAvg.toFixed(1)}/5)`}
        </span>
      </summary>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
        <div>
          <div className="text-xs text-stoniz-gray-600 mb-1">📊 Taux d'occupation</div>
          <MiniGraph values={occSeries} color="#2563eb" format="pct" />
          <div className="flex justify-between text-[10px] text-stoniz-gray-400 mt-0.5">
            <span>{monthLabel(months[0])}</span>
            <span>{monthLabel(months[months.length - 1])}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-stoniz-gray-600 mb-1">💶 Revenus (MAD)</div>
          <MiniGraph values={revSeries} color="#059669" format="num" />
          <div className="flex justify-between text-[10px] text-stoniz-gray-400 mt-0.5">
            <span>{monthLabel(months[0])}</span>
            <span>{monthLabel(months[months.length - 1])}</span>
          </div>
        </div>
        <div>
          <div className="text-xs text-stoniz-gray-600 mb-1">⭐ Note voyageurs</div>
          <MiniGraph values={ratingSeries} color="#d97706" format="rating" />
          <div className="flex justify-between text-[10px] text-stoniz-gray-400 mt-0.5">
            <span>{monthLabel(months[0])}</span>
            <span>{monthLabel(months[months.length - 1])}</span>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Link
          href="/propria/performance"
          className="text-xs text-blue-600 hover:underline"
        >
          Voir le détail mois par mois →
        </Link>
      </div>
    </details>
  );
}
