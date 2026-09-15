import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LOST_STATUS } from '@/lib/projects/lost';

/**
 * Collecte les alertes opérationnelles travaux pour le dashboard CEO
 * (CEO 2026-06-17). Une seule passe BDD agrégeant tout pour minimiser le
 * coût réseau.
 *
 * Output :
 *   - timeAtRisk : chantiers actifs > 90j ou en retard sur date prévue de fin
 *   - artisanDueSoon : acomptes artisans à payer dans 30j + retards
 *   - anomalies : sur-paiement artisan, sur-encaissement client, projets en perte
 *   - dataIncomplete : projets sans forfait / sans chef / sans dates
 *   - avgDelayDays : délai moyen historique (sur projets clos)
 */

type ProjectRow = {
  id: string;
  reference: string;
  client_name: string;
  amount_mad?: number;
  detail?: string;
  href: string;
};

export type TravauxOpsAlerts = {
  timeAtRisk: { older90: ProjectRow[]; overdue: ProjectRow[] };
  artisanDueSoon: { retard: ProjectRow[]; venir: ProjectRow[]; totalRetardMad: number; totalVenirMad: number };
  anomalies: {
    surPaiement: ProjectRow[];   // amount_paid > amount_total
    surEncaissement: ProjectRow[]; // total_encaisse > forfait vendu
    perte: ProjectRow[];         // marge réelle < 0
  };
  dataIncomplete: {
    sansForfait: ProjectRow[];
    sansChef: ProjectRow[];
    sansDates: ProjectRow[];
  };
  avgDelayDays: number | null;
  totalActifs: number;
};

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

const TERMINAL_STATUSES = new Set(['terminé', 'termine', 'livre', 'livraison_terminee', 'livraison', 'cloture', 'clos', 'archived', 'archive']);

/**
 * Phases où on attend déjà des données chantier (dates, forfait).
 * Avant ces phases (sourcing, onboarding, design) c'est normal qu'elles
 * soient vides — pas d'alerte (CEO 2026-06-17).
 */
const PHASES_CHANTIER_ATTENDU = new Set(['travaux', 'mise_en_location', 'termine']);

export async function collectTravauxOpsAlerts(): Promise<TravauxOpsAlerts> {
  const supabase = createClient();
  const todayIso = new Date().toISOString().slice(0, 10);
  const j30Iso = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  // Pull projets + lots + payments + encaissements
  const [projectsRes, lotsRes, paymentsRes, encaissementsRes] = await Promise.all([
    supabase.from('projects')
      .select('id, reference, status, current_phase, assigned_chef_projet, travaux_budget_mad, travaux_start_date, travaux_end_date, livraison_date, client:clients(full_name), chef:profiles!projects_assigned_chef_projet_fkey(full_name)')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
    supabase.from('travaux_lots')
      .select('id, project_id, devis_artisan_mad, facture_client_mad, status, artisan_name, deleted_at')
      .is('deleted_at', null),
    supabase.from('travaux_payments')
      .select('id, project_id, lot_id, artisan_name, amount_total, amount_paid, scheduled_date, paid_at, status, deleted_at')
      .is('deleted_at', null),
    supabase.from('travaux_encaissements')
      .select('id, project_id, amount_mad, status, deleted_at')
      .is('deleted_at', null),
  ]);

  const projects = (projectsRes.data ?? []) as any[];
  const allLots = (lotsRes.data ?? []) as any[];
  const allPayments = (paymentsRes.data ?? []) as any[];
  const allEncs = (encaissementsRes.data ?? []) as any[];

  // Index par projet
  const lotsByProject = new Map<string, any[]>();
  const paymentsByProject = new Map<string, any[]>();
  const encsByProject = new Map<string, any[]>();
  for (const l of allLots) {
    const arr = lotsByProject.get(l.project_id) ?? [];
    arr.push(l); lotsByProject.set(l.project_id, arr);
  }
  for (const p of allPayments) {
    const arr = paymentsByProject.get(p.project_id) ?? [];
    arr.push(p); paymentsByProject.set(p.project_id, arr);
  }
  for (const e of allEncs) {
    const arr = encsByProject.get(e.project_id) ?? [];
    arr.push(e); encsByProject.set(e.project_id, arr);
  }

  // Buckets
  const timeAtRisk: TravauxOpsAlerts['timeAtRisk'] = { older90: [], overdue: [] };
  const anomalies: TravauxOpsAlerts['anomalies'] = { surPaiement: [], surEncaissement: [], perte: [] };
  const dataIncomplete: TravauxOpsAlerts['dataIncomplete'] = { sansForfait: [], sansChef: [], sansDates: [] };
  const artisanDueSoonItems: Array<ProjectRow & { isRetard: boolean }> = [];
  let totalActifs = 0;
  const durations: number[] = []; // pour le délai moyen

  for (const p of projects) {
    const isActive = p.status === 'actif' || (p.status && !TERMINAL_STATUSES.has(p.status));
    if (isActive) totalActifs++;

    // CEO 2026-07-13 : un projet peut rester status='actif' (Propria le gère
    // après livraison) tout en ayant son chantier terminé. On ne veut pas
    // qu'il apparaisse dans "en retard sur date prévue" ni "lancé > 90j" dans
    // ce cas — il n'est plus un chantier en cours.
    // Sources de vérité :
    //   - livraison_date renseignée (chantier livré factuellement)
    //   - current_phase ∈ {livraison, mise_en_location, termine} : toutes les
    //     phases post-travaux dans l'ordre canonique du cycle de vie
    //     (cf. lib/projects/lifecycle-kpis.ts LIFECYCLE_PHASES).
    const POST_TRAVAUX_PHASES = new Set(['livraison', 'mise_en_location', 'termine']);
    const isDelivered = !!p.livraison_date || POST_TRAVAUX_PHASES.has(p.current_phase ?? '');

    const ref = p.reference ?? '—';
    const clientName = p.client?.full_name ?? '—';
    const row = (extra: Partial<ProjectRow> = {}): ProjectRow => ({
      id: p.id, reference: ref, client_name: clientName,
      href: `/projects/${p.id}/travaux`,
      ...extra,
    });
    const lots = lotsByProject.get(p.id) ?? [];
    const payments = paymentsByProject.get(p.id) ?? [];
    const encs = encsByProject.get(p.id) ?? [];
    const hasActivity = lots.length > 0 || payments.length > 0 || encs.some((e) => Number(e.amount_mad) > 0);

    // ─── Délai moyen (sur projets terminés avec dates) ────────────────────
    if (
      TERMINAL_STATUSES.has(p.status ?? '') &&
      p.travaux_start_date && p.travaux_end_date
    ) {
      const d = daysBetween(p.travaux_start_date, p.travaux_end_date);
      if (d > 0 && d < 365 * 3) durations.push(d);
    }

    // ─── Time at risk ────────────────────────────────────────────────────
    // Skip les projets livrés / phase termine : le chantier n'est plus en cours
    // même si status='actif' (Propria continue derrière).
    if (isActive && !isDelivered && hasActivity && p.travaux_start_date) {
      const ageDays = daysBetween(p.travaux_start_date, todayIso);
      if (ageDays > 90) {
        timeAtRisk.older90.push(row({ detail: `${ageDays} jours depuis lancement` }));
      }
    }
    if (isActive && !isDelivered && hasActivity && p.travaux_end_date && p.travaux_end_date < todayIso) {
      const retardJ = daysBetween(p.travaux_end_date, todayIso);
      timeAtRisk.overdue.push(row({ detail: `Retard ${retardJ}j sur date prévue ${p.travaux_end_date}` }));
    }

    // ─── Anomalies financières ───────────────────────────────────────────
    const devisArtisans = lots.reduce((s, l) => s + Number(l.devis_artisan_mad ?? 0), 0);
    const factureClient = lots.reduce((s, l) => s + Number(l.facture_client_mad ?? 0), 0);
    const totalPaye = payments.reduce((s, pay) => s + Number(pay.amount_paid ?? 0), 0);
    const totalEncaisse = encs
      .filter((e) => (e.status ?? 'recu') === 'recu')
      .reduce((s, e) => s + Number(e.amount_mad ?? 0), 0);
    const forfait = Number(p.travaux_budget_mad ?? 0);
    const reference = forfait > 0 ? forfait : factureClient;
    const margeReelle = reference - devisArtisans;

    if (totalPaye > devisArtisans + 0.5 && devisArtisans > 0) {
      anomalies.surPaiement.push(row({
        amount_mad: totalPaye - devisArtisans,
        detail: `Payé ${Math.round(totalPaye)} MAD vs devis ${Math.round(devisArtisans)} MAD`,
      }));
    }
    if (totalEncaisse > reference + 0.5 && reference > 0) {
      anomalies.surEncaissement.push(row({
        amount_mad: totalEncaisse - reference,
        detail: `Encaissé ${Math.round(totalEncaisse)} MAD vs forfait ${Math.round(reference)} MAD`,
      }));
    }
    if (margeReelle < 0 && (devisArtisans > 0 || reference > 0) && hasActivity && isActive) {
      anomalies.perte.push(row({
        amount_mad: Math.abs(margeReelle),
        detail: `Marge réelle ${Math.round(margeReelle)} MAD`,
      }));
    }

    // ─── Data incomplete ─────────────────────────────────────────────────
    // CEO 2026-06-17 : on n'alerte sur dates chantier / forfait que si le
    // projet est en phase travaux ou après. En phase sourcing/onboarding/
    // design c'est normal de ne pas encore avoir ces données.
    const inChantierPhase = PHASES_CHANTIER_ATTENDU.has(p.current_phase ?? '');

    if (isActive && hasActivity && forfait === 0 && inChantierPhase) {
      dataIncomplete.sansForfait.push(row({ detail: 'Forfait vendu non renseigné — calculs en mode repli' }));
    }
    if (isActive && !p.assigned_chef_projet) {
      dataIncomplete.sansChef.push(row({ detail: 'Pas de chef de projet assigné' }));
    }
    if (isActive && inChantierPhase && (!p.travaux_start_date || !p.travaux_end_date)) {
      const missing = [];
      if (!p.travaux_start_date) missing.push('date de début');
      if (!p.travaux_end_date) missing.push('date de fin');
      dataIncomplete.sansDates.push(row({ detail: `Phase ${p.current_phase} · manque ${missing.join(' + ')}` }));
    }

    // ─── Acomptes artisans à payer (retard + à venir 30j) ────────────────
    for (const pay of payments) {
      if (pay.status === 'paid') continue;
      if (!pay.scheduled_date) continue;
      if (pay.scheduled_date < todayIso) {
        artisanDueSoonItems.push({
          ...row({
            amount_mad: Number(pay.amount_total ?? 0),
            detail: `${pay.artisan_name ?? 'Artisan'} · échéance ${pay.scheduled_date}`,
          }),
          isRetard: true,
        });
      } else if (pay.scheduled_date <= j30Iso) {
        artisanDueSoonItems.push({
          ...row({
            amount_mad: Number(pay.amount_total ?? 0),
            detail: `${pay.artisan_name ?? 'Artisan'} · échéance ${pay.scheduled_date}`,
          }),
          isRetard: false,
        });
      }
    }
  }

  // Tri
  artisanDueSoonItems.sort((a, b) => (a.detail ?? '').localeCompare(b.detail ?? ''));
  const retard = artisanDueSoonItems.filter((x) => x.isRetard).map(({ isRetard, ...r }) => r);
  const venir = artisanDueSoonItems.filter((x) => !x.isRetard).map(({ isRetard, ...r }) => r);
  const totalRetardMad = retard.reduce((s, x) => s + (x.amount_mad ?? 0), 0);
  const totalVenirMad = venir.reduce((s, x) => s + (x.amount_mad ?? 0), 0);

  const avgDelayDays = durations.length > 0
    ? Math.round(durations.reduce((s, x) => s + x, 0) / durations.length)
    : null;

  return {
    timeAtRisk,
    artisanDueSoon: { retard, venir, totalRetardMad, totalVenirMad },
    anomalies,
    dataIncomplete,
    avgDelayDays,
    totalActifs,
  };
}
