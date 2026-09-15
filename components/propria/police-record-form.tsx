'use client';

import { useMemo, useState } from 'react';
import type {
  AccompanyingPerson,
  PoliceRecord,
  PoliceRecordIdType,
  PoliceRecordMotif,
  PoliceRecordSource,
  PoliceRecordGender,
} from '@/lib/propria/police-records';

type PropOpt = { id: string; label: string };
type UnitOpt = { id: string; label: string; property_id: string };

// Conventions :
//   - Mobile-first : tous les inputs en `text-base` (16px) pour éviter le zoom
//     auto iOS lorsque l'input prend focus. Bug terrain connu (mémoire
//     stoniz_react_field_closure_pattern : on définit les composants Field
//     TOP-LEVEL, jamais dans la closure du parent, sinon la frappe disparaît).
//   - Pas d'autosave V1 : bouton Sauvegarder. La page parente gère l'action.
//   - Sections collapsables via <details>/<summary> natif (zéro JS pour
//     l'expansion → robuste mobile).

const inputCls = 'mt-1 w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-stoniz-black disabled:bg-stoniz-gray-50 disabled:text-stoniz-gray-600';
const inputErrCls = 'mt-1 w-full border-2 border-red-400 rounded-md px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-red-600';
const labelCls = 'text-xs text-stoniz-gray-600';
const labelReqCls = 'text-xs text-stoniz-gray-600';

// Sections collapsables : on les met top-level pour éviter le piège "Field-in-closure"
function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen} className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
      <summary className="px-4 py-3 sm:px-6 sm:py-4 cursor-pointer select-none font-display text-base flex items-center justify-between hover:bg-stoniz-gray-50">
        <span>{title}</span>
        <span className="text-stoniz-gray-400 text-xs">▾</span>
      </summary>
      <div className="px-4 pb-4 pt-1 sm:px-6 sm:pb-6 sm:pt-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
        {children}
      </div>
    </details>
  );
}

function Field({
  label,
  name,
  type = 'text',
  defaultValue,
  required,
  hasError,
  disabled,
  span2,
  placeholder,
  inputMode,
}: {
  label: React.ReactNode;
  name: string;
  type?: string;
  defaultValue?: string | null;
  required?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  span2?: boolean;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className={required ? labelReqCls : labelCls}>
        {label}
        {required ? ' *' : ''}
      </label>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        disabled={disabled}
        placeholder={placeholder}
        inputMode={inputMode}
        className={hasError ? inputErrCls : inputCls}
      />
    </div>
  );
}

function SelectField({
  label,
  name,
  defaultValue,
  required,
  hasError,
  disabled,
  options,
  span2,
}: {
  label: React.ReactNode;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  options: { value: string; label: string }[];
  span2?: boolean;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
      <label className={required ? labelReqCls : labelCls}>
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        name={name}
        defaultValue={defaultValue ?? ''}
        disabled={disabled}
        className={hasError ? inputErrCls : inputCls}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

function TextAreaField({
  label,
  name,
  defaultValue,
  required,
  hasError,
  disabled,
  rows = 3,
  placeholder,
}: {
  label: React.ReactNode;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  hasError?: boolean;
  disabled?: boolean;
  rows?: number;
  placeholder?: string;
}) {
  return (
    <div className="sm:col-span-2">
      <label className={required ? labelReqCls : labelCls}>
        {label}
        {required ? ' *' : ''}
      </label>
      <textarea
        name={name}
        defaultValue={defaultValue ?? ''}
        rows={rows}
        disabled={disabled}
        placeholder={placeholder}
        className={hasError ? inputErrCls : inputCls}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Accompagnant : composant top-level (pas dans une closure)
// ────────────────────────────────────────────────────────────────────────────

type DraftAccompanying = AccompanyingPerson & { _key: string };

function AccompanyingRow({
  index,
  person,
  readonly,
  onChange,
  onRemove,
}: {
  index: number;
  person: DraftAccompanying;
  readonly: boolean;
  onChange: (idx: number, patch: Partial<AccompanyingPerson>) => void;
  onRemove: (idx: number) => void;
}) {
  // Calcul mineur/majeur dérivé (label uniquement, pas stocké).
  const isMinor = useMemo(() => {
    if (!person.birth_date) return null;
    const bd = new Date(person.birth_date + 'T00:00:00Z');
    if (Number.isNaN(bd.getTime())) return null;
    const now = new Date();
    const age = (now.getTime() - bd.getTime()) / (365.25 * 86_400_000);
    return age < 18;
  }, [person.birth_date]);

  const ageLabel = isMinor === null ? '' : isMinor ? ' (mineur)' : ' (majeur)';

  return (
    <div className="border border-stoniz-gray-200 rounded-md p-3 sm:p-4 bg-stoniz-gray-50 relative">
      <div className="flex items-start justify-between mb-2">
        <p className="text-xs font-medium text-stoniz-gray-700">
          Accompagnant {index + 1}
          {ageLabel && <span className="text-stoniz-gray-500 font-normal">{ageLabel}</span>}
        </p>
        {!readonly && (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-xs text-red-600 hover:underline"
          >
            Supprimer
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Nom</label>
          <input
            type="text"
            defaultValue={person.last_name}
            onBlur={(e) => onChange(index, { last_name: e.currentTarget.value })}
            disabled={readonly}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Prénom</label>
          <input
            type="text"
            defaultValue={person.first_name}
            onBlur={(e) => onChange(index, { first_name: e.currentTarget.value })}
            disabled={readonly}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Date de naissance</label>
          <input
            type="date"
            defaultValue={person.birth_date ?? ''}
            onChange={(e) => onChange(index, { birth_date: e.currentTarget.value || null })}
            disabled={readonly}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Nationalité</label>
          <input
            type="text"
            defaultValue={person.nationality ?? ''}
            onBlur={(e) => onChange(index, { nationality: e.currentTarget.value || null })}
            disabled={readonly}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Type pièce</label>
          <select
            defaultValue={person.id_type ?? ''}
            onChange={(e) => onChange(index, { id_type: (e.currentTarget.value || null) as PoliceRecordIdType | null })}
            disabled={readonly}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="cin">CIN</option>
            <option value="passport">Passeport</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>N° pièce</label>
          <input
            type="text"
            defaultValue={person.id_number ?? ''}
            onBlur={(e) => onChange(index, { id_number: e.currentTarget.value || null })}
            disabled={readonly}
            className={inputCls}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Relation</label>
          <select
            defaultValue={person.relation ?? ''}
            onChange={(e) => onChange(index, { relation: e.currentTarget.value || null })}
            disabled={readonly}
            className={inputCls}
          >
            <option value="">—</option>
            <option value="conjoint">Conjoint(e)</option>
            <option value="enfant">Enfant</option>
            <option value="parent">Parent</option>
            <option value="ami">Ami(e)</option>
            <option value="autre">Autre</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Formulaire principal
// ────────────────────────────────────────────────────────────────────────────

export type PoliceRecordFormSubmit = {
  property_id: string | null;
  propria_unit_id: string | null;
  head_last_name: string | null;
  head_first_name: string | null;
  head_gender: PoliceRecordGender | null;
  head_birth_date: string | null;
  head_birth_place: string | null;
  head_nationality: string | null;
  head_profession: string | null;
  head_id_type: PoliceRecordIdType | null;
  head_id_number: string | null;
  head_id_issue_date: string | null;
  head_id_expiry_date: string | null;
  head_id_issue_country: string | null;
  head_residence_country: string | null;
  head_residence_address: string | null;
  arrival_date_morocco: string | null;
  arrival_date_property: string | null;
  expected_departure_date: string | null;
  motif_sejour: PoliceRecordMotif | null;
  accompanying_persons: AccompanyingPerson[];
  data_source: PoliceRecordSource | null;
  notes: string | null;
};

export function PoliceRecordForm({
  record,
  properties,
  units,
  readonly = false,
  submitLabel = 'Sauvegarder',
  onSubmit,
  showMissingHighlight = false,
}: {
  record?: Partial<PoliceRecord> | null;
  properties: PropOpt[];
  units: UnitOpt[];
  readonly?: boolean;
  submitLabel?: string;
  onSubmit: (data: PoliceRecordFormSubmit) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** Si true, met en évidence les champs requis vides (après une 1ère tentative). */
  showMissingHighlight?: boolean;
}) {
  const v = record ?? {};

  // Accompagnants : state interne (array → JSONB à la soumission)
  const [accompanying, setAccompanying] = useState<DraftAccompanying[]>(() =>
    ((v.accompanying_persons ?? []) as AccompanyingPerson[]).map((p, i) => ({
      ...p,
      _key: `init-${i}`,
    })),
  );

  // Sélection bien → restreint la liste des unités
  const [propertyId, setPropertyId] = useState<string | null>(
    (v.property_id as string | null) ?? null,
  );
  const [unitId, setUnitId] = useState<string | null>(
    (v.propria_unit_id as string | null) ?? null,
  );

  const filteredUnits = useMemo(
    () => (propertyId ? units.filter((u) => u.property_id === propertyId) : units),
    [propertyId, units],
  );

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [submitTried, setSubmitTried] = useState(false);

  // Indicateurs erreur (uniquement après 1ère tentative ratée)
  function isMissing(field: keyof PoliceRecord, val: unknown): boolean {
    if (!submitTried && !showMissingHighlight) return false;
    if (val == null) return true;
    if (typeof val === 'string' && val.trim() === '') return true;
    return false;
  }

  function patchAccompanying(idx: number, patch: Partial<AccompanyingPerson>) {
    setAccompanying((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }
  function removeAccompanying(idx: number) {
    setAccompanying((prev) => prev.filter((_, i) => i !== idx));
  }
  function addAccompanying() {
    setAccompanying((prev) => [
      ...prev,
      {
        _key: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        last_name: '',
        first_name: '',
        birth_date: null,
        nationality: null,
        id_type: null,
        id_number: null,
        relation: null,
      },
    ]);
  }

  function strOrNull(raw: FormDataEntryValue | null): string | null {
    if (raw == null) return null;
    const s = String(raw).trim();
    return s === '' ? null : s;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (readonly) return;
    setSubmitTried(true);
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      const payload: PoliceRecordFormSubmit = {
        property_id: strOrNull(fd.get('property_id')),
        propria_unit_id: strOrNull(fd.get('propria_unit_id')),
        head_last_name: strOrNull(fd.get('head_last_name')),
        head_first_name: strOrNull(fd.get('head_first_name')),
        head_gender: (strOrNull(fd.get('head_gender')) as PoliceRecordGender | null) ?? null,
        head_birth_date: strOrNull(fd.get('head_birth_date')),
        head_birth_place: strOrNull(fd.get('head_birth_place')),
        head_nationality: strOrNull(fd.get('head_nationality')),
        head_profession: strOrNull(fd.get('head_profession')),
        head_id_type: (strOrNull(fd.get('head_id_type')) as PoliceRecordIdType | null) ?? null,
        head_id_number: strOrNull(fd.get('head_id_number')),
        head_id_issue_date: strOrNull(fd.get('head_id_issue_date')),
        head_id_expiry_date: strOrNull(fd.get('head_id_expiry_date')),
        head_id_issue_country: strOrNull(fd.get('head_id_issue_country')),
        head_residence_country: strOrNull(fd.get('head_residence_country')),
        head_residence_address: strOrNull(fd.get('head_residence_address')),
        arrival_date_morocco: strOrNull(fd.get('arrival_date_morocco')),
        arrival_date_property: strOrNull(fd.get('arrival_date_property')),
        expected_departure_date: strOrNull(fd.get('expected_departure_date')),
        motif_sejour: (strOrNull(fd.get('motif_sejour')) as PoliceRecordMotif | null) ?? null,
        accompanying_persons: accompanying.map(({ _key, ...rest }) => rest),
        data_source: (strOrNull(fd.get('data_source')) as PoliceRecordSource | null) ?? null,
        notes: strOrNull(fd.get('notes')),
      };
      const res = await onSubmit(payload);
      if (!res.ok) {
        setErr(res.error);
        setBusy(false);
        return;
      }
      setBusy(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur inconnue');
      setBusy(false);
    }
  }

  // Compte rendu pour le panel "champs manquants"
  const requiredCheck: { field: keyof PoliceRecord; label: string; value: unknown }[] = [
    { field: 'head_last_name', label: 'Nom', value: v.head_last_name },
    { field: 'head_first_name', label: 'Prénom', value: v.head_first_name },
    { field: 'head_gender', label: 'Sexe', value: v.head_gender },
    { field: 'head_birth_date', label: 'Date naissance', value: v.head_birth_date },
    { field: 'head_birth_place', label: 'Lieu naissance', value: v.head_birth_place },
    { field: 'head_nationality', label: 'Nationalité', value: v.head_nationality },
    { field: 'head_id_type', label: 'Type pièce', value: v.head_id_type },
    { field: 'head_id_number', label: 'N° pièce', value: v.head_id_number },
    { field: 'head_id_issue_country', label: 'Pays émetteur', value: v.head_id_issue_country },
    { field: 'head_residence_country', label: 'Pays résidence', value: v.head_residence_country },
    { field: 'head_residence_address', label: 'Adresse résidence', value: v.head_residence_address },
    { field: 'arrival_date_property', label: 'Date arrivée logement', value: v.arrival_date_property },
    { field: 'expected_departure_date', label: 'Date départ prévue', value: v.expected_departure_date },
    { field: 'motif_sejour', label: 'Motif séjour', value: v.motif_sejour },
  ];
  const missingLabels = requiredCheck.filter((r) => isMissing(r.field, r.value)).map((r) => r.label);

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-4xl">
      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {err}
        </div>
      )}

      {/* 1) Hébergement */}
      <Section title="1. Hébergement">
        <div>
          <label className={labelCls}>Bien</label>
          <select
            name="property_id"
            value={propertyId ?? ''}
            onChange={(e) => {
              const id = e.currentTarget.value || null;
              setPropertyId(id);
              setUnitId(null);
            }}
            disabled={readonly}
            className={inputCls}
          >
            <option value="">— Aucun —</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Unité / Lot</label>
          <select
            name="propria_unit_id"
            value={unitId ?? ''}
            onChange={(e) => setUnitId(e.currentTarget.value || null)}
            disabled={readonly}
            className={inputCls}
          >
            <option value="">— Bien entier —</option>
            {filteredUnits.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </div>
        <Field
          label="Arrivée logement"
          name="arrival_date_property"
          type="date"
          defaultValue={v.arrival_date_property as string | null | undefined}
          required
          hasError={isMissing('arrival_date_property', v.arrival_date_property)}
          disabled={readonly}
        />
        <Field
          label="Départ prévu"
          name="expected_departure_date"
          type="date"
          defaultValue={v.expected_departure_date as string | null | undefined}
          required
          hasError={isMissing('expected_departure_date', v.expected_departure_date)}
          disabled={readonly}
        />
      </Section>

      {/* 2) Chef de famille */}
      <Section title="2. Chef de famille (voyageur principal)">
        <Field
          label="Nom"
          name="head_last_name"
          defaultValue={v.head_last_name as string | null | undefined}
          required
          hasError={isMissing('head_last_name', v.head_last_name)}
          disabled={readonly}
        />
        <Field
          label="Prénom"
          name="head_first_name"
          defaultValue={v.head_first_name as string | null | undefined}
          required
          hasError={isMissing('head_first_name', v.head_first_name)}
          disabled={readonly}
        />
        <SelectField
          label="Sexe"
          name="head_gender"
          defaultValue={v.head_gender as string | null | undefined}
          required
          hasError={isMissing('head_gender', v.head_gender)}
          disabled={readonly}
          options={[
            { value: 'M', label: 'Masculin' },
            { value: 'F', label: 'Féminin' },
            { value: 'autre', label: 'Autre' },
          ]}
        />
        <Field
          label="Date de naissance"
          name="head_birth_date"
          type="date"
          defaultValue={v.head_birth_date as string | null | undefined}
          required
          hasError={isMissing('head_birth_date', v.head_birth_date)}
          disabled={readonly}
        />
        <Field
          label="Lieu de naissance (ville, pays)"
          name="head_birth_place"
          defaultValue={v.head_birth_place as string | null | undefined}
          required
          hasError={isMissing('head_birth_place', v.head_birth_place)}
          disabled={readonly}
        />
        <Field
          label="Nationalité"
          name="head_nationality"
          defaultValue={v.head_nationality as string | null | undefined}
          required
          hasError={isMissing('head_nationality', v.head_nationality)}
          disabled={readonly}
        />
        <Field
          label="Profession"
          name="head_profession"
          defaultValue={v.head_profession as string | null | undefined}
          disabled={readonly}
        />
      </Section>

      {/* 3) Pièce d'identité */}
      <Section title="3. Pièce d'identité du chef de famille">
        <SelectField
          label="Type de pièce"
          name="head_id_type"
          defaultValue={v.head_id_type as string | null | undefined}
          required
          hasError={isMissing('head_id_type', v.head_id_type)}
          disabled={readonly}
          options={[
            { value: 'cin', label: 'CIN' },
            { value: 'passport', label: 'Passeport' },
            { value: 'other', label: 'Autre' },
          ]}
        />
        <Field
          label="N° de pièce"
          name="head_id_number"
          defaultValue={v.head_id_number as string | null | undefined}
          required
          hasError={isMissing('head_id_number', v.head_id_number)}
          disabled={readonly}
        />
        <Field
          label="Date d'émission"
          name="head_id_issue_date"
          type="date"
          defaultValue={v.head_id_issue_date as string | null | undefined}
          disabled={readonly}
        />
        <Field
          label="Date d'expiration"
          name="head_id_expiry_date"
          type="date"
          defaultValue={v.head_id_expiry_date as string | null | undefined}
          disabled={readonly}
        />
        <Field
          label="Pays émetteur"
          name="head_id_issue_country"
          defaultValue={v.head_id_issue_country as string | null | undefined}
          required
          hasError={isMissing('head_id_issue_country', v.head_id_issue_country)}
          disabled={readonly}
          span2
        />
      </Section>

      {/* 4) Résidence habituelle */}
      <Section title="4. Résidence habituelle">
        <Field
          label="Pays de résidence"
          name="head_residence_country"
          defaultValue={v.head_residence_country as string | null | undefined}
          required
          hasError={isMissing('head_residence_country', v.head_residence_country)}
          disabled={readonly}
        />
        <Field
          label="Adresse complète"
          name="head_residence_address"
          defaultValue={v.head_residence_address as string | null | undefined}
          required
          hasError={isMissing('head_residence_address', v.head_residence_address)}
          disabled={readonly}
          placeholder="Numéro, rue, ville, code postal"
        />
      </Section>

      {/* 5) Séjour */}
      <Section title="5. Détails du séjour">
        <Field
          label="Date arrivée Maroc"
          name="arrival_date_morocco"
          type="date"
          defaultValue={v.arrival_date_morocco as string | null | undefined}
          disabled={readonly}
        />
        <SelectField
          label="Motif du séjour"
          name="motif_sejour"
          defaultValue={v.motif_sejour as string | null | undefined}
          required
          hasError={isMissing('motif_sejour', v.motif_sejour)}
          disabled={readonly}
          options={[
            { value: 'tourisme', label: 'Tourisme' },
            { value: 'affaires', label: 'Affaires' },
            { value: 'famille', label: 'Famille' },
            { value: 'transit', label: 'Transit' },
            { value: 'autre', label: 'Autre' },
          ]}
        />
        <SelectField
          label="Source des données"
          name="data_source"
          defaultValue={(v.data_source as string | null | undefined) ?? 'unknown'}
          disabled={readonly}
          options={[
            { value: 'hostaway_portal', label: 'Portail Hostaway' },
            { value: 'manual_checkin', label: 'Check-in manuel' },
            { value: 'whatsapp', label: 'WhatsApp' },
            { value: 'unknown', label: 'Inconnue' },
          ]}
          span2
        />
        <TextAreaField
          label="Notes / Observations"
          name="notes"
          defaultValue={v.notes as string | null | undefined}
          disabled={readonly}
        />
      </Section>

      {/* 6) Accompagnants */}
      <Section title={`6. Accompagnants (${accompanying.length})`} defaultOpen={accompanying.length > 0}>
        <div className="sm:col-span-2 space-y-3">
          {accompanying.length === 0 && (
            <p className="text-sm text-stoniz-gray-500 italic">
              Aucun accompagnant. Cliquez sur « + Ajouter » pour ajouter un conjoint, enfant ou autre.
            </p>
          )}
          {accompanying.map((p, i) => (
            <AccompanyingRow
              key={p._key}
              index={i}
              person={p}
              readonly={readonly}
              onChange={patchAccompanying}
              onRemove={removeAccompanying}
            />
          ))}
          {!readonly && (
            <button
              type="button"
              onClick={addAccompanying}
              className="w-full sm:w-auto border border-stoniz-gray-300 hover:border-stoniz-black px-4 py-2 rounded-md text-sm"
            >
              + Ajouter un accompagnant
            </button>
          )}
        </div>
      </Section>

      {/* Footer : champs manquants + submit */}
      {!readonly && (
        <>
          {showMissingHighlight && missingLabels.length > 0 && (
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded p-3">
              <strong>Champs manquants pour passer en « Complète » :</strong>{' '}
              {missingLabels.join(', ')}
            </div>
          )}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={busy}
              className="w-full sm:w-auto bg-stoniz-black text-white px-5 py-2.5 sm:py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
            >
              {busy ? 'Enregistrement…' : submitLabel}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
