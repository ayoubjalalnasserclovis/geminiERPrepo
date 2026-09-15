'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deletePropertyAction } from '@/app/(team)/properties/actions';

/**
 * Bouton "Supprimer" sur la fiche bien.
 * Soft-delete via deletePropertyAction (deleted_at = NOW()).
 * Confirm natif puis redirect vers /properties.
 * Visible CEO + chef_projet + sourcing uniquement (filtré au call site).
 */
export function PropertyDeleteButton({
  propertyId,
  propertyName,
}: {
  propertyId: string;
  propertyName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    if (!confirm(
      `Supprimer le bien "${propertyName}" ?\n\n` +
      `Il disparaîtra de la liste mais ses données restent en base (soft-delete).`,
    )) return;
    start(async () => {
      const r = await deletePropertyAction(propertyId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r || !r.ok) {
        alert(`Échec de la suppression : ${r?.error ?? 'erreur inconnue'}`);
        return;
      }
      router.push('/properties');
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={pending}
      title={`Supprimer ${propertyName}`}
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      <Trash2 className="w-4 h-4 mr-1.5" />
      {pending ? 'Suppression…' : 'Supprimer'}
    </Button>
  );
}
