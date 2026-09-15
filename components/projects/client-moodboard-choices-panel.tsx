import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

export async function ClientMoodboardChoicesPanel({ projectId }: { projectId: string }) {
  const supabase = createClient();

  const [selectionsRes, projectRes] = await Promise.all([
    supabase.from('client_moodboard_selections')
      .select('id, preference_order, client_comment, selected_at, template:moodboard_templates(name, style, palette_colors, description)')
      .eq('project_id', projectId)
      .order('preference_order'),
    supabase.from('projects')
      .select('moodboard_selection_completed_at, moodboard_selection_global_comment')
      .eq('id', projectId).single(),
  ]);

  const selections = (selectionsRes.data ?? []) as any[];
  const project = projectRes.data;

  if (selections.length === 0) {
    return null; // Pas de sélection encore — ne pas afficher la carte
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Moodboards choisis par le client</CardTitle>
        {project?.moodboard_selection_completed_at && (
          <p className="text-xs text-grey-text">
            Soumis le {new Date(project.moodboard_selection_completed_at).toLocaleDateString('fr-FR', {
              day: 'numeric', month: 'long', year: 'numeric',
            })}
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {selections.map((s: any) => (
            <div key={s.id} className="border border-grey-line rounded-sm p-4">
              <div className="flex items-start gap-3">
                <span className="flex-shrink-0 w-8 h-8 rounded-full bg-stoniz-black text-cream flex items-center justify-center font-bold text-sm">
                  #{s.preference_order}
                </span>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold">{s.template?.name}</h4>
                  {s.template?.description && (
                    <p className="text-sm text-grey-text mt-1">{s.template.description}</p>
                  )}
                  {/* Palette */}
                  {s.template?.palette_colors && (
                    <div className="flex gap-1 mt-2">
                      {(s.template.palette_colors as string[]).slice(0, 5).map((c, i) => (
                        <span
                          key={i}
                          className="w-5 h-5 rounded-full border border-grey-line"
                          style={{ background: c }}
                        />
                      ))}
                    </div>
                  )}
                  {s.client_comment && (
                    <div className="mt-3 bg-yellow/15 rounded-sm p-3 border-l-2 border-stoniz-black">
                      <p className="text-[10px] uppercase tracking-wider text-grey-text mb-1">Remarque du client</p>
                      <p className="text-sm italic">{s.client_comment}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {project?.moodboard_selection_global_comment && (
          <div className="mt-5 bg-cream-soft rounded-sm p-4 border-l-2 border-stoniz-black">
            <p className="text-[10px] uppercase tracking-wider text-grey-text mb-1">Commentaire global du client</p>
            <p className="text-sm italic whitespace-pre-line">{project.moodboard_selection_global_comment}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
