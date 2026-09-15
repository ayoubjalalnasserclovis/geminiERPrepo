'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { createClientAction, updateClientAction } from '@/app/(team)/clients/actions';

type ClientInput = {
  id?: string;
  full_name?: string;
  email?: string;
  phone?: string | null;
  nationality?: string | null;
  budget_min?: number | null;
  budget_max?: number | null;
  available_savings?: number | null;
  credit_type?: 'yes'|'no'|'islamic' | null;
  signature_mode?: 'distance'|'presentiel' | null;
  specificities?: string | null;
  comments?: string | null;
};

export function ClientForm({ client }: { client?: ClientInput }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(form.entries());
    // Cast numbers
    ['budget_min','budget_max','available_savings'].forEach(k => {
      if (data[k] === '') data[k] = null;
      else if (data[k]) data[k] = Number(data[k]);
    });
    if (data.credit_type === '') data.credit_type = null;
    if (data.signature_mode === '') data.signature_mode = null;

    const res = client?.id
      ? await updateClientAction(client.id, data)
      : await createClientAction(data);

    setLoading(false);
    if (!res.ok) { setError(res.error ?? 'Erreur'); return; }
    router.push(client?.id ? `/clients/${client.id}` : `/clients/${(res as any).id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="space-y-4">
        <h3 className="font-display text-lg">Identité</h3>
        <p className="text-xs text-stoniz-gray-600 -mt-2">
          Le client renseignera son cahier des charges (budget, type de bien, etc.) lors de son onboarding sur l'app.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="full_name">Nom complet *</Label>
            <Input id="full_name" name="full_name" defaultValue={client?.full_name ?? ''} required />
          </div>
          <div>
            <Label htmlFor="email">Email *</Label>
            <Input id="email" name="email" type="email" defaultValue={client?.email ?? ''} required />
          </div>
          <div>
            <Label htmlFor="phone">Téléphone</Label>
            <Input id="phone" name="phone" placeholder="+33..." defaultValue={client?.phone ?? ''} />
          </div>
          <div>
            <Label htmlFor="nationality">Nationalité (code ISO)</Label>
            <Input id="nationality" name="nationality" placeholder="FR, CH, BE..." defaultValue={client?.nationality ?? ''} />
          </div>
        </div>
      </Card>

      <details className="bg-white border border-stoniz-gray-200 rounded-xl">
        <summary className="cursor-pointer px-6 py-4 font-display text-lg hover:bg-stoniz-gray-50 rounded-xl">
          + Pré-remplir le cahier des charges (optionnel)
        </summary>
        <div className="px-6 pb-6 space-y-5">
          <p className="text-xs text-stoniz-gray-600">
            Tu peux saisir ici ce que le client t'a déjà communiqué — il pourra compléter / modifier ensuite via son espace.
          </p>

          <div>
            <h4 className="font-medium text-sm mb-3">Financier</h4>
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="budget_min">Budget min (€)</Label>
                <Input id="budget_min" name="budget_min" type="number" defaultValue={client?.budget_min ?? ''} />
              </div>
              <div>
                <Label htmlFor="budget_max">Budget max (€)</Label>
                <Input id="budget_max" name="budget_max" type="number" defaultValue={client?.budget_max ?? ''} />
              </div>
              <div>
                <Label htmlFor="available_savings">Épargne disponible (€)</Label>
                <Input id="available_savings" name="available_savings" type="number" defaultValue={client?.available_savings ?? ''} />
              </div>
              <div>
                <Label htmlFor="credit_type">Crédit</Label>
                <select id="credit_type" name="credit_type" defaultValue={client?.credit_type ?? ''}
                  className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                  <option value="">—</option>
                  <option value="yes">Oui</option>
                  <option value="no">Non</option>
                  <option value="islamic">Islamique</option>
                </select>
              </div>
              <div>
                <Label htmlFor="signature_mode">Mode de signature</Label>
                <select id="signature_mode" name="signature_mode" defaultValue={client?.signature_mode ?? ''}
                  className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                  <option value="">—</option>
                  <option value="distance">À distance</option>
                  <option value="presentiel">Présentiel</option>
                </select>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm mb-3">Spécificités &amp; commentaires</h4>
            <div className="space-y-3">
              <div>
                <Label htmlFor="specificities">Cahier des charges détaillé</Label>
                <Textarea id="specificities" name="specificities" rows={3} defaultValue={client?.specificities ?? ''} />
              </div>
              <div>
                <Label htmlFor="comments">Commentaires internes</Label>
                <Textarea id="comments" name="comments" rows={2} defaultValue={client?.comments ?? ''} />
              </div>
            </div>
          </div>
        </div>
      </details>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
        <Button type="submit" disabled={loading}>{loading ? 'Enregistrement…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}
