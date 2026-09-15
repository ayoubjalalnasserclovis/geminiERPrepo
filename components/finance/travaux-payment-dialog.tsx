'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { createTravauxPaymentAction } from '@/app/(team)/projects/[id]/payments/actions';

export function TravauxPaymentDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(form.entries());
    if (data.amount_total) data.amount_total = Number(data.amount_total);
    if (data.exchange_rate_eur) data.exchange_rate_eur = Number(data.exchange_rate_eur);
    else data.exchange_rate_eur = null;
    if (data.scheduled_date === '') data.scheduled_date = null;
    if (data.category === '') data.category = null;
    data.project_id = projectId;

    setError(null);
    start(async () => {
      const r = await createTravauxPaymentAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setOpen(false);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>+ Paiement artisan</Button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-xl">Nouveau paiement artisan</h2>
            <div>
              <Label>Nom de l'artisan</Label>
              <Input name="artisan_name" required />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Catégorie</Label>
                <select name="category" className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                  <option value="">—</option>
                  <option value="gros_oeuvre">Gros œuvre</option>
                  <option value="plomberie">Plomberie</option>
                  <option value="electricite">Électricité</option>
                  <option value="menuiserie">Menuiserie</option>
                  <option value="peinture">Peinture</option>
                  <option value="deco">Déco</option>
                  <option value="fournitures">Fournitures</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
              <div>
                <Label>Type</Label>
                <select name="payment_type" className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                  <option value="acompte">Acompte</option>
                  <option value="solde">Solde</option>
                  <option value="autre">Autre</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Montant total (MAD)</Label>
                <Input name="amount_total" type="number" step="0.01" required />
              </div>
              <div>
                <Label>Taux EUR/MAD (auto)</Label>
                <Input name="exchange_rate_eur" type="number" step="0.0001" placeholder="auto si vide" />
              </div>
            </div>
            <div>
              <Label>Date prévue</Label>
              <Input name="scheduled_date" type="date" />
            </div>
            <div>
              <Label>Description</Label>
              <Input name="description" />
            </div>
            <input type="hidden" name="currency" value="MAD" />
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={pending}>{pending ? '…' : 'Créer'}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
