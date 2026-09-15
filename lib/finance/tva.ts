/**
 * Calcul automatique TVA du mois basé sur les transactions bancaires importées.
 * CEO 2026-09-02.
 *
 * Principe :
 *   - Chaque bank_transaction a un tva_treatment (auto par défaut, override possible)
 *     et un tva_rate optionnel (NULL = 20 % par défaut ou taux mémorisé pour le bénéf).
 *   - Mode 'auto' cascade :
 *     1) Si le bénéficiaire a une règle mémorisée dans vendor_tva_defaults → applique
 *     2) Sinon → règles par category_code (voir DEFAULT_TVA_RULES ci-dessous)
 *   - Taux TVA Maroc : 20 (standard), 14, 10, 7. Par défaut 20 quand non spécifié.
 *   - Montant importé = TTC. HT = TTC / (1 + rate/100) ; TVA = TTC − HT.
 *
 * Sortie : agrégation mensuelle par société avec base HT + TVA collectée/déductible
 * + TVA à payer (ou crédit).
 */

import { createClient } from '@/lib/supabase/server';

// Constantes et types déplacés dans ./tva-constants.ts (sans import serveur) pour
// pouvoir être lus par les composants client. Ré-exportés ici : les imports
// existants depuis '@/lib/finance/tva' continuent de fonctionner côté serveur.
export {
  DEFAULT_TVA_RATE,
  TVA_RATE_OPTIONS,
} from './tva-constants';
export type { TvaTreatment, TvaResolved } from './tva-constants';

import {
  DEFAULT_TVA_RATE,
  TVA_RATE_OPTIONS,
} from './tva-constants';
import type { TvaTreatment, TvaResolved } from './tva-constants';

/**
 * Règles par défaut appliquées quand tva_treatment='auto' ET aucun vendor_default.
 * Le sens dépend du signe (credit → entrée, debit → sortie).
 */
export const DEFAULT_TVA_RULES: {
  creditCollectee: Set<string>;
  debitDeductible: Set<string>;
  exonereeCategories: Set<string>;
  aQualifierCategories: Set<string>;
} = {
  creditCollectee: new Set([
    'virement_recu',
    'virement_instantane_recu',
    'cheque_recu',
    'virement_etranger_recu',
  ]),
  debitDeductible: new Set([
    'virement_emis',
    'virement_instantane_emis',
    'achat_cb',
    'paiement_facture',
    'cheque_emis',
  ]),
  exonereeCategories: new Set([
    'dgi',
    'cnss',
    'frais_bancaire',
    'maroc_telecom',
    'mise_a_disposition',
  ]),
  aQualifierCategories: new Set([
    'autre',
    'achat_cb_etranger',
  ]),
};

/**
 * Normalise un nom de bénéficiaire pour matching cohérent (lowercase + trim
 * + espaces multiples réduits).
 */
export function normalizeBeneficiary(b: string | null | undefined): string | null {
  if (!b) return null;
  const n = b.trim().toLowerCase().replace(/\s+/g, ' ');
  return n.length > 0 ? n : null;
}

/**
 * Mots-clés qui trahissent une société / commerce (donc PAS un salarié).
 * Case-insensitive.
 */
const COMPANY_KEYWORDS = [
  'sarl', 's.a.r.l', 'sarlau', 'sas', ' sa ', 's.a.', 'ste ', 'société', 'societe',
  'e-com', 'e com', 'mall', 'store', 'shop', 'boutique', 'magasin', 'geant', 'géant',
  'marche', 'marché', 'market', 'super', 'hyper', 'carrefour', 'marjane',
  'cafe', 'café', 'resto', 'restaurant', 'hotel', 'hôtel', 'station',
  'travaux', 'batiment', 'bâtiment', 'construction', 'import', 'export',
  'groupe', 'group ', 'company', 'services', 'consulting', 'conseil',
  'dgi', 'cnss', 'trésor', 'tresor', 'impots', 'impôts',
  'orange', 'iam', 'inwi', 'lydec', 'redal', 'radeema',
  'shell', 'total', 'winxo', 'afriquia', 'petromin',
];

/**
 * Heuristique : le bénéficiaire ressemble-t-il à une personne physique ?
 * Utilisé pour marquer par défaut les paiements comme "exonérés" (salaires,
 * remboursements privés) plutôt que "TVA déductible".
 *
 * Faux positifs possibles (indépendant portant un nom de personne). Le CEO
 * peut override + mémoriser la règle correcte via la modale.
 */
export function looksLikePerson(beneficiary: string | null | undefined): boolean {
  if (!beneficiary) return false;
  const lower = beneficiary.toLowerCase();
  // Si un mot-clé société est présent → pas une personne
  for (const kw of COMPANY_KEYWORDS) {
    if (lower.includes(kw)) return false;
  }
  const trimmed = beneficiary.trim();
  if (trimmed.length > 45) return false; // trop long pour un nom
  // Compter les mots (min 2 pour un nom + prénom)
  const words = trimmed.split(/\s+/).filter(w => w.length > 0);
  if (words.length < 2 || words.length > 5) return false;
  // Éviter les libellés composés d'acronymes ou chiffres majoritaires
  const hasDigits = /\d/.test(trimmed);
  if (hasDigits) return false;
  return true;
}

export type VendorDefault = {
  beneficiary_normalized: string;
  tva_treatment: TvaTreatment;
  tva_rate: number | null;
};

/**
 * Résout le traitement TVA d'une transaction, dans l'ordre :
 * 1. Override manuel sur la transaction (tva_treatment != 'auto')
 * 2. Règle mémorisée pour le bénéficiaire (vendor_tva_defaults)
 * 3. Règles par catégorie + sens (DEFAULT_TVA_RULES)
 */
export function resolveTvaTreatment(
  tx: {
    tva_treatment: TvaTreatment | null;
    category_code: string | null;
    credit_mad: number | null;
    debit_mad: number | null;
    beneficiary: string | null;
  },
  vendorLookup?: Map<string, VendorDefault>,
): { resolved: TvaResolved; source: 'manual' | 'vendor' | 'person' | 'category'; rateFromVendor: number | null } {
  // 1. Override transaction manuel
  if (tx.tva_treatment && tx.tva_treatment !== 'auto') {
    return { resolved: tx.tva_treatment as TvaResolved, source: 'manual', rateFromVendor: null };
  }
  // 2. Vendor default (règle mémorisée)
  const key = normalizeBeneficiary(tx.beneficiary);
  if (key && vendorLookup) {
    const vd = vendorLookup.get(key);
    if (vd && vd.tva_treatment !== 'auto') {
      return {
        resolved: vd.tva_treatment as TvaResolved,
        source: 'vendor',
        rateFromVendor: vd.tva_rate,
      };
    }
  }
  // 3. Heuristique personne physique (salaires, remboursements privés,
  //    honoraires ponctuels — hors champ TVA en régime marocain).
  //    Uniquement pour les DÉBITS : un crédit venant d'une personne physique
  //    peut être un encaissement client honoraires assujetti.
  const isCredit = Number(tx.credit_mad ?? 0) > 0;
  const isDebit = Number(tx.debit_mad ?? 0) > 0;
  const cat = tx.category_code ?? '';
  const debitCategory = DEFAULT_TVA_RULES.debitDeductible.has(cat);
  if (isDebit && debitCategory && looksLikePerson(tx.beneficiary)) {
    return { resolved: 'exoneree', source: 'person', rateFromVendor: null };
  }
  // 4. Règles par catégorie
  if (DEFAULT_TVA_RULES.exonereeCategories.has(cat)) {
    return { resolved: 'exoneree', source: 'category', rateFromVendor: null };
  }
  if (DEFAULT_TVA_RULES.aQualifierCategories.has(cat)) {
    return { resolved: 'a_qualifier', source: 'category', rateFromVendor: null };
  }
  if (isCredit && DEFAULT_TVA_RULES.creditCollectee.has(cat)) {
    return { resolved: 'collectee', source: 'category', rateFromVendor: null };
  }
  if (isDebit && debitCategory) {
    return { resolved: 'deductible', source: 'category', rateFromVendor: null };
  }
  return { resolved: 'a_qualifier', source: 'category', rateFromVendor: null };
}

/** Calcule base HT et TVA à partir du TTC et d'un taux (%). Retourne 0/0 si rate=0. */
export function splitTtc(ttc: number, ratePct: number): { ht: number; tva: number } {
  if (!ratePct || ratePct === 0) return { ht: ttc, tva: 0 };
  const divisor = 1 + ratePct / 100;
  const ht = +(ttc / divisor).toFixed(2);
  return { ht, tva: +(ttc - ht).toFixed(2) };
}

export type TvaSocieteSummary = {
  company_id: string;
  company_label: string;
  base_ht_collectee: number;
  tva_collectee: number;
  base_ht_deductible: number;
  tva_deductible: number;
  tva_a_payer: number;
  nb_tx_collectee: number;
  nb_tx_deductible: number;
  nb_tx_exoneree: number;
  nb_tx_a_qualifier: number;
  montant_a_qualifier: number;
};

export type TvaTransactionRow = {
  id: string;
  operation_date: string;
  label: string;
  reference: string | null;
  beneficiary: string | null;
  category_code: string | null;
  credit_mad: number | null;
  debit_mad: number | null;
  tva_treatment: TvaTreatment;
  tva_rate: number | null;
  resolved: TvaResolved;
  /** D'où vient la décision. person = heuristique personne physique (présumé salaire/remboursement). */
  source: 'manual' | 'vendor' | 'person' | 'category';
  applied_rate: number;
  base_ht: number;
  tva: number;
  account_label: string;
  company_id: string;
  company_label: string;
};

/**
 * Calcule les KPIs TVA pour un mois donné, groupés par société.
 * Charge aussi les vendor_tva_defaults pour l'auto-apprentissage.
 */
export async function computeMonthlyTva(year: number, month: number): Promise<{
  societes: TvaSocieteSummary[];
  transactions: TvaTransactionRow[];
  period: { year: number; month: number; from: string; to: string };
}> {
  const supabase = createClient();

  const from = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const to = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);

  // Charge en parallèle les transactions + vendor defaults
  const [txRes, vendorRes] = await Promise.all([
    supabase
      .from('bank_transactions')
      .select(`
        id, operation_date, label, reference, beneficiary, category_code,
        credit_mad, debit_mad, tva_treatment, tva_rate,
        account:bank_accounts!inner(id, account_label, company_id)
      `)
      .is('deleted_at', null)
      .eq('is_pending', false)
      .gte('operation_date', from)
      .lt('operation_date', to),
    supabase.from('vendor_tva_defaults').select('beneficiary_normalized, tva_treatment, tva_rate'),
  ]);

  const vendorLookup = new Map<string, VendorDefault>();
  for (const vd of (vendorRes.data ?? []) as VendorDefault[]) {
    vendorLookup.set(vd.beneficiary_normalized, vd);
  }

  const txs: TvaTransactionRow[] = ((txRes.data ?? []) as any[]).map((r) => {
    const decision = resolveTvaTreatment(
      {
        tva_treatment: r.tva_treatment,
        category_code: r.category_code,
        credit_mad: r.credit_mad,
        debit_mad: r.debit_mad,
        beneficiary: r.beneficiary,
      },
      vendorLookup,
    );

    // Taux appliqué : priorité au tva_rate de la transaction, sinon vendor rate, sinon 20
    const applied_rate = r.tva_rate ?? decision.rateFromVendor ?? DEFAULT_TVA_RATE;
    const ttc = Number(r.credit_mad ?? 0) + Number(r.debit_mad ?? 0);
    const applyTva = decision.resolved === 'collectee' || decision.resolved === 'deductible';
    const { ht, tva } = applyTva ? splitTtc(ttc, applied_rate) : { ht: ttc, tva: 0 };

    return {
      id: r.id,
      operation_date: r.operation_date,
      label: r.label ?? '',
      reference: r.reference,
      beneficiary: r.beneficiary,
      category_code: r.category_code,
      credit_mad: r.credit_mad,
      debit_mad: r.debit_mad,
      tva_treatment: r.tva_treatment ?? 'auto',
      tva_rate: r.tva_rate,
      resolved: decision.resolved,
      source: decision.source,
      applied_rate,
      base_ht: ht,
      tva,
      account_label: r.account?.account_label ?? '—',
      company_id: r.account?.company_id ?? 'unknown',
      company_label: guessCompanyLabel(r.account?.account_label ?? ''),
    };
  });

  const byCompany = new Map<string, TvaSocieteSummary>();
  for (const t of txs) {
    let s = byCompany.get(t.company_id);
    if (!s) {
      s = {
        company_id: t.company_id,
        company_label: t.company_label,
        base_ht_collectee: 0,
        tva_collectee: 0,
        base_ht_deductible: 0,
        tva_deductible: 0,
        tva_a_payer: 0,
        nb_tx_collectee: 0,
        nb_tx_deductible: 0,
        nb_tx_exoneree: 0,
        nb_tx_a_qualifier: 0,
        montant_a_qualifier: 0,
      };
      byCompany.set(t.company_id, s);
    }
    if (t.resolved === 'collectee') {
      s.base_ht_collectee += t.base_ht;
      s.tva_collectee += t.tva;
      s.nb_tx_collectee += 1;
    } else if (t.resolved === 'deductible') {
      s.base_ht_deductible += t.base_ht;
      s.tva_deductible += t.tva;
      s.nb_tx_deductible += 1;
    } else if (t.resolved === 'exoneree') {
      s.nb_tx_exoneree += 1;
    } else if (t.resolved === 'a_qualifier') {
      s.nb_tx_a_qualifier += 1;
      s.montant_a_qualifier += Number(t.credit_mad ?? 0) + Number(t.debit_mad ?? 0);
    }
  }
  for (const s of Array.from(byCompany.values())) {
    s.base_ht_collectee = +s.base_ht_collectee.toFixed(2);
    s.tva_collectee = +s.tva_collectee.toFixed(2);
    s.base_ht_deductible = +s.base_ht_deductible.toFixed(2);
    s.tva_deductible = +s.tva_deductible.toFixed(2);
    s.tva_a_payer = +(s.tva_collectee - s.tva_deductible).toFixed(2);
    s.montant_a_qualifier = +s.montant_a_qualifier.toFixed(2);
  }

  return {
    societes: Array.from(byCompany.values()).sort((a, b) => a.company_label.localeCompare(b.company_label)),
    transactions: txs.sort((a, b) => a.operation_date.localeCompare(b.operation_date)),
    period: { year, month, from, to },
  };
}

/** "STZ OJ — CIH — Compte courant" → "STZ OJ" */
export function guessCompanyLabel(accountLabel: string): string {
  if (!accountLabel) return 'Société inconnue';
  const parts = accountLabel.split(/[—-]/);
  return (parts[0] ?? accountLabel).trim();
}
