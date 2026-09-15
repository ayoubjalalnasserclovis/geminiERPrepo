import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { PauseCircle, XCircle, Euro, Clock, BookOpen } from 'lucide-react';

/**
 * Section KPI lifecycle pour le dashboard CEO.
 * 6 indicateurs validés Phase 2 §2.8 :
 *   1. Taux de pause / mois (12 mois glissants)
 *   2. Taux de perdus / source (camembert raisons)
 *   3. Manque à gagner cumulé (workflow only)
 *   4. Top raisons de perte
 *   5. Durée moyenne en pause avant reprise
 *   6. Dernières leçons apprises
 *
 * Toutes les KPI excluent legacy_imported = true.
 */

const PAUSE_REASON_LABELS: Record<string, string> = {
  financement_attendu: 'Financement attendu',
  sourcing_bloque: 'Sourcing bloqué',
  client_indisponible: 'Client indisponible',
  litige_partenaire: 'Litige partenaire',
  autre: 'Autre',
};

const LOST_REASON_LABELS: Record<string, string> = {
  client_retire: 'Client retiré',
  concurrent: 'Concurrent',
  desaccord_contractuel: 'Désaccord',
  qualite_reprochee: 'Qualité',
  delai_excessif: 'Délai',
  defaut_financement: 'Défaut finance',
  autre: 'Autre',
};

function formatMoney(amount: number): string {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount);
}

export async function LifecycleKpiSection() {
  const supabase = createClient();
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const cutoff = twelveMonthsAgo.toISOString();

  // 1. Compte projets actifs + en pause + perdus (workflow only)
  const { data: counts } = await supabase
    .from('projects')
    .select('id, status, paused_at, resumed_at, lost_revenue_amount')
    .eq('legacy_imported', false)
    .is('deleted_at', null);

  const projectsActifs = (counts ?? []).filter((p: any) => p.status === 'actif').length;
  const projectsPause = (counts ?? []).filter((p: any) => p.status === 'pause').length;
  const projectsPerdus = (counts ?? []).filter((p: any) => p.status === 'perdu').length;
  const totalNonLegacy = (counts ?? []).length;

  const pauseRate = totalNonLegacy > 0
    ? ((projectsPause / totalNonLegacy) * 100).toFixed(1)
    : '0.0';
  const lostRate = totalNonLegacy > 0
    ? ((projectsPerdus / totalNonLegacy) * 100).toFixed(1)
    : '0.0';

  // 2. Manque à gagner cumulé (workflow only)
  const manqueAGagner = (counts ?? [])
    .filter((p: any) => p.status === 'perdu' && p.lost_revenue_amount)
    .reduce((sum: number, p: any) => sum + Number(p.lost_revenue_amount ?? 0), 0);

  // 3. Top raisons de perte (12 mois glissants)
  const { data: lostTransitions } = await supabase
    .from('project_lifecycle_transition')
    .select('lost_reason_code_v')
    .eq('to_status', 'perdu')
    .eq('workflow_status', 'approved')
    .gte('validated_at', cutoff);

  const lostReasonCounts = (lostTransitions ?? []).reduce((acc: Record<string, number>, t: any) => {
    const k = t.lost_reason_code_v ?? 'autre';
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});
  const topLostReasons = Object.entries(lostReasonCounts)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5);

  // 4. Durée moyenne en pause avant reprise (en jours)
  const { data: resumes } = await supabase
    .from('project_lifecycle_transition')
    .select('project_id, validated_at')
    .eq('to_status', 'actif')
    .eq('from_status', 'pause')
    .eq('workflow_status', 'approved')
    .gte('validated_at', cutoff);

  // Pour chaque resume, on cherche le paused_at correspondant (transition pause précédente)
  let totalDays = 0;
  let countResumes = 0;
  for (const r of (resumes ?? [])) {
    const { data: priorPause } = await supabase
      .from('project_lifecycle_transition')
      .select('validated_at')
      .eq('project_id', (r as any).project_id)
      .eq('to_status', 'pause')
      .eq('workflow_status', 'approved')
      .lt('validated_at', (r as any).validated_at)
      .order('validated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorPause?.validated_at) {
      const days = (new Date((r as any).validated_at).getTime() - new Date(priorPause.validated_at).getTime()) / 86400000;
      totalDays += days;
      countResumes += 1;
    }
  }
  const avgPauseDays = countResumes > 0 ? (totalDays / countResumes).toFixed(0) : null;

  // 5. Dernières leçons apprises (top 5)
  const { data: lessons } = await supabase
    .from('project_lifecycle_transition')
    .select(`
      validated_at, lessons_learned, lost_revenue_snapshot,
      project:projects(code, reference, client:clients(full_name))
    `)
    .eq('to_status', 'perdu')
    .eq('workflow_status', 'approved')
    .not('lessons_learned', 'is', null)
    .order('validated_at', { ascending: false })
    .limit(5);

  // Si rien d'intéressant, on n'affiche pas la section
  if (projectsPause === 0 && projectsPerdus === 0 && (lessons ?? []).length === 0) {
    return null;
  }

  return (
    <section className="mt-8">
      <h2 className="text-sm font-medium uppercase tracking-wide text-stoniz-gray-600 mb-3">
        Cycle de vie projets
      </h2>

      {/* 4 tuiles principales */}
      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-stoniz-gray-500 uppercase tracking-wide">En pause</span>
              <PauseCircle className="w-4 h-4 text-amber-600" />
            </div>
            <div className="text-2xl font-medium">{projectsPause}</div>
            <div className="text-xs text-stoniz-gray-500">{pauseRate}% du portefeuille</div>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-stoniz-gray-500 uppercase tracking-wide">Perdus</span>
              <XCircle className="w-4 h-4 text-red-600" />
            </div>
            <div className="text-2xl font-medium">{projectsPerdus}</div>
            <div className="text-xs text-stoniz-gray-500">{lostRate}% du portefeuille</div>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-stoniz-gray-500 uppercase tracking-wide">Manque à gagner</span>
              <Euro className="w-4 h-4 text-stoniz-gray-500" />
            </div>
            <div className="text-2xl font-medium">{formatMoney(manqueAGagner)}</div>
            <div className="text-xs text-stoniz-gray-500">cumulé, projets perdus</div>
          </div>
        </Card>

        <Card>
          <div className="p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-stoniz-gray-500 uppercase tracking-wide">Pause moy.</span>
              <Clock className="w-4 h-4 text-stoniz-gray-500" />
            </div>
            <div className="text-2xl font-medium">
              {avgPauseDays !== null ? `${avgPauseDays}j` : '—'}
            </div>
            <div className="text-xs text-stoniz-gray-500">avant reprise, 12 mois</div>
          </div>
        </Card>
      </div>

      {/* Top raisons + Leçons */}
      <div className="grid md:grid-cols-2 gap-3">
        {/* Top raisons de perte */}
        {topLostReasons.length > 0 && (
          <Card>
            <div className="p-4">
              <h3 className="text-sm font-medium mb-3">Top raisons de perte (12 mois)</h3>
              <div className="space-y-2">
                {topLostReasons.map(([code, count]) => {
                  const pct = projectsPerdus > 0 ? ((count as number) / projectsPerdus) * 100 : 0;
                  return (
                    <div key={code}>
                      <div className="flex justify-between text-xs mb-1">
                        <span>{LOST_REASON_LABELS[code] ?? code}</span>
                        <span className="text-stoniz-gray-500">{count as number}</span>
                      </div>
                      <div className="h-1.5 bg-stoniz-gray-100 rounded">
                        <div
                          className="h-1.5 bg-red-400 rounded"
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>
        )}

        {/* Leçons apprises récentes */}
        {(lessons ?? []).length > 0 && (
          <Card>
            <div className="p-4">
              <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-amber-600" />
                Leçons récentes
              </h3>
              <div className="space-y-3">
                {(lessons ?? []).slice(0, 3).map((l: any, i: number) => (
                  <div key={i} className="text-xs border-l-2 border-amber-300 pl-2">
                    <div className="text-stoniz-gray-500 mb-0.5">
                      {l.project?.client?.full_name ?? '—'}
                      {l.lost_revenue_snapshot && (
                        <span> · perdu {formatMoney(Number(l.lost_revenue_snapshot))}</span>
                      )}
                    </div>
                    <div className="text-stoniz-gray-700 italic">« {l.lessons_learned}»</div>
                  </div>
                ))}
              </div>
            </div>
          </Card>
        )}
      </div>
    </section>
  );
}
