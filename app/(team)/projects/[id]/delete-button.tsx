'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { deleteProjectAction } from '@/app/(team)/projects/actions';

/**
 * Bouton "Supprimer le projet" sur la fiche projet.
 * Soft-delete via deleteProjectAction (deleted_at = NOW()).
 * Confirm natif puis redirect vers /projects.
 * Visible CEO + chef_projet uniquement (filtré au call site).
 */
export function ProjectDeleteButton({
  projectId,
  projectLabel,
}: {
  projectId: string;
  projectLabel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function onClick() {
    if (!confirm(
      `Supprimer le projet "${projectLabel}" ?\n\n` +
      `Il disparaîtra de tous les écrans mais ses données restent en base (soft-delete).\n` +
      `Réversible par un CEO via /admin/preparation.`,
    )) return;
    start(async () => {
      const r = await deleteProjectAction(projectId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r || !r.ok) {
        alert(`Échec de la suppression : ${r?.error ?? 'erreur inconnue'}`);
        return;
      }
      router.push('/projects');
      router.refresh();
    });
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onClick}
      disabled={pending}
      title={`Supprimer ${projectLabel}`}
      className="text-red-600 hover:bg-red-50 hover:text-red-700"
    >
      <Trash2 className="w-4 h-4 mr-1.5" />
      {pending ? 'Suppression…' : 'Supprimer'}
    </Button>
  );
}
