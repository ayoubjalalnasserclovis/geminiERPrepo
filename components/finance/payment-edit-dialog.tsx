'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { updatePaymentAction } from '@/app/(team)/projects/[id]/payments/actions';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

/**
 * Modale d'édition d'un paiement honoraires.
 *
 * Tous les rôles autorisés (CEO, chef_projet, finance) peuvent saisir le
 * paiement reçu : montant payé, date du paiement, mode, notes.
 *
 * Décalage d'ÉCHÉANCE (due_date) : CEO + chef_projet + finance. Ouvert au
 * chef de projet depuis le 2026-07-10 (CEO) pour aligner date planifiée et
 * réalité chantier sans passer par la finance.
 *
 * Modification du MONTANT ATTENDU (amount_expected) : CEO + finance
 * uniquement — c'est un acte de pilotage barème/cabinet.
 */
export function PaymentEditDialog({
  payment,
  userRole,
}: {
  payment: any;
  userRole?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEditDueDate = userRole === 'ceo' || userRole === 'chef_projet' || userRole === 'finance';
  const canEditAmountExpected = userRole === 'ceo' || userRole === 'finance';

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const payload: any = {
        payment_id: payment.id,
        amount_paid: Number(form.get('amount_paid')),
        paid_at: (form.get('paid_at') as string) || null,
        payment_method: form.get('payment_method'),
        notes: form.get('notes'),
      };
      if (canEditDueDate) {
        payload.due_date = (form.get('due_date') as string) || null;
      }
      if (canEditAmountExpected) {
        const amt = form.get('amount_expected');
        if (amt !== null && amt !== '') {
          payload.amount_expected = Number(amt);
        }
      }
      const r = await updatePaymentAction(payload);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setOpen(false);
    });
  }

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <FinanceAuditButton table="payments" recordId={payment.id} />
        <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>Éditer</Button>
      </span>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form
            onSubmit={submit}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={e => e.stopPropagation()}
          >
            <h2 className="font-display text-xl">{payment.type}</h2>
            {!canEditDueDate && !canEditAmountExpected && (
              <p className="text-sm text-stoniz-gray-500">
                Montant attendu : {payment.amount_expected} €
              </p>
            )}

            {(canEditDueDate || canEditAmountExpected) && (
              <div className="rounded-lg border border-stoniz-gray-200 bg-stoniz-gray-50 p-3 space-y-3">
                <div className="text-xs uppercase tracking-wider text-stoniz-gray-600">
                  Échéancier
                </div>
                <div className={canEditAmountExpected ? 'grid grid-cols-2 gap-3' : ''}>
                  {canEditAmountExpected ? (
                    <div>
                      <Label>Montant attendu (€)</Label>
                      <Input
                        name="amount_expected"
                        type="number"
                        step="0.01"
                        min={Number(payment.amount_paid) || 0}
                        defaultValue={Number(payment.amount_expected)}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-stoniz-gray-500 mb-2">
                      Montant attendu : {payment.amount_expected} € (modifiable par CEO/Finance)
                    </p>
                  )}
                  {canEditDueDate && (
                    <div>
                      <Label>Date d'échéance</Label>
                      <Input
                        name="due_date"
                        type="date"
                        defaultValue={payment.due_date ?? ''}
                      />
                    </div>
                  )}
                </div>
                <p className="text-[11px] text-stoniz-gray-500">
                  Modifier la date déplace automatiquement l'alerte paiement liée à cette échéance.
                </p>
              </div>
            )}

            <div>
              <Label>Montant payé</Label>
              <Input name="amount_paid" type="number" step="0.01" defaultValue={payment.amount_paid} required />
            </div>
            <div>
              <Label>Date du paiement</Label>
              <Input name="paid_at" type="date" defaultValue={payment.paid_at ?? ''} />
            </div>
            <div>
              <Label>Mode de paiement</Label>
              <Input name="payment_method" defaultValue={payment.payment_method ?? ''} placeholder="Virement, espèces..." />
            </div>
            <div>
              <Label>Notes</Label>
              <Input name="notes" defaultValue={payment.notes ?? ''} />
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={pending}>{pending ? '…' : 'Enregistrer'}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
