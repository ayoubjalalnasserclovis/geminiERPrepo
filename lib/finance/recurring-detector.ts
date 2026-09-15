/**
 * Détecteur de paiements récurrents (salaires, loyers, honoraires fixes).
 * CEO 2026-09-02.
 *
 * Signature d'un salaire / paiement récurrent fixe :
 *   - Même bénéficiaire
 *   - Un "gros" paiement (>= 1 500 MAD) sur ≥ 3 mois distincts
 *   - Coefficient de variation < 20 % (moyenne stable, autorise petites primes)
 *   - Une occurrence de ce montant par mois (permet paiements annexes en parallèle)
 *
 * Pourquoi cette règle : les vraies paies passent en montant net FIXE
 * (ex: NABIL = 22 000 pile chaque mois). Les paiements annexes (notes de
 * frais, primes ponctuelles) varient et ne matchent donc pas.
 *
 * ATTENTION : cette règle n'est pas la même que la détection "personne
 * physique" du helper TVA (looksLikePerson dans lib/finance/tva.ts) — celle-ci
 * est plus large (nom ressemble à une personne) mais moins précise. Ici on
 * cherche uniquement les RÉCURRENTS pour la projection de trésorerie.
 */

import { createClient } from '@/lib/supabase/server';

const MIN_MONTHS = 3;
const MIN_AMOUNT = 1500;
const LOOKBACK_MONTHS = 8;
/** Tolérance sur la variation du montant récurrent (coefficient de variation) */
const MAX_VARIATION = 0.20;

export type RecurringPaymentType =
  | 'salaire'
  | 'prestataire'
  | 'loyer'
  | 'abonnement'
  | 'autre'
  | 'ignore';

export type RecurringPayment = {
  beneficiary: string;
  amount_per_month: number;   // montant unitaire fixe
  nb_mois: number;
  total_period: number;
  months_active: string[];    // ["01/26", "02/26", …]
  is_active: boolean;         // touché sur au moins 1 des 2 derniers mois
  /** Classification manuelle (défaut 'autre' — voir recurring_payment_classifications) */
  type: RecurringPaymentType;
  notes: string | null;
};

/**
 * Retourne la liste des bénéficiaires payés récurremment (salaires + loyers).
 * Filtrée pour exclure les sociétés (SARL, STE, GROUPE, etc.) et les
 * artisans/fournisseurs déclarés.
 */
export async function detectRecurringPayments(): Promise<RecurringPayment[]> {
  const supabase = createClient();

  // Fetch les artisans + allocations pour exclure les paiements liés aux chantiers
  // + les classifications manuelles pour typer les récurrents détectés
  const [artisansRes, allocsRes, mappingsRes, classificationsRes] = await Promise.all([
    supabase.from('artisans').select('name').is('deleted_at', null),
    supabase.from('bank_transaction_allocations')
      .select('transaction:bank_transactions(beneficiary)')
      .in('allocation_type', ['travaux', 'achats', 'services'])
      .is('deleted_at', null),
    supabase.from('bank_category_mappings')
      .select('bank_label_match, allocation_type')
      .in('allocation_type', ['travaux', 'achats', 'services', 'honoraires', 'propria', 'intercompany'])
      .is('deleted_at', null),
    supabase.from('recurring_payment_classifications')
      .select('beneficiary_normalized, type, notes'),
  ]);
  const classifLookup = new Map<string, { type: RecurringPaymentType; notes: string | null }>();
  for (const c of (classificationsRes.data ?? []) as any[]) {
    classifLookup.set(c.beneficiary_normalized, { type: c.type, notes: c.notes ?? null });
  }

  function normalize(s: string): string {
    return (s ?? '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  }
  const providerNeedles = (artisansRes.data ?? [])
    .map((p: any) => normalize(p.name ?? ''))
    .filter((n: string) => n.length >= 3);
  const projectBenefs = new Set<string>();
  for (const a of (allocsRes.data ?? []) as any[]) {
    const b = a.transaction?.beneficiary;
    if (b) projectBenefs.add(normalize(b));
  }
  const mappedNonCabinet = (mappingsRes.data ?? [])
    .map((m: any) => normalize(m.bank_label_match ?? ''))
    .filter((n: string) => n.length >= 3);

  // Blacklist textuelle (sociétés évidentes)
  const COMPANY_KEYWORDS = [
    'SARL', 'STE ', 'SAS', 'S.A.R.L', 'SARLAU',
    'TRAVAUX', 'BATIMENT', 'BÂTIMENT', 'GROUPE', 'IMPORT', 'EXPORT',
    'SERVICES', 'CONSEIL', 'CONSULTING', 'SDK', 'E-COM', 'MALL',
    'HOTEL', 'RESTAURANT', 'CAFE', 'STATION', 'MAGASIN', 'MARKET',
    'ASSURANCE', 'BANQUE', 'BANK',
  ];

  function isExcluded(benef: string): boolean {
    const n = normalize(benef);
    if (projectBenefs.has(n)) return true;
    for (const kw of COMPANY_KEYWORDS) if (n.includes(kw)) return true;
    for (const needle of providerNeedles) if (n.includes(needle) || needle.includes(n)) return true;
    for (const needle of mappedNonCabinet) if (needle && (n.includes(needle) || needle.includes(n))) return true;
    return false;
  }

  // Fetch les transactions >= MIN_AMOUNT MAD sur LOOKBACK_MONTHS derniers mois
  // (avant la dernière date connue en base, pas avant now() qui peut être
  // ultérieur si les relevés récents ne sont pas encore importés).
  const { data: maxDateRow } = await supabase
    .from('bank_transactions').select('operation_date')
    .is('deleted_at', null).eq('is_pending', false)
    .order('operation_date', { ascending: false }).limit(1).maybeSingle();
  const anchor = (maxDateRow as any)?.operation_date
    ? new Date((maxDateRow as any).operation_date)
    : new Date();
  const from = new Date(anchor);
  from.setMonth(from.getMonth() - LOOKBACK_MONTHS);

  const { data: txs } = await supabase
    .from('bank_transactions')
    .select('beneficiary, debit_mad, operation_date')
    .is('deleted_at', null).eq('is_pending', false)
    .gte('operation_date', from.toISOString().slice(0, 10))
    .gt('debit_mad', 0)
    .not('beneficiary', 'is', null)
    .limit(10000);

  // Groupement par bénéficiaire → liste des GROS paiements (>= MIN_AMOUNT)
  // Pour chaque mois on ne garde que le paiement le plus élevé (le "salaire" —
  // pas les petites primes/notes de frais en parallèle).
  const byBenef = new Map<string, {
    display: string;
    byMonth: Map<string, number>;
  }>();
  for (const t of (txs ?? []) as any[]) {
    const debit = Number(t.debit_mad ?? 0);
    if (debit < MIN_AMOUNT) continue;
    const raw = String(t.beneficiary ?? '').trim();
    if (!raw) continue;
    if (isExcluded(raw)) continue;
    const key = normalize(raw);
    let entry = byBenef.get(key);
    if (!entry) {
      entry = { display: raw, byMonth: new Map() };
      byBenef.set(key, entry);
    }
    const ym = String(t.operation_date).slice(0, 7);
    const prev = entry.byMonth.get(ym) ?? 0;
    if (debit > prev) entry.byMonth.set(ym, debit); // garde le plus gros du mois
  }

  const anchorYm = anchor.toISOString().slice(0, 7);
  const prevMonth = new Date(anchor); prevMonth.setMonth(prevMonth.getMonth() - 1);
  const prevYm = prevMonth.toISOString().slice(0, 7);

  const results: RecurringPayment[] = [];
  for (const entry of Array.from(byBenef.values())) {
    const monthKeys = Array.from(entry.byMonth.keys()).sort();
    if (monthKeys.length < MIN_MONTHS) continue;
    const amounts = monthKeys.map(m => entry.byMonth.get(m)!);
    const mean = amounts.reduce((s, v) => s + v, 0) / amounts.length;
    // Coefficient de variation = écart-type / moyenne. Salaire "stable" si < 20 %.
    const variance = amounts.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / amounts.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 1;
    if (cv > MAX_VARIATION) continue;

    const is_active = entry.byMonth.has(anchorYm) || entry.byMonth.has(prevYm);
    const nrm = normalize(entry.display);
    const classif = classifLookup.get(nrm);
    results.push({
      beneficiary: entry.display,
      amount_per_month: Math.round(mean),
      nb_mois: monthKeys.length,
      total_period: Math.round(amounts.reduce((s, v) => s + v, 0)),
      months_active: monthKeys.map(m => `${m.slice(5)}/${m.slice(2, 4)}`),
      is_active,
      type: classif?.type ?? 'autre',
      notes: classif?.notes ?? null,
    });
  }

  return results.sort((a, b) => b.amount_per_month - a.amount_per_month);
}

/**
 * Types de paiements RÉELLEMENT récurrents (à inclure dans les projections
 * cashflow). Les 'prestataires' sont exclus : par nature ponctuels, liés à
 * des missions, pas une charge cabinet fixe. Les 'ignore' sont exclus aussi.
 */
export const RECURRING_TYPES_FOR_PROJECTION: RecurringPaymentType[] = [
  'salaire', 'loyer', 'abonnement', 'autre',
];

function isProjectionRecurring(type: RecurringPaymentType): boolean {
  return RECURRING_TYPES_FOR_PROJECTION.includes(type);
}

/**
 * Retourne le total mensuel des paiements récurrents ACTIFS (touchés dans les
 * 2 derniers mois disponibles), avec ventilation par type de classification.
 *
 * IMPORTANT : n'inclut QUE les types "structurellement récurrents" (salaire,
 * loyer, abonnement, autre). Les prestataires et 'ignore' sont EXCLUS car ce
 * ne sont pas des charges cabinet fixes à projeter.
 *
 * Utilisé pour projeter les décaissements prévisionnels (page projection,
 * mensuelle, brief email).
 */
export async function getActiveRecurringMonthly(): Promise<{
  total_per_month: number;
  payments: RecurringPayment[];
  by_type: Record<RecurringPaymentType, number>;
}> {
  const all = await detectRecurringPayments();
  const active = all.filter(p => p.is_active && isProjectionRecurring(p.type));
  const total = active.reduce((s, p) => s + p.amount_per_month, 0);
  const by_type: Record<RecurringPaymentType, number> = {
    salaire: 0, prestataire: 0, loyer: 0, abonnement: 0, autre: 0, ignore: 0,
  };
  for (const p of active) by_type[p.type] += p.amount_per_month;
  return { total_per_month: total, payments: active, by_type };
}
