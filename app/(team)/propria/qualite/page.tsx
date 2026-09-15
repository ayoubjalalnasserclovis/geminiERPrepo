import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { getUnitQualityRows, type QualityPeriod } from '@/lib/propria/quality-score';
import { getZoneCDPercentage } from '@/lib/propria/checkups-query';
import { QualityTable } from '@/components/propria/quality-table';

/**
 * Page « Pilotage qualité » (chantier 11.c marathon — consultant U5/U20/U30).
 *
 * Vue consolidée PAR LOT : note voyageurs (période 30j/90j/12m), préventifs
 * négatifs ouverts, litiges en cours, fraîcheur ménage / deep cleaning /
 * check-up / maintenance préventive, et score qualité /100 — TOUT dérivé à la
 * lecture par lib/propria/quality-score.ts (convention n°1 : rien n'est
 * stocké). Tri : pires scores en premier. Ligne cliquable → fiche bien.
 */
export default async function PropriaQualitePage({
  searchParams,
}: {
  searchParams: { periode?: string };
}) {
  await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const period: QualityPeriod = (['30j', '90j', '12m'] as const).includes(
    searchParams.periode as any,
  )
    ? (searchParams.periode as QualityPeriod)
    : '90j';

  const [rows, zoneCD] = await Promise.all([
    getUnitQualityRows(supabase, period),
    getZoneCDPercentage(supabase),
  ]);

  const scores = rows.map((r) => r.score);
  const avgScore = scores.length
    ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
    : null;
  const nbCritical = rows.filter((r) => r.score < 60).length;
  const nbLateGauges = rows.filter(
    (r) =>
      r.cleaningStatus === 'late' ||
      r.checkupStatus === 'late' ||
      r.deepCleaningStatus === 'late' ||
      r.maintenanceStatus === 'late',
  ).length;

  return (
    <div className="max-w-[1400px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · Qualité'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-2">🎯 Pilotage qualité</h1>
      <p className="text-sm text-stoniz-gray-600 mb-2">
        Score qualité consolidé par lot — calculé à la lecture depuis les avis, ménages,
        check-ups, litiges et préventifs. Les pires lots sont en haut : c&apos;est la liste de travail.
      </p>
      <p className="text-xs text-stoniz-gray-500 mb-6">
        ℹ️ La <strong>période</strong> ne filtre que la <strong>note voyageurs</strong> — ménages,
        check-ups, litiges et préventifs sont toujours évalués à l&apos;instant T (et non sur la
        fenêtre choisie), pour refléter l&apos;état actuel du parc.
      </p>

      {/* KPI synthèse */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Score moyen</div>
          <div className="text-2xl font-display mt-1">
            {avgScore != null ? `${avgScore} /100` : '—'}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">{rows.length} lots actifs sous gestion</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Lots en zone rouge (&lt; 60)</div>
          <div className={`text-2xl font-display mt-1 ${nbCritical > 0 ? 'text-red-600' : ''}`}>
            {nbCritical}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">à traiter en priorité</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Lots avec une jauge 🔴</div>
          <div className={`text-2xl font-display mt-1 ${nbLateGauges > 0 ? 'text-red-600' : ''}`}>
            {nbLateGauges}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">ménage, deep cleaning, check-up ou maintenance en retard</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Parc en zone C/D (90j)</div>
          <div className={`text-2xl font-display mt-1 ${
            zoneCD.pct != null && zoneCD.pct >= 30 ? 'text-red-600' : ''
          }`}>
            {zoneCD.pct != null ? `${zoneCD.pct} %` : '—'}
          </div>
          <div className="text-[10px] text-stoniz-gray-400">
            {zoneCD.denominator > 0
              ? `${zoneCD.numerator} / ${zoneCD.denominator} biens dernier check-up classé C/D`
              : 'aucun check-up validé sur 90j'}
          </div>
        </div>
      </div>

      <QualityTable rows={rows} period={period} />
    </div>
  );
}
