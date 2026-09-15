import { createClient } from '@/lib/supabase/server';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { MoodboardFinalEditor } from '@/components/projects/moodboard-final-editor';

// ─── Moodboard sélectionné (choix FINAL retenu) — CEO 2026-08-19, session D ─
// Toujours visible sur la fiche projet (même sans préférence client) : c'est
// LE moodboard que le studio exécute. Avant, ce choix vivait en commentaire
// libre — introuvable. Les préférences client restent affichées à côté
// (ClientMoodboardChoicesPanel).
export async function MoodboardFinalCard({ projectId }: { projectId: string }) {
  const supabase = createClient();

  const [projectRes, templatesRes] = await Promise.all([
    supabase.from('projects')
      .select(`
        moodboard_final_template_id, moodboard_final_label,
        moodboard_final_decided_at,
        final_template:moodboard_templates!projects_moodboard_final_template_id_fkey(name, style, palette_colors),
        decided_by:profiles!projects_moodboard_final_decided_by_fkey(full_name)
      `)
      .eq('id', projectId).single(),
    supabase.from('moodboard_templates')
      .select('id, name, style')
      .order('name'),
  ]);

  const p = projectRes.data as any;
  const templates = (templatesRes.data ?? []) as any[];
  const hasFinal = !!(p?.moodboard_final_template_id || p?.moodboard_final_label);

  return (
    <Card>
      <CardHeader>
        <CardTitle>🎨 Moodboard sélectionné</CardTitle>
        <p className="text-xs text-grey-text">
          Le choix final retenu pour exécution — distinct des préférences exprimées par le client.
        </p>
      </CardHeader>
      <CardContent>
        {hasFinal && (
          <div className="mb-4 border border-grey-line rounded-sm p-4 bg-cream-soft">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="font-semibold text-lg">
                  {p.final_template?.name ?? p.moodboard_final_label}
                </div>
                {p.final_template?.style && (
                  <div className="text-sm text-grey-text">{p.final_template.style}</div>
                )}
                {p.final_template?.palette_colors && (
                  <div className="flex gap-1 mt-2">
                    {(p.final_template.palette_colors as string[]).slice(0, 5).map((c: string, i: number) => (
                      <span key={i} className="w-5 h-5 rounded-full border border-grey-line" style={{ background: c }} />
                    ))}
                  </div>
                )}
              </div>
              {p.moodboard_final_decided_at && (
                <div className="text-xs text-grey-text text-right">
                  Acté le {new Date(p.moodboard_final_decided_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
                  {p.decided_by?.full_name && <><br />par {p.decided_by.full_name}</>}
                </div>
              )}
            </div>
          </div>
        )}
        <MoodboardFinalEditor
          projectId={projectId}
          templates={templates.map((t) => ({ id: t.id, name: t.name, style: t.style ?? null }))}
          currentTemplateId={p?.moodboard_final_template_id ?? null}
          currentLabel={p?.moodboard_final_label ?? null}
          hasFinal={hasFinal}
        />
      </CardContent>
    </Card>
  );
}
