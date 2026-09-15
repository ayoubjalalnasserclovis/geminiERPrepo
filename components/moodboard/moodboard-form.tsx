'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import {
  saveMoodboardChoiceAction, sendMoodboardToClientAction,
} from '@/app/(team)/projects/[id]/moodboard/actions';

type Template = {
  id: string;
  name: string;
  style: string;
  description: string | null;
  palette_colors: string[];
  tags: string[];
  budget_indicatif_eur_per_m2: number | null;
};

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

export function MoodboardForm({
  projectId, templates, choice,
}: {
  projectId: string;
  templates: Template[];
  choice: any | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string | null>(choice?.template_id ?? null);
  const [notes, setNotes] = useState<string>(choice?.custom_notes ?? '');
  const [inspirations, setInspirations] = useState<string>(
    (choice?.custom_inspirations_urls ?? []).join('\n')
  );
  const [pending, start] = useTransition();
  const [pendingSend, startSend] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isReadonly = choice?.status === 'validated';
  const isSent = choice?.status === 'sent_to_client';

  function save() {
    setError(null); setInfo(null);
    start(async () => {
      const r = await saveMoodboardChoiceAction(projectId, {
        template_id: selected,
        custom_notes: notes,
        custom_inspirations: inspirations,
      });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setInfo('✓ Enregistré');
      router.refresh();
    });
  }

  function send() {
    if (!selected) { setError('Sélectionnez un style avant d\'envoyer au client'); return; }
    if (!confirm('Enregistrer puis envoyer ce moodboard au client pour validation ?')) return;
    setError(null);
    startSend(async () => {
      const sr = await saveMoodboardChoiceAction(projectId, {
        template_id: selected,
        custom_notes: notes,
        custom_inspirations: inspirations,
      });
      if (!sr.ok) { setError(sr.error ?? 'Erreur'); return; }
      const r = await sendMoodboardToClientAction(projectId);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setInfo('✓ Envoyé au client');
      router.refresh();
    });
  }

  return (
    <fieldset disabled={isReadonly} className={isReadonly ? 'opacity-70' : ''}>
      <div className="space-y-6">
        <div>
          <h3 className="font-display text-xl mb-3">Choisissez un style</h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelected(t.id)}
                className={`text-left border rounded-lg p-4 transition-all hover:border-stoniz-black ${
                  selected === t.id ? 'border-stoniz-black bg-stoniz-gray-50 ring-2 ring-stoniz-black/20' : ''
                }`}>
                <div className="flex items-center gap-2 mb-2">
                  {t.palette_colors.slice(0, 4).map((c, i) => (
                    <span key={i} className="rounded-full border border-stoniz-gray-200"
                      style={{ background: c, width: 24, height: 24 }} />
                  ))}
                </div>
                <div className="font-medium">{t.name}</div>
                <div className="text-xs text-stoniz-gray-500 mb-2">
                  {STYLE_LABELS[t.style] ?? t.style}
                  {t.budget_indicatif_eur_per_m2 ? ` · ~${t.budget_indicatif_eur_per_m2} €/m²` : ''}
                </div>
                {t.description && (
                  <p className="text-xs text-stoniz-gray-700 line-clamp-3">{t.description}</p>
                )}
                {t.tags.length > 0 && (
                  <div className="flex gap-1 flex-wrap mt-2">
                    {t.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-600">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <Card className="space-y-4">
          <h3 className="font-display text-lg">Personnalisation</h3>
          <div>
            <Label>Adaptations spécifiques au client</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              placeholder="Ex: client souhaite garder le tadelakt existant, éviter le rouge, prévoir un coin lecture…" />
          </div>
          <div>
            <Label>Liens d'inspiration supplémentaires (Pinterest, photos, etc.)</Label>
            <Textarea value={inspirations} onChange={e => setInspirations(e.target.value)} rows={3}
              placeholder="https://pinterest.com/... &#10;https://...&#10;(une URL par ligne)" />
          </div>
        </Card>

        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md">{error}</div>}
        {info && <div className="text-sm text-green-700 bg-green-50 border border-green-200 p-3 rounded-md">{info}</div>}

        <div className="flex justify-end gap-3">
          {!isReadonly && (
            <Button variant="secondary" onClick={save} disabled={pending || pendingSend}>
              {pending ? 'Enregistrement…' : (isSent ? 'Modifier (re-brouillon)' : 'Enregistrer')}
            </Button>
          )}
          {!isReadonly && !isSent && (
            <Button onClick={send} disabled={pending || pendingSend || !selected}>
              {pendingSend ? 'Envoi…' : '📤 Envoyer au client pour validation'}
            </Button>
          )}
        </div>
      </div>
    </fieldset>
  );
}
