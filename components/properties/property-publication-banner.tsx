'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, CheckCircle2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { publishPropertyAction, unpublishPropertyAction } from '@/app/(team)/properties/actions';

const MISSING_LABELS: Record<string, string> = {
  sourcing_type: 'Indiquer le type de sourcing (partenaire ou direct)',
  partner_id: 'Sélectionner un partenaire (agence)',
  assigned_chasseur: 'Sélectionner un chasseur Stoniz',
  medias: 'Uploader au moins 1 média (photo ou vidéo)',
};

export function PropertyPublicationBanner({
  propertyId,
  isPublished,
  missingForPublication,
  publishedAt,
}: {
  propertyId: string;
  isPublished: boolean;
  missingForPublication: string[] | null;
  publishedAt: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const missing = missingForPublication ?? [];
  const canPublish = missing.length === 0;

  function publish() {
    setError(null);
    start(async () => {
      const r = await publishPropertyAction(propertyId);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      router.refresh();
    });
  }

  function unpublish() {
    if (!confirm('Remettre ce bien en brouillon ? Il ne sera plus visible des équipes projet.')) return;
    setError(null);
    start(async () => {
      const r = await unpublishPropertyAction(propertyId);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      router.refresh();
    });
  }

  // ─── Bien déjà publié ────────────────────────────────────────────────
  if (isPublished) {
    return (
      <div className="bg-green-50 border-2 border-green-300 rounded-md p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-green-700 flex-shrink-0" />
            <div>
              <p className="font-display text-base text-green-900">Bien publié</p>
              <p className="text-xs text-green-800">
                Visible par les équipes projet
                {publishedAt && ` · publié le ${new Date(publishedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={unpublish} disabled={pending}>
            <RotateCcw className="w-3.5 h-3.5" />
            {pending ? '…' : 'Repasser en brouillon'}
          </Button>
        </div>
        {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
      </div>
    );
  }

  // ─── Brouillon prêt à publier ────────────────────────────────────────
  if (canPublish) {
    return (
      <div className="bg-yellow/20 border-2 border-stoniz-black rounded-md p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-stoniz-black flex-shrink-0" />
            <div>
              <p className="font-display text-base text-stoniz-black">
                Toutes les étapes sont complétées 🎉
              </p>
              <p className="text-xs text-stoniz-black/70">
                Le bien peut maintenant être publié et rendu visible aux équipes projet.
              </p>
            </div>
          </div>
          <Button variant="accent" onClick={publish} disabled={pending}>
            {pending ? 'Publication…' : '🚀 Publier le bien'}
          </Button>
        </div>
        {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
      </div>
    );
  }

  // ─── Brouillon avec étapes manquantes ────────────────────────────────
  return (
    <div className="bg-orange-50 border-2 border-orange-300 rounded-md p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-orange-700 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-display text-base text-orange-900">
            Bien en brouillon — pas encore publié
          </p>
          <p className="text-sm text-orange-800 mt-1">
            Ce bien n'est pas encore visible des équipes projet. Complétez les étapes suivantes :
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {missing.map(m => (
              <li key={m} className="flex items-center gap-2 text-orange-900">
                <span className="w-1.5 h-1.5 bg-orange-700 rounded-full" />
                {MISSING_LABELS[m] ?? m}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {error && <p className="text-xs text-red-700 mt-2">{error}</p>}
    </div>
  );
}
