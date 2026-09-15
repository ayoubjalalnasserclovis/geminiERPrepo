import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Invariants de la projection cashflow (CEO 2026-06-18 — chantier C3).
 *
 * RÈGLES CANONIQUES projection :
 *
 * 1. 1 acompte = 1 ligne *_payments = 1 scheduled_date individuelle.
 *    Aucun système ne doit forcer la même date sur plusieurs acomptes
 *    sauf si l'utilisateur l'a explicitement choisi.
 *
 * 2. scheduled_date = date PRÉVUE (source de vérité projection).
 *    paid_at        = date RÉELLE constatée (historique).
 *    Ne JAMAIS écrire dans paid_at depuis une simulation.
 *
 * 3. La projection somme TROIS sources de sorties :
 *    travaux_payments + achats_payments + services_payments.
 *    Toute nouvelle table payable doit être ajoutée à PROJECTION_OUTFLOW_SOURCES.
 *
 * 4. La projection somme DEUX sources d'entrées :
 *    payments (honoraires Stoniz) + travaux_encaissements + achats_encaissements.
 *
 * 5. Un acompte status='paid' avec amount_paid >= amount_total est exclu de
 *    la projection (déjà payé), mais inclus dans l'historique.
 *
 * 6. Un lot status='perdu' ou deleted_at IS NOT NULL est exclu partout.
 *
 * 7. ACHATS : un paiement dont le lot.status='a_commander' est exclu de la
 *    projection (le prix n'est pas encore connu — un acompte daté sur ce lot
 *    est une incohérence à corriger, alerte UI sur /finance/projection).
 *    CEO 2026-06-18 B3.
 */

/** Statuts de lot achats CONSIDÉRÉS dans la projection cashflow et les KPI
 * dashboard. Tous les statuts hors 'a_commander' et 'annule' sont retenus.
 * - 'a_commander' : prix non encore connu (CEO 2026-06-18 B3)
 * - 'annule'      : lot abandonné, ne doit pas peser dans le cashflow (CEO 2026-06-18)
 */
export const PROJECTION_ACHATS_LOT_STATUSES = [
  'devis_recu',
  'commande',
  'livre',
  'installe',
] as const;
export type ProjectionAchatsLotStatus = (typeof PROJECTION_ACHATS_LOT_STATUSES)[number];

/** Statuts EXCLUS partout (projection + KPI dashboard + liste à programmer).
 * Inverse de la liste blanche.
 * CEO 2026-06-18 : étendu à la liste 'lots à programmer' après bug remonté
 * (le bandeau "289 lots à programmer · 1.7M MAD" incluait des lots a_commander).
 */
export const ACHATS_LOT_STATUSES_EXCLUDED_FROM_KPI = ['a_commander', 'annule'] as const;

/** Statuts achats EXCLUS de la liste "lots avec reste à payer à programmer"
 * affichée dans le bandeau MissingDatesBanner sur /finance/projection.
 * Inclut les statuts déjà exclus partout + ceux du cycle "produit déjà reçu"
 * (installe, livre) qui n'ont plus à être programmés. */
export const ACHATS_LOT_STATUSES_NOT_TO_PROGRAM = [
  ...ACHATS_LOT_STATUSES_EXCLUDED_FROM_KPI,
  'installe',
  'livre',
] as const;

/** Format PostgREST pour usage direct dans .not('status', 'in', '(...)') */
export const ACHATS_LOT_NOT_TO_PROGRAM_PG =
  `(${ACHATS_LOT_STATUSES_NOT_TO_PROGRAM.join(',')})`;

export const ACHATS_LOT_EXCLUDED_FROM_KPI_PG =
  `(${ACHATS_LOT_STATUSES_EXCLUDED_FROM_KPI.join(',')})`;

/** Tables sources des sorties dans la projection. Tout ajout ici DOIT être
 * répercuté dans app/(team)/finance/projection/page.tsx (projectAtDay et
 * tensionPoints) ET dans actions.ts (mapping source → table). */
export const PROJECTION_OUTFLOW_SOURCES = [
  'travaux_payments',
  'achats_payments',
  'services_payments',
] as const;
export type ProjectionOutflowTable = (typeof PROJECTION_OUTFLOW_SOURCES)[number];

export const PROJECTION_INFLOW_SOURCES = [
  'payments',                  // honoraires Stoniz
  'travaux_encaissements',
  'achats_encaissements',
] as const;
export type ProjectionInflowTable = (typeof PROJECTION_INFLOW_SOURCES)[number];

/** Colonne de date PRÉVUE par table. Toute écriture depuis la projection
 * (drawer, simulation) cible cette colonne — jamais paid_at. */
export const SCHEDULED_DATE_COLUMN: Record<ProjectionOutflowTable | ProjectionInflowTable, string> = {
  travaux_payments: 'scheduled_date',
  achats_payments: 'scheduled_date',
  services_payments: 'scheduled_date',
  payments: 'due_date',
  travaux_encaissements: 'scheduled_date',
  achats_encaissements: 'scheduled_date',
};

export type ProjectionInvariantCheck = {
  name: string;
  ok: boolean;
  detail: string;
};

/**
 * Vérifications runtime. À appeler depuis un endpoint healthcheck ou un cron
 * pour détecter une dérive (ex: lots avec tous les acomptes même date,
 * paid_at modifié alors qu'il devrait rester null, etc.).
 *
 * Retourne une liste de checks avec ok/ko + detail. ok = false → action requise.
 */
export async function runProjectionInvariants(
  supabase: SupabaseClient,
): Promise<ProjectionInvariantCheck[]> {
  const checks: ProjectionInvariantCheck[] = [];

  // ─── Invariant 1 : ratio "lots multi-acomptes avec dates aplaties" ─────
  // Si > 10 % des lots multi-acomptes ont tous leurs acomptes même date,
  // c'est un signal qu'un bug bulk-plan ré-introduit le pattern fautif.
  for (const table of ['travaux_payments', 'achats_payments'] as const) {
    const { data } = await supabase
      .from(table)
      .select('lot_id, scheduled_date')
      .not('lot_id', 'is', null)
      .not('scheduled_date', 'is', null)
      .is('deleted_at', null);
    const byLot = new Map<string, Set<string>>();
    for (const row of (data ?? []) as any[]) {
      const set = byLot.get(row.lot_id) ?? new Set<string>();
      set.add(row.scheduled_date as string);
      byLot.set(row.lot_id, set);
    }
    const multi = Array.from(byLot.values()).filter((s) => {
      // on regarde aussi le count; ici on a juste les dates distinctes
      return true; // tous les lots ; on filtre ensuite via le nb d'entrées brutes
    });
    // Approximation : compte les lots dont nb d'acomptes >= 2 et nb dates distinctes == 1
    const countByLot = new Map<string, number>();
    for (const row of (data ?? []) as any[]) {
      countByLot.set(row.lot_id, (countByLot.get(row.lot_id) ?? 0) + 1);
    }
    const multiLots = Array.from(countByLot.entries()).filter(([, n]) => n >= 2);
    const flatLots = multiLots.filter(([lotId]) => (byLot.get(lotId)?.size ?? 0) === 1);
    const total = multiLots.length;
    const flat = flatLots.length;
    const ratio = total === 0 ? 0 : (flat / total) * 100;
    checks.push({
      name: `${table}: ratio lots multi-acomptes avec dates aplaties`,
      ok: ratio <= 10,
      detail: total === 0
        ? `0 lots multi-acomptes (rien à vérifier)`
        : `${flat}/${total} lots (${ratio.toFixed(1)} %) ont tous leurs acomptes même date. Seuil alerte : > 10 %.`,
    });
  }

  // ─── Invariant 2 : aucune ligne avec scheduled_date dans le passé et paid_at NULL non flaggée ──
  // → ce sont les "overdues" qui doivent apparaître dans la projection avec flag overdue=true.
  // Si la requête planning oublie ces lignes, on perd des sorties prévues.
  // Check : compte les lignes overdues totales par table — informatif uniquement.
  const todayIso = new Date().toISOString().slice(0, 10);
  for (const table of PROJECTION_OUTFLOW_SOURCES) {
    const { count } = await supabase
      .from(table)
      .select('id', { count: 'exact', head: true })
      .lt('scheduled_date', todayIso)
      .is('paid_at', null)
      .neq('status', 'paid')
      .is('deleted_at', null);
    checks.push({
      name: `${table}: lignes en retard (scheduled_date < today, non payées)`,
      ok: true, // informatif, jamais ko
      detail: `${count ?? 0} acompte(s) en retard à régulariser.`,
    });
  }

  // ─── Invariant 2bis : lots achats a_commander dans 'à programmer' ────────
  // CEO 2026-06-18 : aucun lot status='a_commander' ou 'annule' ne doit
  // apparaître dans la liste "lots avec reste à payer à programmer" — le prix
  // n'est pas connu (a_commander) ou le lot est abandonné (annule).
  const { data: aCommanderLots } = await supabase
    .from('achats_lots')
    .select('id, supplier_name, project_id, devis_fournisseur_mad')
    .is('deleted_at', null)
    .in('status', ['a_commander', 'annule']);
  const aCommanderCount = (aCommanderLots ?? []).length;
  const aCommanderTotalMad = (aCommanderLots ?? []).reduce(
    (s: number, l: any) => s + Number(l.devis_fournisseur_mad ?? 0),
    0,
  );
  checks.push({
    name: 'achats_lots: a_commander/annule présents en base',
    ok: true, // informatif — l'exclusion est appliquée à la lecture, pas en base
    detail: aCommanderCount === 0
      ? 'OK : aucun lot a_commander/annule.'
      : `${aCommanderCount} lot(s) a_commander/annule (total devis ${aCommanderTotalMad.toLocaleString('fr-FR')} MAD). ` +
        `Ils DOIVENT être exclus de toute lecture cashflow via ACHATS_LOT_EXCLUDED_FROM_KPI_PG ` +
        `et de la liste "à programmer" via ACHATS_LOT_NOT_TO_PROGRAM_PG.`,
  });

  // ─── Invariant 3 : services_payments doit avoir scheduled_date renseigné ─
  // (sinon il échappe à la projection — bug juin 2026 sur la colonne paid_at)
  const { count: servicesSansDate } = await supabase
    .from('services_payments')
    .select('id', { count: 'exact', head: true })
    .is('scheduled_date', null)
    .is('paid_at', null)
    .neq('status', 'paye')
    .is('deleted_at', null);
  checks.push({
    name: 'services_payments: scheduled_date renseigné',
    ok: (servicesSansDate ?? 0) === 0,
    detail: (servicesSansDate ?? 0) === 0
      ? 'OK : toutes les sorties services prévues ont une date'
      : `${servicesSansDate} ligne(s) services_payments sans scheduled_date ni paid_at → invisibles dans la projection. À dater.`,
  });

  return checks;
}
