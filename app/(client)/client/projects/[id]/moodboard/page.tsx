import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ClientMoodboardActions } from '@/components/moodboard/client-moodboard-actions';
import { formatDate } from '@/lib/utils/format';

const STYLE_LABELS: Record<string, string> = {
  oriental_traditionnel: 'Oriental traditionnel',
  oriental_moderne: 'Oriental moderne',
  contemporain_minimaliste: 'Contemporain minimaliste',
  scandinave: 'Scandinave',
  industriel: 'Industriel',
  boheme: 'Bohème',
  luxe_marocain: 'Luxe marocain',
  tropical: 'Tropical',
  art_deco: 'Art déco',
};

export default async function ClientMoodboardPage({ params }: { params: { id: string } }) {
  const supabase = createClient();
  const { data: choice } = await supabase
    .from('project_moodboard_choices')
    .select('*, template:moodboard_templates(*)')
    .eq('project_id', params.id).maybeSingle();

  if (!choice) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <h1 className="font-display text-3xl">Votre moodboard</h1>
        <Card>
          <p className="text-stoniz-gray-600">
            Votre conseiller prépare le moodboard décoratif de votre projet. Vous serez notifié dès qu'il sera disponible.
          </p>
        </Card>
      </div>
    );
  }

  const tpl = choice.template;
  const isPending = choice.status === 'sent_to_client';
  const isValidated = choice.status === 'validated';
  const isRejected = choice.status === 'rejected';

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link href={`/client/projects/${params.id}`} className="text-sm text-stoniz-gray-500 hover:text-stoniz-black">
        ← Retour au projet
      </Link>
      <h1 className="font-display text-3xl">Votre moodboard 3D</h1>
      <p className="text-stoniz-gray-500">
        Le style décoratif choisi par votre conseiller pour votre bien.
      </p>

      {isPending && (
        <Card className="bg-accent-light border-accent border-2">
          <h2 className="font-display text-xl">⏳ En attente de votre validation</h2>
          <p className="text-sm text-stoniz-gray-700 mt-2">
            Validez ce moodboard si vous l'aimez, ou demandez des ajustements à votre conseiller.
          </p>
        </Card>
      )}
      {isValidated && (
        <Card className="bg-green-50 border-green-200">
          <h2 className="font-display text-xl">✅ Validé le {formatDate(choice.validated_by_client_at)}</h2>
        </Card>
      )}
      {isRejected && (
        <Card className="bg-red-50 border-red-200">
          <h2 className="font-display text-xl">Modifications demandées</h2>
          <p className="italic mt-2 bg-white p-3 rounded border text-sm">« {choice.rejection_reason} »</p>
        </Card>
      )}

      {tpl && (
        <Card>
          <div className="flex items-center gap-3 mb-3">
            {(tpl.palette_colors ?? []).slice(0, 5).map((c: string, i: number) => (
              <span key={i} className="rounded-full border border-stoniz-gray-200"
                style={{ background: c, width: 36, height: 36 }} />
            ))}
          </div>
          <h2 className="font-display text-2xl">{tpl.name}</h2>
          <p className="text-stoniz-gray-500 text-sm mb-3">{STYLE_LABELS[tpl.style] ?? tpl.style}</p>
          {tpl.description && <p className="mb-3">{tpl.description}</p>}
          {tpl.tags?.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mt-3">
              {tpl.tags.map((t: string) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          )}
          {tpl.budget_indicatif_eur_per_m2 && (
            <p className="text-xs text-stoniz-gray-500 mt-3">
              Budget indicatif : ~{tpl.budget_indicatif_eur_per_m2} €/m² (déco + mobilier)
            </p>
          )}
        </Card>
      )}

      {choice.custom_notes && (
        <Card>
          <h3 className="font-display text-lg mb-2">Adaptations spécifiques pour vous</h3>
          <p className="whitespace-pre-wrap text-sm">{choice.custom_notes}</p>
        </Card>
      )}

      {choice.custom_inspirations_urls?.length > 0 && (
        <Card>
          <h3 className="font-display text-lg mb-2">Inspirations supplémentaires</h3>
          <ul className="space-y-1 text-sm">
            {choice.custom_inspirations_urls.map((u: string, i: number) => (
              <li key={i}>
                <a href={u} target="_blank" rel="noreferrer" className="text-stoniz-black underline break-all">
                  {u}
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {isPending && <ClientMoodboardActions projectId={params.id} />}
    </div>
  );
}
