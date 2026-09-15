import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Automatisations check-up (chantier 11.b — consultant U27/U28/U29).
 *
 * Logique PARTAGÉE entre le cron quotidien (app/api/cron/checkups-auto) et le
 * bouton CEO « Lancer maintenant » (/propria/checkups) — une seule source de
 * vérité, même pattern que lib/propria/cleanings-auto.ts.
 *
 * Quatre blocs, chacun IDEMPOTENT (re-run le même jour = zéro création) :
 *   a. Fréquence (U27)        : dedupe = « aucun check-up ouvert sur le lot »
 *                               (le check-up créé au 1er run bloque les suivants)
 *   b. Aléatoire bureau (U28) : dedupe = quota du jour déjà atteint (tâches
 *                               créées aujourd'hui avec le libellé canon)
 *                               + jamais 2 tâches ouvertes de même libellé/lot
 *   c. Aléatoire terrain (U28): dedupe = 1 seul auto_source='aleatoire_terrain'
 *                               créé par jour (même soft-deleted)
 *   d. Logement du jour (U29) : dedupe = 1 seul auto_source='logement_du_jour'
 *                               créé par jour (même soft-deleted)
 *
 * « Journée blanche » = aucune résa Hostaway new/modified ce jour-là sur le
 * lot : ni séjour en cours, ni arrivée, ni départ (arrival ≤ J ≤ departure).
 */

export type CheckupAutoClient = SupabaseClient<any, 'public', any>;

export type CheckupAutoSummary = {
  ran_at: string;
  frequence: { due: number; created: number; no_slot: number; skipped_open: number };
  bureau: { cleaned_yesterday: number; target: number; created: number; skipped: number };
  terrain: { day_eligible: boolean; created: number; skipped: number };
  logement_du_jour: { enabled: boolean; created: number; skipped: number };
  errors: string[];
};

/** Libellé canon des tâches « contrôle bureau » — sert au dedupe (préfixe). */
export const BUREAU_TASK_PREFIX = "Contrôle bureau (photos du ménage d'hier)";

const OPEN_CHECKUP_STATUSES = ['a_faire', 'en_cours', 'a_valider'];

const SETTINGS_DEFAULTS = {
  checkup_every_months: 3,
  checkup_every_stays: 10,
  random_office_per_day: 5,
  random_office_pct: 10,
  random_terrain_per_week: 3, // documentaire — rythme porté par LUN/MER/VEN
  logement_du_jour_enabled: true,
};

// ─── Helpers dates (tout en UTC, dates 'YYYY-MM-DD') ────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Bornes UTC [today 00:00:00Z, tomorrow 00:00:00Z) en chaîne ISO complète —
 * utilisé pour le dedup cron afin d'éviter les ambiguïtés du cast implicite
 * `created_at >= 'YYYY-MM-DD'` (qui dépend du timezone serveur Postgres).
 */
function utcDayBounds(todayIso: string): { start: string; end: string } {
  const start = new Date(todayIso + 'T00:00:00Z');
  const end = addDays(start, 1);
  return { start: start.toISOString(), end: end.toISOString() };
}

/**
 * Advisory lock 32 bits dérivé d'une chaîne via hash FNV-1a (stable,
 * collision-tolérant à l'échelle d'une poignée de clés concurrentes).
 * Utilisé pour sérialiser les blocs cron à risque de race (logement_du_jour,
 * aleatoire_terrain) — voir runLogementDuJourBlock pour le contexte.
 */
function lockKeyFor(scope: string, dayIso: string): number {
  const s = `${scope}:${dayIso}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // Postgres pg_try_advisory_xact_lock(int4) prend un int signé 32 bits
  return h | 0;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + months);
  return isoDate(d);
}

function diffDays(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ─── Settings ───────────────────────────────────────────────────────────────

export type CheckupAutoSettings = typeof SETTINGS_DEFAULTS;

export async function getCheckupAutoSettings(
  supabase: CheckupAutoClient,
): Promise<CheckupAutoSettings> {
  const { data } = await supabase
    .from('propria_settings')
    .select('key, value')
    .in('key', Object.keys(SETTINGS_DEFAULTS));
  const out: any = { ...SETTINGS_DEFAULTS };
  for (const row of (data ?? []) as any[]) {
    if (row.key === 'logement_du_jour_enabled') {
      out.logement_du_jour_enabled = row.value === true || row.value === 'true';
    } else {
      const n = Number(row.value);
      if (Number.isFinite(n) && n > 0) out[row.key] = n;
    }
  }
  return out as CheckupAutoSettings;
}

// ─── Contexte commun (lots actifs, résas, derniers validés, ouverts) ────────

type UnitCtx = {
  id: string;
  property_id: string;
  label: string;
  created_at: string;
};

type Resa = { arrival_date: string; departure_date: string };

type AutoContext = {
  todayIso: string;
  settings: CheckupAutoSettings;
  units: UnitCtx[];
  /** Résas new/modified par lot (fenêtre J-365 → J+22). */
  resasByUnit: Map<string, Resa[]>;
  /** Lots avec un check-up ouvert (a_faire/en_cours/a_valider) — lot OU bien entier. */
  blockedUnitIds: Set<string>;
  /** Dernier check-up validé effectif par lot (max lot / bien entier), date ISO. */
  lastValidatedByUnit: Map<string, string>;
};

async function loadContext(supabase: CheckupAutoClient): Promise<AutoContext> {
  const today = new Date();
  const todayIso = isoDate(today);
  const settings = await getCheckupAutoSettings(supabase);

  // CEO 2026-06-23 — guardrail périmètre Propria : on ne crée plus de check-up
  // sur des lots dont le bien parent n'est pas géré Propria (= cause indirecte
  // du bug "checkups invisibles" : 2/18 orphelins TESTI 2 + GHAOUTI 2 créés
  // par aleatoire_terrain sur des biens hors périmètre, soft-deleted ou non
  // marqué propria_managed_at).
  const { data: propriaProps } = await supabase
    .from('properties')
    .select('id')
    .not('propria_managed_at', 'is', null)
    .is('propria_refused_at', null)
    .is('deleted_at', null);
  const propriaPropertyIdSet = new Set(((propriaProps ?? []) as any[]).map((p) => p.id as string));

  const [unitsRes, listingsRes, openRes, validatedRes] = await Promise.all([
    supabase
      .from('propria_units')
      .select('id, code, order_index, property_id, created_at')
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('hostaway_listings')
      .select('id, propria_unit_id')
      .not('propria_unit_id', 'is', null)
      .is('deleted_at', null),
    supabase
      .from('propria_checkups')
      .select('propria_unit_id, property_id')
      .in('status', OPEN_CHECKUP_STATUSES)
      .is('deleted_at', null),
    supabase
      .from('propria_checkups')
      .select('propria_unit_id, property_id, validated_at')
      .eq('status', 'valide')
      .not('validated_at', 'is', null)
      .is('deleted_at', null),
  ]);

  const units: UnitCtx[] = ((unitsRes.data ?? []) as any[])
    .filter((u) => propriaPropertyIdSet.has(u.property_id))
    .map((u) => ({
      id: u.id,
      property_id: u.property_id,
      label: u.code ?? `Suite ${u.order_index}`,
      created_at: (u.created_at ?? todayIso).slice(0, 10),
    }));

  // Map listing DB id → unit id (matching identique à cleanings-auto.ts)
  const listingToUnit = new Map<string, string>();
  for (const l of (listingsRes.data ?? []) as any[]) {
    listingToUnit.set(l.id, l.propria_unit_id);
  }

  // Résas : séjours passés (comptage U27, 12 mois max — fenêtre de sync) +
  // futurs (journées blanches sous 21 jours).
  const { data: resasRaw } = await supabase
    .from('hostaway_reservations')
    .select('hostaway_listing_db_id, arrival_date, departure_date')
    .in('status', ['new', 'modified'])
    .is('deleted_at', null)
    .gte('departure_date', isoDate(addDays(today, -365)))
    .lte('arrival_date', isoDate(addDays(today, 22)))
    .not('hostaway_listing_db_id', 'is', null)
    .limit(10000);
  const resasByUnit = new Map<string, Resa[]>();
  for (const r of (resasRaw ?? []) as any[]) {
    const unitId = listingToUnit.get(r.hostaway_listing_db_id);
    if (!unitId) continue;
    const list = resasByUnit.get(unitId) ?? [];
    list.push({ arrival_date: r.arrival_date, departure_date: r.departure_date });
    resasByUnit.set(unitId, list);
  }

  // Check-up ouvert sur le lot OU sur le bien entier → lot bloqué (pas de
  // doublon de contrôle pendant qu'un check-up est en cours).
  const blockedUnitIds = new Set<string>();
  const blockedPropertyIds = new Set<string>();
  for (const c of (openRes.data ?? []) as any[]) {
    if (c.propria_unit_id) blockedUnitIds.add(c.propria_unit_id);
    else if (c.property_id) blockedPropertyIds.add(c.property_id);
  }
  for (const u of units) {
    if (blockedPropertyIds.has(u.property_id)) blockedUnitIds.add(u.id);
  }

  // Dernier validé effectif : max(validated_at du lot, validated_at d'un
  // check-up « bien entier » du bien parent — il couvre tous ses lots).
  const lastByUnit = new Map<string, string>();
  const lastByProperty = new Map<string, string>();
  for (const c of (validatedRes.data ?? []) as any[]) {
    const v = String(c.validated_at).slice(0, 10);
    if (c.propria_unit_id) {
      const prev = lastByUnit.get(c.propria_unit_id);
      if (!prev || v > prev) lastByUnit.set(c.propria_unit_id, v);
    } else if (c.property_id) {
      const prev = lastByProperty.get(c.property_id);
      if (!prev || v > prev) lastByProperty.set(c.property_id, v);
    }
  }
  const lastValidatedByUnit = new Map<string, string>();
  for (const u of units) {
    const a = lastByUnit.get(u.id);
    const b = lastByProperty.get(u.property_id);
    const best = [a, b].filter(Boolean).sort().pop();
    if (best) lastValidatedByUnit.set(u.id, best);
  }

  return { todayIso, settings, units, resasByUnit, blockedUnitIds, lastValidatedByUnit };
}

// ─── Journées blanches ──────────────────────────────────────────────────────

function isBlankDay(resas: Resa[], dayIso: string): boolean {
  return !resas.some((r) => r.arrival_date <= dayIso && dayIso <= r.departure_date);
}

/** Première journée blanche du lot entre J (inclus) et J+horizon-1. */
function firstBlankDay(resas: Resa[], todayIso: string, horizonDays: number): string | null {
  const start = new Date(todayIso + 'T00:00:00Z');
  for (let i = 0; i < horizonDays; i++) {
    const day = isoDate(addDays(start, i));
    if (isBlankDay(resas, day)) return day;
  }
  return null;
}

// ─── Blocs ──────────────────────────────────────────────────────────────────

const NO_SLOT_21 = 'Aucun créneau libre sous 21 jours — planifier manuellement';
const NO_SLOT_7 = 'Aucun créneau libre sous 7 jours — planifier manuellement';

/**
 * a. Fréquence (U27) — un check-up est dû si, depuis le dernier check-up
 * VALIDÉ du lot : N mois écoulés OU N séjours terminés (départs Hostaway).
 * Lot jamais validé : la référence est la date de création du lot (sinon la
 * règle ne se déclencherait jamais — le « logement du jour » U29 couvre aussi
 * ce cas par ailleurs).
 *
 * Idempotence : on ne crée RIEN si un check-up ouvert existe déjà sur le lot
 * (a_faire/en_cours/a_valider) — le check-up créé au run précédent (y compris
 * le même jour) bloque donc toute re-création.
 */
async function runFrequenceBlock(
  supabase: CheckupAutoClient,
  ctx: AutoContext,
  summary: CheckupAutoSummary,
): Promise<void> {
  const { todayIso, settings } = ctx;
  for (const unit of ctx.units) {
    if (ctx.blockedUnitIds.has(unit.id)) {
      summary.frequence.skipped_open++;
      continue;
    }
    const baseline = ctx.lastValidatedByUnit.get(unit.id) ?? unit.created_at;
    const monthsDue = addMonthsIso(baseline, settings.checkup_every_months) <= todayIso;
    const resas = ctx.resasByUnit.get(unit.id) ?? [];
    const staysSince = resas.filter(
      (r) => r.departure_date > baseline && r.departure_date <= todayIso,
    ).length;
    const staysDue = staysSince >= settings.checkup_every_stays;
    if (!monthsDue && !staysDue) continue;

    summary.frequence.due++;
    const dueDate = firstBlankDay(resas, todayIso, 21);
    const reason = monthsDue
      ? `dernier check-up validé le ${baseline} (> ${settings.checkup_every_months} mois)`
      : `${staysSince} séjours terminés depuis le ${baseline} (seuil ${settings.checkup_every_stays})`;
    const observations = dueDate
      ? `Check-up automatique (fréquence) — ${reason}.`
      : `Check-up automatique (fréquence) — ${reason}. ${NO_SLOT_21}`;

    const { error } = await supabase.from('propria_checkups').insert({
      propria_unit_id: unit.id,
      status: 'a_faire',
      auto_source: 'frequence',
      assigned_to_id: null, // non assigné — dispatch superviseur (U29)
      due_date: dueDate,
      observations,
    } as any);
    if (error) {
      summary.errors.push(`frequence ${unit.label} : ${error.message}`);
      continue;
    }
    summary.frequence.created++;
    if (!dueDate) summary.frequence.no_slot++;
    ctx.blockedUnitIds.add(unit.id); // bloque les blocs suivants du même run
  }
}

/**
 * b. Aléatoire bureau (U28) — parmi les lots avec un ménage CLÔTURÉ HIER,
 * tirage au sort de cible = MAX(MIN(random_office_per_day, nb nettoyés),
 * ceil(nb nettoyés × random_office_pct %)) lots → 1 TÂCHE (kind='tache')
 * « Contrôle bureau (photos du ménage d'hier) — <lot> » chacun.
 *
 * Idempotence (2 niveaux) :
 *   1. Quota du jour : on compte les tâches au libellé canon déjà créées
 *      AUJOURD'HUI (même clôturées/soft-deleted entre-temps) — si le quota
 *      est atteint, re-run = zéro création (le tirage étant aléatoire, sans
 *      ce garde un re-run pourrait tirer d'autres lots et dépasser la cible).
 *   2. Par lot : jamais de nouvelle tâche si une tâche OUVERTE de même
 *      libellé existe déjà sur le lot.
 */
async function runBureauBlock(
  supabase: CheckupAutoClient,
  ctx: AutoContext,
  summary: CheckupAutoSummary,
): Promise<void> {
  const { todayIso, settings } = ctx;
  const yesterdayIso = isoDate(addDays(new Date(todayIso + 'T00:00:00Z'), -1));

  const { data: cleaned } = await supabase
    .from('propria_cleanings')
    .select('propria_unit_id')
    .eq('status', 'cloture')
    .eq('occurred_at', yesterdayIso)
    .not('propria_unit_id', 'is', null)
    .is('deleted_at', null);
  const cleanedUnitIds = Array.from(
    new Set(((cleaned ?? []) as any[]).map((c) => c.propria_unit_id)),
  );
  const n = cleanedUnitIds.length;
  summary.bureau.cleaned_yesterday = n;
  if (n === 0) return;

  // « 5/jour OU 10 % des nettoyés la veille » (consultant U28)
  const floor10pct = Math.ceil((n * settings.random_office_pct) / 100);
  const target = Math.min(n, Math.max(Math.min(settings.random_office_per_day, n), floor10pct));
  summary.bureau.target = target;

  // Garde quota du jour (idempotence niveau 1) — created_at ∈ [today, tomorrow)
  // en UTC strict (cf. bug historique logement_du_jour), sans filtre
  // deleted_at/status : une tâche supprimée le jour même ne doit pas être
  // re-créée par un re-run.
  const { start: dayStart, end: dayEnd } = utcDayBounds(todayIso);
  const { count: alreadyToday } = await supabase
    .from('propria_interventions')
    .select('id', { count: 'exact', head: true })
    .eq('kind', 'tache')
    .like('description', `${BUREAU_TASK_PREFIX}%`)
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd);
  let remaining = target - (alreadyToday ?? 0);
  if (remaining <= 0) {
    summary.bureau.skipped = n;
    return;
  }

  // Garde par lot (idempotence niveau 2) : tâche ouverte de même libellé
  const { data: openSame } = await supabase
    .from('propria_interventions')
    .select('propria_unit_id')
    .eq('kind', 'tache')
    // statuts non terminaux (schéma 20260531120000) : tâche encore « vivante »
    .in('status', ['a_traiter', 'en_cours', 'a_valider', 'refusee'])
    .like('description', `${BUREAU_TASK_PREFIX}%`)
    .is('deleted_at', null);
  const openBureauUnits = new Set(
    ((openSame ?? []) as any[]).map((t) => t.propria_unit_id).filter(Boolean),
  );

  const unitById = new Map(ctx.units.map((u) => [u.id, u]));
  const eligible = shuffle(cleanedUnitIds.filter((id) => !openBureauUnits.has(id) && unitById.has(id)));
  for (const unitId of eligible) {
    if (remaining <= 0) break;
    const unit = unitById.get(unitId)!;
    const { error } = await supabase.from('propria_interventions').insert({
      property_id: unit.property_id,
      propria_unit_id: unit.id,
      kind: 'tache',
      description: `${BUREAU_TASK_PREFIX} — ${unit.label}`,
      urgency: 'normale',
      status: 'a_traiter',
      occurred_at: todayIso,
      hostaway_integrated: false,
    } as any);
    if (error) {
      summary.errors.push(`bureau ${unit.label} : ${error.message}`);
      continue;
    }
    summary.bureau.created++;
    remaining--;
  }
  summary.bureau.skipped = n - summary.bureau.created;
}

/**
 * c. Aléatoire terrain (U28) — 1 lot aléatoire par jour les LUN/MER/VEN
 * (≈ random_terrain_per_week = 3/semaine), parmi les lots actifs sans
 * check-up ouvert. due_date = aujourd'hui si journée blanche, sinon première
 * blanche sous 7 jours, sinon NULL.
 *
 * Idempotence : max 1 check-up auto_source='aleatoire_terrain' CRÉÉ par jour.
 *
 * BUG HISTORIQUE (corrigé 2026-06-19) : le filtre `created_at >= todayIso`
 * passait par un cast string→timestamptz dépendant du timezone serveur, et
 * 2 invocations cron rapprochées (Vercel retry / overlap) pouvaient lire 0
 * en même temps puis insérer toutes les 2. Fix : bornes UTC explicites
 * [today 00:00:00Z, tomorrow 00:00:00Z) + re-check post-insert qui
 * soft-delete le perdant en cas de race détectée.
 */
async function runTerrainBlock(
  supabase: CheckupAutoClient,
  ctx: AutoContext,
  summary: CheckupAutoSummary,
): Promise<void> {
  const { todayIso } = ctx;
  const dow = new Date(todayIso + 'T00:00:00Z').getUTCDay(); // 1=lun 3=mer 5=ven
  summary.terrain.day_eligible = [1, 3, 5].includes(dow);
  if (!summary.terrain.day_eligible) return;

  const { start: dayStart, end: dayEnd } = utcDayBounds(todayIso);
  const { count: alreadyToday } = await supabase
    .from('propria_checkups')
    .select('id', { count: 'exact', head: true })
    .eq('auto_source', 'aleatoire_terrain')
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd);
  if ((alreadyToday ?? 0) > 0) {
    summary.terrain.skipped++;
    return;
  }

  const candidates = shuffle(ctx.units.filter((u) => !ctx.blockedUnitIds.has(u.id)));
  const unit = candidates[0];
  if (!unit) return;

  const resas = ctx.resasByUnit.get(unit.id) ?? [];
  const dueDate = isBlankDay(resas, todayIso) ? todayIso : firstBlankDay(resas, todayIso, 7);
  const { data: inserted, error } = await supabase
    .from('propria_checkups')
    .insert({
      propria_unit_id: unit.id,
      status: 'a_faire',
      auto_source: 'aleatoire_terrain',
      assigned_to_id: null,
      due_date: dueDate,
      observations: dueDate
        ? 'Check-up automatique (tirage terrain aléatoire).'
        : `Check-up automatique (tirage terrain aléatoire). ${NO_SLOT_7}`,
    } as any)
    .select('id, created_at')
    .single();
  if (error || !inserted) {
    summary.errors.push(`terrain ${unit.label} : ${error?.message ?? 'insert vide'}`);
    return;
  }

  // Re-check anti-race : si un autre run a inséré entretemps, soft-delete
  // le plus récent (LWW : on garde le 1er créé, le perdant disparaît).
  const insertedId = (inserted as any).id as string;
  const insertedAt = (inserted as any).created_at as string;
  const { data: sameDay } = await supabase
    .from('propria_checkups')
    .select('id, created_at')
    .eq('auto_source', 'aleatoire_terrain')
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)
    .order('created_at', { ascending: true });
  const rows = (sameDay ?? []) as Array<{ id: string; created_at: string }>;
  if (rows.length > 1) {
    const keep = rows[0].id;
    if (insertedId !== keep) {
      await supabase
        .from('propria_checkups')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', insertedId);
      summary.terrain.skipped++;
      return;
    }
    // On garde le nôtre, on supprime les autres
    const losers = rows.slice(1).map((r) => r.id);
    if (losers.length > 0) {
      await supabase
        .from('propria_checkups')
        .update({ deleted_at: new Date().toISOString() } as any)
        .in('id', losers);
    }
  }
  void insertedAt;
  summary.terrain.created++;
  ctx.blockedUnitIds.add(unit.id);
}

/**
 * d. Logement du jour (U29) — le lot actif dont le dernier check-up validé
 * est le plus ANCIEN (jamais contrôlé en premier, départage par ancienneté
 * du lot), sans check-up ouvert. due_date = aujourd'hui.
 *
 * Idempotence : max 1 check-up auto_source='logement_du_jour' CRÉÉ par jour.
 *
 * BUG HISTORIQUE (corrigé 2026-06-19) : 3 paires de doublons observées en
 * prod, créées à quelques ms d'écart (race condition cron Vercel). Origine :
 *   1. Filtre `created_at >= todayIso` (string 'YYYY-MM-DD') passait par un
 *      cast timestamptz dépendant du timezone serveur Postgres.
 *   2. Pas de garde par propria_unit_id : 2 runs concurrents lisaient 0
 *      simultanément puis inséraient chacun leur tirage.
 * Fix : bornes UTC explicites [today 00:00:00Z, tomorrow 00:00:00Z) +
 * re-check post-insert qui soft-delete le perdant (LWW : on garde le 1er
 * created_at). Combiné à l'index unique partiel d'anti-doublon, on est
 * verrouillé à 2 niveaux (BDD + applicatif).
 */
async function runLogementDuJourBlock(
  supabase: CheckupAutoClient,
  ctx: AutoContext,
  summary: CheckupAutoSummary,
): Promise<void> {
  const { todayIso, settings } = ctx;
  summary.logement_du_jour.enabled = settings.logement_du_jour_enabled;
  if (!settings.logement_du_jour_enabled) return;

  const { start: dayStart, end: dayEnd } = utcDayBounds(todayIso);
  const { count: alreadyToday } = await supabase
    .from('propria_checkups')
    .select('id', { count: 'exact', head: true })
    .eq('auto_source', 'logement_du_jour')
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd);
  if ((alreadyToday ?? 0) > 0) {
    summary.logement_du_jour.skipped++;
    return;
  }

  const candidates = ctx.units
    .filter((u) => !ctx.blockedUnitIds.has(u.id))
    .sort((a, b) => {
      const la = ctx.lastValidatedByUnit.get(a.id) ?? null;
      const lb = ctx.lastValidatedByUnit.get(b.id) ?? null;
      if (la === null && lb === null) return a.created_at.localeCompare(b.created_at);
      if (la === null) return -1; // jamais contrôlé en premier
      if (lb === null) return 1;
      return la.localeCompare(lb);
    });
  const unit = candidates[0];
  if (!unit) return;

  const last = ctx.lastValidatedByUnit.get(unit.id);
  const { data: inserted, error } = await supabase
    .from('propria_checkups')
    .insert({
      propria_unit_id: unit.id,
      status: 'a_faire',
      auto_source: 'logement_du_jour',
      assigned_to_id: null,
      due_date: todayIso,
      observations: last
        ? `Logement du jour — dernier check-up validé le ${new Date(last + 'T00:00:00Z').toLocaleDateString('fr-FR')}.`
        : 'Logement du jour — jamais contrôlé jusqu’ici.',
    } as any)
    .select('id, created_at')
    .single();
  if (error || !inserted) {
    summary.errors.push(`logement_du_jour ${unit.label} : ${error?.message ?? 'insert vide'}`);
    return;
  }

  // Re-check anti-race : LWW sur created_at (le 1er créé gagne).
  const insertedId = (inserted as any).id as string;
  const { data: sameDay } = await supabase
    .from('propria_checkups')
    .select('id, created_at')
    .eq('auto_source', 'logement_du_jour')
    .is('deleted_at', null)
    .gte('created_at', dayStart)
    .lt('created_at', dayEnd)
    .order('created_at', { ascending: true });
  const rows = (sameDay ?? []) as Array<{ id: string; created_at: string }>;
  if (rows.length > 1) {
    const keep = rows[0].id;
    if (insertedId !== keep) {
      await supabase
        .from('propria_checkups')
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq('id', insertedId);
      summary.logement_du_jour.skipped++;
      return;
    }
    const losers = rows.slice(1).map((r) => r.id);
    if (losers.length > 0) {
      await supabase
        .from('propria_checkups')
        .update({ deleted_at: new Date().toISOString() } as any)
        .in('id', losers);
    }
  }
  summary.logement_du_jour.created++;
  ctx.blockedUnitIds.add(unit.id);
}

// ─── Run principal — cron + bouton CEO ──────────────────────────────────────

export async function runCheckupAutomations(
  supabase: CheckupAutoClient,
): Promise<CheckupAutoSummary> {
  const summary: CheckupAutoSummary = {
    ran_at: new Date().toISOString(),
    frequence: { due: 0, created: 0, no_slot: 0, skipped_open: 0 },
    bureau: { cleaned_yesterday: 0, target: 0, created: 0, skipped: 0 },
    terrain: { day_eligible: false, created: 0, skipped: 0 },
    logement_du_jour: { enabled: true, created: 0, skipped: 0 },
    errors: [],
  };

  const ctx = await loadContext(supabase);
  try {
    await runFrequenceBlock(supabase, ctx, summary);
  } catch (e: any) {
    summary.errors.push(`frequence fatal : ${e?.message ?? 'erreur'}`);
  }
  try {
    await runBureauBlock(supabase, ctx, summary);
  } catch (e: any) {
    summary.errors.push(`bureau fatal : ${e?.message ?? 'erreur'}`);
  }
  try {
    await runTerrainBlock(supabase, ctx, summary);
  } catch (e: any) {
    summary.errors.push(`terrain fatal : ${e?.message ?? 'erreur'}`);
  }
  try {
    await runLogementDuJourBlock(supabase, ctx, summary);
  } catch (e: any) {
    summary.errors.push(`logement_du_jour fatal : ${e?.message ?? 'erreur'}`);
  }
  return summary;
}

// ─── Retard vs fréquence (U27) — DÉRIVÉ à la lecture, jamais stocké ─────────

export type CheckupLateness = {
  unitId: string;
  propertyId: string;
  label: string;
  /** Dernier check-up validé (lot ou bien entier), ISO date, null = jamais. */
  lastValidated: string | null;
  /** Jours de retard au-delà de (dernier validé + checkup_every_months). */
  daysLate: number;
};

/**
 * Lots actifs en retard vs la fréquence paramétrée : dernier check-up validé
 * + checkup_every_months < aujourd'hui. Les lots jamais contrôlés ne sont pas
 * listés comme « en retard » (pas de référence — couverts par U29).
 * Utilisé par /propria/checkups et la section check-ups de la fiche bien.
 */
export async function computeCheckupLateness(
  supabase: CheckupAutoClient,
): Promise<{ everyMonths: number; late: CheckupLateness[] }> {
  const todayIso = isoDate(new Date());
  const settings = await getCheckupAutoSettings(supabase);

  const [unitsRes, validatedRes] = await Promise.all([
    supabase
      .from('propria_units')
      .select('id, code, order_index, property_id')
      .eq('is_active', true)
      .is('deleted_at', null),
    supabase
      .from('propria_checkups')
      .select('propria_unit_id, property_id, validated_at')
      .eq('status', 'valide')
      .not('validated_at', 'is', null)
      .is('deleted_at', null),
  ]);

  const lastByUnit = new Map<string, string>();
  const lastByProperty = new Map<string, string>();
  for (const c of (validatedRes.data ?? []) as any[]) {
    const v = String(c.validated_at).slice(0, 10);
    if (c.propria_unit_id) {
      const prev = lastByUnit.get(c.propria_unit_id);
      if (!prev || v > prev) lastByUnit.set(c.propria_unit_id, v);
    } else if (c.property_id) {
      const prev = lastByProperty.get(c.property_id);
      if (!prev || v > prev) lastByProperty.set(c.property_id, v);
    }
  }

  const late: CheckupLateness[] = [];
  for (const u of (unitsRes.data ?? []) as any[]) {
    const a = lastByUnit.get(u.id);
    const b = lastByProperty.get(u.property_id);
    const lastValidated = [a, b].filter(Boolean).sort().pop() ?? null;
    if (!lastValidated) continue;
    const dueFrom = addMonthsIso(lastValidated, settings.checkup_every_months);
    if (dueFrom < todayIso) {
      late.push({
        unitId: u.id,
        propertyId: u.property_id,
        label: u.code ?? `Suite ${u.order_index}`,
        lastValidated,
        daysLate: diffDays(dueFrom, todayIso),
      });
    }
  }
  late.sort((x, y) => y.daysLate - x.daysLate);
  return { everyMonths: settings.checkup_every_months, late };
}
