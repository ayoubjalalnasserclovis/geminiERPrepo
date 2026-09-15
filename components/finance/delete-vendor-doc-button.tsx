'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { softDeleteVendorDocumentAction } from '@/app/actions/vendor-documents';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

/**
 * Bouton "Supprimer" réutilisable pour un vendor_documents.
 *
 * Rôles autorisés (côté serveur via assertRole) : ceo, chef_projet, achats,
 * assistante. Les autres rôles verront un message "Permission refusée" et
 * ne pourront pas supprimer.
 *
 * Comportement :
 *   - Confirmation native (window.confirm)
 *   - Soft-delete + décrochage automatique des FK (achats_lots × 3 + travaux × 2)
 *   - router.refresh() au succès → le slot devient libre pour ré-upload
 *   - SessionExpiredBanner si l'erreur est une session expirée
 *
 * CEO 2026-06-30.
 */
export function DeleteVendorDocButton({
  docId,
  label,
  size = 'sm',
  inline = false,
  onDeleted,
}: {
  docId: string;
  /** Label court à afficher dans la confirmation (ex : "Devis", "Facture"). */
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
      ? `Supprimer ce document (${label}) ?\n\nLe doc sera détaché du lot et marqué supprimé. Tu pourras en uploader un nouveau immédiatement.`
      : `Supprimer ce document ?\n\nLe doc sera détaché du lot et marqué supprimé. Tu pourras en uploader un nouveau immédiatement.`;
    if (!confirm(msg)) return;
    setError(null);
    start(async () => {
      try {
        const r = await softDeleteVendorDocumentAction(docId);
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
