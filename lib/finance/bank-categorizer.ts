/**
 * Catégorisation automatique des transactions bancaires Chaabi.
 *
 * Approche :
 *   1. Préfixes structurés du libellé Chaabi (ex: "VIR. EMIS VERS X EN FAVEUR DE Y")
 *      → catégorie déduite + bénéficiaire extrait
 *   2. Si la transaction matche un mapping sauvegardé dans bank_category_mappings,
 *      on applique en priorité ce mapping (apprentissage CEO/Finance)
 *
 * Résultat utilisé pour pré-remplir l'écran de dry-run. Le CEO/Finance peut
 * toujours surcharger manuellement avant validation.
 */

import type { ChaabiRawRow } from './bank-chaabi-parser';

/**
 * Catégorie technique de la transaction (basée sur la nature de l'opération bancaire).
 */
export type CategoryCode =
  | 'achat_cb'             // ACHAT PAR CARTE CHEZ ...
  | 'achat_cb_etranger'    // ACHAT PAR CARTE A L'ETRANGER
  | 'virement_emis'        // VIR. EMIS / VIR. DIGITAL ORDINAIRE EMIS
  | 'virement_instantane_emis'   // VIR. INSTANTANE EN FAVEUR DE ...
  | 'virement_recu'        // VIR. RECU / VIREMENT RECU
  | 'virement_instantane_recu'   // VIR. INSTANTANE RECU DE ...
  | 'virement_etranger_recu'     // VIREMENT RECU DE L'ETRANGER / VIR. FINANCIER EMIS
  | 'cheque_emis'          // CHEQUE N ... PAYE EN FAVEUR DE ...
  | 'cheque_recu'          // CHEQUE N ... REMIS PAR ... / ENCAISSEMENT CHEQUE
  | 'dgi'                  // PRELEVEMENTS DES IMPOTS EN FAVEUR DE LA DGI
  | 'cnss'                 // COTISATIONS CNSS
  | 'maroc_telecom'        // REDEVANCES MAROC TELECOM / PAIEMENT DE FACTURE IAM
  | 'frais_bancaire'       // COMMISSION / TAXE SUR VALEUR AJOUTEE / FRAIS CARTE MONETIQUE
  | 'mise_a_disposition'   // ORDRE DE MISE A DISPOSITION
  | 'paiement_facture'     // PAIEMENT FACT TAXES EN LIGNE / SRM
  | 'autre';

/**
 * Type d'allocation business (sera utilisé au Chantier 3 pour rattacher aux projets).
 */
export type AllocationType =
  | 'travaux'
  | 'achats'
  | 'services'          // architecte, géomètre, juridique, photo, décoration, conseil…
  | 'honoraires'
  | 'propria'
  | 'cabinet_charge'    // loyer, salaires, télécom, fournitures bureau, comptable
  | 'cabinet_fiscal'    // DGI (impôts, TVA, IR, IS)
  | 'cabinet_social'    // CNSS, AT
  | 'frais_bancaire'    // commissions banque
  | 'intercompany'      // STZ OJ ↔ STZ CLUB ↔ ELZ HOLVESTA
  | 'autre';

export type CategorizationResult = {
  category_code: CategoryCode;
  allocation_type: AllocationType;
  beneficiary: string | null;       // nom extrait du libellé (ex: "OUACHAOU TRAVAUX")
  confidence: 'auto' | 'mapped' | 'unknown';  // auto=via préfixe, mapped=via bank_category_mappings, unknown=à qualifier
  notes?: string;
};

/**
 * Mapping sauvegardé en BDD (table bank_category_mappings).
 * Permet de mémoriser les qualifications manuelles : à la 2e importation, on
 * matche automatiquement les libellés connus.
 */
export type SavedMapping = {
  bank_label_match: string;         // chaîne à matcher (ex: "AZELMAT ZINEB")
  match_type: 'contains' | 'exact' | 'regex';
  category_code: string;            // catégorie cible (peut sortir du typage strict)
  allocation_type: string | null;
};

// ─── Extraction du bénéficiaire ──────────────────────────────────────────

function extractBeneficiary(label: string, prefix: RegExp): string | null {
  const m = label.match(prefix);
  if (!m) return null;
  const after = m[1] ?? '';
  // Couper à "REF" si présent (les libellés finissent souvent par REF xxxxxx)
  const cut = after.split(/\s+REF\s+/i)[0];
  return cut.trim().replace(/\s+/g, ' ').slice(0, 120) || null;
}

// ─── Règles de catégorisation par préfixe ───────────────────────────────

type Rule = {
  match: (label: string) => boolean;
  category: CategoryCode;
  allocation: AllocationType;
  extractBeneficiary?: (label: string) => string | null;
};

const RULES: Rule[] = [
  // ─── Achats CB ──────────────────────────────────────────────────────────
  {
    match: (l) => /^ACHAT PAR CARTE A L['']?ETRANGER/i.test(l),
    category: 'achat_cb_etranger',
    allocation: 'cabinet_charge',
  },
  {
    match: (l) => /^ACHAT PAR CARTE\s/i.test(l) || /^ACHAT PAR CARTE DE PAIEMENT/i.test(l),
    category: 'achat_cb',
    allocation: 'cabinet_charge',
    extractBeneficiary: (l) => {
      const chez = extractBeneficiary(l, /CHEZ\s+(.+?)(?:>|$)/i);
      if (chez) return chez;
      return extractBeneficiary(l, /^ACHAT\s+PAR\s+CARTE\s+(.+?)(?:>|\(\*\)|$)/i);
    },
  },

  // ─── Virements ─────────────────────────────────────────────────────────
  {
    match: (l) => /^VIR\.\s*INSTANTANE\s+EN\s+FAVEUR\s+DE/i.test(l),
    category: 'virement_instantane_emis',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /EN FAVEUR DE\s+(.+)/i),
  },
  {
    match: (l) => /^VIR\.\s*INSTANTANE\s+RECU\s+DE/i.test(l),
    category: 'virement_instantane_recu',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /RECU DE\s+(.+)/i),
  },
  {
    match: (l) => /^VIR\.\s*FINANCIER\s+EMIS/i.test(l),
    category: 'virement_etranger_recu', // libellé sortant mais structure similaire (international)
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /VERS\s+(.+?)\s+MNT/i),
  },
  {
    match: (l) => /^VIREMENT\s+RECU\s+DE\s+L['']?ETRANGER/i.test(l),
    category: 'virement_etranger_recu',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /DE\s+(.+?)\s+PAYS/i),
  },
  {
    match: (l) => /^VIR\.\s*(DIGITAL\s+ORDINAIRE\s+)?EMIS\s+VERS/i.test(l),
    category: 'virement_emis',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /EN FAVEUR DE\s+(.+)/i),
  },
  {
    match: (l) => /^VIR\.\s*RECU\s+DE/i.test(l) || /^VIREMENT\s+(RECU|EN\s+VOTRE\s+FAVEUR|COMMERCIAL\s+RECU)/i.test(l),
    category: 'virement_recu',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /(?:RECU\s+DE|VOTRE\s+FAVEUR\s+DE)\s+(.+)/i),
  },

  // ─── Chèques ────────────────────────────────────────────────────────────
  {
    match: (l) => /^CHEQUE\s+N\s+\d+\s+PAYE\s+EN\s+FAVEUR\s+DE/i.test(l) || /^ETABLISSEMENT\s+CHEQUE/i.test(l),
    category: 'cheque_emis',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /EN FAVEUR DE\s+(.+)/i),
  },
  {
    match: (l) => /^CHEQUE\s+N\s+\d+\s+REMIS\s+PAR/i.test(l) || /^ENCAISSEMENT\s+CHEQUE/i.test(l),
    category: 'cheque_recu',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /(?:REMIS\s+PAR|PAR|EN\s+FAVEUR\s+DE)\s+(.+)/i),
  },

  // ─── Charges fiscales / sociales / structure ──────────────────────────
  {
    match: (l) => /^PRELEVEMENTS\s+DES\s+IMPOTS/i.test(l) || /^PAIEMENT\s+FACT\s+TAXES/i.test(l),
    category: 'dgi',
    allocation: 'cabinet_fiscal',
  },
  {
    match: (l) => /^COTISATIONS\s+CNSS/i.test(l),
    category: 'cnss',
    allocation: 'cabinet_social',
  },
  {
    match: (l) => /^REDEVANCES\s+MAROC\s+TELECOM/i.test(l) || /PAIEMENT\s+DE\s+FACTURE\s+IAM/i.test(l),
    category: 'maroc_telecom',
    allocation: 'cabinet_charge',
  },
  {
    match: (l) => /SRM\s+Marrakech/i.test(l),
    category: 'paiement_facture',
    allocation: 'cabinet_charge',
  },

  // ─── Frais bancaires ──────────────────────────────────────────────────
  {
    match: (l) => /^COMMISSION/i.test(l)
      || /^TAXE\s+SUR\s+VALEUR\s+AJOUTEE/i.test(l)
      || /^FRAIS\s+CARTE\s+MONETIQUE/i.test(l)
      || /^DROIT\s+DE\s+TIMBRE/i.test(l)
      || /^RESTITUTION\s+COMMISSION/i.test(l)
      || /^RECUPERATION\s+FRAIS/i.test(l)
      || /^COMMISSION\s+DE\s+TENUE/i.test(l)
      || /^ANNULATION\s+ECRITURE/i.test(l),
    category: 'frais_bancaire',
    allocation: 'frais_bancaire',
  },

  // ─── Versements ───────────────────────────────────────────────────────
  {
    match: (l) => /^VERSEMENT/i.test(l),
    category: 'virement_recu',
    allocation: 'autre',
  },

  // ─── Mises à disposition ──────────────────────────────────────────────
  {
    match: (l) => /^ORDRE\s+DE\s+MISE\s+A\s+DISPOSITION/i.test(l),
    category: 'mise_a_disposition',
    allocation: 'autre',
    extractBeneficiary: (l) => extractBeneficiary(l, /EN FAVEUR DE\s+(.+)/i),
  },
];

// ─── Détection des flux intercompagnies ──────────────────────────────────
// Si bénéficiaire/émetteur contient un nom de société Stoniz, on tagge intercompany
const INTERCOMPANY_NAMES = [
  'STZ CLUB',
  'STZ OJ',
  'ELZ HOLVESTA',
  'STONIZ',
];

function isIntercompany(label: string, beneficiary: string | null): boolean {
  const up = (beneficiary ?? label).toUpperCase();
  return INTERCOMPANY_NAMES.some(name => up.includes(name));
}

// ─── Fonction principale ──────────────────────────────────────────────────

export function categorize(
  row: Pick<ChaabiRawRow, 'label'>,
  savedMappings: SavedMapping[] = [],
): CategorizationResult {
  const label = row.label;

  // 1. Mappings sauvegardés (apprentissage) — priorité absolue
  for (const m of savedMappings) {
    let matched = false;
    if (m.match_type === 'exact') matched = label === m.bank_label_match;
    else if (m.match_type === 'regex') {
      try { matched = new RegExp(m.bank_label_match, 'i').test(label); }
      catch { matched = false; }
    } else {
      matched = label.toLowerCase().includes(m.bank_label_match.toLowerCase());
    }
    if (matched) {
      return {
        category_code: (m.category_code as CategoryCode) ?? 'autre',
        allocation_type: (m.allocation_type as AllocationType) ?? 'autre',
        beneficiary: m.bank_label_match,
        confidence: 'mapped',
        notes: 'Catégorisation mémorisée (mapping sauvegardé)',
      };
    }
  }

  // 2. Règles par préfixe
  for (const rule of RULES) {
    if (rule.match(label)) {
      const beneficiary = rule.extractBeneficiary ? rule.extractBeneficiary(label) : null;
      const allocation_type: AllocationType =
        isIntercompany(label, beneficiary) ? 'intercompany' : rule.allocation;
      return {
        category_code: rule.category,
        allocation_type,
        beneficiary,
        confidence: 'auto',
      };
    }
  }

  // 3. Aucune règle ne matche → à qualifier manuellement
  return {
    category_code: 'autre',
    allocation_type: 'autre',
    beneficiary: null,
    confidence: 'unknown',
    notes: 'Libellé non reconnu — à qualifier manuellement',
  };
}

/**
 * Libellé humain pour l'UI.
 */
export const CATEGORY_LABELS: Record<CategoryCode, string> = {
  achat_cb: 'Achat par carte',
  achat_cb_etranger: 'Achat carte étranger',
  virement_emis: 'Virement émis',
  virement_instantane_emis: 'Virement instantané émis',
  virement_recu: 'Virement reçu',
  virement_instantane_recu: 'Virement instantané reçu',
  virement_etranger_recu: 'Virement étranger',
  cheque_emis: 'Chèque émis',
  cheque_recu: 'Chèque reçu',
  dgi: 'Impôts (DGI)',
  cnss: 'Charges sociales (CNSS)',
  maroc_telecom: 'Maroc Telecom',
  frais_bancaire: 'Frais bancaires',
  mise_a_disposition: 'Mise à disposition',
  paiement_facture: 'Paiement facture',
  autre: 'Autre / À qualifier',
};

export const ALLOCATION_LABELS: Record<AllocationType, string> = {
  travaux: 'Projet — travaux',
  achats: 'Projet — achats',
  services: 'Projet — services (architecte, géomètre, juriste…)',
  honoraires: 'Honoraires Stoniz',
  propria: 'Propria conciergerie',
  cabinet_charge: 'Cabinet (loyer, salaires, télécom…)',
  cabinet_fiscal: 'Cabinet (DGI / impôts)',
  cabinet_social: 'Cabinet (CNSS / charges sociales)',
  frais_bancaire: 'Frais bancaires',
  intercompany: 'Intercompagnies',
  autre: 'Autre / À qualifier',
};
