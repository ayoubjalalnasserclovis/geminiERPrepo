'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteArtisanAction } from './actions';

/**
 * Icône corbeille inline dans la liste des artisans / fournisseurs.
 * Soft-delete via deleteArtisanAction. Confirm natif puis refresh.
 * Visible CEO + chef_projet uniquement (filtré au call site).
 */
export function ArtisanRowDeleteButton({
  artisanId,
  artisanName,
}: {
  artisanId: string;
  artisanName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    if (!confirm(`Supprimer "${artisanName}" ?`)) return;
    start(async () => {
      const r = await deleteArtisanAction(artisanId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r || !r.ok) {
        alert(`Échec : ${r?.error ?? 'erreur inconnue'}`);
        return;
      }
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      title={`Supprimer ${artisanName}`}
      className="p-1.5 rounded-md hover:bg-red-50 text-stoniz-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
