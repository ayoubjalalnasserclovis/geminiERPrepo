import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Chantier 12 marathon — intelligence opérationnelle des tâches (U6).
// Contexte calendaire d'un lot Propria, 100 % DÉRIVÉ des tables existantes
// (hostaway_reservations + hostaway_listings + propria_cleanings) :
// aucune colonne ajoutée, aucun état stocké.
//
// getUnitOperationalContext(unitIds, supabase) fait UNE passe de requêtes
// groupées pour N lots (pas de N+1) :
//   1. hostaway_listings    → mapping listing Hostaway → lot Propria
//   2. hostaway_reservations (statuts new/modified, départ ≥ aujourd'hui)
//   3. propria_cleanings    (a_traiter/en_cours, due_date ≥ aujourd'hui)
// puis dérive par lot : occupation actuelle, prochaine arrivée, prochaine
// sortie, prochain ménage planifié.
//
// Réutilisé par : fiche intervention, liste interventions (badges ⚠ en une
// requête pour toutes les lignes), fiche ménage.
// ============================================================================

export type UnitResa = {
  hostaway_id: number;
  guest_name: string | null;
  arrival_date: string; // YYYY-MM-DD
  departure_date: string; // YYYY-MM-DD
};

export type UnitCleaningRef = {
  id: string;
  due_date: string | null;
  status: string;
  description: string | null;
  assigned_to_name: string | null;
};

export type UnitOperationalContext = {
  /** Résa en cours aujourd'hui (arrivée ≤ aujourd'hui ≤ départ). */
  currentStay: UnitResa | null;
  /** Prochaine arrivée (arrivée ≥ aujourd'hui) — peut être celle du jour. */
  nextArrival: UnitResa | null;
  /** Prochaine sortie (départ ≥ aujourd'hui). */
  nextDeparture: UnitResa | null;
  /** Prochain ménage planifié (a_traiter/en_cours, due_date ≥ aujourd'hui). */
  nextCleaning: UnitCleaningRef | null;
};

/** Statuts « ouverts » côté terrain : travail restant à faire.
 *  a_valider est exclu (travail terminé, en attente back-office). */
export const OPEN_TASK_STATUSES: string[] = ['a_traiter', 'en_cours', 'refusee'];

/** Fenêtre de mutualisation des déplacements (jours). */
export const MUTUALISATION_WINDOW_DAYS = 14;

/** Fenêtre d'alerte arrivée quand la tâche n'a pas d'échéance (jours). */
export const NO_DUE_DATE_ARRIVAL_WINDOW_DAYS = 7;

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysISO(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function emptyContext(): UnitOperationalContext {
  return { currentStay: null, nextArrival: null, nextDeparture: null, nextCleaning: null };
}

/**
 * Contexte opérationnel groupé pour N lots — 3 requêtes au total, jamais N+1.
 * @param unitIds lots Propria concernés (doublons tolérés)
 * @param horizonDays fenêtre d'arrivées futures considérée (défaut 60 jours,
 *        aligné sur getUpcomingResaOptions du chantier 14)
 */
export async function getUnitOperationalContext(
  unitIds: string[],
  supabase: SupabaseClient,
  horizonDays = 60,
): Promise<Map<string, UnitOperationalContext>> {
  const map = new Map<string, UnitOperationalContext>();
  const ids = [...new Set(unitIds.filter(Boolean))];
  if (ids.length === 0) return map;
  for (const id of ids) map.set(id, emptyContext());

  const today = todayISO();
  const horizon = addDaysISO(today, horizonDays);

  const [listingsRes, cleaningsRes] = await Promise.all([
    supabase
      .from('hostaway_listings')
      .select('id, propria_unit_id')
      .in('propria_unit_id', ids)
      .is('deleted_at', null),
    supabase
      .from('propria_cleanings')
      .select('id, propria_unit_id, due_date, status, description, assigned:profiles!propria_cleanings_assigned_to_id_fkey(full_name)')
      .in('propria_unit_id', ids)
      .in('status', ['a_traiter', 'en_cours'])
      .gte('due_date', today)
      .is('deleted_at', null)
      .order('due_date', { ascending: true })
      .limit(1000),
  ]);

  const listings = (listingsRes.data ?? []) as any[];
  const unitByListing = new Map<string, string>(
    listings.map((l) => [l.id as string, l.propria_unit_id as string]),
  );

  let resas: any[] = [];
  if (listings.length > 0) {
    const resasRes = await supabase
      .from('hostaway_reservations')
      .select('hostaway_id, hostaway_listing_db_id, guest_name, arrival_date, departure_date')
      .in('hostaway_listing_db_id', listings.map((l) => l.id))
      .in('status', ['new', 'modified'])
      .gte('departure_date', today)
      .lte('arrival_date', horizon)
      .is('deleted_at', null)
      .order('arrival_date', { ascending: true })
      .limit(2000);
    resas = (resasRes.data ?? []) as any[];
  }

  for (const r of resas) {
    const unitId = r.hostaway_listing_db_id ? unitByListing.get(r.hostaway_listing_db_id) : null;
    const ctx = unitId ? map.get(unitId) : null;
    if (!ctx) continue;
    const resa: UnitResa = {
      hostaway_id: Number(r.hostaway_id),
      guest_name: r.guest_name ?? null,
      arrival_date: r.arrival_date,
      departure_date: r.departure_date,
    };
    // Occupation actuelle : arrivée ≤ aujourd'hui ≤ départ (le jour du départ,
    // le lot est encore occupé jusqu'au check-out).
    if (resa.arrival_date <= today && resa.departure_date >= today) {
      if (!ctx.currentStay || resa.departure_date < ctx.currentStay.departure_date) {
        ctx.currentStay = resa;
      }
    }
    // Prochaine arrivée : la plus proche ≥ aujourd'hui (inclut une arrivée du jour).
    if (resa.arrival_date >= today) {
      if (!ctx.nextArrival || resa.arrival_date < ctx.nextArrival.arrival_date) {
        ctx.nextArrival = resa;
      }
    }
    // Prochaine sortie : tous les départs récupérés sont ≥ aujourd'hui.
    if (!ctx.nextDeparture || resa.departure_date < ctx.nextDeparture.departure_date) {
      ctx.nextDeparture = resa;
    }
  }

  for (const c of (cleaningsRes.data ?? []) as any[]) {
    const ctx = c.propria_unit_id ? map.get(c.propria_unit_id) : null;
    if (!ctx) continue;
    if (!ctx.nextCleaning || (c.due_date ?? '9999') < (ctx.nextCleaning.due_date ?? '9999')) {
      ctx.nextCleaning = {
        id: c.id,
        due_date: c.due_date ?? null,
        status: c.status,
        description: c.description ?? null,
        assigned_to_name: (c.assigned as any)?.full_name ?? null,
      };
    }
  }

  return map;
}

/**
 * Agrège les contextes de plusieurs lots (tâche posée sur le bien entier) :
 * occupation = au moins un lot occupé (départ le plus tardif affiché),
 * prochaine arrivée / sortie / ménage = les plus proches tous lots confondus.
 */
export function aggregateUnitContexts(
  contexts: (UnitOperationalContext | null | undefined)[],
): UnitOperationalContext {
  const agg = emptyContext();
  for (const c of contexts) {
    if (!c) continue;
    if (c.currentStay && (!agg.currentStay || c.currentStay.departure_date > agg.currentStay.departure_date)) {
      agg.currentStay = c.currentStay;
    }
    if (c.nextArrival && (!agg.nextArrival || c.nextArrival.arrival_date < agg.nextArrival.arrival_date)) {
      agg.nextArrival = c.nextArrival;
    }
    if (c.nextDeparture && (!agg.nextDeparture || c.nextDeparture.departure_date < agg.nextDeparture.departure_date)) {
      agg.nextDeparture = c.nextDeparture;
    }
    if (c.nextCleaning && (!agg.nextCleaning || (c.nextCleaning.due_date ?? '9999') < (agg.nextCleaning.due_date ?? '9999'))) {
      agg.nextCleaning = c.nextCleaning;
    }
  }
  return agg;
}

// ─── Règles d'alerte (pures, testables, partagées fiche + liste) ────────────

export type ArrivalAlert = {
  /** red = arrivée aujourd'hui/demain ET tâche pas commencée ; amber sinon. */
  level: 'red' | 'amber';
  arrival_date: string;
  guest_name: string | null;
};

/**
 * Alerte calendaire : tâche OUVERTE + arrivée prévue avant/le jour de la
 * due_date (ou dans les 7 prochains jours si pas de due_date).
 */
export function computeArrivalAlert(opts: {
  ctx: UnitOperationalContext | null | undefined;
  status: string;
  dueDate: string | null;
  today?: string;
}): ArrivalAlert | null {
  const { ctx, status, dueDate } = opts;
  if (!ctx?.nextArrival) return null;
  if (!OPEN_TASK_STATUSES.includes(status)) return null;
  const today = opts.today ?? todayISO();
  const arrival = ctx.nextArrival.arrival_date;
  const triggered = dueDate
    ? arrival <= dueDate
    : arrival <= addDaysISO(today, NO_DUE_DATE_ARRIVAL_WINDOW_DAYS);
  if (!triggered) return null;
  const notStarted = status === 'a_traiter' || status === 'refusee';
  const imminent = arrival <= addDaysISO(today, 1); // aujourd'hui ou demain
  return {
    level: imminent && notStarted ? 'red' : 'amber',
    arrival_date: arrival,
    guest_name: ctx.nextArrival.guest_name,
  };
}

export type OccupancyBlock = {
  departure_date: string;
  departsToday: boolean;
};

/**
 * Détection de blocage : logement occupé aujourd'hui + tâche due
 * aujourd'hui/dépassée ou déjà en cours → intervention sur place impossible.
 */
export function computeOccupancyBlock(opts: {
  ctx: UnitOperationalContext | null | undefined;
  status: string;
  dueDate: string | null;
  today?: string;
}): OccupancyBlock | null {
  const { ctx, status, dueDate } = opts;
  if (!ctx?.currentStay) return null;
  if (!OPEN_TASK_STATUSES.includes(status)) return null;
  const today = opts.today ?? todayISO();
  const dueNowOrPast = dueDate != null && dueDate <= today;
  if (!dueNowOrPast && status !== 'en_cours') return null;
  return {
    departure_date: ctx.currentStay.departure_date,
    departsToday: ctx.currentStay.departure_date === today,
  };
}

/**
 * Mutualisation des déplacements : ménage planifié (a_traiter/en_cours) sur
 * le même lot dans les 14 prochains jours, pour une tâche encore ouverte.
 */
export function computeCleaningMutualisation(opts: {
  ctx: UnitOperationalContext | null | undefined;
  status: string;
  today?: string;
}): UnitCleaningRef | null {
  const { ctx, status } = opts;
  if (!OPEN_TASK_STATUSES.includes(status)) return null;
  const cleaning = ctx?.nextCleaning;
  if (!cleaning?.due_date) return null;
  const today = opts.today ?? todayISO();
  if (cleaning.due_date > addDaysISO(today, MUTUALISATION_WINDOW_DAYS)) return null;
  return cleaning;
}
