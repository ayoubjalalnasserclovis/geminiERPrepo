'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { saveBriefAction, sendBriefToClientAction } from '@/app/(team)/projects/[id]/brief/actions';

const PROPERTY_TYPES = ['Appartement','Riad','Villa','Terrain'];
const QUARTIERS = ['Gueliz','Hivernage','Majorelle','Victor Hugo','Semlalia','Route de Casablanca'];
const FINANCING_OPTIONS = [
  { v: 'fonds_propres',    l: 'Fonds propres' },
  { v: 'banque_classique', l: 'Banque traditionnelle' },
  { v: 'banque_islamique', l: 'Banque islamique (Mourabaha / Ijara)' },
  { v: 'mixte',            l: 'Mixte' },
];
const RENTAL_STRATEGIES = [
  { v: 'courte_duree',  l: 'Courte durée (Airbnb)' },
  { v: 'moyenne_duree', l: 'Moyenne durée (1-12 mois)' },
  { v: 'longue_duree',  l: 'Longue durée (bail classique)' },
  { v: 'mixte',         l: 'Mixte' },
  { v: 'indecis',       l: 'Indécis, à discuter' },
];

export function BriefForm({
  projectId, brief, clientPreFill,
}: {
  projectId: string;
  brief: any | null;
  clientPreFill: any;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [pendingSend, startSend] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isReadonly = brief?.status === 'validated';
  const isSent = brief?.status === 'sent_to_client';

  // Pre-fill : si pas encore de brief, on hérite de l'onboarding client
  const initial = brief ?? {
    property_types: clientPreFill?.property_type_preferences ?? [],
    quartiers: clientPreFill?.location_preferences ?? [],
    budget_total_max: clientPreFill?.budget_max ?? '',
    available_savings: clientPreFill?.available_savings ?? '',
    financing_type: clientPreFill?.credit_type === 'yes' ? 'banque_classique'
                   : clientPreFill?.credit_type === 'islamic' ? 'banque_islamique'
                   : 'fonds_propres',
    expected_rent_monthly: clientPreFill?.expected_rent ?? '',
    expected_gross_yield_pct: clientPreFill?.expected_gross_yield_pct ?? '',
    expected_net_yield_pct: clientPreFill?.expected_net_yield_pct ?? '',
  };

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setInfo(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await saveBriefAction(projectId, fd);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setInfo('✓ Cahier des charges enregistré');
      router.refresh();
    });
  }

  function sendToClient() {
    if (!confirm('Enregistrer puis envoyer ce cahier des charges au client pour validation ? Vous ne pourrez plus le modifier librement tant qu\'il n\'a pas répondu.')) return;
    setError(null); setInfo(null);
    const formEl = formRef.current;
    if (!formEl) { setError('Formulaire introuvable'); return; }
    const fd = new FormData(formEl);
    startSend(async () => {
      // 1. Toujours sauvegarder l'état actuel d'abord (crée le brief s'il n'existe pas)
      const saveRes = await saveBriefAction(projectId, fd);
      if (!saveRes.ok) { setError(saveRes.error ?? 'Erreur lors de la sauvegarde'); return; }
      // 2. Puis envoyer au client
      const sendRes = await sendBriefToClientAction(projectId);
      if (!sendRes.ok) { setError(sendRes.error ?? 'Erreur lors de l\'envoi'); return; }
      setInfo('✓ Enregistré et envoyé au client');
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={save} className="space-y-4">
      <fieldset disabled={isReadonly} className={isReadonly ? 'opacity-70' : ''}>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Type de bien & localisation</h3>
        <div>
          <Label>Types de bien acceptés</Label>
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-2 mt-1">
            {PROPERTY_TYPES.map(t => (
              <label key={t} className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50">
                <input type="checkbox" name="property_types" value={t}
                  defaultChecked={(initial.property_types ?? []).includes(t)} />
                <span className="text-sm">{t}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label>Quartiers ciblés *</Label>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2 mt-1">
            {QUARTIERS.map(q => (
              <label key={q} className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50">
                <input type="checkbox" name="quartiers" value={q}
                  defaultChecked={(initial.quartiers ?? []).includes(q)} />
                <span className="text-sm">{q}</span>
              </label>
            ))}
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Budget</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label>Budget total max (EUR)</Label>
            <Input name="budget_total_max" type="number" min="0" defaultValue={initial.budget_total_max ?? ''} />
          </div>
          <div>
            <Label>Acquisition max (EUR)</Label>
            <Input name="budget_acquisition_max" type="number" min="0" defaultValue={initial.budget_acquisition_max ?? ''} />
          </div>
          <div>
            <Label>Travaux max (EUR)</Label>
            <Input name="budget_travaux_max" type="number" min="0" defaultValue={initial.budget_travaux_max ?? ''} />
          </div>
          <div>
            <Label>Déco / mobilier max (EUR)</Label>
            <Input name="budget_deco_max" type="number" min="0" defaultValue={initial.budget_deco_max ?? ''} />
          </div>
          <div>
            <Label>Épargne disponible (EUR)</Label>
            <Input name="available_savings" type="number" min="0" defaultValue={initial.available_savings ?? ''} />
          </div>
          <div>
            <Label>Mode de financement</Label>
            <select name="financing_type" defaultValue={initial.financing_type ?? ''}
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              {FINANCING_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Caractéristiques recherchées</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label>Surface min (m²)</Label>
            <Input name="superficie_min" type="number" min="0" step="0.1" defaultValue={initial.superficie_min ?? ''} />
          </div>
          <div>
            <Label>Surface max (m²)</Label>
            <Input name="superficie_max" type="number" min="0" step="0.1" defaultValue={initial.superficie_max ?? ''} />
          </div>
          <div>
            <Label>Nb suites min</Label>
            <Input name="nb_suites_min" type="number" min="0" defaultValue={initial.nb_suites_min ?? ''} />
          </div>
          <div className="md:col-span-3">
            <Label>Préférence étage (texte libre)</Label>
            <Input name="floor_preference" defaultValue={initial.floor_preference ?? ''}
              placeholder="ex : étage élevé, RDC interdit, avec ascenseur uniquement…" />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-5 gap-3 pt-2">
          {[
            { name: 'needs_terrace', label: 'Terrasse exigée' },
            { name: 'needs_elevator', label: 'Ascenseur exigé' },
            { name: 'needs_parking', label: 'Parking exigé' },
            { name: 'needs_pool', label: 'Piscine souhaitée' },
            { name: 'needs_view', label: 'Vue dégagée' },
          ].map(f => (
            <label key={f.name} className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black">
              <input type="checkbox" name={f.name} defaultChecked={!!initial[f.name]} />
              <span className="text-sm">{f.label}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Stratégie locative & objectifs</h3>
        <div>
          <Label>Stratégie locative</Label>
          <select name="rental_strategy" defaultValue={initial.rental_strategy ?? ''}
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">—</option>
            {RENTAL_STRATEGIES.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        </div>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label>Loyer mensuel cible (EUR)</Label>
            <Input name="expected_rent_monthly" type="number" min="0" step="0.01" defaultValue={initial.expected_rent_monthly ?? ''} />
          </div>
          <div>
            <Label>Rendement brut cible (%)</Label>
            <Input name="expected_gross_yield_pct" type="number" min="0" max="100" step="0.1" defaultValue={initial.expected_gross_yield_pct ?? ''} />
          </div>
          <div>
            <Label>Rendement net cible (%)</Label>
            <Input name="expected_net_yield_pct" type="number" min="0" max="100" step="0.1" defaultValue={initial.expected_net_yield_pct ?? ''} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Travaux & contraintes</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black">
            <input type="checkbox" name="accept_heavy_works" defaultChecked={!!initial.accept_heavy_works} />
            <span className="text-sm">Travaux lourds acceptés (démolition, gros œuvre)</span>
          </label>
          <label className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black">
            <input type="checkbox" name="accept_division" defaultChecked={!!initial.accept_division} />
            <span className="text-sm">Division en plusieurs appartements acceptée</span>
          </label>
        </div>
        <div>
          <Label>Date de mise en location souhaitée</Label>
          <Input name="delivery_deadline" type="date" defaultValue={initial.delivery_deadline ?? ''} className="max-w-xs" />
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Spécificités & exclusions</h3>
        <div>
          <Label>Demandes spécifiques du client (visibles côté client)</Label>
          <Textarea name="specificities" rows={3}
            defaultValue={initial.specificities ?? ''}
            placeholder="Ex: doit pouvoir accueillir des familles, vue sur Atlas obligatoire, etc." />
        </div>
        <div>
          <Label>Exclusions (visibles côté client)</Label>
          <Textarea name="exclusions" rows={2}
            defaultValue={initial.exclusions ?? ''}
            placeholder="Ex: pas de RDC, pas de copropriété en mauvais état, pas de Riad en derb étroit…" />
        </div>
        <div>
          <Label>Notes internes (NON visibles côté client)</Label>
          <Textarea name="chef_notes" rows={3}
            defaultValue={initial.chef_notes ?? ''}
            placeholder="Réflexions chef de projet, points d'attention internes…"
            className="bg-stoniz-gray-50" />
        </div>
      </Card>

      </fieldset>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md">{error}</div>}
      {info  && <div className="text-sm text-green-700 bg-green-50 border border-green-200 p-3 rounded-md">{info}</div>}

      <div className="flex justify-end gap-3 pt-2">
        {!isReadonly && (
          <Button type="submit" variant="secondary" disabled={pending || pendingSend}>
            {pending ? 'Enregistrement…' : (isSent ? 'Modifier (re-passe en brouillon)' : 'Enregistrer')}
          </Button>
        )}
        {!isReadonly && !isSent && (
          <Button type="button" onClick={sendToClient} disabled={pendingSend || pending}>
            {pendingSend ? 'Envoi…' : '📤 Envoyer au client pour validation'}
          </Button>
        )}
      </div>
    </form>
  );
}
