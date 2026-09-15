'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { completeOnboardingAction } from '@/app/(client)/client/onboarding/actions';

const QUARTIERS = [
  { value: 'gueliz',         label: 'Gueliz' },
  { value: 'hivernage',      label: 'Hivernage' },
  { value: 'majorelle',      label: 'Majorelle' },
  { value: 'victor_hugo',    label: 'Victor Hugo' },
  { value: 'route_de_casa',  label: 'Route de Casa' },
  { value: 'semlalia',       label: 'Semlalia' },
];

export function OnboardingForm({ client, userEmail }: { client: any; userEmail: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [creditType, setCreditType] = useState<string>(client?.credit_type ?? 'no');
  const [holding, setHolding] = useState<string>(client?.investment_holding ?? 'nom_propre');
  const [partyMode, setPartyMode] = useState<'seul' | 'plusieurs'>(
    (client?.investment_party_count ?? 1) > 1 ? 'plusieurs' : 'seul'
  );
  const [coCount, setCoCount] = useState<number>(
    Math.max(0, (client?.investment_party_count ?? 1) - 1)
  );
  const [needsBank, setNeedsBank] = useState<'yes' | 'no'>(
    client?.needs_bank_account_opening === true ? 'yes' : 'no'
  );

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);

    // Recalcule investment_party_count côté client
    const total = partyMode === 'seul' ? 1 : 1 + Math.max(1, coCount);
    fd.set('investment_party_count', String(total));
    fd.set('investment_holding', holding);

    start(async () => {
      const r = await completeOnboardingAction(fd);
      if (r && 'ok' in r && !r.ok) setError(r.error ?? 'Erreur');
    });
  }

  const [first, ...restName] = (client?.full_name ?? '').split(' ');
  const guessedFirstName = client?.first_name ?? first ?? '';
  const guessedLastName  = client?.last_name  ?? restName.join(' ') ?? '';

  return (
    <form onSubmit={submit} className="space-y-4">
      <Card className="space-y-4">
        <h2 className="font-display text-xl">Identité</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Prénom *</Label>
            <Input name="first_name" required defaultValue={guessedFirstName} />
          </div>
          <div>
            <Label>Nom *</Label>
            <Input name="last_name" required defaultValue={guessedLastName} />
          </div>
          <div>
            <Label>Email *</Label>
            <Input name="email" type="email" required defaultValue={client?.email ?? userEmail} />
          </div>
          <div>
            <Label>Téléphone (international) *</Label>
            <Input name="phone" required placeholder="+33 6 12 34 56 78"
              defaultValue={client?.phone ?? ''} />
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Format obligatoire avec indicatif pays : +33, +212, +41, etc.
            </p>
          </div>
          <div>
            <Label>Nationalité *</Label>
            <Input name="nationality" required placeholder="ex: Française, Marocaine, Belge…"
              defaultValue={client?.nationality ?? ''} />
          </div>
          <div>
            <Label>Votre pièce d'identité (CNI ou passeport) *</Label>
            <input type="file" name="piece_identite" required
              accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
              className="w-full text-sm py-2" />
            <p className="text-xs text-stoniz-gray-500 mt-1">PDF ou image, max 25 MB.</p>
          </div>
        </div>
      </Card>

      {/* ─── Structure d'investissement ───────────────────────────────── */}
      <Card className="space-y-4">
        <h2 className="font-display text-xl">Structure de l'investissement</h2>

        <div>
          <Label>Vous investissez en *</Label>
          <div className="space-y-2 mt-2">
            <RadioOption name="investment_holding_radio" value="nom_propre"
              checked={holding === 'nom_propre'} onChange={setHolding}
              label="Nom propre (personne physique)" />
            <RadioOption name="investment_holding_radio" value="societe"
              checked={holding === 'societe'} onChange={setHolding}
              label="Société (SCI, SARL, SAS, holding…)" />
          </div>
        </div>

        {holding === 'societe' && (
          <div className="grid md:grid-cols-2 gap-4 pt-2 border-t">
            <div>
              <Label>Raison sociale *</Label>
              <Input name="company_name" required={holding === 'societe'}
                defaultValue={client?.company_name ?? ''}
                placeholder="SCI Stoniz Invest" />
            </div>
            <div>
              <Label>N° d'immatriculation (RC / SIREN / Kbis) *</Label>
              <Input name="company_registration_number" required={holding === 'societe'}
                defaultValue={client?.company_registration_number ?? ''}
                placeholder="ex: 123 456 789" />
            </div>
          </div>
        )}

        <div className="pt-2 border-t">
          <Label>Vous investissez *</Label>
          <div className="space-y-2 mt-2">
            <RadioOption name="party_mode_radio" value="seul"
              checked={partyMode === 'seul'} onChange={v => setPartyMode(v as any)}
              label="Seul" />
            <RadioOption name="party_mode_radio" value="plusieurs"
              checked={partyMode === 'plusieurs'} onChange={v => setPartyMode(v as any)}
              label="À plusieurs (conjoint, associés, famille…)" />
          </div>
        </div>

        {partyMode === 'plusieurs' && (
          <div className="space-y-4 pt-2 border-t">
            <div>
              <Label>Nombre de co-investisseurs (en plus de vous) *</Label>
              <Input type="number" min={1} max={10}
                value={coCount || ''} required
                onChange={e => setCoCount(Math.max(1, Math.min(10, Number(e.target.value) || 0)))}
                className="max-w-[180px]" />
              <p className="text-xs text-stoniz-gray-500 mt-1">
                Total des investisseurs : <strong>{1 + (coCount || 0)}</strong> personne(s)
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium">Pièces d'identité des co-investisseurs *</p>
              <p className="text-xs text-stoniz-gray-500">
                Chaque co-investisseur doit uploader sa CNI ou son passeport pour pouvoir
                accéder à l'application. Tant qu'une pièce manque, l'onboarding est bloqué.
              </p>
              {Array.from({ length: coCount }, (_, i) => (
                <div key={i} className="grid md:grid-cols-3 gap-3 p-3 border rounded-md bg-stoniz-gray-50">
                  <div>
                    <Label className="text-xs">Nom complet #{i + 2} *</Label>
                    <Input name={`co_full_name_${i}`} required
                      placeholder="Prénom Nom" />
                  </div>
                  <div>
                    <Label className="text-xs">Lien (optionnel)</Label>
                    <Input name={`co_relation_${i}`}
                      placeholder="Conjoint, associé…" />
                  </div>
                  <div>
                    <Label className="text-xs">Pièce d'identité *</Label>
                    <input type="file" name={`co_piece_identite_${i}`} required
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
                      className="w-full text-sm py-2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ─── Adresse de facturation ──────────────────────────────────── */}
      <Card className="space-y-4">
        <h2 className="font-display text-xl">Adresse de facturation</h2>
        <p className="text-sm text-stoniz-gray-500">
          Adresse utilisée sur les factures Stoniz (honoraires, acomptes…).
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <Label>Adresse (rue + n°) *</Label>
            <Input name="billing_address_line" required
              defaultValue={client?.billing_address_line ?? ''}
              placeholder="12 rue de la République" />
          </div>
          <div>
            <Label>Ville *</Label>
            <Input name="billing_city" required
              defaultValue={client?.billing_city ?? ''} />
          </div>
          <div>
            <Label>Code postal *</Label>
            <Input name="billing_postal_code" required
              defaultValue={client?.billing_postal_code ?? ''} />
          </div>
          <div className="md:col-span-2">
            <Label>Pays *</Label>
            <Input name="billing_country" required
              defaultValue={client?.billing_country ?? ''}
              placeholder="France, Maroc, Belgique…" />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-xl">Financement</h2>
        <div>
          <Label>Prenez-vous un financement bancaire ? *</Label>
          <div className="space-y-2 mt-2">
            <RadioOption name="credit_type" value="no" checked={creditType === 'no'} onChange={setCreditType} label="Non, financement en fonds propres" />
            <RadioOption name="credit_type" value="yes" checked={creditType === 'yes'} onChange={setCreditType} label="Oui, banque traditionnelle" />
            <RadioOption name="credit_type" value="islamic" checked={creditType === 'islamic'} onChange={setCreditType} label="Oui, banque islamique (Mourabaha / Ijara)" />
          </div>
        </div>

        <div className="pt-4 border-t">
          <Label>Avez-vous besoin d'ouvrir un compte bancaire au Maroc ? *</Label>
          <p className="text-xs text-stoniz-gray-500 mb-2">
            Un compte bancaire marocain est nécessaire pour percevoir les loyers en MAD.
            Stoniz peut vous accompagner pour l'ouverture si vous n'en avez pas encore.
          </p>
          <div className="space-y-2 mt-2">
            <RadioOption name="needs_bank_account_opening" value="no"
              checked={needsBank === 'no'} onChange={v => setNeedsBank(v as any)}
              label="Non, j'ai déjà un compte bancaire au Maroc" />
            <RadioOption name="needs_bank_account_opening" value="yes"
              checked={needsBank === 'yes'} onChange={v => setNeedsBank(v as any)}
              label="Oui, je souhaite que Stoniz m'accompagne pour l'ouverture" />
          </div>

          {needsBank === 'yes' && (
            <div className="mt-3">
              <Label>Précisions (optionnel)</Label>
              <Input name="bank_account_notes"
                defaultValue={client?.bank_account_notes ?? ''}
                placeholder="Préférence de banque, dispositions déjà prises…" />
            </div>
          )}
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-xl">Capacité & objectifs financiers</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <Label>Épargne disponible pour ce projet (EUR) *</Label>
            <Input name="available_savings" type="number" min="0" required
              defaultValue={client?.available_savings ?? ''} />
          </div>
          <div>
            <Label>Budget maximum total (EUR) *</Label>
            <Input name="budget_max" type="number" min="0" required
              defaultValue={client?.budget_max ?? ''} />
            <p className="text-xs text-stoniz-gray-500 mt-1">Coût total projet (acquisition + travaux + frais).</p>
          </div>
          <div>
            <Label>Loyer mensuel espéré (EUR) *</Label>
            <Input name="expected_rent" type="number" min="0" required
              defaultValue={client?.expected_rent ?? ''} />
          </div>
          <div></div>
          <div>
            <Label>Rendement brut espéré (%) *</Label>
            <Input name="expected_gross_yield_pct" type="number" step="0.1" min="0" max="100" required
              defaultValue={client?.expected_gross_yield_pct ?? ''} />
          </div>
          <div>
            <Label>Rendement net espéré (%) *</Label>
            <Input name="expected_net_yield_pct" type="number" step="0.1" min="0" max="100" required
              defaultValue={client?.expected_net_yield_pct ?? ''} />
          </div>
        </div>
      </Card>

      <Card className="space-y-4">
        <h2 className="font-display text-xl">Quartiers d'investissement visés *</h2>
        <p className="text-sm text-stoniz-gray-500">Sélectionnez un ou plusieurs quartiers de Marrakech.</p>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2">
          {QUARTIERS.map(q => {
            const checked = (client?.location_preferences ?? []).includes(q.value);
            return (
              <label key={q.value}
                className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50">
                <input type="checkbox" name="quartiers" value={q.value}
                  defaultChecked={checked} />
                <span className="text-sm">{q.label}</span>
              </label>
            );
          })}
        </div>
      </Card>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md">{error}</div>}

      <div className="flex justify-end pt-2">
        <Button type="submit" disabled={pending} size="lg">
          {pending ? 'Enregistrement…' : 'Valider et accéder à mon portail →'}
        </Button>
      </div>
    </form>
  );
}

function RadioOption({
  name, value, label, checked, onChange,
}: {
  name: string; value: string; label: string; checked: boolean; onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 border rounded-md px-3 py-2 cursor-pointer hover:bg-stoniz-gray-50 has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50">
      <input type="radio" name={name} value={value}
        checked={checked} onChange={() => onChange(value)} required />
      <span className="text-sm">{label}</span>
    </label>
  );
}
