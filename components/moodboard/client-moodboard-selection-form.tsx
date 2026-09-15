'use client';

import { useState, useTransition } from 'react';
import { submitMoodboardSelectionAction } from '@/app/(client)/client/projects/[id]/moodboard-selection/actions';

type Template = {
  id: string;
  name: string;
  style: string;
  description: string | null;
  palette_colors: string[] | null;
  tags: string[] | null;
  inspirations_urls: string[] | null;
  cover_image_url: string | null;
};

export function ClientMoodboardSelectionForm({
  projectId,
  templates,
}: {
  projectId: string;
  templates: Template[];
}) {
  // selected = liste ordonnée des template_ids choisis (max 2)
  const [selected, setSelected] = useState<string[]>([]);
  const [commentsById, setCommentsById] = useState<Record<string, string>>({});
  const [globalComment, setGlobalComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [imagesModalFor, setImagesModalFor] = useState<Template | null>(null);

  function toggle(id: string) {
    setError(null);
    setSelected(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) {
        setError('Vous pouvez sélectionner 2 moodboards maximum. Désélectionnez-en un d\'abord.');
        return prev;
      }
      return [...prev, id];
    });
  }

  function submit() {
    setError(null);
    if (selected.length === 0) {
      setError('Sélectionnez au moins 1 moodboard.');
      return;
    }
    if (globalComment.trim().length < 10) {
      setError('Merci de partager un commentaire global (10 caractères minimum) pour expliquer votre choix.');
      return;
    }
    start(async () => {
      const r = await submitMoodboardSelectionAction({
        project_id: projectId,
        global_comment: globalComment.trim(),
        selections: selected.map((id, idx) => ({
          template_id: id,
          preference_order: idx + 1,
          client_comment: commentsById[id]?.trim() || null,
        })),
      });
      if (r && !r.ok) setError(r.error ?? 'Erreur lors de la soumission');
      // sinon : redirect géré côté action
    });
  }

  return (
    <div className="space-y-8">
      {/* Sélection visuelle */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium">Choisissez 1 ou 2 styles qui vous correspondent</p>
          <span className="text-xs text-grey-text">{selected.length}/2 sélectionnés</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((t) => {
            const checked = selected.includes(t.id);
            const order = checked ? selected.indexOf(t.id) + 1 : null;
            return (
              <label
                key={t.id}
                className={`relative block bg-white border-2 rounded-md overflow-hidden cursor-pointer transition-all ${
                  checked
                    ? 'border-stoniz-black shadow-[0_2px_12px_rgba(10,10,10,0.08)]'
                    : 'border-grey-line hover:border-stoniz-black/40'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(t.id)}
                  className="absolute top-3 right-3 w-5 h-5 z-10"
                />
                {order && (
                  <div className="absolute top-3 left-3 z-10 w-8 h-8 rounded-full bg-stoniz-black text-cream flex items-center justify-center font-bold text-sm">
                    #{order}
                  </div>
                )}

                {/* Palette + nom */}
                <div className="p-5">
                  {/* Palette colorée */}
                  <div className="flex gap-1.5 mb-3">
                    {(t.palette_colors ?? []).slice(0, 5).map((c, i) => (
                      <span
                        key={i}
                        className="w-7 h-7 rounded-full border border-grey-line"
                        style={{ background: c }}
                      />
                    ))}
                  </div>

                  <h3 className="font-display text-lg mb-1">{t.name}</h3>
                  {t.description && (
                    <p className="text-sm text-grey-text leading-relaxed mb-3 line-clamp-3">{t.description}</p>
                  )}

                  {/* Tags */}
                  {t.tags && t.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {t.tags.slice(0, 5).map((tag) => (
                        <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-cream-soft text-stoniz-black uppercase tracking-wider">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Bouton voir les images */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setImagesModalFor(t);
                    }}
                    className="text-xs underline underline-offset-2 text-stoniz-black hover:text-stoniz-black/70 font-medium"
                  >
                    📷 Voir les images d'inspiration
                  </button>

                  {/* Commentaire par moodboard, visible quand coché */}
                  {checked && (
                    <div className="mt-4 pt-3 border-t border-grey-line">
                      <label className="text-xs text-grey-text mb-1 block">
                        Une remarque sur ce moodboard ? (optionnel)
                      </label>
                      <textarea
                        value={commentsById[t.id] ?? ''}
                        onChange={(e) => setCommentsById(prev => ({ ...prev, [t.id]: e.target.value }))}
                        onClick={(e) => e.stopPropagation()}
                        rows={2}
                        placeholder="Ex : j'adore mais je voudrais plus de bois clair…"
                        className="w-full text-sm"
                      />
                    </div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Commentaire global obligatoire */}
      <div className="bg-white border border-grey-line rounded-md p-6">
        <label className="block">
          <p className="font-semibold mb-1">
            Votre commentaire global <span className="text-red-600">*</span>
          </p>
          <p className="text-xs text-grey-text mb-3">
            Décrivez l'ambiance que vous recherchez, les couleurs, les matériaux qui vous attirent ou
            qui vous repoussent. Toute info utile à votre architecte est précieuse.
          </p>
          <textarea
            value={globalComment}
            onChange={(e) => setGlobalComment(e.target.value)}
            rows={5}
            placeholder="Ex : j'aime les ambiances chaleureuses avec beaucoup de bois clair et de lin. Je veux éviter le marbre froid et les couleurs trop sombres. Idéalement un espace qui respire avec quelques touches d'artisanat marocain…"
            className="w-full"
          />
          <div className="text-xs text-grey-text mt-1">{globalComment.length} caractères — minimum 10</div>
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-sm p-3 text-sm text-red-900">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending || selected.length === 0 || globalComment.trim().length < 10}
          className="bg-yellow text-stoniz-black border-[1.5px] border-stoniz-black px-7 py-3 rounded-sm font-semibold hover:brightness-95 disabled:opacity-50"
        >
          {pending ? 'Envoi…' : `Valider ma sélection (${selected.length})`}
        </button>
      </div>

      {/* Modal images d'inspiration */}
      {imagesModalFor && (
        <div
          className="fixed inset-0 bg-stoniz-black/70 z-50 flex items-center justify-center p-4 animate-fadein"
          onClick={() => setImagesModalFor(null)}
        >
          <div
            className="bg-cream rounded-md max-w-5xl w-full max-h-[90vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-grey-line flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow mb-1">Moodboard d'inspiration</p>
                <h2 className="font-display text-2xl">{imagesModalFor.name}</h2>
                {imagesModalFor.description && (
                  <p className="text-sm text-grey-text mt-2 leading-relaxed">{imagesModalFor.description}</p>
                )}
                {/* Palette dans le modal aussi */}
                {imagesModalFor.palette_colors && (
                  <div className="flex gap-1.5 mt-3">
                    {imagesModalFor.palette_colors.map((c, i) => (
                      <span key={i} className="w-6 h-6 rounded-full border border-grey-line" style={{ background: c }} />
                    ))}
                  </div>
                )}
              </div>
              <button
                onClick={() => setImagesModalFor(null)}
                className="text-2xl text-grey-text hover:text-stoniz-black"
                aria-label="Fermer"
              >×</button>
            </div>

            <div className="overflow-y-auto p-6">
              {(imagesModalFor.inspirations_urls?.length ?? 0) === 0 ? (
                <div className="text-center py-16 text-grey-text">
                  <p className="mb-2 text-4xl">🎨</p>
                  <p>Les images d'inspiration arrivent bientôt.</p>
                  <p className="text-xs mt-2">Votre conseiller les ajoutera dans les prochains jours.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {imagesModalFor.inspirations_urls!.map((url, i) => (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block rounded-md overflow-hidden bg-cream-soft hover:opacity-90 transition-opacity"
                    >
                      <img
                        src={url}
                        alt={`${imagesModalFor.name} — inspiration ${i + 1}`}
                        className="w-full h-48 object-cover"
                        loading="lazy"
                      />
                    </a>
                  ))}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-grey-line flex justify-end">
              <button
                onClick={() => setImagesModalFor(null)}
                className="px-5 py-2 bg-stoniz-black text-cream rounded-sm text-sm font-semibold hover:bg-stoniz-black/85"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
