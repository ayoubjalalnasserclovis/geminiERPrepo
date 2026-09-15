import Link from 'next/link';
import { Gauge } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getUnitQualityRows, type Freshness } from '@/lib/propria/quality-score';

/**
 * Section « Pilotage qualité » de la fiche bien Propria (chantier 11.c).
 * Score consolidé du bien (moyenne des scores de ses lots — DÉRIVÉ, jamais
 * stocké) + les 5 dates clés par lot avec jauges 🟢🟠🔴 : dernier ménage
 * validé, dernier contrôle bureau (tâche canon 11.b clôturée), dernier
 * check-up validé, dernière maintenance préventive, dernier deep cleaning.
 * Réutilise lib/propria/quality-score.ts (mêmes calculs que /propria/qualite).
 * Server Component.
 */

const DOT: Record<Freshness, string> = { recent: '🟢', soon: '🟠', late: '🔴', none: '⚪' };
const DOT_TITLE: Record<Freshness, string> = {
  recent: 'Récent', soon: 'Bientôt nécessaire', late: 'En retard', none: 'Pas de donnée',
};

function fmt(iso: string | null): string {
  return iso ? new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR') : '—';
}

function DateChip({
  label, date, status,
}: { label: string; date: string | null; status?: Freshness }) {
  return (
    <div className="border border-stoniz-gray-200 rounded-lg px-2.5 py-1.5">
      <div className="text-[10px] text-stoniz-gray-500">{label}</div>
      <div className="text-xs whitespace-nowrap" title={status ? DOT_TITLE[status] : undefined}>
        {status && <span className="mr-1">{DOT[status]}</span>}
        <span className={date ? '' : 'text-stoniz-gray-400'}>{fmt(date)}</span>
      </div>
    </div>
  );
}

function scoreBadge(score: number): string {
  if (score >= 80) return 'bg-emerald-100 text-emerald-800';
  if (score >= 60) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

export async function PropriaBienQualitySection({ propertyId }: { propertyId: string }) {
  const supabase = createClient();
  const rows = await getUnitQualityRows(supabase, '90j', propertyId);

  if (rows.length === 0) return null;

  // Score consolidé du bien = moyenne des scores de ses lots (dérivé)
  const bienScore = Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length);

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mt-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg inline-flex items-center gap-2">
          <Gauge className="w-4 h-4 text-stoniz-gray-500" /> Pilotage qualité
        </h2>
        <div className="flex items-center gap-3">
          <span
            className={`text-xs font-medium px-2.5 py-1 rounded-full ${scoreBadge(bienScore)}`}
            title="Score consolidé du bien = moyenne des scores de ses lots (notes 90 j) — dérivé à la lecture, jamais stocké"
          >
            Score bien : {bienScore} /100
          </span>
          <Link href="/propria/qualite" className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">
            Vue qualité →
          </Link>
        </div>
      </div>

      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.unitId} className="border border-stoniz-gray-200 rounded-lg p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
              <span className="text-sm font-medium">{r.label}</span>
              <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${scoreBadge(r.score)}`}>
                {r.score} /100
              </span>
              {r.avgRating != null ? (
                <span className="text-xs text-stoniz-gray-600">
                  ★ {r.avgRating.toFixed(2)} /5 ({r.nbReviews} avis · 90 j)
                </span>
              ) : (
                <span className="text-xs text-stoniz-gray-400">aucun avis sur 90 j</span>
              )}
              {r.openLitiges > 0 && (
                <span className="text-xs text-red-700">⚠ {r.openLitiges} litige(s) en cours</span>
              )}
              {r.openNegativePreReviews > 0 && (
                <span className="text-xs text-orange-700">⚠ {r.openNegativePreReviews} préventif(s) négatif(s)</span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              <DateChip label="Dernier ménage validé" date={r.lastCleaningAt} status={r.cleaningStatus} />
              <DateChip label="Dernier contrôle bureau" date={r.lastBureauControlAt} />
              <DateChip label="Dernier check-up validé" date={r.lastCheckupAt} status={r.checkupStatus} />
              <DateChip label="Dernière maintenance" date={r.lastMaintenanceAt} status={r.maintenanceStatus} />
              <DateChip label="Dernier deep cleaning" date={r.lastDeepCleaningAt} status={r.deepCleaningStatus} />
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-stoniz-gray-400 mt-3">
        Jauges : 🟢 récent · 🟠 bientôt nécessaire · 🔴 en retard · ⚪ pas de donnée.
        Score dérivé à la lecture (avis 40 % · ménage 15 % · check-up 15 % · litiges 15 % · préventifs 15 %).
      </p>
    </div>
  );
}
