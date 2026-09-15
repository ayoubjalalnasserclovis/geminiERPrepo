'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { submitSurveyAction } from '@/app/(client)/client/surveys/actions';

type Survey = {
  id: string;
  trigger_phase: string;
  global_score: number | null;
  communication_score: number | null;
  reactivity_score: number | null;
  quality_score: number | null;
  deadline_score: number | null;
  comment: string | null;
  nps_score: number | null;
  nps_comment: string | null;
};

const QUESTIONS = [
  { key: 'global_score',         label: 'Note globale' },
  { key: 'communication_score',  label: 'Qualité de la communication' },
  { key: 'reactivity_score',     label: 'Réactivité de l\'équipe Stoniz' },
  { key: 'quality_score',        label: 'Qualité de la prestation' },
  { key: 'deadline_score',       label: 'Respect des délais' },
] as const;

export function SurveyForm({ survey, isCompleted }: { survey: Survey; isCompleted: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(isCompleted);

  // Pour les notes 1-5
  const [scores, setScores] = useState<Record<string, number>>({
    global_score:        survey.global_score        ?? 0,
    communication_score: survey.communication_score ?? 0,
    reactivity_score:    survey.reactivity_score    ?? 0,
    quality_score:       survey.quality_score       ?? 0,
    deadline_score:      survey.deadline_score      ?? 0,
  });

  const [npsScore, setNpsScore] = useState<number | null>(survey.nps_score);

  const isLivraison = survey.trigger_phase === 'livraison';

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Vérifie que toutes les notes sont remplies (1-5)
    for (const q of QUESTIONS) {
      if (!scores[q.key] || scores[q.key] < 1) {
        setError(`Veuillez attribuer une note à "${q.label}"`);
        return;
      }
    }
    if (isLivraison && (npsScore === null || npsScore < 0 || npsScore > 10)) {
      setError('Veuillez indiquer votre note NPS (0 à 10).');
      return;
    }

    const fd = new FormData(e.currentTarget);
    const data: any = {
      survey_id: survey.id,
      ...scores,
      comment: fd.get('comment'),
    };
    if (isLivraison) {
      data.nps_score = npsScore;
      data.nps_comment = fd.get('nps_comment');
    }

    start(async () => {
      const r = await submitSurveyAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setSuccess(true);
      // Redirige vers le projet après 1.5s
      setTimeout(() => router.back(), 1500);
    });
  }

  if (success) {
    return (
      <Card className="text-center py-8">
        <div className="text-5xl mb-3">✓</div>
        <h2 className="font-display text-2xl mb-2">Merci pour votre retour</h2>
        <p className="text-stoniz-gray-500 text-sm">Votre avis a bien été enregistré.</p>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="space-y-6">
        {QUESTIONS.map(q => (
          <div key={q.key}>
            <Label>{q.label}</Label>
            <StarRating
              value={scores[q.key]}
              onChange={v => setScores(s => ({ ...s, [q.key]: v }))}
            />
          </div>
        ))}
        <div>
          <Label>Un commentaire à partager ? (optionnel)</Label>
          <Textarea name="comment" rows={3} defaultValue={survey.comment ?? ''} />
        </div>
      </Card>

      {isLivraison && (
        <Card className="space-y-4">
          <h3 className="font-display text-lg">Recommanderiez-vous Stoniz ?</h3>
          <p className="text-sm text-stoniz-gray-500">
            De 0 (pas du tout) à 10 (tout à fait). Vos retours nourrissent notre démarche d'amélioration continue.
          </p>
          <NpsScale value={npsScore} onChange={setNpsScore} />
          <div>
            <Label>Pourquoi cette note ? (optionnel)</Label>
            <Textarea name="nps_comment" rows={3} defaultValue={survey.nps_comment ?? ''} />
          </div>
        </Card>
      )}

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" type="button" onClick={() => router.back()}>Annuler</Button>
        <Button type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Envoyer ma réponse'}</Button>
      </div>
    </form>
  );
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1 mt-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`text-3xl transition-colors ${n <= value ? 'text-accent' : 'text-stoniz-gray-200 hover:text-stoniz-gray-400'}`}
          aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
        >
          ★
        </button>
      ))}
      {value > 0 && (
        <span className="ml-2 self-center text-xs text-stoniz-gray-500">
          {value}/5
        </span>
      )}
    </div>
  );
}

function NpsScale({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-11 gap-1">
      {Array.from({ length: 11 }, (_, i) => i).map(n => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          className={`h-10 rounded-md font-medium text-sm transition-colors ${
            value === n
              ? 'bg-stoniz-black text-white'
              : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'
          }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}
