'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { CheckSquare, Square, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ceoBulkApproveAction, ceoBulkMarkPaidAction } from '@/app/(team)/validations/actions';

type ApprovalLight = {
  id: string;
  amount: number;
  currency: string;
  beneficiary_name: string | null;
  description: string | null;
  urgency: 'normal' | 'urgent';
};

/**
 * Panel CEO bulk-approve (CEO 2026-09-16).
 * - Bandeau sticky en haut : "Sélectionner tout", "Valider en masse (N)"
 * - Chaque enfant (ApprovalCard) est wrapped dans un div avec checkbox à gauche
 * - État de sélection Set<string>. Confirmation modale avant envoi.
 */
export function CeoBulkPanel({
  approvals,
  children,
  mode = 'approve',
}: {
  approvals: ApprovalLight[];
  children: ReactNode[];
  /** 'approve' : tab ceo_pending → CEO valide. 'pay' : tab to_pay → CEO marque payé. */
  mode?: 'approve' | 'pay';
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('virement');
  const [paymentReference, setPaymentReference] = useState('');
  const isPay = mode === 'pay';

  const totalByCurrency = useMemo(() => {
    const m: Record<string, number> = {};
    for (const a of approvals) {
      if (!selected.has(a.id)) continue;
      m[a.currency] = (m[a.currency] ?? 0) + Number(a.amount ?? 0);
    }
    return m;
  }, [approvals, selected]);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev => {
      if (prev.size === approvals.length) return new Set();
      return new Set(approvals.map(a => a.id));
    });
  }

  function submit() {
    if (selected.size === 0) return;
    setError(null);
    const ids = Array.from(selected);
    start(async () => {
      const r = isPay
        ? await ceoBulkMarkPaidAction(ids, paymentMethod || undefined, paymentReference.trim() || undefined)
        : await ceoBulkApproveAction(ids, 'approved', notes.trim() || undefined);
      if (!r.ok && r.count_ok === 0) {
        setError(r.error ?? `Échec sur ${r.count_errors ?? 0} demande(s)`);
        return;
      }
      // Succès partiel ou total → rafraîchir
      setConfirm(false);
      setSelected(new Set());
      setNotes('');
      setPaymentReference('');
      router.refresh();
    });
  }

  const all = selected.size === approvals.length && approvals.length > 0;

  return (
    <div>
      {/* Bandeau CEO — sticky en haut */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-2 border-stoniz-black rounded-md p-3 mb-4 shadow-sm">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={toggleAll}
              className="inline-flex items-center gap-1.5 text-sm hover:bg-stoniz-gray-50 px-2 py-1 rounded"
            >
              {all ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
              {all ? 'Tout désélectionner' : `Sélectionner tout (${approvals.length})`}
            </button>
            {selected.size > 0 && (
              <div className="text-sm">
                <strong>{selected.size}</strong> sélectionnée(s) ·{' '}
                {Object.entries(totalByCurrency).map(([cur, tot], i) => (
                  <span key={cur}>
                    {i > 0 && ' + '}
                    <strong>{new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(tot)} {cur}</strong>
                  </span>
                ))}
              </div>
            )}
          </div>
          <Button
            size="sm"
            onClick={() => { setError(null); setConfirm(true); }}
            disabled={selected.size === 0 || pending}
          >
            {isPay ? `✓ Marquer payé en masse (${selected.size})` : `✓ Valider en masse (${selected.size})`}
          </Button>
        </div>
        {error && <div className="mt-2 text-sm text-red-600 flex items-center gap-1">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>}
      </div>

      {/* Liste des cartes existantes, wrap avec checkbox à gauche */}
      <div className="space-y-3">
        {children.map((child, i) => {
          const a = approvals[i];
          if (!a) return child;
          const checked = selected.has(a.id);
          return (
            <div key={a.id} className={`flex items-start gap-3 ${checked ? 'bg-stoniz-beige/30 rounded-md ring-2 ring-stoniz-black -m-1 p-1' : ''}`}>
              <button
                type="button"
                onClick={() => toggle(a.id)}
                className="mt-4 flex-shrink-0 p-1 hover:bg-stoniz-gray-100 rounded"
                aria-label={checked ? 'Désélectionner' : 'Sélectionner'}
              >
                {checked ? <CheckSquare className="w-5 h-5 text-stoniz-black" /> : <Square className="w-5 h-5 text-stoniz-gray-400" />}
              </button>
              <div className="flex-1 min-w-0">{child}</div>
            </div>
          );
        })}
      </div>

      {/* Modale confirmation */}
      {confirm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
             onClick={() => !pending && setConfirm(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
               onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold">
                {isPay ? 'Marquer comme payé en masse' : 'Validation en masse'}
              </h3>
              <p className="text-sm text-stoniz-gray-600 mt-1">
                {isPay ? (
                  <>Tu vas marquer <strong>{selected.size}</strong> demande(s) comme payées pour un total de{' '}</>
                ) : (
                  <>Tu vas approuver <strong>{selected.size}</strong> demande(s) pour un total de{' '}</>
                )}
                {Object.entries(totalByCurrency).map(([cur, tot], i) => (
                  <span key={cur}>
                    {i > 0 && ' + '}
                    <strong>{new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(tot)} {cur}</strong>
                  </span>
                ))}.
                {isPay
                  ? ' Le paiement source (achats/travaux/honoraires) sera mis à jour et le demandeur recevra un email de confirmation.'
                  : ' Le demandeur de chaque ligne recevra un email de confirmation.'
                }
              </p>
            </div>
            {isPay ? (
              <>
                <div>
                  <label className="block text-sm font-medium mb-1">Méthode de paiement</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    disabled={pending}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  >
                    <option value="virement">Virement bancaire</option>
                    <option value="cheque">Chèque</option>
                    <option value="especes">Espèces</option>
                    <option value="carte">Carte bancaire</option>
                    <option value="autre">Autre</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">
                    Référence (optionnel — appliquée à toutes)
                  </label>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Ex : relevé Chaabi 16/09 · virement groupé"
                    disabled={pending}
                    className="w-full border rounded-md px-3 py-2 text-sm"
                  />
                  <div className="text-xs text-stoniz-gray-500 mt-1">
                    Preuve fichier : à uploader individuellement plus tard depuis chaque fiche.
                  </div>
                </div>
              </>
            ) : (
              <div>
                <label className="block text-sm font-medium mb-1">
                  Notes (optionnel — appliquées à toutes les demandes)
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Ex : validation groupée après revue tréso du 16/09"
                  className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-stoniz-black"
                  disabled={pending}
                />
              </div>
            )}
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirm(false)}
                disabled={pending}
                className="px-4 py-2 text-sm rounded-md border hover:bg-stoniz-gray-50"
              >
                Annuler
              </button>
              <Button size="sm" onClick={submit} disabled={pending || selected.size === 0}>
                {pending ? 'Validation en cours…' : `✓ Approuver ${selected.size} demande(s)`}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
