'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { createPartnerAction, updatePartnerAction } from '@/app/(team)/partners/actions';

export function PartnerForm({ partner }: { partner?: any }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(form.entries());
    data.contract_signed = form.get('contract_signed') === 'on';
    data.has_whatsapp_group = form.get('has_whatsapp_group') === 'on';
    if (data.evaluation === '') data.evaluation = null;
    else if (data.evaluation) data.evaluation = Number(data.evaluation);

    // Téléphone : doit commencer par + et indicatif (E.164)
    const phoneRaw = String(data.phone ?? '').trim();
    if (!phoneRaw) {
      setLoading(false);
      setError('Le téléphone est obligatoire (avec indicatif pays, ex : +212 6 12 34 56 78).');
      return;
    }
    if (!/^\+\d{1,4}[\s\d-]{6,}$/.test(phoneRaw)) {
      setLoading(false);
      setError('Format téléphone invalide. Utilisez l\'indicatif international, ex : +212 6 12 34 56 78.');
      return;
    }
    data.phone = phoneRaw;

    const res = partner?.id
      ? await updatePartnerAction(partner.id, data)
      : await createPartnerAction(data);

    setLoading(false);
    if (!res.ok) { setError(res.error ?? 'Erreur'); return; }
    router.push(partner?.id ? `/partners/${partner.id}` : `/partners/${(res as any).id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Nom de l'agence *</Label>
            <Input name="agency_name" defaultValue={partner?.agency_name ?? ''} required />
          </div>
          <div>
            <Label>Contact principal</Label>
            <Input name="contact_name" defaultValue={partner?.contact_name ?? ''} />
          </div>
          <div>
            <Label>Téléphone * <span className="text-xs text-stoniz-gray-500 font-normal">(avec indicatif, ex : +212 6 12 34 56 78)</span></Label>
            <Input
              name="phone"
              type="tel"
              required
              placeholder="+212 6 12 34 56 78"
              pattern="^\+\d{1,4}[\s\d-]{6,}$"
              title="Format international requis : indicatif pays (+212, +33…) suivi du numéro"
              defaultValue={partner?.phone ?? ''}
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input name="email" type="email" defaultValue={partner?.email ?? ''} />
          </div>
          <div>
            <Label>Statut</Label>
            <select name="status" defaultValue={partner?.status ?? 'actif'}
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="actif">Actif</option>
              <option value="inactif">Inactif</option>
              <option value="prospect">Prospect</option>
            </select>
          </div>
          <div>
            <Label>Évaluation (1-3)</Label>
            <select name="evaluation" defaultValue={partner?.evaluation ?? ''}
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              <option value="1">⭐</option>
              <option value="2">⭐⭐</option>
              <option value="3">⭐⭐⭐</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" name="contract_signed" defaultChecked={partner?.contract_signed} />
            <Label className="mb-0">Contrat signé</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" name="has_whatsapp_group" defaultChecked={partner?.has_whatsapp_group} />
            <Label className="mb-0">Groupe WhatsApp</Label>
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <Textarea name="notes" rows={3} defaultValue={partner?.notes ?? ''} />
        </div>
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
        <Button type="submit" disabled={loading}>{loading ? '…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}
