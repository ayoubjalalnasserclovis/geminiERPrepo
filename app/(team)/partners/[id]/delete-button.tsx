'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deletePartnerAction } from '@/app/(team)/partners/actions';

/**
 * Bouton "Supprimer" sur la fiche partenaire.
 * Soft-delete via deletePartnerAction (deleted_at = NOW()).
 * Confirm natif puis redirect vers /partners.
 * Visible CEO + chef_projet uniquement (filtré au call site).
 */
export function PartnerDeleteButton({
  partnerId,
  partnerName,
}: {
  partnerId: string;
  partnerName: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    if (!confirm(`Supprimer le partenaire "${partnerName}" ?\n\nIl disparaîtra de la liste mais ses données restent en base (soft-delete).`)) return;
    start(async () => {
      const r = await deletePartnerAction(partnerId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r || !r.ok) {
        alert(`Échec de la suppression : ${r?.error ?? 'erreur inconnue'}`);
        return;
      }
      router.push('/partners');
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      disabled={pending}
      title={`Supprimer ${partnerName}`}
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      <Trash2 className="w-4 h-4 mr-1.5" />
      {pending ? 'Suppression…' : 'Supprimer'}
    </Button>
  );
}
