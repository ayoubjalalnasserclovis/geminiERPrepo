'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Receipt, X } from 'lucide-react';
import { attachAchatDocAction } from '@/app/(team)/projects/[id]/achats/actions';
import { getVendorDocumentSignedUrlByIdAction } from '@/app/actions/vendor-documents';
import { VendorDocPicker } from '@/components/vendor-documents/vendor-doc-picker';
import { DeleteVendorDocButton } from '@/components/finance/delete-vendor-doc-button';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

/**
 * Section "Documents fournisseur" sur la fiche d'un lot achats (CEO 2026-06-18 B5).
 *
 * 3 zones : Devis · Bon de commande · Facture. Pour chaque zone :
 *   - si attaché : référence + lien doc + bouton détacher
 *   - sinon : bouton "Attacher" qui ouvre le VendorDocPicker
 *
 * Permissions : ceo / finance / assistante / achats.
 */

type DocKind = 'quote' | 'purchase_order' | 'invoice';

type AttachedDoc = {
  id: string;
  reference: string | null;
  document_date: string | null;
  file_path: string | null;
};

export function AchatLotDocuments({
  lotId,
  supplierId,
  quote,
  purchaseOrder,
  invoice,
  recentDocs,
}: {
  lotId: string;
  supplierId: string | null;
  quote: AttachedDoc | null;
  purchaseOrder: AttachedDoc | null;
  invoice: AttachedDoc | null;
  recentDocs: any[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [picker, setPicker] = useState<DocKind | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function attach(role: DocKind, docId: string | null) {
    setErr(null);
    start(async () => {
      const r = await attachAchatDocAction({ lot_id: lotId, doc_id: docId, doc_role: role });
      if (!r.ok) { setErr(r.error); return; }
      setPicker(null);
      setPickedId(null);
      router.refresh();
    });
  }

  /**
   * CEO 2026-06-25 — Fix 404 "voir facture" : on a longtemps pointé un
   * `<a href="/api/vendor-documents/.../download">` qui n'existait pas.
   * Désormais, helper canonique côté server qui retourne `{ok, url}` ou une
   * cause précise (`not_found`, `no_file`, `no_perm`, `storage_error`).
   */
  async function openDoc(docId: string) {
    setErr(null);
    try {
      const r = await getVendorDocumentSignedUrlByIdAction(docId);
      if (!r.ok) {
        const msg =
          r.error === 'not_found' ? 'Document introuvable (supprimé ?)'
          : r.error === 'no_file'  ? 'Aucun fichier attaché à ce document.'
          : r.error === 'no_perm'  ? 'Permission refusée.'
          : r.error === 'storage_error' ? 'Erreur de stockage — réessayer.'
          : 'Erreur — merci de réessayer.';
        setErr(msg);
        return;
      }
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch {
      setErr('Erreur réseau — merci de réessayer.');
    }
  }

  function Tile({ kind, doc, title, icon: Icon, palette }: {
    kind: DocKind;
    doc: AttachedDoc | null;
    title: string;
    icon: any;
    palette: string;
  }) {
    const docTypeForPicker = kind === 'invoice' ? 'facture' : kind === 'quote' ? 'devis' : 'bon_commande';
    return (
      <div className={`border rounded-lg p-3 ${doc ? palette : 'border-stoniz-gray-200 bg-stoniz-gray-50/40'}`}>
        <div className="flex items-center gap-2 mb-1.5">
          <Icon className="w-4 h-4 text-stoniz-gray-600" />
          <h5 className="text-sm font-medium">{title}</h5>
        </div>
        {doc ? (
          <div>
            <div className="text-xs text-stoniz-gray-700">
              <strong>{doc.reference ?? '(sans réf.)'}</strong>
              {doc.document_date && <span className="text-stoniz-gray-500"> · {doc.document_date}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {doc.file_path && (
                <button type="button"
                  onClick={() => openDoc(doc.id)}
                  className="text-xs text-blue-600 hover:underline">
                  Voir
                </button>
              )}
              <button type="button"
                onClick={() => attach(kind, null)}
                disabled={pending}
                className="text-xs text-stoniz-gray-500 hover:text-red-600 inline-flex items-center gap-0.5">
                <X className="w-3 h-3" /> Détacher
              </button>
              {/* CEO 2026-06-30 : Supprimer définitivement (soft-delete) le doc
                  + Historique des actions. 4 rôles : ceo / chef_projet / achats /
                  assistante. Permet le ré-upload immédiat (le slot devient libre). */}
              <DeleteVendorDocButton docId={doc.id} label={title} inline />
              <FinanceAuditButton table="vendor_documents" recordId={doc.id} size="sm" inline />
            </div>
          </div>
        ) : (
          <button type="button"
            onClick={() => { setPicker(kind); setPickedId(null); setErr(null); }}
            className="text-xs text-blue-600 hover:underline">
            + Attacher
          </button>
        )}

        {/* Picker inline si on a cliqué attacher sur cette tuile */}
        {picker === kind && (
          <div className="mt-2 space-y-2 border-t border-stoniz-gray-200 pt-2">
            {!supplierId ? (
              <p className="text-xs text-orange-700">Affecte d&apos;abord un fournisseur au lot.</p>
            ) : (
              <>
                {/* Fix Chadi 2026-06-18 : artisan, pas partner (B1) */}
                <VendorDocPicker
                  vendorKind="artisan"
                  artisanId={supplierId}
                  docType={docTypeForPicker as any}
                  onPicked={setPickedId}
                  recentDocs={recentDocs.filter((d: any) => d.artisan_id === supplierId && d.doc_type === docTypeForPicker)}
                />
                <div className="flex gap-2">
                  <button type="button"
                    onClick={() => pickedId && attach(kind, pickedId)}
                    disabled={pending || !pickedId}
                    className="bg-stoniz-black text-white px-2 py-1 rounded text-xs disabled:opacity-50">
                    {pending ? '…' : 'Attacher'}
                  </button>
                  <button type="button" onClick={() => { setPicker(null); setPickedId(null); }}
                    className="text-xs text-stoniz-gray-500 hover:text-stoniz-black px-2 py-1">
                    Annuler
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border-t pt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="font-medium text-sm">📎 Documents fournisseur</h4>
      </div>
      {err && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
          {err}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Tile kind="quote" doc={quote} title="Devis"
          icon={FileText} palette="border-purple-300 bg-purple-50/40" />
        <Tile kind="purchase_order" doc={purchaseOrder} title="Bon de commande"
          icon={FileText} palette="border-amber-300 bg-amber-50/40" />
        <Tile kind="invoice" doc={invoice} title="Facture"
          icon={Receipt} palette="border-blue-300 bg-blue-50/40" />
      </div>
    </div>
  );
}
