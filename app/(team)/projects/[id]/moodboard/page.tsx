import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/lib/utils/format';

/**
 * Page équipe — Moodboard.
 *
 * Le workflow actuel est inversé par rapport à l'ancien : c'est le CLIENT qui
 * choisit 1 ou 2 moodboards depuis l'espace client (via le gate phase Design).
 * Cette page sert donc à l'équipe à consulter le choix du client et à transmettre
 * au studio/architecte. L'ancien système (équipe choisit puis envoie au client
 * via project_moodboard_choices) est conservé en BDD mais n'est plus utilisé.
 */
import { requireRole } from '@/lib/auth/require';

export default async function ProjectMoodboardPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','chef_projet','developer','commercial','marketing','assistante']);
  const supabase = createClient();

  const [projectRes, selectionsRes] = await Promise.all([
    supabase.from('projects')
      .select(`id, reference, current_phase,
        moodboard_selection_completed_at, moodboard_selection_global_comment,
        client:clients(full_name)
      `)
      .eq('id', params.id).single(),
    supabase.from('client_moodboard_selections')
      .select(`id, preference_order, client_comment, selected_at,
        template:moodboard_templates(name, style, description, palette_colors, tags, inspirations_urls)
      `)
      .eq('project_id', params.id)
      .order('preference_order'),
  ]);

  if (!projectRes.data) notFound();
  const project = projectRes.data as any;
  const selections = (selectionsRes.data ?? []) as any[];
  const completed = !!project.moodboard_selection_completed_at;

  return (
    <div className="space-y-6 max-w-5xl">
      <Link href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black">
        <ArrowLeft className="w-4 h-4" /> Retour au projet {project.reference}
      </Link>

      <PageHeader
        title="Moodboard du client"
        description={`Style décoratif choisi — ${project.client?.full_name ?? ''}`}
        action={
          completed
            ? <Badge variant="success">✓ Sélection complétée</Badge>
            : <Badge variant="warning">⏳ En attente du client</Badge>
        }
      />

      {!completed && (
        <Card className="bg-yellow/15 border-stoniz-black border">
          <h3 className="font-display text-lg mb-2">⏳ Le client n'a pas encore complété sa sélection</h3>
          <p className="text-sm text-stoniz-gray-700 leading-relaxed">
            Dès que le projet entre en phase <strong>Design</strong>, le client est automatiquement
            invité à choisir 1 ou 2 moodboards depuis son portail. Une notification vous sera envoyée
            à la soumission. Vous pourrez alors transmettre ces choix à l'architecte.
          </p>
        </Card>
      )}

      {completed && (
        <>
          <Card className="bg-green-50 border-green-200">
            <h3 className="font-display text-lg">✅ Sélection reçue du client</h3>
            <p className="text-sm text-stoniz-gray-700 mt-1">
              Complétée le {formatDate(project.moodboard_selection_completed_at)} —
              {selections.length} moodboard{selections.length > 1 ? 's' : ''} choisi{selections.length > 1 ? 's' : ''}.
              Vous pouvez maintenant transmettre ces préférences à l'architecte / studio design.
            </p>
          </Card>

          <div className="space-y-4">
            {selections.map((s) => (
              <Card key={s.id}>
                <div className="flex items-start gap-4">
                  <span className="flex-shrink-0 w-10 h-10 rounded-full bg-stoniz-black text-cream flex items-center justify-center font-bold">
                    #{s.preference_order}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="font-display text-xl">{s.template?.name}</h3>
                      {s.preference_order === 1 && (
                        <Badge variant="success">Préférence n°1</Badge>
                      )}
                    </div>
                    {s.template?.description && (
                      <p className="text-sm text-stoniz-gray-700 leading-relaxed">
                        {s.template.description}
                      </p>
                    )}

                    {/* Palette */}
                    {s.template?.palette_colors && (
                      <div className="flex gap-2 mt-3">
                        {(s.template.palette_colors as string[]).map((c, i) => (
                          <span key={i} className="w-7 h-7 rounded-full border border-grey-line"
                            style={{ background: c }} title={c} />
                        ))}
                      </div>
                    )}

                    {/* Tags */}
                    {s.template?.tags && s.template.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {s.template.tags.map((tag: string) => (
                          <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-cream-soft text-stoniz-black uppercase tracking-wider">
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Commentaire client */}
                    {s.client_comment && (
                      <div className="mt-4 bg-yellow/15 rounded-sm p-3 border-l-2 border-stoniz-black">
                        <p className="text-[10px] uppercase tracking-wider text-grey-text mb-1">
                          Remarque du client sur ce moodboard
                        </p>
                        <p className="text-sm italic whitespace-pre-line">{s.client_comment}</p>
                      </div>
                    )}

                    {/* Images d'inspiration */}
                    {s.template?.inspirations_urls && s.template.inspirations_urls.length > 0 && (
                      <details className="mt-4">
                        <summary className="cursor-pointer text-sm text-stoniz-black underline underline-offset-4">
                          Voir les {s.template.inspirations_urls.length} images d'inspiration de ce moodboard
                        </summary>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-3">
                          {(s.template.inspirations_urls as string[]).map((url, i) => (
                            <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                              className="block rounded-md overflow-hidden bg-cream-soft hover:opacity-90 transition-opacity">
                              <img src={url} alt={`${s.template?.name} ${i + 1}`}
                                className="w-full h-32 object-cover" loading="lazy" />
                            </a>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Commentaire global */}
          {project.moodboard_selection_global_comment && (
            <Card>
              <h3 className="font-display text-lg mb-2">Commentaire global du client</h3>
              <p className="text-xs text-grey-text uppercase tracking-wider mb-2">
                Ce que le client a partagé pour orienter le design
              </p>
              <div className="bg-cream-soft rounded-sm p-4 border-l-2 border-stoniz-black">
                <p className="italic whitespace-pre-line">
                  « {project.moodboard_selection_global_comment} »
                </p>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
