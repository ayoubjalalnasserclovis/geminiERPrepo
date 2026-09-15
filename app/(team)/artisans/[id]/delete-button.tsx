'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteArtisanAction } from '@/app/(team)/artisans/actions';

/**
 * Bouton "Supprimer" sur la fiche artisan.
 * Soft-delete via deleteArtisanAction (deleted_at = NOW()).
 * Confirm natif puis redirect vers /artisans.
 * Visible CEO + chef_projet uniquement (filtré au call site).
 */
export function ArtisanDeleteButton({
  artisanId,
  artisanName,
}: {
  artisanId: string;
  artisanName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    if (!confirm(`Supprimer l'artisan / fournisseur "${artisanName}" ?\n\nIl disparaîtra de la liste mais ses données restent en base (soft-delete).`)) return;
    start(async () => {
      const r = await deleteArtisanAction(artisanId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r || !r.ok) {
        alert(`Échec de la suppression : ${r?.error ?? 'erreur inconnue'}`);
        return;
      }
      router.push('/artisans');
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={pending}
      title={`Supprimer ${artisanName}`}
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      <Trash2 className="w-4 h-4 mr-1.5" />
      {pending ? 'Suppression…' : 'Supprimer'}
    </Button>
  );
}
