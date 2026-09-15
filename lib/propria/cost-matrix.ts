import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { CleaningCategory } from './cleaning-categories';

/**
 * Matrice de coûts ménage + rentabilité réelle + charge de gestion
 * (chantier 15 marathon — consultant U23/U24/U25, décision CEO B7).
 *
 * RIEN n'est stocké (convention n°1) : seuls les coûts unitaires saisis
 * vivent dans propria_cost_params (global + override par lot + date d'effet).
 * Tout le reste est DÉRIVÉ à la lecture :
 *
 *   - resolveParam : valeur applicable d'un paramètre pour un lot à une date
 *       = override lot le plus récent à effective_from <= date,
 *         sinon global le plus récent, sinon null (= donnée manquante).
 *   - computeCleaningCost : coût d'UN ménage selon sa catégorie —
 *       MO (standard / Deep Cleaning / Poussière)
 *       + linge (linge_par_chambre × nb chambres + linge_par_sdb × nb SDB
 *                + amortissement linge)
 *       + consommables + transport + frais de gestion.
 *       Composante sans paramètre (ou sans nb chambres/SDB saisi) = null →
 *       total « partiel » ; si TOUT est null → « en attente de données ».
 *       JAMAIS de faux zéro.
 *   - getUnitProfitabilityRows : par lot sur une période —
 *       Revenus = CA résas Hostaway (prorata nuits dans la période, même
 *       pattern que la vue performance ch.13) + CA upsell (statuts
 *       confirme + livre, cf. lib/propria/upsell.ts) ;
 *       Coûts  = Σ coûts des ménages clôturés de la période (valorisés avec
 *       les paramètres en vigueur À LA DATE de chaque ménage — historisation)
 *       + coûts interventions clôturées (cost_propria_mad) ;
 *       Marge brute = revenus − coûts.
 *   - Charge de gestion (U25 — PROXY, on ne mesure pas encore le temps réel) :
 *       nb d'actions traitées sur la période = ménages clôturés
 *       + interventions clôturées + tâches clôturées + litiges ouverts
 *       + visites de maintenance préventive réalisées.
 *       « Marge par action » = marge brute ÷ nb actions — indicateur RELATIF
 *       pour comparer les lots entre eux, pas un coût horaire.
 *
 * Devise : tout en MAD opérationnel. L'équivalent € (taux interne fixe,
 * lib/finance/fx-fixed.ts) n'est qu'un affichage de pilotage.
 */

export type CostClient = SupabaseClient<any, 'public', any>;

// ─── Paramètres (clés + habillage) ──────────────────────────────────────────

export const COST_PARAM_KEYS = [
  'mo_par_menage',
  'mo_par_deep_cleaning',
  'mo_par_poussiere',
  'linge_par_chambre',
  'linge_par_sdb',
  'blanchisserie_par_kg_ou_set',
  'amortissement_linge_par_menage',
  'consommables_par_menage',
  'transport_par_menage',
  'frais_gestion_par_menage',
] as const;

export type CostParamKey = (typeof COST_PARAM_KEYS)[number];

export const COST_PARAM_META: Record<
  CostParamKey,
  { label: string; description: string; usedInCalc: boolean }
> = {
  mo_par_menage: {
    label: 'Main d’œuvre — ménage standard',
    description: 'Coût MO d’un ménage avec/sans arrivée ou post-propriétaire (MAD).',
    usedInCalc: true,
  },
  mo_par_deep_cleaning: {
    label: 'Main d’œuvre — Deep Cleaning',
    description: 'Coût MO d’un Deep Cleaning (MAD).',
    usedInCalc: true,
  },
  mo_par_poussiere: {
    label: 'Main d’œuvre — Poussière',
    description: 'Coût MO d’un ménage Poussière (MAD).',
    usedInCalc: true,
  },
  linge_par_chambre: {
    label: 'Linge par chambre',
    description: 'Coût linge (rotation du set lit) par chambre et par ménage (MAD).',
    usedInCalc: true,
  },
  linge_par_sdb: {
    label: 'Linge par salle de bain',
    description: 'Coût linge (serviettes…) par SDB et par ménage (MAD).',
    usedInCalc: true,
  },
  blanchisserie_par_kg_ou_set: {
    label: 'Blanchisserie (au kg ou au set)',
    description:
      'Tarif blanchisserie unitaire — valeur de RÉFÉRENCE : pas encore injectée dans le coût d’un ménage (pas de quantité kg/set mesurée par ménage).',
    usedInCalc: false,
  },
  amortissement_linge_par_menage: {
    label: 'Amortissement linge par ménage',
    description: 'Quote-part d’usure du parc de linge par ménage (MAD).',
    usedInCalc: true,
  },
  consommables_par_menage: {
    label: 'Consommables par ménage',
    description: 'Produits ménagers + consommables d’accueil par ménage (MAD).',
    usedInCalc: true,
  },
  transport_par_menage: {
    label: 'Transport par ménage',
    description: 'Déplacement de l’équipe par ménage (MAD).',
    usedInCalc: true,
  },
  frais_gestion_par_menage: {
    label: 'Frais de gestion par ménage',
    description: 'Quote-part de frais de gestion (planification, supervision) par ménage (MAD).',
    usedInCalc: true,
  },
};

export type CostParamRow = {
  id: string;
  scope: 'global' | 'unit';
  propria_unit_id: string | null;
  param_key: CostParamKey;
  value_mad: number;
  effective_from: string; // 'YYYY-MM-DD'
  comment: string | null;
  created_at: string;
};

/** UNE requête groupée — toutes les lignes actives, triées pour la résolution. */
export async function loadCostParams(supabase: CostClient): Promise<CostParamRow[]> {
  const { data } = await supabase
    .from('propria_cost_params')
    .select('id, scope, propria_unit_id, param_key, value_mad, effective_from, comment, created_at')
    .is('deleted_at', null)
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(10000);
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id,
    scope: r.scope,
    propria_unit_id: r.propria_unit_id,
    param_key: r.param_key,
    value_mad: Number(r.value_mad),
    effective_from: String(r.effective_from).slice(0, 10),
    comment: r.comment ?? null,
    created_at: r.created_at,
  }));
}

/**
 * Valeur applicable d'un paramètre pour un lot à une date (fonction pure) :
 * override lot le plus récent à effective_from <= date, sinon global le plus
 * récent, sinon null (= donnée manquante). `rows` doit être trié effective_from
 * DESC puis created_at DESC (cf. loadCostParams) — premier match = bon match.
 */
export function resolveParam(
  rows: CostParamRow[],
  key: CostParamKey,
  unitId: string | null,
  dateIso: string,
): CostParamRow | null {
  let global: CostParamRow | null = null;
  for (const r of rows) {
    if (r.param_key !== key || r.effective_from > dateIso) continue;
    if (unitId && r.scope === 'unit' && r.propria_unit_id === unitId) return r;
    if (r.scope === 'global' && !global) global = r;
  }
  return global;
}

// ─── Coût d'UN ménage (fonction pure) ───────────────────────────────────────

export type CostComponent = {
  key: string;
  label: string;
  /** null = composante non calculable (paramètre ou nb chambres/SDB manquant). */
  amountMad: number | null;
  detail?: string;
};

export type CleaningCostBreakdown = {
  category: CleaningCategory;
  components: CostComponent[];
  /** Somme des composantes calculables — null si AUCUNE (en attente de données). */
  totalMad: number | null;
  /** true = au moins une composante manquante (le total affiché est partiel). */
  isPartial: boolean;
  /** Libellés des composantes manquantes (affichage « — »). */
  missing: string[];
};

export type UnitRoomCounts = {
  nbChambres: number | null;
  nbSdb: number | null;
};

/**
 * Coût d'UN ménage selon sa catégorie. `getParam` doit déjà être résolu pour
 * le lot et la DATE du ménage (historisation) — voir resolveParam.
 */
export function computeCleaningCost(
  category: CleaningCategory,
  unit: UnitRoomCounts,
  getParam: (key: CostParamKey) => number | null,
): CleaningCostBreakdown {
  const moKey: CostParamKey =
    category === 'deep_cleaning' ? 'mo_par_deep_cleaning'
    : category === 'poussiere' ? 'mo_par_poussiere'
    : 'mo_par_menage';

  const lingeChambre = getParam('linge_par_chambre');
  const lingeSdb = getParam('linge_par_sdb');

  const components: CostComponent[] = [
    {
      key: 'main_oeuvre',
      label: 'Main d’œuvre',
      amountMad: getParam(moKey),
      detail: COST_PARAM_META[moKey].label,
    },
    {
      key: 'linge_chambres',
      label: 'Linge chambres',
      amountMad:
        lingeChambre != null && unit.nbChambres != null
          ? lingeChambre * unit.nbChambres
          : null,
      detail:
        unit.nbChambres == null
          ? 'nb chambres non renseigné sur le lot'
          : `${unit.nbChambres} ch. × linge_par_chambre`,
    },
    {
      key: 'linge_sdb',
      label: 'Linge SDB',
      amountMad:
        lingeSdb != null && unit.nbSdb != null ? lingeSdb * unit.nbSdb : null,
      detail:
        unit.nbSdb == null
          ? 'nb SDB non renseigné sur le lot'
          : `${unit.nbSdb} SDB × linge_par_sdb`,
    },
    {
      key: 'amortissement_linge',
      label: 'Amortissement linge',
      amountMad: getParam('amortissement_linge_par_menage'),
    },
    {
      key: 'consommables',
      label: 'Consommables',
      amountMad: getParam('consommables_par_menage'),
    },
    {
      key: 'transport',
      label: 'Transport',
      amountMad: getParam('transport_par_menage'),
    },
    {
      key: 'frais_gestion',
      label: 'Frais de gestion',
      amountMad: getParam('frais_gestion_par_menage'),
    },
  ];

  const available = components.filter((c) => c.amountMad != null);
  const missing = components.filter((c) => c.amountMad == null).map((c) => c.label);

  return {
    category,
    components,
    totalMad:
      available.length === 0
        ? null
        : Math.round(available.reduce((s, c) => s + (c.amountMad ?? 0), 0) * 100) / 100,
    isPartial: missing.length > 0 && available.length > 0,
    missing,
  };
}

// ─── Périodes (mêmes valeurs que le pilotage qualité ch.11.c) ───────────────

export type CostPeriod = '30j' | '90j' | '12m';

export const COST_PERIODS: { value: CostPeriod; label: string; days: number }[] = [
  { value: '30j', label: '30 jours', days: 30 },
  { value: '90j', label: '90 jours', days: 90 },
  { value: '12m', label: '12 mois', days: 365 },
];

export function costPeriodDays(period: CostPeriod): number {
  return COST_PERIODS.find((p) => p.value === period)?.days ?? 90;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ─── Rentabilité par lot (requêtes groupées — jamais de N+1) ────────────────

export type UnitProfitabilityRow = {
  unitId: string;
  propertyId: string;
  label: string;
  bienLabel: string;
  nbChambres: number | null;
  nbSdb: number | null;
  // Revenus (MAD)
  revenueResasMad: number;
  revenueUpsellMad: number;
  revenueTotalMad: number;
  // Ménages clôturés de la période, valorisés à la date de chaque ménage
  cleaningsCount: number;
  cleaningsByCategory: Partial<Record<CleaningCategory, { count: number; costMad: number | null }>>;
  /** null = des ménages existent mais AUCUN n'a pu être chiffré (pas de faux zéro). */
  cleaningsCostMad: number | null;
  /** true = au moins un ménage au coût partiel ou non chiffrable. */
  cleaningsCostPartial: boolean;
  // Interventions clôturées de la période
  interventionsCount: number;
  interventionsCostMad: number;
  /** Interventions clôturées sans cost_propria_mad saisi (non valorisées). */
  interventionsWithoutCost: number;
  // Marge brute (null si les coûts ménage ne sont pas chiffrables)
  costsTotalMad: number | null;
  margeBruteMad: number | null;
  // Charge de gestion (U25 — proxy, pas un temps réel)
  actionsCount: number;
  actionsDetail: {
    menages: number;
    interventions: number;
    taches: number;
    litiges: number;
    maintenance: number;
  };
  margePerActionMad: number | null;
};

export type ProfitabilityResult = {
  rows: UnitProfitabilityRow[];
  /** false = aucun coût unitaire saisi → « dashboard en attente de données ». */
  hasCostParams: boolean;
  periodStartIso: string;
  periodEndIso: string;
};

/**
 * Rentabilité réelle + charge de gestion par lot sur une période.
 * UNE requête groupée par source. `propertyId` optionnel (fiche bien).
 */
export async function getUnitProfitabilityRows(
  supabase: CostClient,
  period: CostPeriod = '90j',
  propertyId?: string,
): Promise<ProfitabilityResult> {
  const todayIso = isoDate(new Date());
  const startIso = isoDate(new Date(Date.now() - costPeriodDays(period) * 86_400_000));

  // 1) Lots actifs sous gestion + nb chambres / nb SDB (noms réels vérifiés :
  //    propria_units.propria_nb_chambres / propria_units.propria_nb_sdb,
  //    chambres héritées du bien à défaut — pattern propria_units_enriched).
  let unitsQuery = supabase
    .from('propria_units_enriched')
    .select('unit_id, property_id, display_label, bien_code, bien_name, nb_chambres')
    .eq('is_active', true)
    .not('propria_managed_at', 'is', null)
    .is('propria_refused_at', null);
  if (propertyId) unitsQuery = unitsQuery.eq('property_id', propertyId);

  const [unitsRes, params] = await Promise.all([unitsQuery, loadCostParams(supabase)]);

  const units = ((unitsRes.data ?? []) as any[]).map((u) => ({
    unitId: u.unit_id as string,
    propertyId: u.property_id as string,
    label: (u.display_label ?? u.bien_code ?? '—') as string,
    bienLabel: (u.bien_code ?? u.bien_name ?? '—') as string,
    nbChambres: u.nb_chambres != null ? Number(u.nb_chambres) : null,
    nbSdb: null as number | null, // complété ci-dessous (colonne hors vue enrichie)
  }));
  if (units.length === 0) {
    return { rows: [], hasCostParams: params.length > 0, periodStartIso: startIso, periodEndIso: todayIso };
  }
  const unitIds = units.map((u) => u.unitId);

  // 2) Une requête groupée PAR SOURCE
  const [sdbRes, listingsRes, upsellsRes, cleaningsRes, intsRes, litigesRes, maintRes] =
    await Promise.all([
      // nb SDB (colonne lot uniquement — ajoutée par 20260609150000)
      supabase
        .from('propria_units')
        .select('id, propria_nb_sdb')
        .in('id', unitIds)
        .is('deleted_at', null),
      // Mapping listing Hostaway → lot
      supabase
        .from('hostaway_listings')
        .select('id, propria_unit_id')
        .in('propria_unit_id', unitIds)
        .is('deleted_at', null),
      // CA upsell : statuts confirme + livre comptent (lib/propria/upsell.ts)
      supabase
        .from('propria_upsells')
        .select('propria_unit_id, amount_mad, status, created_at')
        .in('propria_unit_id', unitIds)
        .in('status', ['confirme', 'livre'])
        .gte('created_at', startIso)
        .is('deleted_at', null)
        .limit(10000),
      // Ménages clôturés (la vue exclut déjà les soft-deleted) — marge de 60 j
      // sur occurred_at, le vrai filtre date (due_date ?? occurred_at) est en
      // mémoire pour gérer les due_date nulles.
      supabase
        .from('propria_cleanings_enriched')
        .select('propria_unit_id, category, status, due_date, occurred_at')
        .in('propria_unit_id', unitIds)
        .eq('status', 'cloture')
        .gte('occurred_at', isoDate(new Date(Date.now() - (costPeriodDays(period) + 60) * 86_400_000)))
        .limit(10000),
      // Interventions ET tâches clôturées de la période (un seul fetch)
      supabase
        .from('propria_interventions')
        .select('propria_unit_id, kind, cost_propria_mad, closed_at')
        .in('propria_unit_id', unitIds)
        .eq('status', 'cloture')
        .gte('closed_at', startIso)
        .is('deleted_at', null)
        .limit(10000),
      // Litiges ouverts dans la période (proxy charge de gestion)
      supabase
        .from('propria_litiges')
        .select('propria_unit_id, opened_at')
        .in('propria_unit_id', unitIds)
        .gte('opened_at', startIso)
        .is('deleted_at', null)
        .limit(10000),
      // Visites de maintenance préventive réalisées dans la période
      supabase
        .from('propria_maintenance_visits')
        .select('propria_unit_id, status, completed_at')
        .in('propria_unit_id', unitIds)
        .eq('status', 'realise')
        .gte('completed_at', startIso)
        .is('deleted_at', null)
        .limit(10000),
    ]);

  const sdbByUnit = new Map<string, number | null>();
  for (const r of (sdbRes.data ?? []) as any[]) {
    sdbByUnit.set(r.id, r.propria_nb_sdb != null ? Number(r.propria_nb_sdb) : null);
  }
  for (const u of units) u.nbSdb = sdbByUnit.get(u.unitId) ?? null;

  // 3) Revenus résas — prorata nuits dans la période (pattern ch.10/13) :
  //    prix/nuit = total_price / nuits, on ne compte que les nuits ∈ période.
  const listingToUnit = new Map<string, string>();
  for (const l of (listingsRes.data ?? []) as any[]) listingToUnit.set(l.id, l.propria_unit_id);

  const resasRevenueByUnit = new Map<string, number>();
  if (listingToUnit.size > 0) {
    const { data: resas } = await supabase
      .from('hostaway_reservations')
      .select('hostaway_listing_db_id, arrival_date, departure_date, nights, total_price')
      .in('hostaway_listing_db_id', Array.from(listingToUnit.keys()))
      .in('status', ['new', 'modified'])
      .is('deleted_at', null)
      .lt('arrival_date', todayIso)
      .gt('departure_date', startIso)
      .limit(10000);
    for (const r of (resas ?? []) as any[]) {
      const unitId = listingToUnit.get(r.hostaway_listing_db_id);
      if (!unitId) continue;
      const arrival = String(r.arrival_date).slice(0, 10);
      const departure = String(r.departure_date).slice(0, 10);
      if (arrival >= departure) continue;
      const totalNights = Math.max(
        Number(r.nights) || 0,
        Math.round((Date.parse(departure) - Date.parse(arrival)) / 86_400_000),
      );
      if (totalNights <= 0) continue;
      // Nuits de la résa ∈ [startIso, todayIso) — bornes en jours UTC
      const from = Math.max(Date.parse(arrival), Date.parse(startIso));
      const to = Math.min(Date.parse(departure), Date.parse(todayIso));
      const nightsInPeriod = Math.max(0, Math.round((to - from) / 86_400_000));
      if (nightsInPeriod === 0) continue;
      const revenue = (Number(r.total_price) || 0) * (nightsInPeriod / totalNights);
      resasRevenueByUnit.set(unitId, (resasRevenueByUnit.get(unitId) ?? 0) + revenue);
    }
  }

  // 4) CA upsell par lot
  const upsellRevenueByUnit = new Map<string, number>();
  for (const u of (upsellsRes.data ?? []) as any[]) {
    upsellRevenueByUnit.set(
      u.propria_unit_id,
      (upsellRevenueByUnit.get(u.propria_unit_id) ?? 0) + (Number(u.amount_mad) || 0),
    );
  }

  // 5) Ménages clôturés de la période, valorisés À LA DATE du ménage
  type CleaningAgg = {
    count: number;
    byCategory: Map<CleaningCategory, { count: number; costMad: number | null }>;
    costMad: number;
    pricedCount: number;
    partial: boolean;
  };
  const cleaningsByUnit = new Map<string, CleaningAgg>();
  const unitById = new Map(units.map((u) => [u.unitId, u]));
  for (const c of (cleaningsRes.data ?? []) as any[]) {
    const date = String(c.due_date ?? c.occurred_at).slice(0, 10);
    if (date < startIso || date > todayIso) continue;
    const unit = unitById.get(c.propria_unit_id);
    if (!unit) continue;
    let agg = cleaningsByUnit.get(c.propria_unit_id);
    if (!agg) {
      agg = { count: 0, byCategory: new Map(), costMad: 0, pricedCount: 0, partial: false };
      cleaningsByUnit.set(c.propria_unit_id, agg);
    }
    agg.count += 1;
    const category = (c.category ?? 'sans_arrivee') as CleaningCategory;
    const breakdown = computeCleaningCost(
      category,
      { nbChambres: unit.nbChambres, nbSdb: unit.nbSdb },
      (key) => resolveParam(params, key, unit.unitId, date)?.value_mad ?? null,
    );
    const cat = agg.byCategory.get(category) ?? { count: 0, costMad: null };
    cat.count += 1;
    if (breakdown.totalMad != null) {
      cat.costMad = (cat.costMad ?? 0) + breakdown.totalMad;
      agg.costMad += breakdown.totalMad;
      agg.pricedCount += 1;
      if (breakdown.isPartial) agg.partial = true;
    } else {
      agg.partial = true;
    }
    agg.byCategory.set(category, cat);
  }

  // 6) Interventions / tâches / litiges / maintenance par lot
  const intsByUnit = new Map<string, { count: number; cost: number; noCost: number }>();
  const tachesByUnit = new Map<string, number>();
  for (const i of (intsRes.data ?? []) as any[]) {
    if (i.kind === 'tache') {
      tachesByUnit.set(i.propria_unit_id, (tachesByUnit.get(i.propria_unit_id) ?? 0) + 1);
      continue;
    }
    const agg = intsByUnit.get(i.propria_unit_id) ?? { count: 0, cost: 0, noCost: 0 };
    agg.count += 1;
    if (i.cost_propria_mad != null) agg.cost += Number(i.cost_propria_mad);
    else agg.noCost += 1;
    intsByUnit.set(i.propria_unit_id, agg);
  }
  const litigesByUnit = new Map<string, number>();
  for (const l of (litigesRes.data ?? []) as any[]) {
    litigesByUnit.set(l.propria_unit_id, (litigesByUnit.get(l.propria_unit_id) ?? 0) + 1);
  }
  const maintByUnit = new Map<string, number>();
  for (const m of (maintRes.data ?? []) as any[]) {
    if (!m.propria_unit_id) continue;
    maintByUnit.set(m.propria_unit_id, (maintByUnit.get(m.propria_unit_id) ?? 0) + 1);
  }

  // 7) Assemblage — tout dérivé, rien stocké, pas de faux zéro
  const rows: UnitProfitabilityRow[] = units.map((u) => {
    const revenueResasMad = Math.round((resasRevenueByUnit.get(u.unitId) ?? 0) * 100) / 100;
    const revenueUpsellMad = Math.round((upsellRevenueByUnit.get(u.unitId) ?? 0) * 100) / 100;
    const revenueTotalMad = Math.round((revenueResasMad + revenueUpsellMad) * 100) / 100;

    const cl = cleaningsByUnit.get(u.unitId);
    const cleaningsCount = cl?.count ?? 0;
    // 0 ménage = vrai zéro ; des ménages mais aucun chiffrable = null (— )
    const cleaningsCostMad =
      cleaningsCount === 0 ? 0 : cl && cl.pricedCount > 0 ? Math.round(cl.costMad * 100) / 100 : null;
    const cleaningsByCategory: UnitProfitabilityRow['cleaningsByCategory'] = {};
    if (cl) {
      for (const [cat, v] of Array.from(cl.byCategory.entries())) {
        cleaningsByCategory[cat] = {
          count: v.count,
          costMad: v.costMad != null ? Math.round(v.costMad * 100) / 100 : null,
        };
      }
    }

    const ints = intsByUnit.get(u.unitId);
    const interventionsCostMad = Math.round((ints?.cost ?? 0) * 100) / 100;

    const costsTotalMad =
      cleaningsCostMad == null
        ? null
        : Math.round((cleaningsCostMad + interventionsCostMad) * 100) / 100;
    const margeBruteMad =
      costsTotalMad == null ? null : Math.round((revenueTotalMad - costsTotalMad) * 100) / 100;

    const actionsDetail = {
      menages: cleaningsCount,
      interventions: ints?.count ?? 0,
      taches: tachesByUnit.get(u.unitId) ?? 0,
      litiges: litigesByUnit.get(u.unitId) ?? 0,
      maintenance: maintByUnit.get(u.unitId) ?? 0,
    };
    const actionsCount =
      actionsDetail.menages + actionsDetail.interventions + actionsDetail.taches +
      actionsDetail.litiges + actionsDetail.maintenance;

    return {
      unitId: u.unitId,
      propertyId: u.propertyId,
      label: u.label,
      bienLabel: u.bienLabel,
      nbChambres: u.nbChambres,
      nbSdb: u.nbSdb,
      revenueResasMad,
      revenueUpsellMad,
      revenueTotalMad,
      cleaningsCount,
      cleaningsByCategory,
      cleaningsCostMad,
      cleaningsCostPartial: cl?.partial ?? false,
      interventionsCount: actionsDetail.interventions,
      interventionsCostMad,
      interventionsWithoutCost: ints?.noCost ?? 0,
      costsTotalMad,
      margeBruteMad,
      actionsCount,
      actionsDetail,
      margePerActionMad:
        margeBruteMad != null && actionsCount > 0
          ? Math.round((margeBruteMad / actionsCount) * 100) / 100
          : null,
    };
  });

  rows.sort((a, b) => (b.revenueTotalMad - a.revenueTotalMad) || a.label.localeCompare(b.label));
  return { rows, hasCostParams: params.length > 0, periodStartIso: startIso, periodEndIso: todayIso };
}

/** Rentabilité d'UN lot sur une période (wrapper du chargeur groupé). */
export async function computeUnitProfitability(
  supabase: CostClient,
  unitId: string,
  period: CostPeriod = '90j',
): Promise<UnitProfitabilityRow | null> {
  const { data: unit } = await supabase
    .from('propria_units')
    .select('property_id')
    .eq('id', unitId)
    .maybeSingle();
  if (!unit) return null;
  const { rows } = await getUnitProfitabilityRows(supabase, period, (unit as any).property_id);
  return rows.find((r) => r.unitId === unitId) ?? null;
}

/** Charge de gestion d'UN lot (U25 — proxy nb actions, pas un temps réel). */
export async function computeManagementLoad(
  supabase: CostClient,
  unitId: string,
  period: CostPeriod = '90j',
): Promise<{ actionsCount: number; detail: UnitProfitabilityRow['actionsDetail']; margePerActionMad: number | null } | null> {
  const row = await computeUnitProfitability(supabase, unitId, period);
  if (!row) return null;
  return {
    actionsCount: row.actionsCount,
    detail: row.actionsDetail,
    margePerActionMad: row.margePerActionMad,
  };
}

// ─── Coût ménage « à aujourd'hui » par lot (fiche bien — sujet 4) ───────────

export type UnitCleaningCostToday = {
  unitId: string;
  label: string;
  nbChambres: number | null;
  nbSdb: number | null;
  standard: CleaningCostBreakdown;
  poussiere: CleaningCostBreakdown;
  deepCleaning: CleaningCostBreakdown;
};

/**
 * Coût calculé d'un ménage standard / poussière / deep cleaning à aujourd'hui
 * pour chaque lot d'un bien (paramètres en vigueur ce jour, overrides inclus).
 */
export async function getCleaningCostTodayForProperty(
  supabase: CostClient,
  propertyId: string,
): Promise<{ units: UnitCleaningCostToday[]; hasCostParams: boolean }> {
  const todayIso = isoDate(new Date());
  const [unitsRes, sdbUnitsRes, params] = await Promise.all([
    supabase
      .from('propria_units_enriched')
      .select('unit_id, display_label, nb_chambres')
      .eq('property_id', propertyId)
      .eq('is_active', true)
      .order('display_label'),
    supabase
      .from('propria_units')
      .select('id, propria_nb_sdb')
      .eq('property_id', propertyId)
      .is('deleted_at', null),
    loadCostParams(supabase),
  ]);

  const sdbByUnit = new Map<string, number | null>(
    ((sdbUnitsRes.data ?? []) as any[]).map((r) => [
      r.id,
      r.propria_nb_sdb != null ? Number(r.propria_nb_sdb) : null,
    ]),
  );

  const units = ((unitsRes.data ?? []) as any[]).map((u) => {
    const nbChambres = u.nb_chambres != null ? Number(u.nb_chambres) : null;
    const nbSdb = sdbByUnit.get(u.unit_id) ?? null;
    const getParam = (key: CostParamKey) =>
      resolveParam(params, key, u.unit_id, todayIso)?.value_mad ?? null;
    return {
      unitId: u.unit_id as string,
      label: (u.display_label ?? '—') as string,
      nbChambres,
      nbSdb,
      standard: computeCleaningCost('sans_arrivee', { nbChambres, nbSdb }, getParam),
      poussiere: computeCleaningCost('poussiere', { nbChambres, nbSdb }, getParam),
      deepCleaning: computeCleaningCost('deep_cleaning', { nbChambres, nbSdb }, getParam),
    };
  });

  return { units, hasCostParams: params.length > 0 };
}
