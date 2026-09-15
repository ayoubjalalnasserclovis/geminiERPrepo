'use client';

import { useState, useTransition } from 'react';
import { getVendorDocumentSignedUrlByIdAction } from '@/app/actions/vendor-documents';

/**
 * Bouton-lien minimaliste pour ouvrir une facture/devis/BC fournisseur
 * stockés dans `vendor_documents`. Réutilise le helper canonique
 * `getVendorDocumentSignedUrlByIdAction` (cf. fix 404 du 25/06).
 *
 * Utilisé par <ApprovalBreakdownPanel> côté /validations et
 * /mes-demandes-paiement.
 */
export function VendorDocLink({
  docId,
  label,
  icon,
  title,
  className,
}: {
  docId: string;
  label: string;
  icon?: string;
  title?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function open() {
    setErr(null);
    start(async () => {
      try {
        const r = await getVendorDocumentSignedUrlByIdAction(docId);
        if (!r || !r.ok) {
          const msg =
            r?.error === 'not_found' ? 'Document introuvable (supprimé ?)'
            : r?.error === 'no_file'  ? 'Aucun fichier attaché.'
            : r?.error === 'no_perm'  ? 'Permission refusée.'
            : r?.error === 'storage_error' ? 'Erreur de stockage — réessayer.'
            : 'Erreur — merci de réessayer.';
          setErr(msg);
          return;
        }
        window.open(r.url, '_blank', 'noopener,noreferrer');
      } catch {
        setErr('Erreur réseau — merci de réessayer.');
      }
    });
  }

  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={open}
        disabled={pending}
        title={title ?? label}
        className={
          className ??
          'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border border-green-300 bg-green-50 text-green-800 hover:bg-green-100 disabled:opacity-50'
        }
      >
        {icon && <span aria-hidden>{icon}</span>}
        <span>{pending ? '…' : label}</span>
      </button>
      {err && <span className="text-[10px] text-red-600 mt-0.5">{err}</span>}
    </span>
  );
}
