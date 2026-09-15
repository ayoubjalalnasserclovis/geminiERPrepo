import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Star, TrendingUp, MessageSquare, Clock } from 'lucide-react';

const PHASE_LABELS: Record<string, string> = {
  sourcing: 'Sourcing', design: 'Design', travaux: 'Travaux',
  livraison: 'Livraison', mise_en_location: 'Mise en location',
};

function avg(values: (number | null)[]): number | null {
  const ns = values.filter((v): v is number => typeof v === 'number');
  if (ns.length === 0) return null;
  return ns.reduce((s, v) => s + v, 0) / ns.length;
}

function nps(scores: number[]): number {
  if (scores.length === 0) return 0;
  const promoters = scores.filter(s => s >= 9).length;
  const detractors = scores.filter(s => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}

function StarBig({ score }: { score: number | null }) {
  if (score == null) return <span className="text-stoniz-gray-400">—</span>;
  const rounded = Math.round(score * 10) / 10;
  return (
    <span className="inline-flex items-center gap-1">
      <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
      <span className="font-medium">{rounded.toFixed(1)}</span>
      <span className="text-stoniz-gray-500 text-sm">/5</span>
    </span>
  );
}

export default async function SatisfactionDashboardPage() {
  await requireRole(['ceo','chef_projet','developer']);
  const supabase = createClient();

  const { data: surveys } = await supabase
    .from('satisfaction_dashboard')
    .select('*')
    .order('completed_at', { ascending: false, nullsFirst: false })
    .limit(500);

  const all = (surveys ?? []) as any[];
  const completed = all.filter(s => s.completed_at);
  const pending = all.filter(s => !s.completed_at);

  const globalAvg = avg(completed.map(s => s.global_score));
  const commAvg = avg(completed.map(s => s.communication_score));
  const reacAvg = avg(completed.map(s => s.reactivity_score));
  const qualAvg = avg(completed.map(s => s.quality_score));
  const deadAvg = avg(completed.map(s => s.deadline_score));

  const npsScores = completed.map(s => s.nps_score).filter((s): s is number => typeof s === 'number');
  const npsValue = nps(npsScores);

  const completionRate = all.length > 0
    ? Math.round((completed.length / all.length) * 100)
    : 0;

  const completionTimes = completed
    .map(s => s.completion_hours)
    .filter((h): h is number => typeof h === 'number' && h > 0);
  const avgCompletionHours = completionTimes.length > 0
    ? completionTimes.reduce((s, v) => s + v, 0) / completionTimes.length
    : null;

  // Par phase
  const byPhase = ['sourcing','design','livraison'].map(phase => {
    const phaseSurveys = completed.filter(s => s.trigger_phase === phase);
    return {
      phase,
      label: PHASE_LABELS[phase] ?? phase,
      count: phaseSurveys.length,
      avg: avg(phaseSurveys.map(s => s.global_score)),
    };
  });

  return (
    <div className="max-w-7xl">
      <div className="mb-8">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/dashboard" className="hover:text-stoniz-black">Dashboard</Link> · Satisfaction
        </div>
        <h1 className="text-3xl font-display">Satisfaction clients</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Vue d'ensemble des enquêtes envoyées et complétées par les clients.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <Card>
          <Star className="w-5 h-5 text-amber-500 mb-3" />
          <div className="text-3xl font-display">{globalAvg ? globalAvg.toFixed(1) : '—'}<span className="text-base text-stoniz-gray-500">/5</span></div>
          <div className="text-xs text-stoniz-gray-600 mt-1">Note moyenne globale</div>
        </Card>
        <Card>
          <TrendingUp className="w-5 h-5 text-emerald-500 mb-3" />
          <div className="text-3xl font-display">{npsScores.length > 0 ? (npsValue > 0 ? `+${npsValue}` : npsValue) : '—'}</div>
          <div className="text-xs text-stoniz-gray-600 mt-1">
            NPS {npsScores.length > 0 ? `(${npsScores.length} réponses)` : ''}
          </div>
        </Card>
        <Card>
          <MessageSquare className="w-5 h-5 text-blue-500 mb-3" />
          <div className="text-3xl font-display">{completionRate}%</div>
          <div className="text-xs text-stoniz-gray-600 mt-1">
            Taux de complétion ({completed.length}/{all.length})
          </div>
        </Card>
        <Card>
          <Clock className="w-5 h-5 text-purple-500 mb-3" />
          <div className="text-3xl font-display">
            {avgCompletionHours
              ? avgCompletionHours < 24
                ? `${Math.round(avgCompletionHours)}h`
                : `${Math.round(avgCompletionHours / 24)}j`
              : '—'}
          </div>
          <div className="text-xs text-stoniz-gray-600 mt-1">Délai moyen de réponse</div>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <Card>
          <CardHeader><CardTitle>Notes moyennes par dimension</CardTitle></CardHeader>
          <CardContent>
            <DimensionRow label="Communication" score={commAvg} />
            <DimensionRow label="Réactivité" score={reacAvg} />
            <DimensionRow label="Qualité" score={qualAvg} />
            <DimensionRow label="Délais" score={deadAvg} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Par phase</CardTitle></CardHeader>
          <CardContent>
            {byPhase.map(p => (
              <div key={p.phase} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
                <span className="font-medium">{p.label}</span>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-stoniz-gray-500">{p.count} réponses</span>
                  <StarBig score={p.avg} />
                </div>
              </div>
            ))}
            {pending.length > 0 && (
              <div className="mt-3 pt-3 border-t text-xs text-stoniz-gray-600">
                ⏳ {pending.length} enquête{pending.length > 1 ? 's' : ''} en attente
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Dernières enquêtes complétées</CardTitle></CardHeader>
        <CardContent>
          {completed.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucune enquête complétée pour l'instant.</p>
          ) : (
            <div className="space-y-3">
              {completed.slice(0, 12).map((s: any) => (
                <div key={s.id} className="border border-stoniz-gray-100 rounded-lg p-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div>
                      <div className="font-medium text-sm">
                        {s.client_name}
                        <Link href={`/projects/${s.project_id}`} className="text-xs text-stoniz-gray-500 ml-2 hover:underline">
                          ({s.project_reference})
                        </Link>
                      </div>
                      <div className="text-xs text-stoniz-gray-500 mt-0.5">
                        Phase {PHASE_LABELS[s.trigger_phase] ?? s.trigger_phase} · {new Date(s.completed_at).toLocaleDateString('fr-FR')}
                      </div>
                    </div>
                    <StarBig score={s.global_score} />
                  </div>
                  {s.comment && (
                    <p className="text-sm italic text-stoniz-gray-700 mt-2 bg-stoniz-gray-50 rounded p-2">
                      « {s.comment} »
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DimensionRow({ label, score }: { label: string; score: number | null }) {
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
      <span>{label}</span>
      <StarBig score={score} />
    </div>
  );
}
