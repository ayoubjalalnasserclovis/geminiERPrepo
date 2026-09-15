import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Helpers requêtes check-ups (CEO 2026-06-18 — chantier 1 marathon).
 *
 * Périmètre Propria CANONIQUE : utilisé partout pour éviter les divergences
 * de KPI (voir invariants README sectionner Check-ups).
 *
 * Règle 1 : périmètre = biens avec propria_managed_at NOT NULL,
 *           propria_refused_at NULL, deleted_at NULL.
 * Règle 2 : les compteurs de page (KPI) sont calculés sur la table ENTIÈRE,
 *           pas sur la liste filtrée affichée.
 *
 * BUG HISTORIQUE (corrigé 2026-06-23) : le filtre périmètre ne prenait en
 * compte QUE property_id, alors que le cron checkups-auto crée des check-ups
 * sur propria_unit_id (jamais sur property_id direct). Résultat : 18/18
 * check-ups actifs étaient invisibles sur /propria/checkups, mais le cron
 * daily-reminders envoyait quand même des emails de retard (SELECT sans filtre
 * périmètre). Fix : élargir le scope à TOUTES les rows dont soit property_id,
 * soit propria_unit_id.property_id est dans le périmètre Propria.
 */

const ACTIVE_STATUSES = ['a_faire', 'en_cours', 'a_valider'] as const;

export type CheckupStatusCounts = {
  a_faire: number;
  en_cours: number;
  a_valider: number;
  valide: number;
  annule: number;
  total: number;
  actifs: number; // = a_faire + en_cours + a_valider
};

type PropriaScopeIds = {
  propertyIds: string[];
  unitIds: string[]; // lots actifs (is_active=true, deleted_at IS NULL) DES biens Propria
};

/**
 * Cache des property_ids dans le périmètre Propria — une seule requête réutilisable.
 */
async function getPropriaPropertyIds(supabase: SupabaseClient): Promise<string[]> {
  // CEO 2026-06-18 : ajout propria_refused_at IS NULL pour cohérence avec
  // les autres vues (property_completeness_view, propria_unit_completeness).
  // Avant : biens refusés comptés à tort dans les KPI check-ups.
  const { data } = await supabase
    .from('properties')
    .select('id')
    .not('propria_managed_at', 'is', null)
    .is('propria_refused_at', null)
    .is('deleted_at', null);
  return ((data ?? []) as any[]).map((p) => p.id as string);
}

/**
 * Périmètre Propria étendu : property_ids ET propria_unit_ids actifs
 * rattachés à ces biens. Utilisé par la query check-ups et les compteurs KPI,
 * car le cron checkups-auto attache TOUT à propria_unit_id (jamais à property_id).
 */
async function getPropriaScopeIds(supabase: SupabaseClient): Promise<PropriaScopeIds> {
  const propertyIds = await getPropriaPropertyIds(supabase);
  if (propertyIds.length === 0) return { propertyIds: [], unitIds: [] };
  // Soft-deleted/inactif inclus volontairement côté unitIds : un check-up sur
  // un lot qui a été désactivé après création doit RESTER visible pour pouvoir
  // être clôturé/annulé. Le périmètre Propria est porté par le bien parent.
  const { data: units } = await supabase
    .from('propria_units')
    .select('id')
    .in('property_id', propertyIds);
  const unitIds = ((units ?? []) as any[]).map((u) => u.id as string);
  return { propertyIds, unitIds };
}

/**
 * Compteurs par statut sur la table entière, dans le périmètre Propria.
 *
 * IMPORTANT : pas de filtre côté appelant. Si on filtrait sur status='valide',
 * on perdrait les autres compteurs (bug observé en juin 2026 sur la page liste).
 */
export async function getCheckupStatusCounts(
  supabase: SupabaseClient,
): Promise<CheckupStatusCounts> {
  const { propertyIds, unitIds } = await getPropriaScopeIds(supabase);
  if (propertyIds.length === 0 && unitIds.length === 0) {
    return { a_faire: 0, en_cours: 0, a_valider: 0, valide: 0, annule: 0, total: 0, actifs: 0 };
  }

  // OR-filter sur property_id OU propria_unit_id (cron crée uniquement
  // propria_unit_id). Supabase JS : .or('property_id.in.(...),propria_unit_id.in.(...)')
  const orClauses: string[] = [];
  if (propertyIds.length > 0) orClauses.push(`property_id.in.(${propertyIds.join(',')})`);
  if (unitIds.length > 0) orClauses.push(`propria_unit_id.in.(${unitIds.join(',')})`);
  const { data } = await supabase
    .from('propria_checkups')
    .select('status')
    .is('deleted_at', null)
    .or(orClauses.join(','));

  const counts: CheckupStatusCounts = {
    a_faire: 0, en_cours: 0, a_valider: 0, valide: 0, annule: 0, total: 0, actifs: 0,
  };
  for (const row of (data ?? []) as any[]) {
    const s = row.status as keyof CheckupStatusCounts;
    if (counts[s] !== undefined) counts[s] += 1;
    counts.total += 1;
  }
  counts.actifs = counts.a_faire + counts.en_cours + counts.a_valider;
  return counts;
}

/**
 * Périmètre Propria pour la requête liste : filtre property_id IN (...) en plus
 * du soft-delete. Retourne le query builder à enrichir avec status + order + limit.
 *
 * NB : appel sequentiel (récupère propertyIds puis applique). À paralléliser
 * en amont via Promise.all([getCheckupStatusCounts, propriaCheckupsQuery]).
 */
export async function propriaCheckupsQuery(
  supabase: SupabaseClient,
  options?: { statusFilter?: string; limit?: number },
) {
  const { propertyIds, unitIds } = await getPropriaScopeIds(supabase);
  let q = supabase
    .from('propria_checkups')
    .select(
      'id, property_id, propria_unit_id, status, assigned_to_id, due_date, started_at, submitted_at, validated_at, observations, created_at, auto_source, final_classification',
    )
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(options?.limit ?? 300);

  // Périmètre Propria étendu : check-up rattaché à un bien Propria direct
  // OU à un lot d'un bien Propria (le cron checkups-auto utilise toujours
  // propria_unit_id). Sans cet OR, les 100% du parc créé par cron sont invisibles.
  if (propertyIds.length === 0 && unitIds.length === 0) {
    q = q.eq('property_id', '00000000-0000-0000-0000-000000000000');
  } else {
    const orClauses: string[] = [];
    if (propertyIds.length > 0) orClauses.push(`property_id.in.(${propertyIds.join(',')})`);
    if (unitIds.length > 0) orClauses.push(`propria_unit_id.in.(${unitIds.join(',')})`);
    q = q.or(orClauses.join(','));
  }

  if (options?.statusFilter === 'actifs') {
    q = q.in('status', ACTIVE_STATUSES as readonly string[]);
  } else if (options?.statusFilter) {
    q = q.eq('status', options.statusFilter);
  }

  return q;
}

/**
 * Compteur "% biens parc en zone C/D" sur 90j — KPI parc qualité (chantier 4).
 *
 * Dénominateur : nb de biens Propria ayant AU MOINS un check-up validé sur 90j.
 * Numérateur   : nb de biens dont le DERNIER check-up validé sur 90j est en C ou D.
 *
 * Retourne null si dénominateur = 0 (pas de plancher artificiel).
 */
export async function getZoneCDPercentage(
  supabase: SupabaseClient,
): Promise<{ pct: number | null; numerator: number; denominator: number }> {
  const periodStartIso = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { propertyIds, unitIds } = await getPropriaScopeIds(supabase);
  if (propertyIds.length === 0 && unitIds.length === 0) {
    return { pct: null, numerator: 0, denominator: 0 };
  }

  // Périmètre étendu : check-ups attachés au bien OU à un lot du bien.
  // On charge propria_unit_id pour pouvoir résoudre le bien parent en map.
  const orClauses: string[] = [];
  if (propertyIds.length > 0) orClauses.push(`property_id.in.(${propertyIds.join(',')})`);
  if (unitIds.length > 0) orClauses.push(`propria_unit_id.in.(${unitIds.join(',')})`);
  const { data } = await supabase
    .from('propria_checkups')
    .select('property_id, propria_unit_id, final_classification, validated_at')
    .eq('status', 'valide')
    .gte('validated_at', periodStartIso)
    .is('deleted_at', null)
    .or(orClauses.join(','))
    .order('validated_at', { ascending: false });

  // Map unit → property pour rassembler par bien (un check-up sur le lot
  // compte pour son bien parent).
  const unitToProperty = new Map<string, string>();
  if (unitIds.length > 0) {
    const { data: units } = await supabase
      .from('propria_units')
      .select('id, property_id')
      .in('id', unitIds);
    for (const u of (units ?? []) as any[]) unitToProperty.set(u.id, u.property_id);
  }

  // Dernier check-up validé par property_id (résolu via unit si besoin)
  const lastByProperty = new Map<string, string | null>();
  for (const row of (data ?? []) as any[]) {
    const propId = row.property_id ?? (row.propria_unit_id ? unitToProperty.get(row.propria_unit_id) : null);
    if (!propId) continue;
    if (!lastByProperty.has(propId)) {
      lastByProperty.set(propId, row.final_classification ?? null);
    }
  }
  const denominator = lastByProperty.size;
  const numerator = Array.from(lastByProperty.values()).filter(
    (c) => c === 'C' || c === 'D',
  ).length;
  return {
    pct: denominator === 0 ? null : Math.round((numerator / denominator) * 100),
    numerator,
    denominator,
  };
}
