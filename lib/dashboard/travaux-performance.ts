import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { LOST_STATUS } from '@/lib/projects/lost';

/**
 * Données performance travaux (CEO 2026-06-17).
 * Une seule passe BDD agrégeant chefs + artisans + Gantt + distribution marges.
 */

export type ChefPerf = {
  chef_id: string;
  chef_name: string;
  nb_actifs: number;
  nb_termines: number;
  volume_total_mad: number;
  marge_moyenne_pct: number;
  delai_moyen_jours: number | null;
  taux_livre_a_temps_pct: number | null;
};

export type ArtisanPerf = {
  artisan_id: string | null;
  artisan_name: string;
  nb_lots: number;
  volume_total_mad: number;
  marge_contribuee_mad: number;
  marge_pct: number;
  taux_retard_pct: number;
  doc_compliance_pct: number;
};

export type ProjectGanttRow = {
  id: string;
  reference: string;
  client: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  pct_avancement: number;
  is_overdue: boolean;
  chef_name: string | null;
};

export type MarginBucket = {
  label: string;
  range_min: number;
  range_max: number | null;
  count: number;
  total_mad: number;
};

export type TravauxPerformance = {
  chefs: ChefPerf[];
  artisans: ArtisanPerf[];
  gantt: ProjectGanttRow[];
  marginBuckets: MarginBucket[];
  monthlyDelay: { current: number | null; previous: number | null; deltaPct: number | null };
};

const TERMINAL = new Set(['terminé', 'termine', 'livre', 'livraison_terminee', 'livraison', 'cloture', 'clos']);

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

export async function collectTravauxPerformance(): Promise<TravauxPerformance> {
  const supabase = createClient();
  const todayIso = new Date().toISOString().slice(0, 10);

  const [projectsRes, lotsRes, paymentsRes] = await Promise.all([
    supabase.from('projects')
      .select('id, reference, status, current_phase, travaux_budget_mad, travaux_marge_cible_pct, travaux_start_date, travaux_end_date, livraison_date, assigned_chef_projet, client:clients(full_name), chef:profiles!projects_assigned_chef_projet_fkey(id, full_name)')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
    supabase.from('travaux_lots')
      .select('id, project_id, artisan_id, artisan_name, devis_artisan_mad, facture_client_mad, status, quote_doc_id')
      .is('deleted_at', null),
    supabase.from('travaux_payments')
      .select('id, project_id, lot_id, artisan_name, amount_total, amount_paid, scheduled_date, status, invoice_doc_id')
      .is('deleted_at', null),
  ]);

  const projects = (projectsRes.data ?? []) as any[];
  const allLots = (lotsRes.data ?? []) as any[];
  const allPayments = (paymentsRes.data ?? []) as any[];

  const lotsByProject = new Map<string, any[]>();
  const paymentsByProject = new Map<string, any[]>();
  for (const l of allLots) {
    const arr = lotsByProject.get(l.project_id) ?? []; arr.push(l); lotsByProject.set(l.project_id, arr);
  }
  for (const p of allPayments) {
    const arr = paymentsByProject.get(p.project_id) ?? []; arr.push(p); paymentsByProject.set(p.project_id, arr);
  }

  // ─── Chefs ──────────────────────────────────────────────────────────
  const chefMap = new Map<string, {
    chef_id: string; chef_name: string;
    nb_actifs: number; nb_termines: number;
    volume_total_mad: number;
    margePcts: number[];
    delais: number[];
    aTemps: number; total_avec_dates: number;
  }>();

  // ─── Artisans ──────────────────────────────────────────────────────
  const artisanMap = new Map<string, {
    artisan_id: string | null; artisan_name: string;
    nb_lots: number;
    volume_total_mad: number;
    marge_contribuee_mad: number;
    nb_retard: number; nb_acomptes: number;
    nb_avec_doc: number; nb_total_doc: number;
  }>();

  const gantt: ProjectGanttRow[] = [];
  const margins: number[] = []; // marges réelles MAD pour buckets
  const monthlyDurations: Array<{ duration: number; month: string }> = []; // pour évolution

  for (const p of projects) {
    const lots = lotsByProject.get(p.id) ?? [];
    const payments = paymentsByProject.get(p.id) ?? [];
    const isActive = p.status === 'actif' || (p.status && !TERMINAL.has(p.status));
    const isTerminal = TERMINAL.has(p.status ?? '');
    const forfait = Number(p.travaux_budget_mad ?? 0);
    const devisArtisans = lots.reduce((s: number, l: any) => s + Number(l.devis_artisan_mad ?? 0), 0);
    const factureClient = lots.reduce((s: number, l: any) => s + Number(l.facture_client_mad ?? 0), 0);
    const reference = forfait > 0 ? forfait : factureClient;
    const margeReelle = reference - devisArtisans;
    const margePct = reference > 0 ? (margeReelle / reference) * 100 : 0;
    if (reference > 0) margins.push(margeReelle);

    // Chef perf
    const chefId = p.assigned_chef_projet;
    if (chefId) {
      const chefName = p.chef?.full_name ?? 'Inconnu';
      let cur = chefMap.get(chefId);
      if (!cur) {
        cur = { chef_id: chefId, chef_name: chefName, nb_actifs: 0, nb_termines: 0, volume_total_mad: 0, margePcts: [], delais: [], aTemps: 0, total_avec_dates: 0 };
        chefMap.set(chefId, cur);
      }
      if (isActive) cur.nb_actifs++;
      if (isTerminal) cur.nb_termines++;
      cur.volume_total_mad += reference;
      if (reference > 0) cur.margePcts.push(margePct);
      if (isTerminal && p.travaux_start_date && p.travaux_end_date) {
        const d = daysBetween(p.travaux_start_date, p.travaux_end_date);
        if (d > 0 && d < 365 * 3) cur.delais.push(d);
        cur.total_avec_dates++;
        // À temps si end_date réel ≤ end_date prévu (on n'a que end_date prévu, donc on compare avec aujourd'hui pour les terminés)
        // Simplifié : si terminé sans dépasser today, on considère à temps.
        if (p.travaux_end_date >= todayIso) cur.aTemps++;
        monthlyDurations.push({ duration: d, month: p.travaux_end_date.slice(0, 7) });
      }
    }

    // Artisan perf (via lots)
    for (const lot of lots) {
      const key = lot.artisan_id ?? lot.artisan_name ?? 'unknown';
      let cur = artisanMap.get(key);
      if (!cur) {
        cur = {
          artisan_id: lot.artisan_id,
          artisan_name: lot.artisan_name ?? 'Inconnu',
          nb_lots: 0, volume_total_mad: 0, marge_contribuee_mad: 0,
          nb_retard: 0, nb_acomptes: 0, nb_avec_doc: 0, nb_total_doc: 0,
        };
        artisanMap.set(key, cur);
      }
      cur.nb_lots++;
      const lotDevis = Number(lot.devis_artisan_mad ?? 0);
      cur.volume_total_mad += lotDevis;
      // marge "contribuée" par lot = (facture/forfait) - devis artisan
      const lotFacture = Number(lot.facture_client_mad ?? 0);
      if (lotFacture > 0) cur.marge_contribuee_mad += lotFacture - lotDevis;
      if (lot.quote_doc_id) cur.nb_avec_doc++;
      cur.nb_total_doc++;
    }
    for (const pay of payments) {
      const key = (pay.artisan_name && allLots.find((l) => l.id === pay.lot_id)?.artisan_id)
        ?? pay.artisan_name ?? 'unknown';
      const cur = artisanMap.get(key);
      if (!cur) continue;
      cur.nb_acomptes++;
      if (pay.status === 'pending' && pay.scheduled_date && pay.scheduled_date < todayIso) {
        cur.nb_retard++;
      }
    }

    // Gantt — projets actifs avec dates
    // CEO 2026-07-13 : un chantier livré (livraison_date renseignée OU phase
    // post-travaux) n'est pas "en retard" même si travaux_end_date < today.
    // Aligné sur lib/dashboard/travaux-ops-alerts.ts.
    const POST_TRAVAUX_PHASES_GANTT = new Set(['livraison', 'mise_en_location', 'termine']);
    const isDelivered = !!p.livraison_date || POST_TRAVAUX_PHASES_GANTT.has(p.current_phase ?? '');
    if (isActive && (p.travaux_start_date || p.travaux_end_date)) {
      const lotsTermines = lots.filter((l: any) => l.status === 'termine').length;
      const pctAvancement = lots.length > 0 ? Math.round((lotsTermines / lots.length) * 100) : 0;
      gantt.push({
        id: p.id,
        reference: p.reference ?? '—',
        client: p.client?.full_name ?? '—',
        status: p.status ?? 'actif',
        start_date: p.travaux_start_date,
        end_date: p.travaux_end_date,
        pct_avancement: pctAvancement,
        is_overdue: !isDelivered && !!(p.travaux_end_date && p.travaux_end_date < todayIso),
        chef_name: p.chef?.full_name ?? null,
      });
    }
  }

  // Tri Gantt : projets en retard d'abord, puis par date début
  gantt.sort((a, b) => {
    if (a.is_overdue !== b.is_overdue) return a.is_overdue ? -1 : 1;
    return (a.start_date ?? '').localeCompare(b.start_date ?? '');
  });

  // ─── Buckets de marge (histogramme) ────────────────────────────────
  const ranges: Array<{ label: string; min: number; max: number | null }> = [
    { label: '< 0', min: -Infinity, max: 0 },
    { label: '0–25k', min: 0, max: 25_000 },
    { label: '25k–50k', min: 25_000, max: 50_000 },
    { label: '50k–100k', min: 50_000, max: 100_000 },
    { label: '100k–200k', min: 100_000, max: 200_000 },
    { label: '200k+', min: 200_000, max: null },
  ];
  const marginBuckets: MarginBucket[] = ranges.map((r) => ({
    label: r.label, range_min: r.min, range_max: r.max,
    count: 0, total_mad: 0,
  }));
  for (const m of margins) {
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      const inRange = m >= r.min && (r.max == null || m < r.max);
      if (inRange) { marginBuckets[i].count++; marginBuckets[i].total_mad += m; break; }
    }
  }

  // ─── Délai moyen mois en cours vs mois précédent ───────────────────
  const now = new Date();
  const currentMonth = now.toISOString().slice(0, 7);
  const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = prevMonthDate.toISOString().slice(0, 7);
  const curDurations = monthlyDurations.filter((d) => d.month === currentMonth).map((d) => d.duration);
  const prevDurations = monthlyDurations.filter((d) => d.month === prevMonth).map((d) => d.duration);
  const avg = (arr: number[]) => arr.length === 0 ? null : Math.round(arr.reduce((s, x) => s + x, 0) / arr.length);
  const current = avg(curDurations);
  const previous = avg(prevDurations);
  const deltaPct = current != null && previous != null && previous > 0
    ? Math.round(((current - previous) / previous) * 100)
    : null;

  // Finalisation chefs
  const chefs: ChefPerf[] = Array.from(chefMap.values()).map((c) => ({
    chef_id: c.chef_id,
    chef_name: c.chef_name,
    nb_actifs: c.nb_actifs,
    nb_termines: c.nb_termines,
    volume_total_mad: c.volume_total_mad,
    marge_moyenne_pct: c.margePcts.length > 0
      ? Math.round((c.margePcts.reduce((s, x) => s + x, 0) / c.margePcts.length) * 10) / 10
      : 0,
    delai_moyen_jours: c.delais.length > 0
      ? Math.round(c.delais.reduce((s, x) => s + x, 0) / c.delais.length)
      : null,
    taux_livre_a_temps_pct: c.total_avec_dates > 0
      ? Math.round((c.aTemps / c.total_avec_dates) * 100)
      : null,
  })).sort((a, b) => b.volume_total_mad - a.volume_total_mad);

  // Finalisation artisans (top 20 par volume)
  const artisans: ArtisanPerf[] = Array.from(artisanMap.values()).map((a) => ({
    artisan_id: a.artisan_id,
    artisan_name: a.artisan_name,
    nb_lots: a.nb_lots,
    volume_total_mad: a.volume_total_mad,
    marge_contribuee_mad: a.marge_contribuee_mad,
    marge_pct: a.volume_total_mad > 0
      ? Math.round((a.marge_contribuee_mad / a.volume_total_mad) * 1000) / 10
      : 0,
    taux_retard_pct: a.nb_acomptes > 0
      ? Math.round((a.nb_retard / a.nb_acomptes) * 100)
      : 0,
    doc_compliance_pct: a.nb_total_doc > 0
      ? Math.round((a.nb_avec_doc / a.nb_total_doc) * 100)
      : 0,
  })).sort((a, b) => b.volume_total_mad - a.volume_total_mad).slice(0, 30);

  return {
    chefs, artisans, gantt, marginBuckets,
    monthlyDelay: { current, previous, deltaPct },
  };
}
