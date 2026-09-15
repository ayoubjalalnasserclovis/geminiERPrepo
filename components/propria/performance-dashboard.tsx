'use client';

import { useMemo, useState } from 'react';
import { Download, TrendingUp, TrendingDown, Minus, ChevronDown, X } from 'lucide-react';
import { madToEur } from '@/lib/finance/fx-fixed';

type Row = {
  hostaway_listing_db_id: string;
  hostaway_listing_id: number;
  listing_name: string | null;
  propria_unit_id: string | null;
  unit_code: string | null;
  property_id: string | null;
  property_name: string | null;
  month_start: string;       // 'YYYY-MM-01'
  nights_in_month: number;
  nights_occupied: number;
  occupancy_rate: number | null;  // 0..1
  revenue: number | null;
  nb_reviews: number;
  avg_rating: number | null;
};

type KpiKey = 'occupancy' | 'revenue' | 'rating';
const KPI_LABEL: Record<KpiKey, string> = {
  occupancy: 'Taux d\'occupation',
  revenue: 'Revenus (MAD)',
  rating: 'Note voyageurs',
};
const KPI_COLOR: Record<KpiKey, string> = {
  occupancy: '#2563eb',  // blue-600
  revenue: '#059669',    // emerald-600
  rating: '#d97706',     // amber-600
};

function monthLabel(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('fr-FR', { month: 'short', year: '2-digit' });
}

function fmtPct(v: number | null): string {
  if (v == null) return '—';
  return (v * 100).toFixed(0) + ' %';
}
function fmtMoney(v: number | null): string {
  if (v == null || v === 0) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
}
/** Montant MAD avec devise explicite + équivalent € au taux interne fixe. */
function fmtMadWithEur(v: number | null): string {
  if (v == null) return '—';
  const mad = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
  const eur = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(madToEur(v));
  return `${mad} MAD (≈ ${eur} €)`;
}
function fmtRating(v: number | null, n: number): string {
  if (v == null || n === 0) return '—';
  return `${v.toFixed(1)} (${n})`;
}

function getKpiValue(row: Row, kpi: KpiKey): number | null {
  if (kpi === 'occupancy') return row.occupancy_rate;
  if (kpi === 'revenue') return row.revenue;
  return row.avg_rating;
}

function formatKpiCell(row: Row, kpi: KpiKey): string {
  if (kpi === 'occupancy') return fmtPct(row.occupancy_rate);
  if (kpi === 'revenue') return fmtMoney(row.revenue);
  return fmtRating(row.avg_rating, row.nb_reviews);
}

/**
 * Sparkline SVG inline — 1 mini-courbe par ligne du tableau.
 * Largeur fixe 80px, hauteur 24px. Couleur = couleur du KPI.
 */
function Sparkline({ values, color }: { values: (number | null)[]; color: string }) {
  const cleaned = values.map((v) => (v == null ? 0 : v));
  const max = Math.max(...cleaned, 0.001);
  const min = 0; // toujours ancré à 0 pour comparer
  const w = 80, h = 24, pad = 2;
  const stepX = (w - pad * 2) / Math.max(1, values.length - 1);
  const pts = cleaned.map((v, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((v - min) / (max - min)) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="inline-block align-middle">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth={1.4}
        points={pts.join(' ')}
      />
      {/* Dernier point en surbrillance */}
      <circle
        cx={pad + (values.length - 1) * stepX}
        cy={h - pad - ((cleaned[cleaned.length - 1] - min) / (max - min)) * (h - pad * 2)}
        r={2}
        fill={color}
      />
    </svg>
  );
}

/**
 * Indicateur de tendance vs mois précédent : ↗ vert / ↘ rouge / — gris.
 */
function TrendIndicator({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return null;
  if (Math.abs(current - previous) < 0.0001) {
    return <Minus className="w-3 h-3 text-stoniz-gray-400 inline-block ml-1" />;
  }
  if (current > previous) {
    return <TrendingUp className="w-3 h-3 text-emerald-600 inline-block ml-1" />;
  }
  return <TrendingDown className="w-3 h-3 text-red-600 inline-block ml-1" />;
}

/**
 * Gros graphique du haut : courbe d'évolution mensuelle.
 * Affiche la moyenne globale + jusqu'à 3 suites sélectionnées en comparaison.
 */
function MainChart({
  months,
  globalSeries,
  globalLabel,
  selectedSeries,
  kpi,
}: {
  months: string[];
  globalSeries: (number | null)[];
  globalLabel: string;
  selectedSeries: { label: string; values: (number | null)[]; color: string }[];
  kpi: KpiKey;
}) {
  const W = 800, H = 240, PAD_L = 50, PAD_R = 20, PAD_T = 20, PAD_B = 30;
  const allValues = [
    ...globalSeries.filter((v): v is number => v != null),
    ...selectedSeries.flatMap((s) => s.values.filter((v): v is number => v != null)),
  ];
  const max = allValues.length > 0 ? Math.max(...allValues) : 1;
  const stepX = (W - PAD_L - PAD_R) / Math.max(1, months.length - 1);

  const toPath = (values: (number | null)[]) => {
    const pts: string[] = [];
    values.forEach((v, i) => {
      if (v == null) return;
      const x = PAD_L + i * stepX;
      const y = H - PAD_B - (v / max) * (H - PAD_T - PAD_B);
      pts.push(`${pts.length === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return pts.join(' ');
  };

  // Ticks Y (4 ticks)
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} className="overflow-visible">
        {/* Axes Y */}
        {yTicks.map((v, i) => {
          const y = H - PAD_B - (v / max) * (H - PAD_T - PAD_B);
          let label = '';
          if (kpi === 'occupancy') label = (v * 100).toFixed(0) + '%';
          else if (kpi === 'revenue') label = fmtMoney(v);
          else label = v.toFixed(1);
          return (
            <g key={i}>
              <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="#e5e7eb" strokeWidth={1} />
              <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="10" fill="#6b7280">{label}</text>
            </g>
          );
        })}
        {/* Axe X labels */}
        {months.map((m, i) => {
          const x = PAD_L + i * stepX;
          return (
            <text key={m} x={x} y={H - PAD_B + 14} textAnchor="middle" fontSize="10" fill="#6b7280">
              {monthLabel(m)}
            </text>
          );
        })}
        {/* Courbe globale */}
        <path d={toPath(globalSeries)} fill="none" stroke={KPI_COLOR[kpi]} strokeWidth={2.5} />
        {/* Courbes comparaison */}
        {selectedSeries.map((s, i) => (
          <path
            key={i}
            d={toPath(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={1.5}
            strokeDasharray="3 3"
          />
        ))}
      </svg>
      <div className="flex gap-4 text-xs mt-2 flex-wrap">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block w-3 h-0.5" style={{ background: KPI_COLOR[kpi] }} />
          <span className="font-medium">{globalLabel}</span>
        </span>
        {kpi === 'revenue' && (
          <span className="text-stoniz-gray-400">Montants en MAD</span>
        )}
        {selectedSeries.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1">
            <span className="inline-block w-3 h-0.5" style={{ background: s.color, borderTop: `1px dashed ${s.color}` }} />
            <span>{s.label}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Panneau détail d'un logement (12 mois glissants), ouvert au clic sur le nom.
 * Toutes les composantes sont DÉRIVÉES, rien n'est stocké :
 *   - CA / encaissement total = somme des revenus de la vue (MAD, prorata nuits,
 *     prix total payé voyageurs remonté par Hostaway).
 *   - Commission Propria = CA × taux mandat (properties.propria_commission_rate).
 *   - Frais de ménage : aucun coût ménage n'est suivi en BDD (propria_cleanings
 *     n'a pas de montant) → affiché « non suivi », jamais un faux 0.
 *   - Revenu net propriétaire estimé = CA − commission (hors ménage).
 */
function ListingDetailPanel({
  label,
  data,
  commissionRate,
  onClose,
}: {
  label: string;
  data: Row[];
  commissionRate: number | null | undefined;
  onClose: () => void;
}) {
  const ca = data.reduce((s, r) => s + (Number(r.revenue) || 0), 0);
  const nightsOcc = data.reduce((s, r) => s + (Number(r.nights_occupied) || 0), 0);
  const nightsTotal = data.reduce((s, r) => s + (Number(r.nights_in_month) || 0), 0);
  const occ = nightsTotal > 0 ? nightsOcc / nightsTotal : null;
  const reviews = data.reduce((s, r) => s + (Number(r.nb_reviews) || 0), 0);
  const ratingAvg =
    reviews > 0
      ? data.reduce((s, r) => {
          const n = Number(r.nb_reviews) || 0;
          const v = Number(r.avg_rating) || 0;
          return s + (n && v ? v * n : 0);
        }, 0) / reviews
      : null;
  const commission = commissionRate != null ? (ca * commissionRate) / 100 : null;
  const net = commission != null ? ca - commission : null;
  const propertyName = data[0]?.property_name ?? null;
  const listingName = data[0]?.listing_name ?? null;

  const line = 'flex items-baseline justify-between gap-3 py-2 border-b border-stoniz-gray-100 last:border-0';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-5 max-h-[85vh] overflow-y-auto">
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-1 rounded hover:bg-stoniz-gray-100"
          aria-label="Fermer"
        >
          <X className="w-4 h-4 text-stoniz-gray-500" />
        </button>
        <div className="font-mono font-medium text-lg">{label}</div>
        <div className="text-xs text-stoniz-gray-500 mb-1">
          {listingName}{propertyName ? ` · ${propertyName}` : ''}
        </div>
        <div className="text-[11px] text-stoniz-gray-400 uppercase tracking-wider mb-3">
          12 derniers mois · montants en MAD (≈ € au taux fixe 10)
        </div>

        <div className="text-sm">
          <div className={line}>
            <span className="text-stoniz-gray-600">CA / encaissement total voyageurs</span>
            <span className="font-medium text-right">{fmtMadWithEur(ca)}</span>
          </div>
          <div className={line}>
            <span className="text-stoniz-gray-600">
              Commission Propria{commissionRate != null ? ` (${commissionRate} %)` : ''}
            </span>
            <span className="font-medium text-right">
              {commission != null ? (
                `− ${fmtMadWithEur(commission)}`
              ) : (
                <span className="text-stoniz-gray-400 italic font-normal">non suivi — taux mandat non renseigné</span>
              )}
            </span>
          </div>
          <div className={line}>
            <span className="text-stoniz-gray-600">Frais de ménage</span>
            <span className="text-stoniz-gray-400 italic text-right">non suivi</span>
          </div>
          <div className={line}>
            <span className="text-stoniz-gray-700 font-medium">Revenu net propriétaire estimé</span>
            <span className="font-semibold text-right">
              {net != null ? fmtMadWithEur(net) : '—'}
            </span>
          </div>
        </div>
        <p className="text-[11px] text-stoniz-gray-400 mt-2">
          Estimation = CA − commission. Les frais de ménage ne sont pas suivis en
          base (pas de montant sur les ménages) : ils ne sont donc pas déduits.
        </p>

        <div className="grid grid-cols-3 gap-2 mt-4 text-center">
          <div className="bg-stoniz-gray-50 rounded-lg p-2">
            <div className="text-[10px] text-stoniz-gray-500 uppercase">Occupation</div>
            <div className="font-medium text-sm">{fmtPct(occ)}</div>
            <div className="text-[10px] text-stoniz-gray-400">{nightsOcc} nuits</div>
          </div>
          <div className="bg-stoniz-gray-50 rounded-lg p-2">
            <div className="text-[10px] text-stoniz-gray-500 uppercase">Note</div>
            <div className="font-medium text-sm">{ratingAvg != null ? ratingAvg.toFixed(2) + ' /5' : '—'}</div>
            <div className="text-[10px] text-stoniz-gray-400">{reviews} avis</div>
          </div>
          <div className="bg-stoniz-gray-50 rounded-lg p-2">
            <div className="text-[10px] text-stoniz-gray-500 uppercase">CA / nuit</div>
            <div className="font-medium text-sm">
              {nightsOcc > 0 ? `${fmtMoney(ca / nightsOcc)} MAD` : '—'}
            </div>
            <div className="text-[10px] text-stoniz-gray-400">nuits occupées</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PerformanceDashboard({
  rows,
  commissionRates = {},
}: {
  rows: Row[];
  commissionRates?: Record<string, number | null>;
}) {
  const [kpi, setKpi] = useState<KpiKey>('occupancy');
  const [selectedListings, setSelectedListings] = useState<string[]>([]);
  const [filterIds, setFilterIds] = useState<string[]>([]); // [] = tous les logements
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  // Index par (listing_db_id, month)
  const byListing = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of rows) {
      const arr = map.get(r.hostaway_listing_db_id) ?? [];
      arr.push(r);
      map.set(r.hostaway_listing_db_id, arr);
    }
    // tri par month_start asc
    for (const [, arr] of map) {
      arr.sort((a, b) => a.month_start.localeCompare(b.month_start));
    }
    return map;
  }, [rows]);

  const months = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.month_start);
    return Array.from(set).sort();
  }, [rows]);

  const listings = useMemo(() => {
    return Array.from(byListing.keys())
      .map((id) => {
        const r = byListing.get(id)![0];
        return {
          id,
          label: r.unit_code ?? r.listing_name ?? `Listing ${r.hostaway_listing_id}`,
          property_name: r.property_name,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [byListing]);

  // Filtre logements : [] = tous, sinon multi-sélection (dropdown à cases).
  const visibleListings = useMemo(() => {
    if (filterIds.length === 0) return listings;
    return listings.filter((l) => filterIds.includes(l.id));
  }, [listings, filterIds]);

  const visibleRows = useMemo(() => {
    if (filterIds.length === 0) return rows;
    const set = new Set(filterIds);
    return rows.filter((r) => set.has(r.hostaway_listing_db_id));
  }, [rows, filterIds]);

  // Série agrégée par mois sur les logements filtrés.
  const globalSeries = useMemo(() => {
    return months.map((m) => {
      const sameMonth = visibleRows.filter((r) => r.month_start === m);
      const vals = sameMonth
        .map((r) => getKpiValue(r, kpi))
        .filter((v): v is number => v != null);
      if (vals.length === 0) return null;
      // Pour les revenus, on somme. Pour occupation/note, on moyenne.
      if (kpi === 'revenue') {
        return vals.reduce((s, v) => s + v, 0);
      }
      return vals.reduce((s, v) => s + v, 0) / vals.length;
    });
  }, [visibleRows, months, kpi]);

  const selectedSeries = useMemo(() => {
    const palette = ['#dc2626', '#7c3aed', '#0891b2'];
    return selectedListings.slice(0, 3).map((id, i) => {
      const data = byListing.get(id) ?? [];
      const values = months.map((m) => {
        const r = data.find((x) => x.month_start === m);
        return r ? getKpiValue(r, kpi) : null;
      });
      const label = listings.find((l) => l.id === id)?.label ?? '?';
      return { label, values, color: palette[i] };
    });
  }, [selectedListings, byListing, months, kpi, listings]);

  function toggleListing(id: string) {
    setSelectedListings((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return [prev[1], prev[2], id]; // max 3, push out oldest
      return [...prev, id];
    });
  }

  function toggleFilter(id: string) {
    setFilterIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function exportCSV() {
    const unit = kpi === 'revenue' ? ' (MAD)' : '';
    const header = ['Listing', 'Suite', 'Bien', ...months.map((m) => monthLabel(m) + unit)];
    const lines = [header.join(',')];
    for (const l of visibleListings) {
      const data = byListing.get(l.id) ?? [];
      const cells = months.map((m) => {
        const r = data.find((x) => x.month_start === m);
        if (!r) return '';
        if (kpi === 'occupancy') return r.occupancy_rate != null ? (r.occupancy_rate * 100).toFixed(1) + '%' : '';
        if (kpi === 'revenue') return r.revenue != null ? r.revenue.toFixed(2) : '';
        return r.avg_rating != null ? `${r.avg_rating.toFixed(2)} (${r.nb_reviews})` : '';
      });
      const r0 = data[0];
      lines.push([
        `"${r0?.listing_name ?? ''}"`,
        `"${r0?.unit_code ?? ''}"`,
        `"${r0?.property_name ?? ''}"`,
        ...cells,
      ].join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `propria-performance-${kpi}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      {/* Onglets KPI */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2 text-sm">
          {(Object.keys(KPI_LABEL) as KpiKey[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKpi(k)}
              className={`px-4 py-2 rounded-md ${kpi === k ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200 text-stoniz-gray-700'}`}
            >
              {KPI_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          {/* Filtre logements : un seul ou plusieurs (cases à cocher) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setFilterOpen((o) => !o)}
              className={`border px-3 py-1.5 rounded-md text-xs inline-flex items-center gap-1 ${
                filterIds.length > 0
                  ? 'border-stoniz-black bg-stoniz-black text-white'
                  : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'
              }`}
            >
              {filterIds.length === 0
                ? `Logements : tous (${listings.length})`
                : `Logements : ${filterIds.length} sélectionné${filterIds.length > 1 ? 's' : ''}`}
              <ChevronDown className="w-3 h-3" />
            </button>
            {filterOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setFilterOpen(false)} aria-hidden="true" />
                <div className="absolute right-0 mt-1 z-40 bg-white border border-stoniz-gray-200 rounded-md shadow-lg w-72 max-h-80 overflow-y-auto p-2">
                  <button
                    type="button"
                    onClick={() => setFilterIds([])}
                    className="text-[11px] text-blue-600 hover:underline px-1 mb-1"
                  >
                    Réinitialiser (tous les logements)
                  </button>
                  {listings.map((l) => (
                    <label
                      key={l.id}
                      className="flex items-center gap-2 px-1 py-1 text-xs hover:bg-stoniz-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={filterIds.includes(l.id)}
                        onChange={() => toggleFilter(l.id)}
                        className="cursor-pointer"
                      />
                      <span className="font-mono font-medium">{l.label}</span>
                      {l.property_name && (
                        <span className="text-stoniz-gray-400 truncate">{l.property_name}</span>
                      )}
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={exportCSV}
            className="border border-stoniz-gray-300 px-3 py-1.5 rounded-md text-xs hover:bg-stoniz-gray-50 inline-flex items-center gap-1"
          >
            <Download className="w-3 h-3" />
            Exporter CSV
          </button>
        </div>
      </div>

      {/* Graphique principal */}
      <MainChart
        months={months}
        globalSeries={globalSeries}
        globalLabel={
          (kpi === 'revenue' ? 'Total' : 'Moyenne') +
          (filterIds.length > 0 ? ` sélection (${visibleListings.length})` : ' globale')
        }
        selectedSeries={selectedSeries}
        kpi={kpi}
      />

      {selectedSeries.length > 0 && (
        <p className="text-xs text-stoniz-gray-500">
          ↑ Lignes pointillées = suites sélectionnées en comparaison.
        </p>
      )}
      <p className="text-xs text-stoniz-gray-500">
        Coche jusqu'à 3 suites dans le tableau pour les comparer dans le graph.
      </p>

      {/* Tableau pivot */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-stoniz-gray-50 text-stoniz-gray-600 uppercase">
            <tr>
              <th className="px-2 py-2 text-left sticky left-0 bg-stoniz-gray-50 z-10 w-8"></th>
              <th className="px-3 py-2 text-left sticky left-8 bg-stoniz-gray-50 z-10 min-w-[200px]">Suite / Bien</th>
              {months.map((m) => (
                <th key={m} className="px-2 py-2 text-right whitespace-nowrap">{monthLabel(m)}</th>
              ))}
              <th className="px-3 py-2 text-center whitespace-nowrap">Tendance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visibleListings.map((l) => {
              const data = byListing.get(l.id) ?? [];
              const dataMap = new Map(data.map((r) => [r.month_start, r]));
              const series = months.map((m) => {
                const r = dataMap.get(m);
                if (!r) return null;
                return getKpiValue(r, kpi);
              });
              const checked = selectedListings.includes(l.id);
              return (
                <tr key={l.id} className={`hover:bg-stoniz-gray-50 ${checked ? 'bg-blue-50/50' : ''}`}>
                  <td className="px-2 py-1.5 sticky left-0 bg-inherit z-10">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleListing(l.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  <td className="px-3 py-1.5 sticky left-8 bg-inherit z-10">
                    <button
                      type="button"
                      onClick={() => setDetailId(l.id)}
                      className="text-left hover:underline"
                      title="Voir le détail financier du logement"
                    >
                      <div className="font-mono font-medium">{l.label}</div>
                      {l.property_name && (
                        <div className="text-[10px] text-stoniz-gray-500 truncate max-w-[180px]">{l.property_name}</div>
                      )}
                    </button>
                  </td>
                  {months.map((m, i) => {
                    const r = dataMap.get(m);
                    const current = r ? getKpiValue(r, kpi) : null;
                    const prev = i > 0 ? (dataMap.get(months[i - 1]) ? getKpiValue(dataMap.get(months[i - 1])!, kpi) : null) : null;
                    return (
                      <td key={m} className="px-2 py-1.5 text-right whitespace-nowrap">
                        <span className="inline-flex items-center justify-end">
                          <span className={current != null && current > 0 ? '' : 'text-stoniz-gray-400'}>
                            {r ? formatKpiCell(r, kpi) : '—'}
                          </span>
                          {i > 0 && <TrendIndicator current={current} previous={prev} />}
                        </span>
                      </td>
                    );
                  })}
                  <td className="px-3 py-1.5 text-center">
                    <Sparkline values={series} color={KPI_COLOR[kpi]} />
                  </td>
                </tr>
              );
            })}
            {visibleListings.length === 0 && (
              <tr><td colSpan={months.length + 3} className="px-3 py-6 text-center text-stoniz-gray-500">
                {listings.length === 0 ? 'Aucun listing Hostaway syncé.' : 'Aucun logement dans la sélection.'}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-stoniz-gray-500">
        Clique sur le nom d'un logement pour ouvrir son détail financier 12 mois.
      </p>

      {/* Panneau détail logement */}
      {detailId && (
        <ListingDetailPanel
          label={listings.find((l) => l.id === detailId)?.label ?? '?'}
          data={byListing.get(detailId) ?? []}
          commissionRate={(() => {
            const pid = (byListing.get(detailId) ?? [])[0]?.property_id;
            return pid ? commissionRates[pid] : null;
          })()}
          onClose={() => setDetailId(null)}
        />
      )}
    </div>
  );
}
