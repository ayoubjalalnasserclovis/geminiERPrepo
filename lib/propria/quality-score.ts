import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BUREAU_TASK_PREFIX, getCheckupAutoSettings } from './checkups-auto';
import {
  computeQualityScore,
  cleaningFreshness,
  checkupFreshness,
  deepCleaningFreshness,
  maintenanceFreshness,
  qualityPeriodDays,
  QUALITY_PERIODS,
} from './quality-score-pure';
import type {
  QualityPeriod,
  Freshness,
  QualityScoreInput,
  QualityScoreBreakdown,
} from './quality-score-pure';

// Ré-export public (le code app importe `from './quality-score'` historiquement)
export {
  computeQualityScore,
  cleaningFreshness,
  checkupFreshness,
  deepCleaningFreshness,
  maintenanceFreshness,
  qualityPeriodDays,
  QUALITY_PERIODS,
};
export type { QualityPeriod, Freshness, QualityScoreInput, QualityScoreBreakdown };

/**
 * Pilotage qualité consolidé (chantier 11.c marathon — consultant U5/U20/U30).
 *
 * RIEN n'est stocké : le score qualité et toutes les fraîcheurs sont DÉRIVÉS
 * à la lecture depuis les sources existantes (convention n°1) :
 *   - avis            : hostaway_reviews (rating_normalized /5)
 *   - ménage / DC     : propria_cleanings_enriched (validated_at, category)
 *   - check-ups       : propria_checkups (status='valide', validated_at)
 *   - contrôle bureau : propria_interventions kind='tache' au libellé canon
 *                       BUREAU_TASK_PREFIX (chantier 11.b), clôturées
 *   - maintenance     : propria_maintenance_visits (trimestrielle obligatoire)
 *   - litiges         : propria_litiges (colonnes kanban non terminales)
 *   - préventifs      : hostaway_pre_review_tracking (sentiment / kanban)
 *
 * ─── FORMULE DU SCORE QUALITÉ /100 ──────────────────────────────────────────
 * 5 composantes pondérées :
 *   1. Note voyageurs   40 %  → (note moyenne période / 5) × 40
 *   2. Fraîcheur ménage 15 %  → dernier ménage validé < 7 j = 15 pts, puis
 *                               dégressif linéaire jusqu'à 0 pt à 30 j
 *   3. Check-up à jour  15 %  → pas en retard vs fréquence (propria_settings
 *                               checkup_every_months) = 15 pts, sinon dégressif
 *                               linéaire jusqu'à 0 pt à 90 j de retard
 *   4. Litiges          15 %  → 0 litige en cours = 15 pts, −5 pts par litige
 *                               ouvert (plancher 0)
 *   5. Préventifs nég.  15 %  → 0 préventif négatif ouvert = 15 pts, −5 pts
 *                               par préventif négatif ouvert (plancher 0)
 *
 * Composante SANS donnée = neutre : elle est exclue et le score est renormalisé
 * sur les poids restants (score = Σ points disponibles / Σ poids disponibles
 * × 100). On ne pénalise jamais l'absence de données :
 *   - aucun avis sur la période        → composante 1 exclue
 *   - aucun ménage jamais validé       → composante 2 exclue
 *   - aucun check-up jamais validé     → composante 3 exclue
 *   - litiges / préventifs : 0 ligne = vraiment 0 ouvert → composante pleine
 *     (ce sont des compteurs, pas des dates — l'absence EST la donnée).
 * ────────────────────────────────────────────────────────────────────────────
 */

export type QualityClient = SupabaseClient<any, 'public', any>;
// Note : les types & fonctions pures sont importés depuis ./quality-score-pure
// et ré-exportés en haut du fichier. Le code DB-dépendant reste ci-dessous.

// ─── Helpers dates (UTC, 'YYYY-MM-DD') ──────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return isoDate(d);
}

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(fromIso.slice(0, 10) + 'T00:00:00Z').getTime();
  const b = new Date(toIso.slice(0, 10) + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

// ─── Ligne consolidée par lot ───────────────────────────────────────────────

export type UnitQualityRow = {
  unitId: string;
  propertyId: string;
  label: string;       // display_label du lot
  bienLabel: string;   // code/nom du bien (filtre)
  // Avis (période choisie)
  avgRating: number | null;
  nbReviews: number;
  // Compteurs ouverts
  openNegativePreReviews: number;
  openLitiges: number;
  // Dates clés + jauges (toutes dérivées)
  lastCleaningAt: string | null;
  cleaningStatus: Freshness;
  lastDeepCleaningAt: string | null;
  deepCleaningStatus: Freshness;
  staysSinceDeepCleaning: number | null;
  lastCheckupAt: string | null;
  checkupDaysLate: number | null;   // null = jamais validé
  checkupStatus: Freshness;
  lastBureauControlAt: string | null;
  lastMaintenanceAt: string | null;
  maintenanceStatus: Freshness;
  // Score consolidé /100 (dérivé)
  score: number;
  scoreDetail: QualityScoreBreakdown;
};

const LITIGE_OPEN_COLUMNS = ['ouvrir_ticket', 'ticket_ouvert', 'appel'];
const PRE_REVIEW_CLOSED = ['accomplie', 'ratee'];

/**
 * Charge et calcule les lignes qualité de tous les lots actifs sous gestion
 * Propria (ou d'un seul bien si propertyId est fourni). UNE requête groupée
 * par source de données — jamais de N+1. Tri : score croissant (pires en
 * premier), réutilisé par /propria/qualite et la fiche bien.
 */
export async function getUnitQualityRows(
  supabase: QualityClient,
  period: QualityPeriod = '90j',
  propertyId?: string,
): Promise<UnitQualityRow[]> {
  const todayIso = isoDate(new Date());
  const periodStartIso = isoDate(new Date(Date.now() - qualityPeriodDays(period) * 86_400_000));
  const yearAgoIso = isoDate(new Date(Date.now() - 365 * 86_400_000));

  // 1) Lots actifs sous gestion (vue socle) + fréquence check-up paramétrée
  let unitsQuery = supabase
    .from('propria_units_enriched')
    .select('unit_id, property_id, display_label, bien_code, bien_name')
    .eq('is_active', true)
    .not('propria_managed_at', 'is', null)
    .is('propria_refused_at', null);
  if (propertyId) unitsQuery = unitsQuery.eq('property_id', propertyId);

  const [unitsRes, settings, dcSettingRes] = await Promise.all([
    unitsQuery,
    getCheckupAutoSettings(supabase),
    supabase.from('propria_settings').select('value').eq('key', 'deep_cleaning_every_stays').maybeSingle(),
  ]);

  const units = ((unitsRes.data ?? []) as any[]).map((u) => ({
    unitId: u.unit_id as string,
    propertyId: u.property_id as string,
    label: (u.display_label ?? u.bien_code ?? '—') as string,
    bienLabel: (u.bien_code ?? u.bien_name ?? '—') as string,
  }));
  if (units.length === 0) return [];

  const unitIds = units.map((u) => u.unitId);
  const propertyIds = Array.from(new Set(units.map((u) => u.propertyId)));
  const dcEveryStays = Math.max(1, Number(dcSettingRes.data?.value ?? 10) || 10);

  // 2) Une requête groupée PAR SOURCE (filtrées sur les lots concernés)
  const [reviewsRes, cleaningsRes, checkupsRes, litigesRes, preReviewRes, bureauRes, maintRes, listingsRes] =
    await Promise.all([
      // Avis de la période (note normalisée /5, avis encore publiés)
      supabase
        .from('hostaway_reviews')
        .select('propria_unit_id, rating_normalized')
        .in('propria_unit_id', unitIds)
        .gte('submitted_at', periodStartIso)
        .not('rating_normalized', 'is', null)
        .is('removed_at', null)
        .is('deleted_at', null)
        .limit(10000),
      // Ménages validés (vue enrichie — exclut déjà les soft-deleted)
      supabase
        .from('propria_cleanings_enriched')
        .select('propria_unit_id, validated_at, category')
        .in('propria_unit_id', unitIds)
        .not('validated_at', 'is', null)
        .order('validated_at', { ascending: false })
        .limit(10000),
      // Check-ups validés (lot OU bien entier — un check-up bien couvre ses lots)
      supabase
        .from('propria_checkups')
        .select('propria_unit_id, property_id, validated_at')
        .eq('status', 'valide')
        .not('validated_at', 'is', null)
        .is('deleted_at', null)
        .limit(10000),
      // Litiges en cours
      supabase
        .from('propria_litiges')
        .select('propria_unit_id, kanban_column')
        .in('propria_unit_id', unitIds)
        .in('kanban_column', LITIGE_OPEN_COLUMNS)
        .is('deleted_at', null),
      // Préventifs (le filtre négatif/ouvert se fait en mémoire)
      supabase
        .from('hostaway_pre_review_tracking')
        .select('propria_unit_id, sentiment, kanban_status')
        .in('propria_unit_id', unitIds)
        .is('deleted_at', null)
        .limit(10000),
      // Contrôles bureau clôturés (tâches au libellé canon du chantier 11.b)
      supabase
        .from('propria_interventions')
        .select('propria_unit_id, closed_at, occurred_at')
        .in('propria_unit_id', unitIds)
        .eq('kind', 'tache')
        .eq('status', 'cloture')
        .like('description', `${BUREAU_TASK_PREFIX}%`)
        .is('deleted_at', null)
        .order('closed_at', { ascending: false })
        .limit(5000),
      // Maintenance préventive trimestrielle (lignes lot + lignes bien legacy)
      supabase
        .from('propria_maintenance_visits')
        .select('propria_unit_id, property_id, status, due_date, completed_at')
        .or(`propria_unit_id.in.(${unitIds.join(',')}),property_id.in.(${propertyIds.join(',')})`)
        .is('deleted_at', null)
        .limit(10000),
      // Mapping listing → lot (pour compter les séjours depuis le dernier DC)
      supabase
        .from('hostaway_listings')
        .select('id, propria_unit_id')
        .in('propria_unit_id', unitIds)
        .is('deleted_at', null),
    ]);

  // ── Avis : moyenne + nb par lot ──
  const ratingAgg = new Map<string, { sum: number; n: number }>();
  for (const r of (reviewsRes.data ?? []) as any[]) {
    const agg = ratingAgg.get(r.propria_unit_id) ?? { sum: 0, n: 0 };
    agg.sum += Number(r.rating_normalized);
    agg.n += 1;
    ratingAgg.set(r.propria_unit_id, agg);
  }

  // ── Ménages : dernier validé + dernier deep cleaning par lot ──
  const lastCleaningByUnit = new Map<string, string>();
  const lastDeepByUnit = new Map<string, string>();
  for (const c of (cleaningsRes.data ?? []) as any[]) {
    const v = String(c.validated_at).slice(0, 10);
    if (!lastCleaningByUnit.has(c.propria_unit_id)) lastCleaningByUnit.set(c.propria_unit_id, v);
    if (c.category === 'deep_cleaning' && !lastDeepByUnit.has(c.propria_unit_id)) {
      lastDeepByUnit.set(c.propria_unit_id, v);
    }
  }

  // ── Check-ups : dernier validé effectif (max lot / bien entier) ──
  const lastCheckupByUnit = new Map<string, string>();
  const lastCheckupByProperty = new Map<string, string>();
  for (const c of (checkupsRes.data ?? []) as any[]) {
    const v = String(c.validated_at).slice(0, 10);
    if (c.propria_unit_id) {
      const prev = lastCheckupByUnit.get(c.propria_unit_id);
      if (!prev || v > prev) lastCheckupByUnit.set(c.propria_unit_id, v);
    } else if (c.property_id) {
      const prev = lastCheckupByProperty.get(c.property_id);
      if (!prev || v > prev) lastCheckupByProperty.set(c.property_id, v);
    }
  }

  // ── Litiges en cours par lot ──
  const litigesByUnit = new Map<string, number>();
  for (const l of (litigesRes.data ?? []) as any[]) {
    litigesByUnit.set(l.propria_unit_id, (litigesByUnit.get(l.propria_unit_id) ?? 0) + 1);
  }

  // ── Préventifs négatifs ouverts par lot ──
  const negPreReviewsByUnit = new Map<string, number>();
  for (const t of (preReviewRes.data ?? []) as any[]) {
    const isNegative = t.sentiment === 'mauvais' || t.kanban_status === 'risque';
    const isOpen = !PRE_REVIEW_CLOSED.includes(t.kanban_status);
    if (isNegative && isOpen) {
      negPreReviewsByUnit.set(t.propria_unit_id, (negPreReviewsByUnit.get(t.propria_unit_id) ?? 0) + 1);
    }
  }

  // ── Dernier contrôle bureau clôturé par lot ──
  const lastBureauByUnit = new Map<string, string>();
  for (const i of (bureauRes.data ?? []) as any[]) {
    const v = String(i.closed_at ?? i.occurred_at).slice(0, 10);
    if (!lastBureauByUnit.has(i.propria_unit_id)) lastBureauByUnit.set(i.propria_unit_id, v);
  }

  // ── Maintenance : dernière réalisée + visite ouverte échue / prochaine due ──
  type MaintAgg = { lastDone: string | null; overdueOpen: boolean; nextDue: string | null; any: boolean };
  const maintByKey = new Map<string, MaintAgg>(); // clé = unit:<id> ou prop:<id>
  const maintAgg = (key: string): MaintAgg => {
    let m = maintByKey.get(key);
    if (!m) { m = { lastDone: null, overdueOpen: false, nextDue: null, any: false }; maintByKey.set(key, m); }
    return m;
  };
  for (const v of (maintRes.data ?? []) as any[]) {
    const key = v.propria_unit_id ? `unit:${v.propria_unit_id}` : v.property_id ? `prop:${v.property_id}` : null;
    if (!key) continue;
    const m = maintAgg(key);
    m.any = true;
    if (v.status === 'realise') {
      const done = String(v.completed_at ?? v.due_date).slice(0, 10);
      if (!m.lastDone || done > m.lastDone) m.lastDone = done;
    } else {
      const due = String(v.due_date).slice(0, 10);
      if (due < todayIso) m.overdueOpen = true;
      else if (!m.nextDue || due < m.nextDue) m.nextDue = due;
    }
  }

  // ── Séjours terminés depuis le dernier DC (fallback : seuil calendaire) ──
  const listingToUnit = new Map<string, string>();
  for (const l of (listingsRes.data ?? []) as any[]) listingToUnit.set(l.id, l.propria_unit_id);
  const staysSinceDeepByUnit = new Map<string, number>();
  if (listingToUnit.size > 0 && lastDeepByUnit.size > 0) {
    const { data: resas } = await supabase
      .from('hostaway_reservations')
      .select('hostaway_listing_db_id, departure_date')
      .in('hostaway_listing_db_id', Array.from(listingToUnit.keys()))
      .in('status', ['new', 'modified'])
      .is('deleted_at', null)
      .gte('departure_date', yearAgoIso)
      .lte('departure_date', todayIso)
      .limit(10000);
    for (const r of (resas ?? []) as any[]) {
      const unitId = listingToUnit.get(r.hostaway_listing_db_id);
      if (!unitId) continue;
      const lastDeep = lastDeepByUnit.get(unitId);
      if (!lastDeep) continue; // pas d'ancre → repli calendaire 90 j
      if (String(r.departure_date) > lastDeep) {
        staysSinceDeepByUnit.set(unitId, (staysSinceDeepByUnit.get(unitId) ?? 0) + 1);
      }
    }
    // Lots avec un DC mais zéro départ depuis : compteur = 0 (donnée réelle)
    for (const unitId of Array.from(lastDeepByUnit.keys())) {
      if (!staysSinceDeepByUnit.has(unitId)) staysSinceDeepByUnit.set(unitId, 0);
    }
  }

  // 3) Assemblage + score (tout dérivé, rien stocké)
  const rows: UnitQualityRow[] = units.map((u) => {
    const agg = ratingAgg.get(u.unitId);
    const avgRating = agg && agg.n > 0 ? agg.sum / agg.n : null;
    const nbReviews = agg?.n ?? 0;

    const lastCleaningAt = lastCleaningByUnit.get(u.unitId) ?? null;
    const daysSinceCleaning = lastCleaningAt ? diffDays(lastCleaningAt, todayIso) : null;

    const lastDeepCleaningAt = lastDeepByUnit.get(u.unitId) ?? null;
    const daysSinceDeep = lastDeepCleaningAt ? diffDays(lastDeepCleaningAt, todayIso) : null;
    const staysSinceDeep = staysSinceDeepByUnit.get(u.unitId) ?? null;

    // Dernier check-up effectif = max(check-up du lot, check-up bien entier)
    const a = lastCheckupByUnit.get(u.unitId);
    const b = lastCheckupByProperty.get(u.propertyId);
    const lastCheckupAt = [a, b].filter(Boolean).sort().pop() ?? null;
    let checkupDaysLate: number | null = null;
    let daysUntilCheckupDue: number | null = null;
    if (lastCheckupAt) {
      const dueFrom = addMonthsIso(lastCheckupAt, settings.checkup_every_months);
      const delta = diffDays(dueFrom, todayIso); // >0 = en retard
      checkupDaysLate = Math.max(0, delta);
      daysUntilCheckupDue = Math.max(0, -delta);
    }

    const openLitiges = litigesByUnit.get(u.unitId) ?? 0;
    const openNegativePreReviews = negPreReviewsByUnit.get(u.unitId) ?? 0;

    // Maintenance : lignes lot prioritaires, repli sur les lignes bien (legacy)
    const m = maintByKey.get(`unit:${u.unitId}`) ?? maintByKey.get(`prop:${u.propertyId}`) ?? null;
    const lastMaintenanceAt = m?.lastDone ?? null;
    const maintenanceStatus = maintenanceFreshness(
      m?.any ?? false,
      m?.overdueOpen ?? false,
      m?.nextDue ? diffDays(todayIso, m.nextDue) : null,
    );

    const scoreDetail = computeQualityScore({
      avgRating, daysSinceCleaning, checkupDaysLate, openLitiges, openNegativePreReviews,
    });

    return {
      unitId: u.unitId,
      propertyId: u.propertyId,
      label: u.label,
      bienLabel: u.bienLabel,
      avgRating,
      nbReviews,
      openNegativePreReviews,
      openLitiges,
      lastCleaningAt,
      cleaningStatus: cleaningFreshness(daysSinceCleaning),
      lastDeepCleaningAt,
      deepCleaningStatus: deepCleaningFreshness(staysSinceDeep, dcEveryStays, daysSinceDeep),
      staysSinceDeepCleaning: staysSinceDeep,
      lastCheckupAt,
      checkupDaysLate,
      checkupStatus: checkupFreshness(checkupDaysLate, daysUntilCheckupDue),
      lastBureauControlAt: lastBureauByUnit.get(u.unitId) ?? null,
      lastMaintenanceAt,
      maintenanceStatus,
      score: scoreDetail.score,
      scoreDetail,
    };
  });

  // Pires en premier (score croissant), départage par libellé
  rows.sort((x, y) => x.score - y.score || x.label.localeCompare(y.label));
  return rows;
}
