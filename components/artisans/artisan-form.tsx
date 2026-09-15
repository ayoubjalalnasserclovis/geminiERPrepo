'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { createArtisanAction, updateArtisanAction } from '@/app/(team)/artisans/actions';
import {
  ARTISAN_TYPE_LABELS, ARTISAN_LEGAL_FORMS, ARTISAN_STATUSES,
} from '@/lib/finance/artisans-constants';
import {
  BUSINESS_SCOPES, getSpecialitiesForScope, type BusinessScope,
} from '@/lib/artisans/specialities';

export function ArtisanForm({ artisan }: { artisan?: any }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<BusinessScope>(artisan?.business_scope ?? 'travaux');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());

    const res = artisan?.id
      ? await updateArtisanAction(artisan.id, data)
      : await createArtisanAction(data);
    setLoading(false);
    if (!res.ok) { setError(res.error ?? 'Erreur'); return; }
    router.push(artisan?.id ? `/artisans/${artisan.id}` : `/artisans/${(res as any).id}`);
    router.refresh();
  }

  const specialities = getSpecialitiesForScope(scope);

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="space-y-4">
        <h3 className="font-display text-lg">Identification</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>Nom / raison sociale *</Label>
            <Input name="name" defaultValue={artisan?.name ?? ''} required
              placeholder="Atlas Maçonnerie SARL" />
          </div>
          <div>
            <Label>Forme juridique</Label>
            <select name="legal_form" defaultValue={artisan?.legal_form ?? ''}
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              {Object.entries(ARTISAN_LEGAL_FORMS).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <Label>Type *</Label>
            <select name="type" defaultValue={artisan?.type ?? 'artisan_local'} required
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              {Object.entries(ARTISAN_TYPE_LABELS).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Périmètre d'activité *</Label>
            <div className="grid grid-cols-3 gap-2">
              {BUSINESS_SCOPES.map(s => (
                <label
                  key={s.value}
                  className={`flex flex-col items-start gap-1 border rounded-md px-3 py-2 cursor-pointer transition-colors text-sm ${
                    scope === s.value
                      ? 'border-stoniz-black bg-cream-soft'
                      : 'border-grey-line hover:border-stoniz-black/40'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="business_scope"
                      value={s.value}
                      checked={scope === s.value}
                      onChange={() => setScope(s.value)}
                    />
                    <span className="font-medium">{s.label}</span>
                  </div>
                  <span className="text-[11px] text-stoniz-gray-500 pl-5">{s.hint}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="md:col-span-2">
            <Label>
              Spécialité principale
              <span className="text-xs text-stoniz-gray-500 font-normal ml-2">
                (filtrée selon le périmètre choisi)
              </span>
            </Label>
            <select
              name="speciality"
              defaultValue={artisan?.speciality ?? ''}
              key={scope /* reset selection si scope change */}
              className="w-full h-10 rounded-md border bg-white px-3 text-sm"
            >
              <option value="">—</option>
              {specialities.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <Label>Statut *</Label>
            <select name="status" defaultValue={artisan?.status ?? 'actif'} required
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              {Object.entries(ARTISAN_STATUSES).map(([v, l]) =>
                <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <Label>Évaluation (1-5)</Label>
            <select name="evaluation" defaultValue={artisan?.evaluation ?? ''}
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              <option value="1">⭐</option>
              <option value="2">⭐⭐</option>
              <option value="3">⭐⭐⭐</option>
              <option value="4">⭐⭐⭐⭐</option>
              <option value="5">⭐⭐⭐⭐⭐</option>
            </select>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Société (fiscal & légal)</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>ICE</Label>
            <Input name="ice" defaultValue={artisan?.ice ?? ''}
              placeholder="15 chiffres" />
          </div>
          <div>
            <Label>RC (Registre du Commerce)</Label>
            <Input name="rc" defaultValue={artisan?.rc ?? ''} />
          </div>
          <div>
            <Label>Identifiant fiscal (IF)</Label>
            <Input name="if_number" defaultValue={artisan?.if_number ?? ''} />
          </div>
          <div>
            <Label>N° patente</Label>
            <Input name="patente" defaultValue={artisan?.patente ?? ''} />
          </div>
          <div>
            <Label>N° CNSS</Label>
            <Input name="cnss" defaultValue={artisan?.cnss ?? ''} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Contact</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Nom du contact principal</Label>
            <Input name="contact_name" defaultValue={artisan?.contact_name ?? ''}
              placeholder="Hassan El Idrissi" />
          </div>
          <div>
            <Label>Téléphone</Label>
            <Input name="phone" defaultValue={artisan?.phone ?? ''}
              placeholder="+212 6 61 12 34 56" />
          </div>
          <div>
            <Label>WhatsApp</Label>
            <Input name="whatsapp" defaultValue={artisan?.whatsapp ?? ''}
              placeholder="+212 6 61 12 34 56" />
          </div>
          <div>
            <Label>Email</Label>
            <Input name="email" type="email" defaultValue={artisan?.email ?? ''} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Adresse</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>Adresse</Label>
            <Input name="address" defaultValue={artisan?.address ?? ''} />
          </div>
          <div>
            <Label>Ville</Label>
            <Input name="city" defaultValue={artisan?.city ?? 'Marrakech'} />
          </div>
          <div>
            <Label>Code postal</Label>
            <Input name="postal_code" defaultValue={artisan?.postal_code ?? ''} />
          </div>
          <div>
            <Label>Pays</Label>
            <Input name="country" defaultValue={artisan?.country ?? 'Maroc'} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Bancaire</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Banque</Label>
            <Input name="bank_name" defaultValue={artisan?.bank_name ?? ''}
              placeholder="Attijariwafa Bank" />
          </div>
          <div>
            <Label>RIB</Label>
            <Input name="rib" defaultValue={artisan?.rib ?? ''}
              placeholder="24 chiffres" />
          </div>
          {/* CEO 2026-06-18 : nom du titulaire du compte (peut différer du nom de l'artisan) */}
          <div className="md:col-span-2">
            <Label>Nom du titulaire du compte</Label>
            <Input name="bank_account_holder" defaultValue={artisan?.bank_account_holder ?? ''}
              placeholder="Nom exact figurant sur le RIB (optionnel)" />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Notes internes</h3>
        <Textarea name="notes" rows={4} defaultValue={artisan?.notes ?? ''}
          placeholder="Qualité d'exécution, ponctualité, recommandation…" />
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
        <Button type="submit" disabled={loading}>{loading ? '…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}
