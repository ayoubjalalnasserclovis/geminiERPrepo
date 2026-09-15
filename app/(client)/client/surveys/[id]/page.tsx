import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SurveyForm } from '@/components/surveys/survey-form';
import { formatPhase } from '@/lib/utils/format';

export default async function ClientSurveyPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: survey } = await supabase
    .from('satisfaction_surveys')
    .select('*, project:projects(id, reference)')
    .eq('id', params.id)
    .single();

  if (!survey) notFound();

  const isCompleted = !!survey.completed_at;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="font-display text-3xl mb-2">
        Votre avis sur la phase {formatPhase(survey.trigger_phase)}
      </h1>
      <p className="text-stoniz-gray-500 mb-8">
        {isCompleted
          ? 'Merci, votre réponse a bien été enregistrée.'
          : 'Votre retour nous aide à améliorer notre accompagnement.'}
      </p>

      <SurveyForm survey={survey} isCompleted={isCompleted} />
    </div>
  );
}
