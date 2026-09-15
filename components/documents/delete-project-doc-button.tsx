'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { softDeleteProjectDocumentAction } from '@/app/(team)/projects/[id]/documents/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Bouton "Supprimer" pour un document projet (table `documents`).
 *
 * Pattern symétrique à `<DeleteVendorDocButton>` :
 *   - Confirmation native (window.confirm)
 *   - Soft-delete + décrochage automatique des FK (payment_approvals.proof_doc_id)
 *   - router.refresh() au succès → la place est libre pour ré-upload
 *   - SessionExpiredBanner si l'erreur est une session expirée
 *
 * Rôles autorisés (côté serveur via assertRole) : ceo, chef_projet, achats,
 * assistante. Les autres rôles verront une erreur "Permission refusée".
 *
 * CEO 2026-06-30.
 */
export function DeleteProjectDocButton({
  docId,
  label,
  size = 'sm',
  inline = false,
  onDeleted,
}: {
  docId: string;
  /** Label court à afficher dans la confirmation (ex : "Plans 3D", "Titre foncier"). */
  label?: string;
  size?: 'sm' | 'md';
  /** Si true, affiche le texte "Supprimer" à côté de l'icône. */
  inline?: boolean;
  /** Callback optionnel après suppression réussie. */
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    const msg = label
      ? `Supprimer ce document (${label}) ?\n\nLe document sera marqué supprimé. Tu pourras en uploader un nouveau immédiatement.`
      : `Supprimer ce document ?\n\nLe document sera marqué supprimé. Tu pourras en uploader un nouveau immédiatement.`;
    if (!confirm(msg)) return;
    setError(null);
    start(async () => {
      try {
        const r = await softDeleteProjectDocumentAction(docId);
        if (!r || !r.ok) {
          setError((r as any)?.error ?? 'Erreur — merci de réessayer.');
          return;
        }
        onDeleted?.();
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur réseau — merci de réessayer.');
      }
    });
  }

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        title="Supprimer ce document"
        className="inline-flex items-center gap-1 text-red-600 hover:text-red-700 hover:bg-red-50 px-1 py-0.5 rounded text-[11px] disabled:opacity-50"
      >
        <Trash2 className={iconSize} />
        {inline && <span>{pending ? 'Suppression…' : 'Supprimer'}</span>}
      </button>
      {error && (
        <div className="mt-1">
          <SessionExpiredBanner error={error} />
        </div>
      )}
    </>
  );
}
