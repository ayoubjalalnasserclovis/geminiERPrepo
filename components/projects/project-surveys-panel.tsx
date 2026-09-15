import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatPhase } from '@/lib/utils/format';

const PHASE_LABELS: Record<string, string> = {
  sourcing: 'Sourcing', design: 'Design', travaux: 'Travaux',
  livraison: 'Livraison', mise_en_location: 'Mise en location',
};

function StarRow({ score }: { score: number | null }) {
  if (score == null) return <span className="text-stoniz-gray-400">—</span>;
  const full = '★'.repeat(score);
  const empty = '☆'.repeat(5 - score);
  return (
    <span className="text-amber-500 text-sm">
      {full}<span className="text-stoniz-gray-300">{empty}</span>
      <span className="ml-1 text-xs text-stoniz-gray-600">{score}/5</span>
    </span>
  );
}

export async function ProjectSurveysPanel({ projectId }: { projectId: string }) {
  const supabase = createClient();
  const { data: surveys } = await supabase
    .from('satisfaction_surveys')
    .select('id, trigger_phase, sent_at, completed_at, global_score, communication_score, reactivity_score, quality_score, deadline_score, nps_score, comment, nps_comment')
    .eq('project_id', projectId)
    .order('sent_at', { ascending: false });

  const rows = surveys ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enquêtes de satisfaction</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500">
            Aucune enquête envoyée pour l'instant. Les enquêtes sont créées automatiquement au passage de certaines phases.
          </p>
        ) : (
          <div className="space-y-3">
            {rows.map((s: any) => {
              const isCompleted = !!s.completed_at;
              return (
                <details key={s.id} className="border border-stoniz-gray-200 rounded-lg" open={isCompleted}>
                  <summary className="cursor-pointer px-4 py-3 hover:bg-stoniz-gray-50 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-sm">
                        Phase {PHASE_LABELS[s.trigger_phase] ?? formatPhase(s.trigger_phase)}
                      </span>
                      <span className="text-xs text-stoniz-gray-500">
                        envoyée le {new Date(s.sent_at).toLocaleDateString('fr-FR')}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {isCompleted ? (
                        <>
                          <StarRow score={s.global_score} />
                          <Badge variant="success">✓ Complétée</Badge>
                        </>
                      ) : (
                        <Badge>⏳ En attente</Badge>
                      )}
                    </div>
                  </summary>
                  {isCompleted && (
                    <div className="px-4 pb-4 pt-2 border-t border-stoniz-gray-100 space-y-3 text-sm">
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <ScoreItem label="Communication" score={s.communication_score} />
                        <ScoreItem label="Réactivité" score={s.reactivity_score} />
                        <ScoreItem label="Qualité" score={s.quality_score} />
                        <ScoreItem label="Délais" score={s.deadline_score} />
                      </div>
                      {s.nps_score != null && (
                        <div className="bg-stoniz-gray-50 rounded p-3">
                          <div className="text-xs text-stoniz-gray-500">NPS (recommandation)</div>
                          <div className="text-2xl font-display">{s.nps_score}<span className="text-sm text-stoniz-gray-500">/10</span></div>
                          {s.nps_comment && <p className="text-xs italic mt-1">{s.nps_comment}</p>}
                        </div>
                      )}
                      {s.comment && (
                        <div className="bg-accent-light/50 rounded p-3">
                          <div className="text-xs text-stoniz-gray-500 mb-1">Commentaire du client</div>
                          <p className="italic">{s.comment}</p>
                        </div>
                      )}
                      <div className="text-xs text-stoniz-gray-500">
                        Complétée le {new Date(s.completed_at).toLocaleDateString('fr-FR')}
                      </div>
                    </div>
                  )}
                </details>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ScoreItem({ label, score }: { label: string; score: number | null }) {
  return (
    <div>
      <div className="text-xs text-stoniz-gray-500 mb-1">{label}</div>
      <StarRow score={score} />
    </div>
  );
}
