'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Paperclip, Plus, X, FileText, Receipt } from 'lucide-react';
import { createVendorDocumentAction } from '@/app/actions/vendor-documents';
import { DeleteVendorDocButton } from '@/components/finance/delete-vendor-doc-button';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

/**
 * Picker de document fournisseur (facture ou devis).
 *
 * Affiche une liste des docs existants filtrés par vendor + permet d'en
 * créer un nouveau via formulaire intégré (création + upload PDF optionnel).
 *
 * Utilisable depuis n'importe quelle modale bulk (Achats, Travaux).
 */

type Doc = {
  id: string;
  doc_type: 'facture' | 'devis';
  reference: string | null;
  document_date: string | null;
  total_amount: number | null;
  currency: string | null;
  partner_id: string | null;
  artisan_id: string | null;
  vendor_label: string | null;
  file_path: string | null;
};

export function VendorDocPicker({
  vendorKind,
  partnerId,
  artisanId,
  vendorLabel,
  docType,
  onPicked,
  recentDocs,
}: {
  vendorKind: 'partner' | 'artisan';
  partnerId?: string | null;
  artisanId?: string | null;
  vendorLabel?: string | null;
  docType: 'facture' | 'devis' | 'bon_commande';
  onPicked: (docId: string) => void;
  /** Liste pré-chargée côté server (filtre vendor) */
  recentDocs: Doc[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [showNew, setShowNew] = useState(recentDocs.length === 0);
  const [err, setErr] = useState<string | null>(null);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // CEO 2026-06-22 : Garde-fou cause (e). Si aucun vendor n'a été passé en
  // props (parent oublie de pré-renseigner artisanId/partnerId/vendorLabel),
  // le doc serait créé orphelin côté serveur — on bloque dès le client pour
  // que le user voie immédiatement pourquoi ça ne marche pas.
  const hasVendorContext = !!(partnerId || artisanId || (vendorLabel && vendorLabel.trim()));

  // Resync showNew si la liste recentDocs change (ex : nouveau doc créé via
  // ce picker → router.refresh() → recentDocs maintenant non vide → on garde
  // showNew pour ne pas casser le flux en cours, mais on revient en mode
  // liste si recentDocs devient non vide ET que le user n'a pas commencé à
  // remplir le formulaire).
  useEffect(() => {
    // On bascule showNew=true seulement au mount initial si liste vide.
    // Évite le piège useState figé : si recentDocs passe de [] à [x] entre
    // mount et un refresh externe, on respecte la transition.
    if (recentDocs.length === 0 && !pickedId) {
      setShowNew(true);
    }
  }, [recentDocs.length, pickedId]);

  function pick(id: string) {
    setPickedId(id);
    onPicked(id);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!hasVendorContext) {
      setErr('Sélectionne d’abord un fournisseur (artisan, partner ou libellé).');
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set('doc_type', docType);
    fd.set('vendor_kind', vendorKind);
    if (partnerId) fd.set('partner_id', partnerId);
    if (artisanId) fd.set('artisan_id', artisanId);
    if (vendorLabel) fd.set('vendor_label', vendorLabel);

    setErr(null);
    start(async () => {
      const r = await createVendorDocumentAction(fd)
        .catch((ex: any) => ({ ok: false as const, error: ex?.message ?? 'Erreur' }));
      if (!(r as any).ok) {
        setErr((r as any).error ?? 'Échec');
        return;
      }
      const newId = (r as any).id;
      setPickedId(newId);
      onPicked(newId);
      router.refresh();
    });
  }

  const docLabel = docType === 'facture' ? 'facture' : 'devis';
  const Icon = docType === 'facture' ? Receipt : FileText;

  return (
    <div className="space-y-3">
      {/* Liste docs existants */}
      {recentDocs.length > 0 && !showNew && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-stoniz-gray-700 mb-1">
            Documents {docLabel}s récents :
          </div>
          {recentDocs.slice(0, 8).map((d) => (
            <div
              key={d.id}
              className={`w-full px-3 py-2 rounded border text-xs flex items-center gap-2 ${pickedId === d.id ? 'border-emerald-500 bg-emerald-50' : 'border-stoniz-gray-200 hover:bg-stoniz-gray-50'}`}
            >
              <button
                type="button"
                onClick={() => pick(d.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left"
              >
                <Icon className="w-3.5 h-3.5 shrink-0 text-stoniz-gray-500" />
                <span className="flex-1 truncate">
                  <span className="font-medium">{d.reference ?? '(sans ref)'}</span>
                  {d.document_date && <span className="text-stoniz-gray-500"> · {d.document_date}</span>}
                  {d.total_amount && (
                    <span className="text-stoniz-gray-500"> · {Intl.NumberFormat('fr-FR').format(Number(d.total_amount))} {d.currency ?? 'MAD'}</span>
                  )}
                </span>
                {d.file_path && <Paperclip className="w-3 h-3 text-blue-600" />}
                {pickedId === d.id && <span className="text-emerald-700 text-[10px]">✓</span>}
              </button>
              {/* CEO 2026-06-30 : permettre de supprimer un doc directement
                  depuis le picker (utile travaux/achats si mauvais upload).
                  Permissions back : ceo/chef_projet/achats/assistante. */}
              <div className="flex items-center gap-1 shrink-0">
                <FinanceAuditButton table="vendor_documents" recordId={d.id} size="sm" />
                <DeleteVendorDocButton docId={d.id} label={docLabel} />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setShowNew(true)}
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-1"
          >
            <Plus className="w-3 h-3" /> Créer un nouveau {docLabel}
          </button>
        </div>
      )}

      {/* Formulaire création */}
      {showNew && (
        <form onSubmit={submit} className="space-y-2 border border-stoniz-gray-200 rounded p-3 bg-stoniz-beige">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium">Nouveau {docLabel}</div>
            {recentDocs.length > 0 && (
              <button type="button" onClick={() => setShowNew(false)}
                className="text-xs text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1">
                <X className="w-3 h-3" /> Annuler
              </button>
            )}
          </div>
          {/* CEO 2026-06-22 : feedback explicite sur le fournisseur cible.
              Permet au user de voir à qui le doc va être attribué AVANT submit.
              Si rien n'est passé en props, on affiche un bandeau rouge. */}
          {hasVendorContext ? (
            <div className="text-[11px] text-stoniz-gray-700 bg-white border border-stoniz-gray-200 rounded px-2 py-1">
              Sera attribué à : <strong>{vendorLabel ?? (vendorKind === 'artisan' ? 'l’artisan sélectionné' : 'le partenaire sélectionné')}</strong>
              {(artisanId || partnerId) && (
                <span className="text-stoniz-gray-500"> (lien direct ✓)</span>
              )}
              {!artisanId && !partnerId && vendorLabel && (
                <span className="text-amber-700"> (libellé seul — sera lié auto si match exact)</span>
              )}
            </div>
          ) : (
            <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
              Aucun fournisseur fourni au formulaire — sélectionne d’abord un artisan/partenaire dans le lot avant d’importer un document.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <input name="reference" placeholder="N° du document" className="border border-stoniz-gray-300 rounded px-2 py-1 text-xs" />
            <input name="document_date" type="date" className="border border-stoniz-gray-300 rounded px-2 py-1 text-xs" />
            <input name="total_amount" type="number" step="0.01" placeholder="Montant total" className="border border-stoniz-gray-300 rounded px-2 py-1 text-xs" />
            <select name="currency" defaultValue="MAD" className="border border-stoniz-gray-300 rounded px-2 py-1 text-xs">
              <option value="MAD">MAD</option>
              <option value="EUR">EUR</option>
            </select>
          </div>
          <input name="notes" placeholder="Notes (optionnel)" className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs" />
          <div className="flex items-center gap-2">
            <label className="text-xs text-stoniz-gray-600">PDF / photo :</label>
            <input name="file" type="file" accept="application/pdf,image/*" className="text-xs flex-1" />
          </div>
          {err && <div className="text-xs text-red-600">{err}</div>}
          <button
            type="submit"
            disabled={pending || !hasVendorContext}
            title={!hasVendorContext ? 'Sélectionne un fournisseur avant de créer le document.' : undefined}
            className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs hover:bg-stoniz-gray-800 disabled:opacity-50"
          >
            {pending ? 'Création…' : `Créer le ${docLabel}`}
          </button>
        </form>
      )}
    </div>
  );
}
