import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { ArrowLeft, TrendingUp, TrendingDown, Calendar, Wrench, User } from 'lucide-react';
import { collectTravauxPerformance } from '@/lib/dashboard/travaux-performance';
import { MarginHistogram } from '@/components/dashboard/margin-histogram';
import { GanttRow } from '@/components/dashboard/gantt-row';

/**
 * Page Performance Travaux (CEO 2026-06-17).
 * Vue stratégique : chefs de projet, artisans, Gantt, distribution marges,
 * évolution mois.
 */

function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

export default async function PerformancePage() {
  await requireRole(['ceo', 'developer', 'finance', 'chef_projet']);
  const data = await collectTravauxPerformance();

  return (
    <div className="space-y-8">
      <Link
        href="/dashboard/travaux"
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour au dashboard travaux
      </Link>

      <PageHeader
        title="Performance travaux"
        description="Vue stratégique : équipe, artisans, calendrier et distribution des marges"
      />

      {/* ─── KPI évolution délai mois ─── */}
      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3">
          <Calendar className="w-4 h-4 text-stoniz-gray-600" />
          <h3 className="text-sm font-medium">Évolution délai moyen chantier</h3>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stoniz-gray-500">Mois en cours</div>
            <div className="text-2xl font-display mt-0.5">
              {data.monthlyDelay.current != null ? `${data.monthlyDelay.current} j` : '—'}
            </div>
            <div className="text-[10px] text-stoniz-gray-500 mt-0.5">Chantiers livrés ce mois</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stoniz-gray-500">Mois précédent</div>
            <div className="text-2xl font-display mt-0.5">
              {data.monthlyDelay.previous != null ? `${data.monthlyDelay.previous} j` : '—'}
            </div>
            <div className="text-[10px] text-stoniz-gray-500 mt-0.5">Chantiers livrés mois dernier</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wide text-stoniz-gray-500">Évolution</div>
            <div className={`text-2xl font-display mt-0.5 inline-flex items-center gap-1 ${
              data.monthlyDelay.deltaPct == null ? 'text-stoniz-gray-400'
              : data.monthlyDelay.deltaPct > 0 ? 'text-red-700' : 'text-emerald-700'
            }`}>
              {data.monthlyDelay.deltaPct == null ? '—' : `${data.monthlyDelay.deltaPct >= 0 ? '+' : ''}${data.monthlyDelay.deltaPct}%`}
              {data.monthlyDelay.deltaPct != null && (
                data.monthlyDelay.deltaPct > 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />
              )}
            </div>
            <div className="text-[10px] text-stoniz-gray-500 mt-0.5">
              {data.monthlyDelay.deltaPct == null
                ? 'Pas assez de données'
                : data.monthlyDelay.deltaPct > 0 ? 'Chantiers plus longs ce mois' : 'Chantiers plus rapides ce mois'}
            </div>
          </div>
        </div>
      </Card>

      {/* ─── Distribution marges ─── */}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
          📊 Distribution des marges (par projet)
        </h3>
        <MarginHistogram buckets={data.marginBuckets} />
      </Card>

      {/* ─── Performance chefs de projet ─── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <User className="w-4 h-4 text-stoniz-gray-600" />
          <h3 className="text-sm font-medium">Performance chefs de projet</h3>
        </div>
        {data.chefs.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500 italic">Aucun projet avec chef assigné.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <th className="text-left py-2 px-2">Chef</th>
                  <th className="text-right py-2 px-2">Projets actifs</th>
                  <th className="text-right py-2 px-2">Terminés</th>
                  <th className="text-right py-2 px-2">Volume géré</th>
                  <th className="text-right py-2 px-2">Marge moyenne</th>
                  <th className="text-right py-2 px-2">Délai moyen</th>
                  <th className="text-right py-2 px-2">Livré à temps</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.chefs.map((c) => (
                  <tr key={c.chef_id} className="hover:bg-stoniz-gray-50">
                    <td className="py-2 px-2 font-medium">{c.chef_name}</td>
                    <td className="text-right py-2 px-2">{c.nb_actifs}</td>
                    <td className="text-right py-2 px-2">{c.nb_termines}</td>
                    <td className="text-right py-2 px-2 font-mono">{fmtMad(c.volume_total_mad)}</td>
                    <td className={`text-right py-2 px-2 ${c.marge_moyenne_pct < 20 ? 'text-amber-700' : c.marge_moyenne_pct < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {c.marge_moyenne_pct}%
                    </td>
                    <td className="text-right py-2 px-2">
                      {c.delai_moyen_jours != null ? `${c.delai_moyen_jours} j` : <span className="text-stoniz-gray-400">—</span>}
                    </td>
                    <td className="text-right py-2 px-2">
                      {c.taux_livre_a_temps_pct != null ? (
                        <span className={c.taux_livre_a_temps_pct >= 80 ? 'text-emerald-700' : 'text-amber-700'}>
                          {c.taux_livre_a_temps_pct}%
                        </span>
                      ) : <span className="text-stoniz-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Performance artisans ─── */}
      <Card className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Wrench className="w-4 h-4 text-stoniz-gray-600" />
          <h3 className="text-sm font-medium">Top artisans · {data.artisans.length}</h3>
        </div>
        {data.artisans.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500 italic">Aucun lot artisan.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <th className="text-left py-2 px-2">Artisan / Fournisseur</th>
                  <th className="text-right py-2 px-2">Lots</th>
                  <th className="text-right py-2 px-2">Volume devis</th>
                  <th className="text-right py-2 px-2">Marge contribuée</th>
                  <th className="text-right py-2 px-2">Marge %</th>
                  <th className="text-right py-2 px-2">Retard</th>
                  <th className="text-right py-2 px-2">Docs OK</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.artisans.map((a) => (
                  <tr key={`${a.artisan_id ?? ''}-${a.artisan_name}`} className="hover:bg-stoniz-gray-50">
                    <td className="py-2 px-2">
                      {a.artisan_id ? (
                        <Link href={`/artisans/${a.artisan_id}`} className="hover:underline">{a.artisan_name}</Link>
                      ) : (
                        <span>{a.artisan_name}</span>
                      )}
                    </td>
                    <td className="text-right py-2 px-2">{a.nb_lots}</td>
                    <td className="text-right py-2 px-2 font-mono">{fmtMad(a.volume_total_mad)}</td>
                    <td className={`text-right py-2 px-2 font-mono ${a.marge_contribuee_mad < 0 ? 'text-red-700' : ''}`}>
                      {fmtMad(a.marge_contribuee_mad)}
                    </td>
                    <td className={`text-right py-2 px-2 ${a.marge_pct < 0 ? 'text-red-700' : a.marge_pct < 20 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {a.marge_pct}%
                    </td>
                    <td className={`text-right py-2 px-2 ${a.taux_retard_pct > 30 ? 'text-red-700' : a.taux_retard_pct > 10 ? 'text-amber-700' : ''}`}>
                      {a.taux_retard_pct}%
                    </td>
                    <td className={`text-right py-2 px-2 ${a.doc_compliance_pct < 60 ? 'text-red-700' : a.doc_compliance_pct < 80 ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {a.doc_compliance_pct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ─── Gantt chantiers actifs ─── */}
      <Card className="p-4">
        <h3 className="text-sm font-medium mb-3 inline-flex items-center gap-2">
          📅 Calendrier chantiers actifs · {data.gantt.length}
        </h3>
        {data.gantt.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500 italic">Aucun chantier actif avec dates renseignées.</p>
        ) : (
          <div className="space-y-1">
            {/* Calcule l'échelle commune : min start, max end / today + 90j */}
            {(() => {
              const allDates: string[] = [];
              for (const g of data.gantt) {
                if (g.start_date) allDates.push(g.start_date);
                if (g.end_date) allDates.push(g.end_date);
              }
              if (allDates.length === 0) return null;
              const todayIso = new Date().toISOString().slice(0, 10);
              allDates.push(todayIso);
              const minDate = allDates.reduce((m, d) => (d < m ? d : m), allDates[0]);
              const maxDate = allDates.reduce((m, d) => (d > m ? d : m), allDates[0]);
              return (
                <>
                  <div className="text-[10px] text-stoniz-gray-500 mb-2 flex justify-between">
                    <span>Échelle : {minDate}</span>
                    <span>aujourd'hui</span>
                    <span>{maxDate}</span>
                  </div>
                  {data.gantt.map((g) => (
                    <GanttRow key={g.id} project={g} minDate={minDate} maxDate={maxDate} todayIso={todayIso} />
                  ))}
                </>
              );
            })()}
          </div>
        )}
      </Card>
    </div>
  );
}
