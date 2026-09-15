import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ClientMoodboardSelectionForm } from '@/components/moodboard/client-moodboard-selection-form';

export default async function ClientMoodboardSelectionPage({ params }: { params: { id: string } }) {
  const supabase = createClient();

  const [projectRes, templatesRes] = await Promise.all([
    supabase.from('projects')
      .select('id, current_phase, moodboard_selection_completed_at, reference')
      .eq('id', params.id).single(),
    supabase.from('moodboard_templates')
      .select('id, name, style, description, palette_colors, tags, inspirations_urls, cover_image_url')
      .eq('is_active', true)
      .order('display_order'),
  ]);

  if (!projectRes.data) notFound();
  // Si déjà complété, retour au projet
  if (projectRes.data.moodboard_selection_completed_at) {
    redirect(`/client/projects/${params.id}`);
  }

  return (
    <div className="max-w-4xl mx-auto">
      <p className="eyebrow mb-2">Phase design — étape 1/2</p>
      <h1 className="font-display text-4xl mb-2">Quels <mark>moodboards</mark> vous parlent ?</h1>
      <p className="text-grey-text mb-8 leading-relaxed">
        Sélectionnez <strong>1 ou 2 styles</strong> parmi nos univers de référence. Vos choix
        guideront notre architecte pour la conception de votre bien. Vous pouvez ajouter un
        commentaire sur chaque moodboard et un commentaire global obligatoire.
      </p>

      <ClientMoodboardSelectionForm
        projectId={params.id}
        templates={templatesRes.data ?? []}
      />
    </div>
  );
}
