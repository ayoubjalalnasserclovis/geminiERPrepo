'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

type Provider = { id: string; name: string; function: string | null };

export type PropriaBienValues = Partial<Record<string, any>>;

// ─────────────────────────────────────────────────────────────────────────
// Composants Field / TextArea / YesNoField sortis HORS de PropriaBienForm
// (CEO 2026-06-11). Avant ils étaient définis dans la closure parente, ce
// qui leur donnait une identité différente à chaque render → React
// démontait / remontait les <input> à chaque setState parent (notamment
// recomputeMissing au onBlur du form). Conséquence : le defaultValue était
// ré-appliqué = la valeur initiale du bien = la frappe en cours était
// PERDUE dès que l'utilisateur cliquait ailleurs. C'est ce bug-là qui
// faisait disparaître RIB / Nom banque chez Ismael.
//
// Maintenant ces composants ont une identité STABLE entre renders, donc
// React conserve les <input> montés et leur état interne (= la frappe).
// ─────────────────────────────────────────────────────────────────────────

const inputCls =
  'mt-1 w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30';
const labelCls = 'text-xs text-stoniz-gray-600';
const sectionCls = 'bg-white border border-stoniz-gray-200 rounded-xl p-6 mb-5';
const grid = 'grid grid-cols-1 md:grid-cols-2 gap-4';

function Field({
  initial, name, label, type = 'text', required = false, placeholder = '', step, soft = false,
}: {
  initial: PropriaBienValues;
  name: string; label: string; type?: string; required?: boolean;
  placeholder?: string; step?: string;
  /** soft = optionnel mais on incitera à compléter via la bannière sur la fiche */
  soft?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label}
        {required && <span className="text-red-600"> *</span>}
        {soft && <span className="ml-1 text-amber-600 text-[10px] uppercase tracking-wider">à compléter</span>}
      </label>
      <input
        type={type}
        name={name}
        defaultValue={initial[name] ?? ''}
        // Soft validation : marqué visuellement * mais n'empêche pas l'enregistrement
        data-soft-required={required ? 'true' : undefined}
        data-soft-label={required ? label : undefined}
        placeholder={placeholder}
        step={step}
        className={inputCls}
      />
    </div>
  );
}

function TextArea({ initial, name, label, rows = 3, required = false }: {
  initial: PropriaBienValues;
  name: string; label: string; rows?: number; required?: boolean;
}) {
  return (
    <div className="md:col-span-2">
      <label className={labelCls}>
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <textarea
        name={name}
        defaultValue={initial[name] ?? ''}
        rows={rows}
        data-soft-required={required ? 'true' : undefined}
        data-soft-label={required ? label : undefined}
        className={inputCls}
      />
    </div>
  );
}

function YesNoField({ initial, name, label, required = true }: {
  initial: PropriaBienValues;
  name: string; label: string; required?: boolean;
}) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-red-600">*</span>}
      </label>
      <select
        name={name}
        defaultValue={initial[name] === true ? 'oui' : initial[name] === false ? 'non' : ''}
        data-soft-required={required ? 'true' : undefined}
        data-soft-label={required ? label : undefined}
        className={inputCls}
      >
        <option value="">—</option>
        <option value="oui">Oui</option>
        <option value="non">Non</option>
      </select>
    </div>
  );
}

// Liste fermée des quartiers — à étendre si besoin
const QUARTIERS = [
  'Gueliz',
  'Hivernage',
  'Majorelle',
  'Victor Hugo',
  'Semlalia',
  'Palmeraie',
  'Médina',
  'Targa',
  'Massira',
  'Route de Casablanca',
  'Autre',
];

const BUILDING_ACCESS_TYPES = [
  { value: 'ouvert_24_24',     label: 'Ouvert 24/24' },
  { value: 'cle',              label: 'Clé' },
  { value: 'badge_ascenseur',  label: 'Badge ascenseur' },
  { value: 'badge_immeuble',   label: 'Badge immeuble' },
  { value: 'badge_asc_cle',    label: 'Badge ascenseur + clé' },
  { value: 'digicode',         label: 'Digicode' },
];

export function PropriaBienForm({
  initial,
  providers,
  action,
  submitLabel = 'Enregistrer',
}: {
  initial?: PropriaBienValues;
  providers: Provider[];
  action: (formData: FormData) => Promise<void>;
  submitLabel?: string;
}) {
  const v = initial ?? {};
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Type d'accès immeuble — pilote le conditionnel "nb badges ascenseur"
  const [buildingAccess, setBuildingAccess] = useState<string>(v.propria_building_access_type ?? '');
  const badgesRequired = buildingAccess !== '' && buildingAccess !== 'ouvert_24_24' && buildingAccess !== 'cle';

  // ─── Soft validation : on n'empêche jamais l'enregistrement, mais on
  // affiche en haut un bandeau dynamique listant les champs marqués *
  // qui ne sont pas remplis. Implémenté via data-soft-required + data-soft-label
  // sur les inputs, et un recalcul à chaque change/focus.
  const formRef = useRef<HTMLFormElement>(null);
  const [missingFields, setMissingFields] = useState<{ name: string; label: string }[]>([]);

  function recomputeMissing() {
    const form = formRef.current;
    if (!form) return;
    const els = form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
      '[data-soft-required="true"]',
    );
    const missing: { name: string; label: string }[] = [];
    els.forEach((el) => {
      // Si la valeur est vide (string vide), on liste le champ
      if (!el.value || String(el.value).trim() === '') {
        missing.push({
          name: el.name || '',
          label: el.dataset.softLabel || el.name || '(champ sans libellé)',
        });
      }
    });
    setMissingFields(missing);
  }

  // Calcul initial après montage (les valeurs par défaut sont déjà en place)
  useEffect(() => {
    recomputeMissing();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const fd = new FormData(e.currentTarget);
      await action(fd);
    } catch (err: any) {
      setError(err.message ?? 'Erreur');
      setSubmitting(false);
    }
  }

  // CEO 2026-06-11 : Field/TextArea/YesNoField sont maintenant définis HORS
  // de ce composant pour avoir une identité React stable et empêcher le
  // démontage des inputs au blur. Voir le commentaire en haut du fichier.

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      // CEO 2026-06-11 : Field / TextArea / YesNoField sont maintenant définis
      // hors de PropriaBienForm (identité React stable), donc un setState
      // parent (comme recomputeMissing) ne démonte plus les inputs. La frappe
      // est préservée. Le onBlur ici reste suffisant pour le bandeau soft.
      onBlur={recomputeMissing}
    >
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-md p-3 mb-4 text-sm">
          {error}
        </div>
      )}

      {/* Bandeau de soft validation : on n'empêche pas d'enregistrer, mais on
          alerte que des champs * sont vides. Mis à jour à chaque changement. */}
      {missingFields.length > 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 mb-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong>
                {missingFields.length} champ{missingFields.length > 1 ? 's' : ''} marqué{missingFields.length > 1 ? 's' : ''} <span className="text-red-600">*</span> non rempli{missingFields.length > 1 ? 's' : ''}
              </strong>
              <span className="block text-amber-800/80 text-[12px] mt-0.5">
                Tu peux quand même enregistrer — la fiche sera marquée incomplète tant que ces champs sont vides.
              </span>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[12px] underline hover:no-underline">
                  Voir la liste
                </summary>
                <ul className="mt-1.5 text-[12px] grid grid-cols-1 md:grid-cols-2 gap-x-4">
                  {missingFields.map((f) => (
                    <li key={f.name} className="list-disc ml-4">{f.label}</li>
                  ))}
                </ul>
              </details>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 mb-4 text-sm text-emerald-900 flex items-start gap-2">
          <span className="text-emerald-600">✓</span>
          <span>Tous les champs marqués <span className="text-red-600">*</span> sont remplis.</span>
        </div>
      )}

      {/* ─── IDENTITÉ ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Identité du bien</h2>
        <div className={grid}>
          <Field initial={v} name="name" label="Nom (interne complet)" required placeholder="ex: Villa Palmeraie" />
          <Field initial={v} name="propria_internal_code" label="Code interne court" required placeholder="ex: AF 1, MAJO 2" />
          <div>
            <label className={labelCls}>Type de bien <span className="text-red-600">*</span></label>
            <select name="type" defaultValue={v.type ?? ''}
              data-soft-required="true" data-soft-label="Type de bien"
              className={inputCls}>
              <option value="">—</option>
              <option value="Appartement">Appartement</option>
              <option value="Riad">Riad</option>
              <option value="Villa">Villa</option>
              <option value="Terrain">Terrain</option>
            </select>
          </div>
          <Field initial={v} name="superficie" label="Superficie (m²)" type="number" step="0.01" />
        </div>
        <p className="text-xs text-stoniz-gray-500 mt-3">
          Capacité, chambres, lits, prix et annonces se renseignent par <strong>lot</strong> (à la mise en location), via « Éditer ce lot » sur la fiche.
        </p>
      </section>

      {/* ─── LOCALISATION ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Localisation</h2>
        <div className={grid}>
          <div>
            <label className={labelCls}>Quartier <span className="text-red-600">*</span></label>
            <select name="quartier" defaultValue={v.quartier ?? ''}
              data-soft-required="true" data-soft-label="Quartier"
              className={inputCls}>
              <option value="">—</option>
              {QUARTIERS.map(q => <option key={q} value={q}>{q}</option>)}
            </select>
          </div>
          <Field initial={v} name="floor" label="Étage" required />
          <Field initial={v} name="propria_apartment_door" label="N° porte" required />
          <Field initial={v} name="address" label="Adresse complète" required />
          <Field initial={v} name="propria_google_maps_url" label="Lien Google Maps" type="url" required />
        </div>
      </section>

      {/* ─── PROPRIÉTAIRE ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Propriétaire</h2>
        <div className={grid}>
          <Field initial={v} name="propria_owner_name" label="Nom du propriétaire" required />
          <Field initial={v} name="propria_owner_phone" label="Téléphone" soft />
          <Field initial={v} name="propria_owner_email" label="Email" type="email" soft />
        </div>
      </section>

      {/* ─── ÉTAT FICHE (remonté sous Propriétaire — CEO 2026-06-09) ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">État de la fiche</h2>
        <div className={grid}>
          <YesNoField initial={v} name="propria_info_sheet_to_send" label="Fiche d'infos à envoyer (oui/non)" required />
          <Field initial={v} name="propria_guardian_name" label="Nom du gardien" />
          <Field initial={v} name="propria_guardian_phone" label="Téléphone gardien" />
        </div>
      </section>

      {/* ─── BANQUE ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Banque du propriétaire</h2>
        <div className={grid}>
          {/* Nom banque : plus marqué obligatoire (CEO 2026-06-09) — RIB reste demandé */}
          <Field initial={v} name="propria_bank_name" label="Nom banque" />
          <Field initial={v} name="propria_bank_rib" label="RIB" required />
          <Field initial={v} name="propria_bank_iban" label="IBAN" />
          <Field initial={v} name="propria_bank_swift" label="SWIFT / BIC" />
        </div>
      </section>

      {/* ─── MANDAT ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Mandat Propria</h2>
        <div className={grid}>
          <Field initial={v} name="propria_mandate_start" label="Date début mandat" type="date" soft />
          <Field initial={v} name="propria_mandate_end" label="Date fin mandat" type="date" />
          <Field initial={v} name="propria_commission_rate" label="Taux commission (%)" type="number" step="0.01" placeholder="20" required />
          <TextArea initial={v} name="propria_mandate_conditions" label="Conditions particulières / mandat" />
        </div>
      </section>

      {/* ─── ACCÈS & SÉCURITÉ (refonte CEO 2026-06-09) ─── */}
      {/* Les champs PAR-SUITE (smart_lock, nb_keys, key_box_home/location)
          sont désormais sur la suite. Les caméras descendent ici depuis
          « Syndic & sécurité copro ». */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Accès & sécurité</h2>
        <div className={grid}>
          <div>
            <label className={labelCls}>Badge / Accès immeuble <span className="text-red-600">*</span></label>
            <select
              name="propria_building_access_type"
              value={buildingAccess}
              onChange={(e) => setBuildingAccess(e.target.value)}
              data-soft-required="true"
              data-soft-label="Badge / Accès immeuble"
              className={inputCls}
            >
              <option value="">—</option>
              {BUILDING_ACCESS_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          {badgesRequired && (
            <div>
              <label className={labelCls}>
                Nombre de badges ascenseur <span className="text-red-600">*</span>
              </label>
              <input
                type="number"
                name="propria_nb_elevator_badges"
                min={0}
                defaultValue={v.propria_nb_elevator_badges ?? ''}
                data-soft-required="true"
                data-soft-label="Nombre de badges ascenseur"
                className={inputCls}
              />
              <p className="text-[11px] text-stoniz-gray-500 mt-1">
                Obligatoire car l'accès à l'immeuble nécessite des badges.
              </p>
            </div>
          )}
          <Field initial={v} name="propria_lock_code" label="Code serrure logement" required />
          <YesNoField initial={v} name="propria_smart_lock" label="Admin serrure connectée (oui/non)" required />
          <Field initial={v} name="propria_key_box_building" label="Boîte à clés immeuble" required />
          <Field initial={v} name="propria_elevator_code" label="Code ascenseur" required />
          <Field initial={v} name="propria_parking_info" label="Parking (emplacement, code)" />

          {/* Caméras — déplacées depuis « Syndic & sécurité copro » */}
          <YesNoField initial={v} name="propria_camera_installed" label="Caméras déjà installées (oui/non)" required />
          <Field initial={v} name="propria_camera_info" label="Caméras — zones / accès (si installées)" />
          <YesNoField initial={v} name="propria_app_admin_access" label="Accès caméra admin par application (oui/non)" required />
        </div>
        <p className="text-[11px] text-stoniz-gray-500 mt-3">
          Nombre de clés, boîte à clés du lot, emplacement boîte à clés et vidéo d'arrivée se renseignent désormais
          <strong> par lot</strong> (cliquez sur « Éditer ce lot » sur la fiche du bien).
        </p>
      </section>

      {/* ─── UTILITIES (wifi retiré : déplacé sur la suite) ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Contrats utilities</h2>
        <div className={grid}>
          <Field initial={v} name="propria_water_contract" label="N° contrat eau" required />
          <Field initial={v} name="propria_water_meter" label="N° compteur eau" />
          <Field initial={v} name="propria_electricity_contract" label="N° contrat électricité" required />
          <Field initial={v} name="propria_electricity_meter" label="N° compteur électricité" />
          <Field initial={v} name="propria_internet_provider" label="Opérateur internet" required />
          <Field initial={v} name="propria_internet_contract" label="N° contrat internet" required />
        </div>
        <p className="text-[11px] text-stoniz-gray-500 mt-3">
          Wifi (SSID + mot de passe) se renseigne désormais <strong>par lot</strong>.
        </p>
      </section>

      {/* ─── SYNDIC & SÉCURITÉ COPRO (caméras retirées : déplacées dans Accès & sécurité) ─── */}
      <section className={sectionCls}>
        <h2 className="font-display text-lg mb-4">Syndic & sécurité copro</h2>
        <div className={grid}>
          <Field initial={v} name="propria_syndic_name" label="Nom du syndic" />
          <Field initial={v} name="propria_syndic_phone" label="Téléphone syndic" />
          <YesNoField initial={v} name="propria_syndic_to_pay" label="Syndic à payer (oui/non)" required={false} />
          <Field initial={v} name="propria_syndic_amount" label="Montant syndic (MAD)" type="number" step="0.01" />
        </div>
      </section>

      <div className="flex justify-end gap-3 mt-6">
        <button
          type="submit"
          disabled={submitting}
          className="bg-stoniz-black text-cream px-6 py-2.5 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {submitting ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
