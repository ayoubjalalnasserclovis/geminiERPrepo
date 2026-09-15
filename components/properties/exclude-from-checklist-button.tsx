'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { EyeOff } from 'lucide-react';
import { togglePublicationChecklistExclusionAction } from '@/app/(team)/properties/actions';

/**
 * Bouton "Marquer comme finalisé hors-ligne" (CEO 2026-06-18 — Q3).
 *
 * Cache un brouillon legacy de /properties/incomplets sans le supprimer
 * ni mentir sur son statut. Confirmé pour éviter les clics accidentels.
 */
export function ExcludeFromChecklistButton({ propertyId }: { propertyId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function exclude() {
    if (!confirm(
      'Marquer ce bien comme finalisé hors-ligne ?\n\n' +
      'Il disparaîtra de la liste « Biens en cours d\'import ». Il ne sera pas publié ' +
      'pour autant (pas affiché sur les pages publiques). Tu pourras le ré-afficher ' +
      'depuis la fiche bien si tu changes d\'avis.',
    )) return;
    setErr(null);
    start(async () => {
      const r = await togglePublicationChecklistExclusionAction(propertyId, true);
      if (!r.ok) { setErr(r.error); return; }
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={exclude}
        disabled={pending}
        className="inline-flex items-center gap-1 text-xs text-stoniz-gray-600 hover:text-stoniz-black border border-stoniz-gray-300 rounded-md px-2.5 py-1.5 hover:bg-stoniz-gray-50 disabled:opacity-50"
        title="Cacher ce brouillon sans le publier"
      >
        <EyeOff className="w-3 h-3" />
        {pending ? 'Masquage…' : 'Finalisé hors-ligne'}
      </button>
      {err && (
        <span className="text-xs text-red-700 ml-2">{err}</span>
      )}
    </>
  );
}
