/**
 * Spécialités artisans / fournisseurs, groupées par scope d'activité.
 * Permet de filtrer le dropdown selon que la fiche couvre Travaux, Déco, ou les deux.
 */

export type Speciality = { value: string; label: string };

export const TRAVAUX_SPECIALITIES: Speciality[] = [
  { value: 'demolition_cloisons',     label: 'Démolition / Cloisons' },
  { value: 'gros_oeuvre_maconnerie',  label: 'Gros œuvre / Maçonnerie' },
  { value: 'electricite',             label: 'Électricité' },
  { value: 'plomberie_sanitaire',     label: 'Plomberie / Sanitaire' },
  { value: 'carrelage_revetements',   label: 'Carrelage / Revêtements' },
  { value: 'menuiserie_interieure',   label: 'Menuiserie intérieure' },
  { value: 'menuiserie_aluminium',    label: 'Menuiserie aluminium' },
  { value: 'peinture',                label: 'Peinture' },
  { value: 'faux_plafond',            label: 'Faux plafond' },
  { value: 'climatisation_vmc',       label: 'Climatisation / VMC' },
  { value: 'ferronnerie',             label: 'Ferronnerie' },
  { value: 'amenagements_exterieurs', label: 'Aménagements extérieurs' },
  { value: 'cuisine',                 label: 'Cuisine' },
  { value: 'multi_corps_etat',        label: 'Multi corps d\'état' },
  { value: 'divers',                  label: 'Divers' },
];

export const DECO_SPECIALITIES: Speciality[] = [
  { value: 'mobilier_salon',         label: 'Mobilier salon' },
  { value: 'mobilier_chambre',       label: 'Mobilier chambre' },
  { value: 'mobilier_sdb',           label: 'Mobilier salle de bain' },
  { value: 'mobilier_cuisine',       label: 'Mobilier cuisine' },
  { value: 'electromenager',         label: 'Électroménager' },
  { value: 'luminaire',              label: 'Luminaires' },
  { value: 'textile_decoration',     label: 'Textile / décoration' },
  { value: 'vaisselle_arts_table',   label: 'Vaisselle / arts de la table' },
  { value: 'linge_maison',           label: 'Linge de maison' },
  { value: 'plomberie_robinetterie', label: 'Plomberie / robinetterie' },
  { value: 'sanitaires',             label: 'Sanitaires' },
  { value: 'carrelage_marbre',       label: 'Carrelage / marbre' },
  { value: 'jardinage_exterieur',    label: 'Jardinage / extérieur' },
];

export type BusinessScope = 'travaux' | 'deco' | 'both';

export const BUSINESS_SCOPES: { value: BusinessScope; label: string; hint: string }[] = [
  { value: 'travaux', label: 'Travaux', hint: 'Maçonnerie, électricité, plomberie, peinture…' },
  { value: 'deco',    label: 'Déco / Mobilier', hint: 'Meubles, luminaires, textiles, électroménager…' },
  { value: 'both',    label: 'Les deux', hint: 'Entreprise généraliste qui fait travaux ET fourniture' },
];

/**
 * Renvoie la liste des spécialités disponibles selon le scope choisi.
 * - travaux → spécialités travaux uniquement
 * - deco    → spécialités déco uniquement
 * - both    → toutes les spécialités, groupées
 */
export function getSpecialitiesForScope(scope: BusinessScope | null | undefined): Speciality[] {
  if (scope === 'deco') return DECO_SPECIALITIES;
  if (scope === 'both') return [...TRAVAUX_SPECIALITIES, ...DECO_SPECIALITIES];
  return TRAVAUX_SPECIALITIES; // défaut
}

export function formatSpeciality(value: string | null | undefined): string {
  if (!value) return '—';
  const all = [...TRAVAUX_SPECIALITIES, ...DECO_SPECIALITIES];
  return all.find(s => s.value === value)?.label ?? value;
}

export function formatBusinessScope(value: string | null | undefined): string {
  if (!value) return '—';
  return BUSINESS_SCOPES.find(s => s.value === value)?.label ?? value;
}

// ─── Conformité fiche artisan pour paiement ──────────────────────────────────

const INDEP_LEGAL_FORMS = new Set(['auto_entrepreneur', 'personne_physique']);

export type ArtisanCompleteness = {
  is_indep: boolean;
  missing: ('bank_name' | 'rib' | 'attestation_rib' | 'attestation_regularite_fiscale')[];
  is_complete_for_payment: boolean;
};

export function checkArtisanCompleteness(opts: {
  legal_form: string | null | undefined;
  bank_name: string | null | undefined;
  rib: string | null | undefined;
  has_attestation_rib: boolean;
  has_attestation_regularite_fiscale: boolean;
}): ArtisanCompleteness {
  const is_indep = !!opts.legal_form && INDEP_LEGAL_FORMS.has(opts.legal_form);
  const missing: ArtisanCompleteness['missing'] = [];

  if (!opts.bank_name || opts.bank_name.trim() === '') missing.push('bank_name');
  if (!opts.rib || opts.rib.trim() === '') missing.push('rib');

  // Attestations exigées uniquement pour les entreprises (non auto-entrepreneurs/personnes physiques)
  if (!is_indep) {
    if (!opts.has_attestation_rib) missing.push('attestation_rib');
    if (!opts.has_attestation_regularite_fiscale) missing.push('attestation_regularite_fiscale');
  }

  return {
    is_indep,
    missing,
    is_complete_for_payment: missing.length === 0,
  };
}

export const MISSING_LABELS: Record<string, string> = {
  bank_name: 'Nom de la banque',
  rib: 'RIB',
  attestation_rib: 'Attestation RIB',
  attestation_regularite_fiscale: 'Attestation de régularité fiscale',
};
