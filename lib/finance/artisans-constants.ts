export const ARTISAN_TYPE_LABELS: Record<string, string> = {
  artisan_local:       'Artisan local',
  entreprise_generale: 'Entreprise générale',
  sous_traitant_ext:   'Sous-traitant extérieur',
  fournisseur:         'Fournisseur',
  grossiste:           'Grossiste',
  importateur:         'Importateur',
  autre:               'Autre',
};

/**
 * Catégories métier regroupant les types `artisans` pour les chips de filtre UI.
 * Décision CEO 2026-05-31 : 4 catégories — Artisans / Entreprises / Fournisseurs / Autre.
 * Les agences immobilières sont une autre entité (table `partners`, page `/partners`).
 */
export const ARTISAN_CATEGORIES: Record<string, { label: string; types: string[] }> = {
  artisans: {
    label: 'Artisans',
    types: ['artisan_local', 'sous_traitant_ext'],
  },
  entreprises: {
    label: 'Entreprises',
    types: ['entreprise_generale'],
  },
  fournisseurs: {
    label: 'Fournisseurs',
    types: ['fournisseur', 'grossiste', 'importateur'],
  },
  autre: {
    label: 'Autre',
    types: ['autre'],
  },
};

export const ARTISAN_LEGAL_FORMS: Record<string, string> = {
  personne_physique:  'Personne physique',
  sarl:               'SARL',
  sa:                 'SA',
  sas:                'SAS',
  sci:                'SCI',
  auto_entrepreneur:  'Auto-entrepreneur',
  autre:              'Autre',
};

export const ARTISAN_SPECIALITIES: Record<string, string> = {
  demolition_cloisons:        'Démolition / cloisons',
  gros_oeuvre_maconnerie:     'Gros œuvre / maçonnerie',
  electricite:                'Électricité',
  plomberie_sanitaire:        'Plomberie / sanitaire',
  carrelage_revetements:      'Carrelage / revêtements',
  menuiserie_interieure:      'Menuiserie intérieure',
  menuiserie_aluminium:       'Menuiserie aluminium',
  peinture:                   'Peinture',
  faux_plafond:               'Faux plafond',
  climatisation_vmc:          'Climatisation / VMC',
  ferronnerie:                'Ferronnerie',
  amenagements_exterieurs:    'Aménagements extérieurs',
  cuisine:                    'Cuisine',
  divers:                     'Divers',
  multi_corps_etat:           'Multi corps d\'état',
};

export const ARTISAN_STATUSES: Record<string, string> = {
  actif:     'Actif',
  inactif:   'Inactif',
  blacklist: 'Blacklist',
  prospect:  'Prospect',
};
