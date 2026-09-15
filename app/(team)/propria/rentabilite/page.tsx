import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { madToEur } from '@/lib/finance/fx-fixed';
import { CLEANING_CATEGORY_META } from '@/lib/propria/cleaning-categories';
import {
  COST_PERIODS,
  getUnitProfitabilityRows,
  type CostPeriod,
  type UnitProfitabilityRow,
} from '@/lib/propria/cost-matrix';

/**
 * Dashboard « Rentabilité réelle par lot » (chantier 15 — U24/U25, CEO B7).
 *
 * Par lot sur la période : revenus (résas Hostaway prorata nuits + upsell
 * confirmé/livré), coûts (ménages clôturés valorisés par la matrice de coûts
 * À LA DATE de chaque ménage + interventions cost_propria_mad), marge brute
 * MAD (≈ €), et charge de gestion (U25 : nb d'actions traitées — PROXY, on ne
 * mesure pas encore le temps réel ; la marge/action sert à COMPARER les lots).
 *
 * Tant que les coûts unitaires ne sont pas saisis dans /propria/couts, les
 * colonnes coûts affichent « — » (jamais de faux zéro) et un bandeau l'explique.
 * Rouge réservé aux marges négatives réelles.
 */

function fmtMad(v: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(v);
}

function Mad({ value, red }: { value: number | null; red?: boolean }) {
  if (value == null) {
    return <span className="text-stoniz-gray-400" title="En attente de données — coûts unitaires non saisis">—</span>;
  }
  return (
    <span className={red && value < 0 ? 'text-red-600 font-medium' : ''}>
      {fmtMad(value)}
    </span>
  );
}

function cleaningsTooltip(row: UnitProfitabilityRow): string {
  const parts: string[] = [];
  for (const [cat, v] of Object.entries(row.cleaningsByCategory)) {
    const meta = CLEANING_CATEGORY_META[cat as keyof typeof CLEANING_CATEGORY_META];
    parts.push(
      `${meta?.label ?? cat} : ${v.count} ménage(s)${v.costMad != null ? ` · ${fmtMad(v.costMad)} MAD` : ' · non chiffré'}`,
    );
  }
  return parts.join('\n') || 'Aucun ménage clôturé sur la période';
}

export default async function PropriaRentabilitePage({
  searchParams,
}: {
  searchParams: { periode?: string };
}) {
  await requireRole(['ceo', 'developer']);
  const supabase = createClient();

  const period: CostPeriod = (['30j', '90j', '12m'] as const).includes(searchParams.periode as any)
    ? (searchParams.periode as CostPeriod)
    : '30j';

  const { rows, hasCostParams } = await getUnitProfitabilityRows(supabase, period);

  const totalRevenue = rows.reduce((s, r) => s + r.revenueTotalMad, 0);
  const anyCosts = rows.some((r) => r.costsTotalMad != null);
  const totalCosts = anyCosts
    ? rows.reduce((s, r) => s + (r.costsTotalMad ?? 0), 0)
    : null;
  const totalMarge = totalCosts != null ? totalRevenue - totalCosts : null;
  const nbNegative = rows.filter((r) => r.margeBruteMad != null && r.margeBruteMad < 0).length;

  return (
    <div className="max-w-[1400px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Rentabilité'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-2">💰 Rentabilité par lot</h1>
      <p className="text-sm text-stoniz-gray-600 mb-4">
        Revenus (réservations + upsell) − coûts réels (ménages valorisés par la matrice de
        coûts à la date de chaque ménage + interventions). Tout est dérivé à la lecture,
        rien n’est stocké.
      </p>

      {/* Sélecteur de période */}
      <div className="flex gap-2 mb-4">
        {COST_PERIODS.map((p) => (
          <Link
            key={p.value}
            href={`/propria/rentabilite?periode=${p.value}`}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              p.value === period
                ? 'bg-stoniz-black text-white border-stoniz-black'
                : 'bg-white text-stoniz-gray-600 border-stoniz-gray-200 hover:border-stoniz-gray-400'
            }`}
          >
            {p.label}
          </Link>
        ))}
      </div>

      {!hasCostParams && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-md px-3 py-2 text-sm mb-6">
          ⏳ <strong>Dashboard en attente de données</strong> : aucun coût unitaire n’est saisi.
          Les colonnes coûts et marge affichent « — » (pas de faux zéro).{' '}
          <Link href="/propria/couts" className="underline font-medium">
            Saisis les coûts unitaires dans /propria/couts →
          </Link>
        </div>
      )}

      {/* KPI synthèse */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Revenus · {COST_PERIODS.find((p) => p.value === period)?.label}</div>
          <div className="text-2xl font-display mt-1">
            {fmtMad(totalRevenue)} <span className="text-sm text-stoniz-gray-400">MAD</span>
          </div>
          <div className="text-[10px] text-stoniz-gray-400">
            ≈ {fmtMad(madToEur(totalRevenue))} € · résas (prorata nuits) + upsell confirmé/livré
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Coûts</div>
          <div className="text-2xl font-display mt-1">
            {totalCosts != null ? (
              <>{fmtMad(totalCosts)} <span className="text-sm text-stoniz-gray-400">MAD</span></>
            ) : (
              <span className="text-stoniz-gray-300">—</span>
            )}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">
            {totalCosts != null
              ? `≈ ${fmtMad(madToEur(totalCosts))} € · ménages + interventions`
              : 'en attente des coûts unitaires'}
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Marge brute</div>
          <div className={`text-2xl font-display mt-1 ${totalMarge != null && totalMarge < 0 ? 'text-red-600' : ''}`}>
            {totalMarge != null ? (
              <>{fmtMad(totalMarge)} <span className="text-sm text-stoniz-gray-400">MAD</span></>
            ) : (
              <span className="text-stoniz-gray-300">—</span>
            )}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">
            {totalMarge != null
              ? `≈ ${fmtMad(madToEur(totalMarge))} €${nbNegative > 0 ? ` · ${nbNegative} lot(s) en marge négative` : ''}`
              : 'en attente des coûts unitaires'}
          </div>
        </div>
      </div>

      {/* Tableau par lot */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-3 text-left">Lot</th>
              <th className="px-3 py-3 text-right">Résas (MAD)</th>
              <th className="px-3 py-3 text-right">Upsell (MAD)</th>
              <th className="px-3 py-3 text-right" title="Ménages clôturés valorisés par la matrice de coûts, décomposés par catégorie (info-bulle par ligne)">Ménages (MAD)</th>
              <th className="px-3 py-3 text-right">Interventions (MAD)</th>
              <th className="px-3 py-3 text-right">Marge brute</th>
              <th className="px-3 py-3 text-right" title="Proxy charge de gestion (U25) : ménages + interventions + tâches + litiges + maintenances de la période">Actions</th>
              <th className="px-3 py-3 text-right" title="Marge brute ÷ nb actions — indicateur RELATIF pour comparer les lots (on ne mesure pas encore le temps réel)">Marge / action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-xs text-stoniz-gray-400">
                  Aucun lot actif sous gestion Propria.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.unitId} className="hover:bg-stoniz-gray-50">
                <td className="px-3 py-2">
                  <Link href={`/propria/biens/${r.propertyId}`} className="hover:underline font-medium">
                    {r.label}
                  </Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMad(r.revenueResasMad)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{fmtMad(r.revenueUpsellMad)}</td>
                <td className="px-3 py-2 text-right tabular-nums" title={cleaningsTooltip(r)}>
                  <Mad value={r.cleaningsCostMad} />
                  <span className="text-[10px] text-stoniz-gray-400 ml-1">
                    ({r.cleaningsCount}{r.cleaningsCostPartial ? ' · partiel' : ''})
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {fmtMad(r.interventionsCostMad)}
                  <span className="text-[10px] text-stoniz-gray-400 ml-1">
                    ({r.interventionsCount}{r.interventionsWithoutCost > 0 ? ` · ${r.interventionsWithoutCost} non chiffrée(s)` : ''})
                  </span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Mad value={r.margeBruteMad} red />
                  {r.margeBruteMad != null && (
                    <div className="text-[10px] text-stoniz-gray-400">≈ {fmtMad(madToEur(r.margeBruteMad))} €</div>
                  )}
                </td>
                <td
                  className="px-3 py-2 text-right tabular-nums"
                  title={`Ménages ${r.actionsDetail.menages} · Interventions ${r.actionsDetail.interventions} · Tâches ${r.actionsDetail.taches} · Litiges ${r.actionsDetail.litiges} · Maintenances ${r.actionsDetail.maintenance}`}
                >
                  {r.actionsCount}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  <Mad value={r.margePerActionMad} red />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-stoniz-gray-400 mt-3">
        « Marge / action » est un indicateur <strong>relatif</strong> de rentabilité par unité de
        gestion (U25) : on compte les actions traitées (ménages, interventions, tâches, litiges,
        maintenances), pas le temps réel passé — il sert à comparer les lots entre eux, pas à
        calculer un coût horaire. Coûts ménage : paramètres historisés{' '}
        <Link href="/propria/couts" className="underline">/propria/couts</Link>, appliqués à la date
        de chaque ménage. MAD opérationnel, ≈ € au taux interne fixe (10 DH = 1 €).
      </p>
    </div>
  );
}
