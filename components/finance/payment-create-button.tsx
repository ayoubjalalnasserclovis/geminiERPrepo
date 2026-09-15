'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { createStonizPaymentAction } from '@/app/(team)/projects/[id]/payments/actions';

/**
 * Bouton pour créer une ligne de paiement (jalon Stoniz manquant en base).
 * Utilisé sur la page paiements pour les projets PROPRIA legacy ou
 * tout cas où la ligne template n'a pas encore de record DB.
 */
export function PaymentCreateButton({
  projectId,
  type,
  label,
  amountExpected,
  duePhase,
  variant = 'inline',
}: {
  projectId: string;
  type: string;
  label: string;
  amountExpected: number;
  duePhase?: string;
  variant?: 'inline' | 'header';
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amountPaid, setAmountPaid] = useState(String(amountExpected));
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const router = useRouter();

  function submit() {
    setError(null);
    start(async () => {
      const r = await createStonizPaymentAction({
        project_id: projectId,
        type,
        amount_expected: amountExpected,
        amount_paid: Number(amountPaid),
        due_at_phase: duePhase ?? null,
        due_date: paidAt,
        paid_at: Number(amountPaid) >= amountExpected ? paidAt : null,
        notes: notes || null,
      });
      if (!r.ok) {
        setError(r.error ?? 'Erreur');
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {variant === 'inline' ? (
        <button
          onClick={() => setOpen(true)}
          className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline"
        >
          Créer
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-3 py-1.5 rounded border border-stoniz-gray-300 hover:bg-stoniz-gray-50 flex items-center gap-1"
        >
          <Plus className="w-3.5 h-3.5" />
          Ajouter un paiement
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-2">Créer le paiement — {label}</h3>
            <p className="text-xs text-stoniz-gray-500 mb-4">
              Saisie rétroactive d'un jalon Stoniz (utile pour les projets PROPRIA déjà
              livrés où les honoraires ont déjà été encaissés).
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                  Montant payé (€)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={amountPaid}
                  onChange={(e) => setAmountPaid(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
                <p className="text-xs text-stoniz-gray-500 mt-1">
                  Attendu : {amountExpected.toLocaleString('fr-FR')} €
                </p>
              </div>
              <div>
                <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                  Date du paiement
                </label>
                <input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                  Notes (optionnel)
                </label>
                <input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ex: paiement historique 2024"
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-700 mt-3 bg-red-50 p-2 rounded">{error}</div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-4 py-2 text-sm border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={pending || !amountPaid}
                className="px-4 py-2 text-sm bg-stoniz-black text-white rounded hover:bg-stoniz-gray-800 disabled:opacity-40"
              >
                {pending ? '…' : 'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
