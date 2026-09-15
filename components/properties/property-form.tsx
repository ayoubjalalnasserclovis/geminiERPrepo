'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { PropertyMediaGallery } from '@/components/properties/property-media-gallery';
import { createPropertyAction, updatePropertyAction } from '@/app/(team)/properties/actions';

// Liste fermée des quartiers (appartements Marrakech)
const QUARTIERS = [
  'Gueliz',
  'Hivernage',
  'Majorelle',
  'Victor Hugo',
  'Semlalia',
  'Route de Casablanca',
];

export function PropertyForm({
  property,
  partners,
  chasseurs = [],
}: {
  property?: any;
  partners: { id: string; agency_name: string }[];
  chasseurs?: { id: string; full_name: string }[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Après création : on bascule sur l'écran d'upload des médias.
  const [createdId, setCreatedId] = useState<string | null>(null);

  // ─── États pour auto-calcs (CEO 2026-06-17, source de vérité unique) ─────
  // Cohérent avec lib/finance/property-calc.ts.
  //   - Notaire : 7% du prix d'achat
  //   - Agence  : 3% TTC (= 2,5% HT + 0,5% TVA)
  //   - Travaux : superficie × 425 + nb_suites × 7000 (figé, non modifiable)
  const [price, setPrice] = useState<number>(Number(property?.price ?? 0));
  const [loyer, setLoyer] = useState<number>(Number(property?.estimated_rent ?? 0));
  const [tauxOcc, setTauxOcc] = useState<number>(Number(property?.taux_occupation ?? 0));
  const [superficieState, setSuperficieState] = useState<number>(Number(property?.superficie ?? 0));
  const [nbSuitesState, setNbSuitesState] = useState<number>(Number(property?.nb_suites ?? 0));

  // Frais auto par défaut, modifiables si besoin
  const fraisNotaireAuto = Math.round(price * 0.07);
  const fraisAgenceAuto = Math.round(price * 0.03);

  // Travaux auto : figé (non modifiable). Décomposition affichée à l'utilisateur.
  const montantTravauxAuto = Math.round(superficieState * 425);
  const montantAmeublementAuto = Math.round(nbSuitesState * 7000);
  const travauxBudgetAuto = montantTravauxAuto + montantAmeublementAuto;

  // ─── Sourcing : partenaire ou direct (avec chasseur assigné) ─────────────
  const [sourcingType, setSourcingType] = useState<'partenaire' | 'direct'>(
    (property?.sourcing_type as any) ?? 'partenaire'
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true); setError(null);
    const form = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(form.entries());
    data.has_elevator = form.get('has_elevator') === 'on';
    data.has_parking = form.get('has_parking') === 'on';
    data.exposure = (data.exposure as string ?? '').split(',').map(s => s.trim()).filter(Boolean);
    data.exterior = (data.exterior as string ?? '').split(',').map(s => s.trim()).filter(Boolean);
    data.avantages = (data.avantages as string ?? '').split(',').map(s => s.trim()).filter(Boolean);
    data.points_negatifs = (data.points_negatifs as string ?? '').split(',').map(s => s.trim()).filter(Boolean);

    // Auto-calc backend pour cohérence (override si user a édité manuellement)
    if (!data.notary_fees) data.notary_fees = String(fraisNotaireAuto);
    if (!data.agency_fees) data.agency_fees = String(fraisAgenceAuto);
    // Travaux : TOUJOURS auto-calculé depuis superficie + nb_suites (figé, non modifiable)
    data.travaux_budget_estimate = String(travauxBudgetAuto);
    // revenu_locatif_brut_annuel : champ legacy, on ne le réinjecte plus
    // (sinon double application du taux d'occupation = bug historique)
    delete data.revenu_locatif_brut_annuel;

    // Sourcing — nettoyage selon le type
    if (data.sourcing_type === 'partenaire') {
      data.assigned_chasseur = null;
      data.sourcing_direct_channel = null;
    } else if (data.sourcing_type === 'direct') {
      data.partner_id = null;
    }

    const res = property?.id
      ? await updatePropertyAction(property.id, data)
      : await createPropertyAction(data);
    setLoading(false);
    if (!res.ok) { setError(res.error ?? 'Erreur'); return; }

    if (property?.id) {
      router.push(`/properties/${property.id}`);
      router.refresh();
    } else {
      // Création OK → on passe à l'étape médias sans quitter la page
      setCreatedId((res as any).id);
    }
  }

  // ─── Étape 2 : upload des médias après création ────────────────────────
  if (createdId) {
    return (
      <div className="space-y-4">
        <Card className="bg-green-50 border-green-200">
          <div className="flex items-start gap-3">
            <div className="text-2xl">✅</div>
            <div className="flex-1">
              <h3 className="font-display text-lg">Bien créé avec succès</h3>
              <p className="text-sm text-stoniz-gray-600 mt-1">
                Ajoutez maintenant les <strong>photos du bien</strong>, les <strong>photos des parties communes</strong>,
                les <strong>photos de l'extérieur</strong> et la <strong>vidéo du bien</strong>.
              </p>
            </div>
          </div>
        </Card>

        <PropertyMediaGallery propertyId={createdId} media={[]} />

        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => router.push('/properties')}>
            Retour à la liste
          </Button>
          <Button onClick={() => router.push(`/properties/${createdId}`)}>
            Terminer et voir le bien
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Card className="space-y-4">
        <h3 className="font-display text-lg">Identification</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>Nom du bien *</Label>
            <Input name="name" defaultValue={property?.name ?? ''} required />
          </div>
          <div>
            <Label>Type *</Label>
            <select name="type" defaultValue={property?.type ?? ''} required
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              <option>Appartement</option><option>Riad</option><option>Villa</option><option>Terrain</option>
            </select>
          </div>
          <div>
            <Label>Quartier *</Label>
            <select name="quartier" defaultValue={property?.quartier ?? ''} required
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              {QUARTIERS.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <Label>Adresse *</Label>
            <Input name="address" defaultValue={property?.address ?? ''} required />
          </div>
          <div>
            <Label>Superficie habitable (m²) *</Label>
            <Input name="superficie" type="number" step="0.01" required
              defaultValue={property?.superficie ?? ''}
              onChange={(e) => setSuperficieState(Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Terrasse (m²) *</Label>
            <Input name="terrasse_m2" type="number" step="0.01" min="0" required
              placeholder="0 si aucune terrasse"
              defaultValue={property?.terrasse_m2 ?? ''} />
          </div>
          <div>
            <Label>Étage *</Label>
            <Input name="floor" defaultValue={property?.floor ?? ''} required />
          </div>
          <div>
            <Label>N° appartement / lot</Label>
            <Input name="apartment_number" defaultValue={property?.apartment_number ?? ''}
              placeholder="Ex : A12, Appt 24, Lot 3…" />
          </div>
          <div>
            <Label>Nb suites *</Label>
            <Input name="nb_suites" type="number" min="0" required
              defaultValue={property?.nb_suites ?? ''}
              onChange={(e) => setNbSuitesState(Number(e.target.value) || 0)} />
          </div>
          <div>
            <Label>Nb lots dans l'immeuble <span className="text-stoniz-gray-400 text-xs">(optionnel)</span></Label>
            <Input name="nb_lots_residence" type="number" min="0"
              defaultValue={property?.nb_lots_residence ?? ''} />
          </div>
          <div>
            <Label>Évaluation *</Label>
            <select name="evaluation" defaultValue={property?.evaluation ?? ''} required
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="">—</option>
              <option value="1">⭐</option>
              <option value="2">⭐⭐</option>
              <option value="3">⭐⭐⭐</option>
            </select>
          </div>
          <div>
            <Label>Statut *</Label>
            <select name="status" defaultValue={property?.status ?? 'sourcing'} required
              className="w-full h-10 rounded-md border bg-white px-3 text-sm">
              <option value="sourcing">Sourcing</option>
              <option value="disponible">Disponible</option>
              <option value="propose">Proposé</option>
              <option value="offre">Offre faite</option>
              <option value="vendu">Vendu</option>
              <option value="a_verifier">À vérifier</option>
            </select>
          </div>
        </div>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <input type="checkbox" name="has_elevator" defaultChecked={property?.has_elevator} />
            <Label className="mb-0">Ascenseur</Label>
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" name="has_parking" defaultChecked={property?.has_parking} />
            <Label className="mb-0">Parking</Label>
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Financier (EUR)</h3>
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <Label>
              Prix vendeur initial (€)
              <span className="text-xs text-stoniz-gray-500 font-normal ml-1">
                — prix demandé avant négo (optionnel)
              </span>
            </Label>
            <Input
              name="initial_asking_price" type="number" step="0.01" min="0"
              placeholder="Ex : 250 000"
              defaultValue={property?.initial_asking_price ?? ''}
            />
          </div>
          <div>
            <Label>
              Prix retenu (€) *
              <span className="text-xs text-stoniz-gray-500 font-normal ml-1">
                — prix négocié / prix d'achat
              </span>
            </Label>
            <Input
              name="price" type="number" step="0.01" min="0" required
              defaultValue={property?.price ?? ''}
              onChange={(e) => setPrice(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label>Loyer estimé / mois *</Label>
            <Input
              name="estimated_rent" type="number" step="0.01" min="0" required
              defaultValue={property?.estimated_rent ?? ''}
              onChange={(e) => setLoyer(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label>
              Budget travaux (€) <span className="text-xs text-stoniz-gray-500 font-normal">— calculé auto, non modifiable</span>
            </Label>
            <div className="border rounded px-3 py-2 bg-stoniz-gray-50 font-medium">
              {travauxBudgetAuto.toLocaleString('fr-FR')} €
            </div>
            <div className="text-xs text-stoniz-gray-500 mt-1 leading-relaxed">
              Travaux : {montantTravauxAuto.toLocaleString('fr-FR')} € ({superficieState || 0} m² × 425 €/m²)<br />
              Ameublement : {montantAmeublementAuto.toLocaleString('fr-FR')} € ({nbSuitesState || 0} suite{nbSuitesState > 1 ? 's' : ''} × 7 000 €)
            </div>
            <input type="hidden" name="travaux_budget_estimate" value={travauxBudgetAuto} />
          </div>
          <div>
            <Label>
              Frais notaire (€) *
              <span className="text-xs text-stoniz-gray-500 font-normal ml-1">
                (auto 7% = {fraisNotaireAuto.toLocaleString('fr-FR')} €)
              </span>
            </Label>
            <Input name="notary_fees" type="number" step="0.01" min="0" required
              placeholder={`${fraisNotaireAuto}`}
              defaultValue={property?.notary_fees ?? fraisNotaireAuto} />
          </div>
          <div>
            <Label>
              Frais d'agence (€) *
              <span className="text-xs text-stoniz-gray-500 font-normal ml-1">
                (auto 3% = {fraisAgenceAuto.toLocaleString('fr-FR')} €)
              </span>
            </Label>
            <Input name="agency_fees" type="number" step="0.01" min="0" required
              placeholder={`${fraisAgenceAuto}`}
              defaultValue={property?.agency_fees ?? fraisAgenceAuto} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Sourcing</h3>
        <p className="text-xs text-stoniz-gray-500">
          Indiquez comment ce bien a été sourcé — c'est obligatoire pour pouvoir le publier.
        </p>

        <div className="grid grid-cols-2 gap-2">
          {([
            { value: 'partenaire', label: '🤝 Sourcé via partenaire', hint: 'Agence partenaire référencée' },
            { value: 'direct', label: '🎯 Sourcing direct Stoniz', hint: 'Trouvé par un chasseur Stoniz' },
          ] as const).map(s => (
            <label key={s.value}
              className={`flex flex-col gap-1 border rounded-md px-3 py-2 cursor-pointer transition-colors text-sm ${
                sourcingType === s.value
                  ? 'border-stoniz-black bg-cream-soft'
                  : 'border-grey-line hover:border-stoniz-black/40'
              }`}>
              <div className="flex items-center gap-2">
                <input
                  type="radio"
                  name="sourcing_type"
                  value={s.value}
                  checked={sourcingType === s.value}
                  onChange={() => setSourcingType(s.value)}
                />
                <span className="font-medium">{s.label}</span>
              </div>
              <span className="text-[11px] text-stoniz-gray-500 pl-5">{s.hint}</span>
            </label>
          ))}
        </div>

        {sourcingType === 'partenaire' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Partenaire (agence) *</Label>
              <select name="partner_id" defaultValue={property?.partner_id ?? ''} required
                className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                <option value="">—</option>
                {partners.map(p => <option key={p.id} value={p.id}>{p.agency_name}</option>)}
              </select>
            </div>
            <div>
              <Label>% commission agence *</Label>
              <Input name="sourcing_commission_rate" type="number" step="0.1" min="0" required
                defaultValue={property?.sourcing_commission_rate ?? 2.5} />
            </div>
          </div>
        )}

        {sourcingType === 'direct' && (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <Label>Chasseur Stoniz qui a sourcé *</Label>
              <select name="assigned_chasseur" defaultValue={property?.assigned_chasseur ?? ''} required
                className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                <option value="">— Choisir un chasseur —</option>
                {chasseurs.map(c => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </div>
            <div>
              <Label>Canal de sourcing</Label>
              <select name="sourcing_direct_channel"
                defaultValue={property?.sourcing_direct_channel ?? ''}
                className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                <option value="">—</option>
                <option value="off_market">Off-market</option>
                <option value="prospection_terrain">Prospection terrain</option>
                <option value="recommandation_client">Recommandation client</option>
                <option value="agence_non_partenaire">Agence non partenaire</option>
                <option value="annonce_en_ligne">Annonce en ligne</option>
                <option value="autre">Autre</option>
              </select>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-grey-line">
          <div className="md:col-span-2">
            <Label>Lien Google Maps *</Label>
            <Input name="google_maps_url" type="url" required
              placeholder="https://maps.google.com/..."
              defaultValue={property?.google_maps_url ?? ''} />
          </div>
          <div className="md:col-span-2">
            <Label>URL Drive (photos / documents)</Label>
            <Input name="drive_url" type="url"
              placeholder="https://drive.google.com/..."
              defaultValue={property?.drive_url ?? ''} />
          </div>
        </div>

        <p className="text-xs text-stoniz-gray-500 pt-2 border-t border-grey-line">
          📅 La date de sourcing est automatiquement enregistrée au moment de la création du bien (date d'upload).
        </p>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Présentation client</h3>
        <p className="text-xs text-stoniz-gray-500">
          Ces informations sont affichées au client lorsque vous lui proposez ce bien.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Highlight (ex: "Division en 2", "Off-market", "Vue Atlas") *</Label>
            <Input name="badge_label" required defaultValue={property?.badge_label ?? ''}
              placeholder="Phrase d'accroche courte" />
          </div>
          <div>
            <Label>URL vidéo du bien (YouTube/Vimeo…) *</Label>
            <Input name="video_url" type="url" required placeholder="https://..."
              defaultValue={property?.video_url ?? ''} />
          </div>
          <div className="md:col-span-2">
            <Label>Description longue *</Label>
            <Textarea name="description" rows={4} required
              placeholder="Au 3ᵉ étage avec ascenseur, cet appartement de 136 m² dispose…"
              defaultValue={property?.description ?? ''} />
          </div>
          <div className="md:col-span-2">
            <Label>Avantages (séparés par virgules) *</Label>
            <Input name="avantages" required placeholder="Sans vis-à-vis, Ascenseur, 3e étage"
              defaultValue={property?.avantages?.join(', ') ?? ''} />
          </div>
          <div className="md:col-span-2">
            <Label>Points négatifs (séparés par virgules) *</Label>
            <Input name="points_negatifs" required placeholder="Parties communes, Immeuble en mauvais état"
              defaultValue={property?.points_negatifs?.join(', ') ?? ''} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h3 className="font-display text-lg">Charges & revenus prévisionnels</h3>
        <p className="text-xs text-stoniz-gray-500">
          Données utilisées pour le calcul du cashflow et du rendement net.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Charges mensuelles immeuble (€) *</Label>
            <Input name="charges_mensuelles_immeuble" type="number" step="0.01" min="0" required
              placeholder="40" defaultValue={property?.charges_mensuelles_immeuble ?? ''} />
          </div>
          <div>
            <Label>Taux d'occupation (%) *</Label>
            <Input name="taux_occupation" type="number" step="0.01" min="0" max="100" required
              placeholder="82.19"
              defaultValue={property?.taux_occupation ?? ''}
              onChange={(e) => setTauxOcc(Number(e.target.value) || 0)}
            />
          </div>
          <div>
            <Label>Frais de fonctionnement / an (€) *</Label>
            <Input name="frais_fonctionnement_annuel" type="number" step="0.01" min="0" required
              placeholder="3060" defaultValue={property?.frais_fonctionnement_annuel ?? ''} />
          </div>
          <div>
            <Label>Conciergerie / an (€) *</Label>
            <Input name="conciergerie_annuel" type="number" step="0.01" min="0" required
              placeholder="7800" defaultValue={property?.conciergerie_annuel ?? ''} />
          </div>
        </div>

        <div className="bg-cream-soft border-l-4 border-stoniz-black rounded-sm p-3">
          <p className="text-xs uppercase tracking-wider text-grey-text mb-1">
            Revenu locatif brut annuel (auto-calculé)
          </p>
          <p className="font-semibold text-lg">
            {(loyer * 12).toLocaleString('fr-FR')} €
            <span className="ml-2 text-xs font-normal text-grey-text">
              = {loyer.toLocaleString('fr-FR')} € × 12
            </span>
          </p>
          <p className="text-xs text-grey-text mt-1">
            Le loyer mensuel saisi inclut déjà le taux d'occupation moyen.
          </p>
        </div>
      </Card>

      <Card className="bg-stoniz-gray-50">
        <h3 className="font-display text-lg">📸 Médias du bien</h3>
        <p className="text-sm text-stoniz-gray-600 mt-1">
          Après avoir enregistré le bien, vous pourrez ajouter dans la même page :
        </p>
        <ul className="text-sm text-stoniz-gray-600 mt-2 ml-5 list-disc">
          <li>Photos du bien</li>
          <li>Photos des parties communes</li>
          <li>Photos de l'extérieur / façade</li>
          <li>Vidéo du bien</li>
        </ul>
      </Card>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <div className="flex justify-end gap-3">
        <Button type="button" variant="secondary" onClick={() => router.back()}>Annuler</Button>
        <Button type="submit" disabled={loading}>
          {loading ? '…' : (property?.id ? 'Enregistrer' : 'Enregistrer et ajouter les médias')}
        </Button>
      </div>
    </form>
  );
}
