import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LOST_STATUS } from '@/lib/projects/lost';
import {
  STONIZ_FEE_SCHEDULE,
  STONIZ_FEES_TOTAL,
} from '@/lib/finance/stoniz-fees';

/**
 * "Honoraires à percevoir" — CEO 2026-08-17.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * REFONTE 2026-08-17b (fix Ilham TELKI)
 * ═══════════════════════════════════════════════════════════════════════════
 * V1 buggée : le forfait_reel était calculé comme (21 000 − stoniz_reduction),
 * ignorant les amount_expected sur-mesure saisis en BDD. Résultat pour Ilham
 * TELKI (forfait vrai = 10 000, saisi ligne par ligne, aucune réduction) : la
 * page affichait 13 499 € à percevoir au lieu de 2 499 €.
 *
 * V2 (actuelle) : les lignes payments EN BDD sont source de vérité par
 * milestone (leur amount_expected est déjà négocié). Le barème n'est un
 * fallback QUE pour les milestones jamais déclenchés (pas de ligne créée).
 * stoniz_reduction s'applique uniquement au prorata sur ces manquants.
 *
 * Calcul ligne par milestone :
 *   target_amount = amount_expected en BDD si ligne existe
 *                 = barème − (reduction × barème/somme_barème_manquants) sinon
 *   reste         = max(0, target_amount − amount_paid)
 *
 * forfait_reel = Σ target_amount des 5 milestones
 * deja_encaisse = Σ amount_paid des lignes existantes
 * reste_global = Σ reste = forfait_reel − deja_encaisse (par construction)
 *
 * Chaque milestone porte SON PROPRE reste (pas de pro-rata artificiel).
 * Ilham TELKI → livraison 2500 − 1 = 2499 €, tout le reste à 0. Total 2 499 ✅
 *
 * NB : cette page ne CRÉE aucune ligne en BDD. C'est un dérivé pur lecture.
 * Les triggers événementiels (upsert_milestone_payment + advance_phase)
 * restent la source de vérité pour créer les vraies échéances.
 */

export type MilestoneStatus =
  /** Pas de ligne payments (jamais déclenché) */
  | 'futur_pur'
  /** Ligne existe, amount_paid = 0 (déclenché mais pas encaissé) */
  | 'planifie'
  /** Ligne existe, 0 < amount_paid < amount_expected */
  | 'partiel';

export type MilestoneAVenir = {
  type: string;
  label: string;
  bareme_amount: number;         // montant standard du barème (référence)
  amount_a_percevoir: number;    // part pro-rata du reste_global sur ce milestone
  status: MilestoneStatus;
  /** Si une ligne existe déjà en BDD : son id (utile pour drill-down) */
  payment_id: string | null;
  /** Si le milestone est déjà planifié / partiel : la due_date de la ligne */
  due_date: string | null;
  /** Si partiellement payé : le montant déjà encaissé sur cette ligne */
  amount_paid_so_far: number;
  /**
   * Mois cible d'encaissement saisi manuellement par CEO/finance (format
   * YYYY-MM) — CEO 2026-08-17c. null si non saisi.
   */
  forecast_month: string | null;
};

export type ProjectFeesAVenir = {
  project_id: string;
  reference: string;
  client_name: string;
  current_phase: string | null;
  status: string | null;
  reduction: number;
  /** Case "Confirmé" cochée manuellement par le CEO/finance (CEO 2026-08-17c). */
  honoraires_confirmed: boolean;
  forfait_reel: number;
  deja_encaisse: number;
  reste_global: number;
  /** Détail par milestone du barème "à venir" (planifiés + futurs purs) */
  milestones_a_venir: MilestoneAVenir[];
};

/**
 * Une ligne de détail d'un mois de prévision : un milestone d'un projet dont
 * le forecast_month tombe sur ce mois. CEO 2026-08-31 (drill-down).
 */
export type ForecastMonthLine = {
  project_id: string;
  reference: string;
  client_name: string;
  current_phase: string | null;
  milestone_type: string;
  milestone_label: string;
  amount: number;
  status: MilestoneStatus;
  /** Le projet est-il marqué "Confirmé" par le CEO/finance ? */
  confirmed: boolean;
};

export type FeesBucketTotals = {
  nb_projects: number;
  total_reste_global: number;
  total_forfait_reel: number;
  total_deja_encaisse: number;
  by_milestone: Array<{ type: string; label: string; amount: number; count_projects: number }>;
  by_phase: Array<{ phase: string; amount: number; count_projects: number }>;
  /**
   * CEO 2026-08-17c : sous-total sur les projets marqués "Confirmé"
   * uniquement — utilisé pour afficher le KPI "CA confirmé" à côté du
   * pipeline complet.
   */
  confirmed: {
    nb_projects: number;
    total_reste_global: number;
  };
  /**
   * CEO 2026-08-17c : agrégation par mois cible (YYYY-MM) des milestones
   * pour lesquels un forecast_month a été saisi. Trié chronologique.
   */
  by_forecast_month: Array<{
    month: string;   // YYYY-MM
    amount_total: number;
    amount_confirmed: number;
    count_milestones: number;
    /**
     * CEO 2026-08-31 : détail des milestones qui composent le mois, pour le
     * drill-down cliquable dans "Prévisions par mois". Trié par montant
     * décroissant (le plus structurant en haut).
     */
    lines: ForecastMonthLine[];
  }>;
};

export type FeesAVenirDataset = {
  /** Projets status='actif' — coeur du pipeline honoraires. */
  active: {
    projects: ProjectFeesAVenir[];
    totals: FeesBucketTotals;
  };
  /**
   * Projets status='pause' — chantiers gelés (client en attente, litige, etc.).
   * CEO 2026-08-17b : séparés pour ne pas gonfler le pipeline actif.
   */
  paused: {
    projects: ProjectFeesAVenir[];
    totals: FeesBucketTotals;
  };
  /** Nombre de projets coaching actifs exclus de cette vue (CEO 2026-08-17). */
  nb_coaching_excluded: number;
};

/**
 * Phases où les honoraires sont bouclés (chantier fini + livraison payée).
 * Un projet en 'termine' n'a plus rien à encaisser côté honoraires.
 * On garde 'mise_en_location' quand même car un projet peut y arriver avec
 * une livraison encore non payée par le client.
 */
const PHASES_HONORAIRES_TERMINEES = new Set(['termine']);

function baremeAmountForType(type: string): number {
  return STONIZ_FEE_SCHEDULE.find(m => m.type === type)?.amount ?? 0;
}

/**
 * Rôle purement fonctionnel : à partir d'un projet + de ses lignes payments,
 * calcule la ventilation des honoraires à percevoir. Séparé du fetch BDD pour
 * pouvoir le tester unitairement sans mock Supabase.
 */
export function computeProjectFeesAVenir(input: {
  project: {
    id: string;
    reference: string | null;
    client_name: string;
    current_phase: string | null;
    status: string | null;
    stoniz_reduction: number | null;
    honoraires_confirmed: boolean | null;
  };
  payments: Array<{
    id: string;
    type: string;
    amount_expected: number | string;
    amount_paid: number | string;
    due_date: string | null;
  }>;
  /**
   * Mois de prévision saisis manuellement (mapping type → YYYY-MM).
   * Optionnel — un milestone sans entrée aura forecast_month = null.
   */
  forecasts?: Record<string, string | null>;
}): ProjectFeesAVenir | null {
  const { project, payments, forecasts } = input;
  const reduction = Number(project.stoniz_reduction ?? 0);
  const honoraires_confirmed = !!project.honoraires_confirmed;

  // On exclut le type 'autre' (paiements divers hors barème honoraires)
  const rawFees = payments.filter(p => p.type !== 'autre');

  // Index par type pour retrouver la ligne existante d'un milestone
  // (un même type PEUT avoir plusieurs lignes en cas de doublon historique —
  // on les somme pour être défensif, aligné sur aggregatePaymentSummary).
  type Agg = { amount_expected: number; amount_paid: number; ids: string[]; earliest_due: string | null };
  const byType = new Map<string, Agg>();
  for (const p of rawFees) {
    const cur = byType.get(p.type) ?? { amount_expected: 0, amount_paid: 0, ids: [], earliest_due: null };
    cur.amount_expected += Number(p.amount_expected ?? 0);
    cur.amount_paid += Number(p.amount_paid ?? 0);
    cur.ids.push(p.id);
    if (p.due_date && (!cur.earliest_due || p.due_date < cur.earliest_due)) {
      cur.earliest_due = p.due_date;
    }
    byType.set(p.type, cur);
  }

  // Barème des milestones SANS ligne en BDD (jamais déclenchés)
  const missingMilestones = STONIZ_FEE_SCHEDULE.filter(m => !byType.has(m.type));
  const totalBaremeMissing = missingMilestones.reduce((s, m) => s + m.amount, 0);

  // Calcul par milestone : source BDD si ligne existe, fallback barème sinon.
  // La réduction s'applique UNIQUEMENT au prorata sur les milestones sans ligne
  // (rationale : les lignes existantes ont un amount_expected déjà négocié —
  //  on ne le touche pas ; la réduction dilue le "à venir" restant).
  const milestonesRaw = STONIZ_FEE_SCHEDULE.map(m => {
    const agg = byType.get(m.type);

    let target_amount: number;
    if (agg) {
      // Source de vérité BDD (peut être sur-mesure : cf. Ilham TELKI 3000+2000+1000+1500+2500)
      target_amount = agg.amount_expected;
    } else {
      // Fallback barème pondéré par la réduction au prorata des manquants
      const reduction_share = totalBaremeMissing > 0
        ? reduction * (m.amount / totalBaremeMissing)
        : 0;
      target_amount = Math.max(0, m.amount - reduction_share);
    }

    const paid_so_far = agg?.amount_paid ?? 0;
    const reste_milestone = Math.max(0, target_amount - paid_so_far);

    // Milestone déjà bouclé → on skip
    if (reste_milestone <= 0.01) return null;

    let status: MilestoneStatus;
    if (!agg) status = 'futur_pur';
    else if (paid_so_far <= 0.01) status = 'planifie';
    else status = 'partiel';

    return {
      type: m.type,
      label: m.label,
      bareme_amount: m.amount,
      target_amount,
      amount_a_percevoir: Math.round(reste_milestone * 100) / 100,
      status,
      payment_id: agg?.ids[0] ?? null,
      due_date: agg?.earliest_due ?? null,
      amount_paid_so_far: paid_so_far,
      forecast_month: forecasts?.[m.type] ?? null,
    };
  }).filter(Boolean) as Array<MilestoneAVenir & { target_amount: number }>;

  // Recalcule les totaux du projet à partir de la même logique (cohérence).
  let forfait_reel = 0;
  for (const m of STONIZ_FEE_SCHEDULE) {
    const agg = byType.get(m.type);
    if (agg) {
      forfait_reel += agg.amount_expected;
    } else {
      const reduction_share = totalBaremeMissing > 0
        ? reduction * (m.amount / totalBaremeMissing)
        : 0;
      forfait_reel += Math.max(0, m.amount - reduction_share);
    }
  }
  const deja_encaisse = rawFees.reduce((s, p) => s + Number(p.amount_paid ?? 0), 0);
  const reste_global = Math.max(0, forfait_reel - deja_encaisse);

  // Aucun milestone restant → le projet n'a plus rien à percevoir.
  if (milestonesRaw.length === 0 || reste_global <= 0.01) return null;

  // On retire le champ interne target_amount avant retour (non exposé au client)
  const milestones_a_venir: MilestoneAVenir[] = milestonesRaw.map(({ target_amount, ...rest }) => rest);

  return {
    project_id: project.id,
    reference: project.reference ?? '—',
    client_name: project.client_name,
    current_phase: project.current_phase,
    status: project.status,
    reduction,
    honoraires_confirmed,
    forfait_reel: Math.round(forfait_reel * 100) / 100,
    deja_encaisse: Math.round(deja_encaisse * 100) / 100,
    reste_global: Math.round(reste_global * 100) / 100,
    milestones_a_venir,
  };
}

/**
 * Charge tous les projets non-perdus, non-livraison-cloturée, calcule pour chacun
 * le reste à percevoir + les agrégats globaux (par milestone, par phase).
 */
export async function collectFeesAVenir(): Promise<FeesAVenirDataset> {
  const supabase = createClient();

  // CEO 2026-08-17 : on lit tous les projets (y compris coaching) pour compter
  // combien on exclut, puis on filtre les cle_en_main pour le calcul détaillé.
  const [{ data: projectsRaw }, { data: payments }, { data: forecastsRaw }] = await Promise.all([
    supabase
      .from('projects')
      .select('id, reference, status, current_phase, stoniz_reduction, service_type, honoraires_confirmed, client:clients(full_name)')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
    supabase
      .from('payments')
      .select('id, project_id, type, amount_expected, amount_paid, due_date')
      .is('deleted_at', null)
      .neq('type', 'autre'),
    supabase
      .from('stoniz_fees_forecast')
      .select('project_id, milestone_type, forecast_month')
      .is('deleted_at', null),
  ]);

  // Index (project_id → milestone_type → YYYY-MM)
  const forecastsByProject = new Map<string, Record<string, string>>();
  for (const f of (forecastsRaw ?? []) as any[]) {
    const cur = forecastsByProject.get(f.project_id) ?? {};
    // BDD stocke une date type YYYY-MM-01 → on ne garde que YYYY-MM pour l'UI
    cur[f.milestone_type] = String(f.forecast_month).slice(0, 7);
    forecastsByProject.set(f.project_id, cur);
  }

  const allProjects = (projectsRaw ?? []) as any[];
  // Coaching = 5 000 € forfaitaire, hors canon 5 milestones → exclus.
  // On compte pour afficher un rappel discret côté UI.
  const nb_coaching_excluded = allProjects.filter(
    p => p.service_type === 'coaching'
      && !PHASES_HONORAIRES_TERMINEES.has(p.current_phase ?? '')
  ).length;
  const projects = allProjects.filter(p => p.service_type !== 'coaching');

  const paymentsByProject = new Map<string, any[]>();
  for (const p of (payments ?? []) as any[]) {
    const arr = paymentsByProject.get(p.project_id) ?? [];
    arr.push(p);
    paymentsByProject.set(p.project_id, arr);
  }

  const active: ProjectFeesAVenir[] = [];
  const paused: ProjectFeesAVenir[] = [];
  for (const p of (projects ?? []) as any[]) {
    // Skip les projets phase 'termine' : plus rien à percevoir en honoraires.
    if (PHASES_HONORAIRES_TERMINEES.has(p.current_phase ?? '')) continue;

    const clientName = p.client?.full_name ?? '—';
    const computed = computeProjectFeesAVenir({
      project: {
        id: p.id,
        reference: p.reference,
        client_name: clientName,
        current_phase: p.current_phase,
        status: p.status,
        stoniz_reduction: p.stoniz_reduction,
        honoraires_confirmed: p.honoraires_confirmed,
      },
      payments: paymentsByProject.get(p.id) ?? [],
      forecasts: forecastsByProject.get(p.id),
    });
    if (!computed) continue;
    // CEO 2026-08-17b : les 'pause' vont dans leur bucket. Les autres statuts
    // non-terminaux ('actif' + rares valeurs legacy) restent dans actifs.
    if (p.status === 'pause') paused.push(computed);
    else active.push(computed);
  }

  // Tri : plus gros reste à percevoir en premier (attention prioritaire au CEO)
  active.sort((a, b) => b.reste_global - a.reste_global);
  paused.sort((a, b) => b.reste_global - a.reste_global);

  return {
    active: { projects: active, totals: buildBucketTotals(active) },
    paused: { projects: paused, totals: buildBucketTotals(paused) },
    nb_coaching_excluded,
  };
}

/**
 * Agrégats internes d'un bucket de projets (actifs ou pause) — extrait dans
 * un helper séparé pour éviter la duplication et faciliter les tests.
 */
function buildBucketTotals(projects: ProjectFeesAVenir[]): FeesBucketTotals {
  const byMilestoneMap = new Map<string, { label: string; amount: number; count_projects: number }>();
  const byPhaseMap = new Map<string, { amount: number; count_projects: number }>();
  let total_reste_global = 0;
  let total_forfait_reel = 0;
  let total_deja_encaisse = 0;

  // KPIs "Confirmé" — sous-total sur les projets cochés (CEO 2026-08-17c)
  let confirmed_nb = 0;
  let confirmed_total = 0;

  // Ventilation mensuelle — CEO 2026-08-17c
  const byMonthMap = new Map<string, { amount_total: number; amount_confirmed: number; count_milestones: number; lines: ForecastMonthLine[] }>();

  for (const r of projects) {
    total_reste_global += r.reste_global;
    total_forfait_reel += r.forfait_reel;
    total_deja_encaisse += r.deja_encaisse;

    if (r.honoraires_confirmed) {
      confirmed_nb += 1;
      confirmed_total += r.reste_global;
    }

    for (const m of r.milestones_a_venir) {
      const cur = byMilestoneMap.get(m.type) ?? { label: m.label, amount: 0, count_projects: 0 };
      cur.amount += m.amount_a_percevoir;
      cur.count_projects += 1;
      byMilestoneMap.set(m.type, cur);

      if (m.forecast_month) {
        const bucket = byMonthMap.get(m.forecast_month)
          ?? { amount_total: 0, amount_confirmed: 0, count_milestones: 0, lines: [] as ForecastMonthLine[] };
        bucket.amount_total += m.amount_a_percevoir;
        bucket.count_milestones += 1;
        if (r.honoraires_confirmed) bucket.amount_confirmed += m.amount_a_percevoir;
        bucket.lines.push({
          project_id: r.project_id,
          reference: r.reference,
          client_name: r.client_name,
          current_phase: r.current_phase,
          milestone_type: m.type,
          milestone_label: m.label,
          amount: m.amount_a_percevoir,
          status: m.status,
          confirmed: r.honoraires_confirmed,
        });
        byMonthMap.set(m.forecast_month, bucket);
      }
    }
    const phase = r.current_phase ?? '—';
    const curPhase = byPhaseMap.get(phase) ?? { amount: 0, count_projects: 0 };
    curPhase.amount += r.reste_global;
    curPhase.count_projects += 1;
    byPhaseMap.set(phase, curPhase);
  }

  const by_milestone = STONIZ_FEE_SCHEDULE
    .map(m => {
      const entry = byMilestoneMap.get(m.type);
      if (!entry) return null;
      return { type: m.type, label: entry.label, amount: entry.amount, count_projects: entry.count_projects };
    })
    .filter(Boolean) as FeesBucketTotals['by_milestone'];

  const PHASE_ORDER = ['onboarding', 'sourcing', 'design', 'travaux', 'livraison', 'mise_en_location'];
  const by_phase = PHASE_ORDER
    .map(phase => {
      const entry = byPhaseMap.get(phase);
      if (!entry) return null;
      return { phase, amount: entry.amount, count_projects: entry.count_projects };
    })
    .filter(Boolean) as FeesBucketTotals['by_phase'];

  // Ventilation par mois triée chronologiquement (YYYY-MM se trie
  // naturellement en ordre lexicographique).
  const by_forecast_month = Array.from(byMonthMap.entries())
    .map(([month, v]) => ({
      month,
      amount_total: Math.round(v.amount_total * 100) / 100,
      amount_confirmed: Math.round(v.amount_confirmed * 100) / 100,
      count_milestones: v.count_milestones,
      // Plus gros montant en haut : c'est ce qui porte le mois.
      lines: v.lines.slice().sort((a, b) => b.amount - a.amount),
    }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    nb_projects: projects.length,
    total_reste_global,
    total_forfait_reel,
    total_deja_encaisse,
    by_milestone,
    by_phase,
    confirmed: {
      nb_projects: confirmed_nb,
      total_reste_global: Math.round(confirmed_total * 100) / 100,
    },
    by_forecast_month,
  };
}

export { STONIZ_FEES_TOTAL };
