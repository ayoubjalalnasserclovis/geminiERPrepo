'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { UnitQualityRow, Freshness, QualityPeriod } from '@/lib/propria/quality-score';

/**
 * Tableau « Pilotage qualité » par lot (chantier 11.c — U5/U20/U30).
 * - Période (30j/90j/12m) : recharge serveur (la fenêtre des avis change).
 * - Filtre bien : côté client (les lignes sont déjà chargées).
 * - Ligne cliquable → fiche bien. Tri serveur : score croissant (pires en haut).
 * Tout est DÉRIVÉ par lib/propria/quality-score.ts — rien n'est stocké.
 */

const PERIODS: { value: QualityPeriod; label: string }[] = [
  { value: '30j', label: '30 j' },
  { value: '90j', label: '90 j' },
  { value: '12m', label: '12 mois' },
];

const FRESHNESS_DOT: Record<Freshness, string> = {
  recent: '🟢',
  soon: '🟠',
  late: '🔴',
  none: '⚪',
};

const FRESHNESS_TITLE: Record<Freshness, string> = {
  recent: 'Récent',
  soon: 'Bientôt nécessaire',
  late: 'En retard',
  none: 'Pas de donnée',
};

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR');
}

function FreshCell({ status, date, extra }: { status: Freshness; date: string | null; extra?: string }) {
  return (
    <span className="whitespace-nowrap" title={FRESHNESS_TITLE[status]}>
      <span className="mr-1">{FRESHNESS_DOT[status]}</span>
      <span className={date ? '' : 'text-stoniz-gray-400'}>{fmtDate(date)}</span>
      {extra && <span className="text-[10px] text-stoniz-gray-500 ml-1">{extra}</span>}
    </span>
  );
}

function scoreBadge(score: number): string {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800';
  if (score >= 60) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

export function QualityTable({
  rows,
  period,
}: {
  rows: UnitQualityRow[];
  period: QualityPeriod;
}) {
  const router = useRouter();
  const [propertyFilter, setPropertyFilter] = useState<string>('');

  const bienOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows) if (!map.has(r.propertyId)) map.set(r.propertyId, r.bienLabel);
    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  const visible = propertyFilter ? rows.filter((r) => r.propertyId === propertyFilter) : rows;

  return (
    <div>
      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex rounded-md border border-stoniz-gray-300 overflow-hidden">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              onClick={() => router.push(`/propria/qualite?periode=${p.value}`)}
              className={`px-3 py-1.5 text-xs ${
                p.value === period
                  ? 'bg-stoniz-black text-white'
                  : 'bg-white text-stoniz-gray-700 hover:bg-stoniz-gray-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <select
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
          className="border border-stoniz-gray-300 rounded-md px-3 py-1.5 text-xs bg-white"
        >
          <option value="">Tous les biens</option>
          {bienOptions.map((b) => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
        <span className="text-xs text-stoniz-gray-500">
          {visible.length} lot{visible.length > 1 ? 's' : ''} · note moyenne sur la période choisie · pires scores en premier
        </span>
      </div>

      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-stoniz-gray-500 border-b border-stoniz-gray-200">
              <th className="px-3 py-2.5">Lot</th>
              <th className="px-3 py-2.5">Score /100</th>
              <th className="px-3 py-2.5">Note voyageurs</th>
              <th className="px-3 py-2.5">Préventifs nég.</th>
              <th className="px-3 py-2.5">Litiges en cours</th>
              <th className="px-3 py-2.5">Dernier ménage validé</th>
              <th className="px-3 py-2.5">Dernier deep cleaning</th>
              <th className="px-3 py-2.5">Dernier check-up validé</th>
              <th className="px-3 py-2.5">Dernière maintenance</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-stoniz-gray-500 text-sm">
                  Aucun lot actif sous gestion Propria.
                </td>
              </tr>
            )}
            {visible.map((r) => (
              <tr
                key={r.unitId}
                onClick={() => router.push(`/propria/biens/${r.propertyId}`)}
                className="border-b border-stoniz-gray-100 last:border-b-0 hover:bg-stoniz-gray-50 cursor-pointer"
                title="Ouvrir la fiche bien"
              >
                <td className="px-3 py-2.5 font-medium whitespace-nowrap">{r.label}</td>
                <td className="px-3 py-2.5">
                  <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${scoreBadge(r.score)}`}>
                    {r.score}
                  </span>
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {r.avgRating != null ? (
                    <>
                      <span className={r.avgRating < 4.5 ? 'text-red-700 font-medium' : ''}>
                        {r.avgRating.toFixed(2)} /5
                      </span>
                      <span className="text-[10px] text-stoniz-gray-500 ml-1">({r.nbReviews} avis)</span>
                    </>
                  ) : (
                    <span className="text-stoniz-gray-400">— aucun avis</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.openNegativePreReviews > 0 ? (
                    <span className="text-orange-700 font-medium">⚠ {r.openNegativePreReviews}</span>
                  ) : (
                    <span className="text-stoniz-gray-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {r.openLitiges > 0 ? (
                    <span className="text-red-700 font-medium">⚠ {r.openLitiges}</span>
                  ) : (
                    <span className="text-stoniz-gray-400">0</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <FreshCell status={r.cleaningStatus} date={r.lastCleaningAt} />
                </td>
                <td className="px-3 py-2.5">
                  <FreshCell
                    status={r.deepCleaningStatus}
                    date={r.lastDeepCleaningAt}
                    extra={r.staysSinceDeepCleaning != null ? `${r.staysSinceDeepCleaning} séjour(s) depuis` : undefined}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <FreshCell
                    status={r.checkupStatus}
                    date={r.lastCheckupAt}
                    extra={r.checkupDaysLate != null && r.checkupDaysLate > 0 ? `retard ${r.checkupDaysLate} j` : undefined}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <FreshCell status={r.maintenanceStatus} date={r.lastMaintenanceAt} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-stoniz-gray-500 mt-3">
        Score /100 dérivé à la lecture (rien n&apos;est stocké) : note voyageurs 40 % · fraîcheur
        ménage 15 % · check-up à jour 15 % · litiges 15 % (−5 pts/litige ouvert) · préventifs
        négatifs 15 % (−5 pts/préventif ouvert). Les composantes sans donnée sont neutres
        (score renormalisé). Jauges : 🟢 récent · 🟠 bientôt nécessaire · 🔴 en retard · ⚪ pas de donnée.
      </p>
    </div>
  );
}
