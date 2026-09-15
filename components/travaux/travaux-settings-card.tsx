'use client';

import { useState, useTransition } from 'react';
import { Pencil, Save, MapPin, Building, Hash, ExternalLink } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMad, formatDate } from '@/lib/utils/format';
import { updateProjectTravauxSettingsAction } from '@/app/(team)/projects/[id]/travaux/actions';

type LinkedProperty = {
  id: string;
  name: string | null;
  address: string | null;
  google_maps_url: string | null;
  floor: string | null;
  apartment_number: string | null;
  quartier: string | null;
} | null;

export function TravauxSettingsCard({
  projectId,
  budget,
  margeCiblePct,
  adresseChantier,
  dateDebut,
  dateFin,
  property,
}: {
  projectId: string;
  budget: number;
  margeCiblePct: number;
  adresseChantier: string | null;
  dateDebut: string | null;
  dateFin: string | null;
  property?: LinkedProperty;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [vals, setVals] = useState({
    travaux_budget_mad: budget,
    travaux_marge_cible_pct: margeCiblePct,
    travaux_adresse_chantier: adresseChantier ?? '',
  });

  function save() {
    setError(null);
    start(async () => {
      const r = await updateProjectTravauxSettingsAction(projectId, {
        travaux_budget_mad: Number(vals.travaux_budget_mad),
        travaux_marge_cible_pct: Number(vals.travaux_marge_cible_pct),
        travaux_adresse_chantier: vals.travaux_adresse_chantier,
      });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setEditing(false);
    });
  }

  function useBienAddress() {
    if (property?.address) {
      setVals(v => ({ ...v, travaux_adresse_chantier: property.address ?? '' }));
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Paramètres chantier</CardTitle>
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Annuler</Button>
              <Button size="sm" onClick={save} disabled={pending}>
                <Save className="w-4 h-4" /> {pending ? '…' : 'Enregistrer'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4" /> Modifier
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}

        {/* Bloc bien lié — auto-rempli depuis le projet */}
        {property ? (
          <div className="mb-4 p-3 rounded-lg bg-stoniz-gray-50 border">
            <div className="text-xs uppercase text-stoniz-gray-500 mb-2 font-medium">
              Bien rattaché au projet
            </div>
            <div className="font-medium text-sm mb-2">{property.name ?? '—'}</div>
            <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <InfoRow icon={<MapPin className="w-3.5 h-3.5" />} label="Adresse"
                value={property.address ?? '—'} />
              <InfoRow icon={<Building className="w-3.5 h-3.5" />} label="Quartier"
                value={property.quartier ?? '—'} />
              <InfoRow icon={<Hash className="w-3.5 h-3.5" />} label="Étage"
                value={property.floor ?? '—'} />
              <InfoRow icon={<Hash className="w-3.5 h-3.5" />} label="N° appartement"
                value={property.apartment_number ?? '—'} />
              {property.google_maps_url && (
                <div className="sm:col-span-2">
                  <a href={property.google_maps_url} target="_blank" rel="noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-stoniz-black hover:underline">
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ouvrir dans Google Maps
                  </a>
                </div>
              )}
            </dl>
            <p className="text-xs text-stoniz-gray-500 mt-3 pt-3 border-t">
              Ces informations sont gérées sur la <a href={`/properties/${property.id}`} className="underline">fiche du bien</a>.
            </p>
          </div>
        ) : (
          <div className="mb-4 p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
            Aucun bien rattaché à ce projet. Acceptez une proposition pour lier le bien à ce chantier.
          </div>
        )}

        <dl className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Row label="Budget vendu client">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input type="number" value={vals.travaux_budget_mad}
                  onChange={e => setVals(v => ({ ...v, travaux_budget_mad: Number(e.target.value) }))}
                  className="w-40" />
                <span className="text-xs text-stoniz-gray-500">MAD</span>
              </div>
            ) : (
              <span className="font-medium">{formatMad(budget)}</span>
            )}
          </Row>
          <Row label="Marge cible">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input type="number" step="0.1" value={vals.travaux_marge_cible_pct}
                  onChange={e => setVals(v => ({ ...v, travaux_marge_cible_pct: Number(e.target.value) }))}
                  className="w-24" />
                <span className="text-xs text-stoniz-gray-500">%</span>
                <span className="text-xs text-stoniz-gray-500">
                  ≈ {formatMad(Math.round((Number(vals.travaux_budget_mad) || 0) * (Number(vals.travaux_marge_cible_pct) || 0) / 100))}
                </span>
              </div>
            ) : (
              <span className="font-medium">
                {margeCiblePct}%
                <span className="ml-2 text-xs text-stoniz-gray-500 font-normal">
                  ≈ {formatMad(Math.round(budget * margeCiblePct / 100))}
                </span>
              </span>
            )}
          </Row>
          <Row label="Adresse chantier">
            {editing ? (
              <div className="space-y-1">
                <Input value={vals.travaux_adresse_chantier}
                  onChange={e => setVals(v => ({ ...v, travaux_adresse_chantier: e.target.value }))}
                  placeholder={property?.address ?? 'Adresse du bien'} />
                {property?.address && vals.travaux_adresse_chantier !== property.address && (
                  <button type="button" onClick={useBienAddress}
                    className="text-xs text-stoniz-black hover:underline">
                    ↺ Utiliser l'adresse du bien
                  </button>
                )}
              </div>
            ) : (
              <span className="font-medium">
                {adresseChantier ?? (property?.address
                  ? <span className="text-stoniz-gray-600 italic">Hérité du bien : {property.address}</span>
                  : <span className="text-stoniz-gray-400 text-xs">Non renseignée</span>)}
              </span>
            )}
          </Row>
          <Row label="Période chantier">
            <span className="font-medium">
              {dateDebut ? formatDate(dateDebut) : '—'} → {dateFin ? formatDate(dateFin) : '—'}
            </span>
            <p className="text-xs text-stoniz-gray-500 mt-0.5">Se modifient sur la fiche projet (Dates clés)</p>
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-stoniz-gray-500 mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-stoniz-gray-400 mt-0.5">{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-stoniz-gray-500">{label}</div>
        <div className="font-medium truncate">{value}</div>
      </div>
    </div>
  );
}
