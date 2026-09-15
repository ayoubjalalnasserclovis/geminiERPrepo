import 'server-only';
import { createClient } from '@/lib/supabase/server';

/**
 * Collecte les KPIs de performance sourcing (CEO 2026-06-17 v2).
 *
 * Sources de vérité :
 *   - Visites : table property_visits
 *   - Offres : table project_offers
 *   - Compromis : projects.compromis_date (vu comme la "vente" — peu de churn après compromis)
 *   - Sourcing : properties.sourcing_date (ou created_at en fallback)
 *
 * Délai total : sourcing_date → compromis_date.
 * Âge pipeline & dormants : basés sur la dernière action MÉTIER (visite, offre, compromis),
 *   pas sur updated_at qui change à chaque édition triviale.
 */

export type WeeklyPoint = { week: string; count: number; weekStart: string };
export type FunnelStep = { label: string; count: number; pct: number };
export type DelayStat = { label: string; medianDays: number | null; n: number };
export type PartnerPerf = {
  id: string;
  agency_name: string;
  sourced: number;
  visited: number;
  offered: number;
  compromised: number;
  sold: number;
  hitRatePct: number | null;
  avgDelayDays: number | null;
};
export type SegmentPerf = {
  key: string;
  total: number;
  visited: number;
  offered: number;
  sold: number;
  conversionPct: number;
};
export type DormantProperty = {
  id: string;
  name: string;
  status: string;
  daysSinceLastEvent: number;
  partner_name?: string;
};
export type IncompleteProperty = {
  id: string;
  name: string;
  missingFields: string[];
};

export type SourcingPerformance = {
  weeklySourced: WeeklyPoint[];
  weeklyNewPartners: WeeklyPoint[];
  funnel: FunnelStep[];
  delays: DelayStat[];
  topPartners: PartnerPerf[];
  byType: SegmentPerf[];
  byQuartier: SegmentPerf[];
  bySourcingType: SegmentPerf[];
  dormants: DormantProperty[];
  incompletes: IncompleteProperty[];   // ← bandeau "biens à compléter"
  totals: {
    totalProperties: number;
    activePipeline: number;
    avgPipelineAgeDays: number | null;
    medianTotalDelayDays: number | null;
  };
};

function isoMonday(d: Date): Date {
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const r = new Date(d);
  r.setUTCDate(d.getUTCDate() + diff);
  r.setUTCHours(0, 0, 0, 0);
  return r;
}

function weekLabel(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function median(arr: number[]): number | null {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const d = (new Date(b).getTime() - new Date(a).getTime()) / 86_400_000;
  return Number.isFinite(d) && d >= 0 ? d : null;
}

const TERMINAL_STATUSES = new Set(['vendu', 'perdu']);

export async function collectSourcingPerformance(): Promise<SourcingPerformance> {
  const supabase = createClient();
  const now = new Date();
  const twelveWeeksAgo = new Date(now);
  twelveWeeksAgo.setUTCDate(twelveWeeksAgo.getUTCDate() - 12 * 7);

  // Une seule passe BDD : on tire tout ce dont on a besoin
  const [propsRes, partnersRes, projectsRes, visitsRes, offersRes] = await Promise.all([
    supabase.from('properties').select(
      'id, name, status, created_at, updated_at, sourcing_date, sourced_by, sourcing_type, partner_id, type, quartier'
    ).is('deleted_at', null),
    supabase.from('partners').select(
      'id, agency_name, status, created_at, last_contact_at'
    ).is('deleted_at', null),
    supabase.from('projects').select(
      'id, property_id, compromis_date'
    ).is('deleted_at', null).not('property_id', 'is', null),
    supabase.from('property_visits').select(
      'id, property_id, visited_at'
    ).is('deleted_at', null),
    supabase.from('project_offers').select(
      'id, property_id, project_id, offer_date, status'
    ).is('deleted_at', null),
  ]);

  const properties = (propsRes.data ?? []) as any[];
  const partners = (partnersRes.data ?? []) as any[];
  const projects = (projectsRes.data ?? []) as any[];
  const visits = (visitsRes.data ?? []) as any[];
  const offers = (offersRes.data ?? []) as any[];

  // ─── Index : property_id → données métier ──────────────────────────────
  const visitsByProp = new Map<string, any[]>();
  for (const v of visits) {
    const arr = visitsByProp.get(v.property_id) ?? [];
    arr.push(v);
    visitsByProp.set(v.property_id, arr);
  }
  const offersByProp = new Map<string, any[]>();
  for (const o of offers) {
    const arr = offersByProp.get(o.property_id) ?? [];
    arr.push(o);
    offersByProp.set(o.property_id, arr);
  }
  const compromisByProp = new Map<string, string>();
  for (const pr of projects) {
    if (pr.property_id && pr.compromis_date && !compromisByProp.has(pr.property_id)) {
      compromisByProp.set(pr.property_id, pr.compromis_date);
    }
  }

  // ─── Évolution hebdo (12 dernières semaines) ─────────────────────────
  function buildWeekly(rows: any[], dateField: string): WeeklyPoint[] {
    const buckets = new Map<string, number>();
    const startMonday = isoMonday(twelveWeeksAgo);
    for (let i = 0; i < 12; i++) {
      const wkStart = new Date(startMonday);
      wkStart.setUTCDate(startMonday.getUTCDate() + i * 7);
      const key = wkStart.toISOString().slice(0, 10);
      buckets.set(key, 0);
    }
    for (const row of rows) {
      const date = row[dateField];
      if (!date) continue;
      const d = new Date(date);
      if (d < twelveWeeksAgo) continue;
      const monday = isoMonday(d);
      const key = monday.toISOString().slice(0, 10);
      if (buckets.has(key)) {
        buckets.set(key, (buckets.get(key) ?? 0) + 1);
      }
    }
    return Array.from(buckets.entries()).map(([weekStart, count]) => ({
      weekStart,
      week: weekLabel(new Date(weekStart)),
      count,
    }));
  }

  const propsForWeekly = properties.map((p) => ({
    ...p,
    _effectiveSourcing: p.sourcing_date ?? p.created_at,
  }));
  const weeklySourced = buildWeekly(propsForWeekly, '_effectiveSourcing');
  const weeklyNewPartners = buildWeekly(partners, 'created_at');

  // ─── Entonnoir (nouvelles sources) ────────────────────────────────────
  const total = properties.length;
  const visited = properties.filter((p) => (visitsByProp.get(p.id)?.length ?? 0) > 0).length;
  const offered = properties.filter((p) => (offersByProp.get(p.id)?.length ?? 0) > 0).length;
  const compromised = properties.filter((p) => compromisByProp.has(p.id)).length;
  // "Vendus" = compromis signé (cf. décision CEO 2026-06-17 : peu de churn post-compromis)
  const sold = compromised;

  const funnel: FunnelStep[] = [
    { label: 'Sourcés', count: total, pct: 100 },
    { label: 'Visités', count: visited, pct: total ? Math.round((visited / total) * 100) : 0 },
    { label: 'Offre envoyée', count: offered, pct: total ? Math.round((offered / total) * 100) : 0 },
    { label: 'Compromis signé', count: compromised, pct: total ? Math.round((compromised / total) * 100) : 0 },
    { label: 'Vente actée', count: sold, pct: total ? Math.round((sold / total) * 100) : 0 },
  ];

  // ─── Délais médians par étape ────────────────────────────────────────
  const d_sourcing_visite: number[] = [];
  const d_visite_offre: number[] = [];
  const d_offre_compromis: number[] = [];
  const d_total: number[] = [];

  for (const p of properties) {
    const sourceDate = p.sourcing_date ?? p.created_at;
    const propVisits = visitsByProp.get(p.id) ?? [];
    const propOffers = offersByProp.get(p.id) ?? [];
    const firstVisit = propVisits.length > 0
      ? propVisits.map((v) => v.visited_at).sort()[0]
      : null;
    const firstOffer = propOffers.length > 0
      ? propOffers.map((o) => o.offer_date).sort()[0]
      : null;
    const compDate = compromisByProp.get(p.id);

    const sv = daysBetween(sourceDate, firstVisit);
    if (sv != null) d_sourcing_visite.push(sv);
    const vo = daysBetween(firstVisit, firstOffer);
    if (vo != null) d_visite_offre.push(vo);
    const oc = daysBetween(firstOffer, compDate);
    if (oc != null) d_offre_compromis.push(oc);
    // Délai total : sourcing → compromis (CEO 2026-06-17)
    const tot = daysBetween(sourceDate, compDate);
    if (tot != null) d_total.push(tot);
  }

  const delays: DelayStat[] = [
    { label: 'Sourcing → 1ère visite', medianDays: median(d_sourcing_visite), n: d_sourcing_visite.length },
    { label: '1ère visite → Offre', medianDays: median(d_visite_offre), n: d_visite_offre.length },
    { label: 'Offre → Compromis', medianDays: median(d_offre_compromis), n: d_offre_compromis.length },
  ];

  // ─── Performance par partenaire ──────────────────────────────────────
  const partnerStats = new Map<string, { sourced: number; visited: number; offered: number; compromised: number; sold: number; delays: number[] }>();
  for (const p of properties) {
    if (!p.partner_id) continue;
    const s = partnerStats.get(p.partner_id) ?? {
      sourced: 0, visited: 0, offered: 0, compromised: 0, sold: 0, delays: [] as number[],
    };
    s.sourced++;
    if ((visitsByProp.get(p.id)?.length ?? 0) > 0) s.visited++;
    if ((offersByProp.get(p.id)?.length ?? 0) > 0) s.offered++;
    const compDate = compromisByProp.get(p.id);
    if (compDate) {
      s.compromised++;
      s.sold++;
      const dy = daysBetween(p.sourcing_date ?? p.created_at, compDate);
      if (dy != null) s.delays.push(dy);
    }
    partnerStats.set(p.partner_id, s);
  }
  const partnersMap = new Map(partners.map((p: any) => [p.id, p]));
  const topPartners: PartnerPerf[] = Array.from(partnerStats.entries())
    .map(([id, s]) => {
      const partner = partnersMap.get(id);
      return {
        id,
        agency_name: partner?.agency_name ?? '—',
        sourced: s.sourced,
        visited: s.visited,
        offered: s.offered,
        compromised: s.compromised,
        sold: s.sold,
        hitRatePct: s.offered > 0 ? Math.round((s.sold / s.offered) * 100) : null,
        avgDelayDays: s.delays.length > 0
          ? Math.round(s.delays.reduce((a, b) => a + b, 0) / s.delays.length)
          : null,
      };
    })
    .sort((a, b) => b.sold - a.sold || b.sourced - a.sourced)
    .slice(0, 15);

  // ─── Performance par segment ─────────────────────────────────────────
  function bySegment(field: string): SegmentPerf[] {
    const segments = new Map<string, { total: number; visited: number; offered: number; sold: number }>();
    for (const p of properties) {
      const key = (p[field] ?? '— non renseigné').toString();
      const s = segments.get(key) ?? { total: 0, visited: 0, offered: 0, sold: 0 };
      s.total++;
      if ((visitsByProp.get(p.id)?.length ?? 0) > 0) s.visited++;
      if ((offersByProp.get(p.id)?.length ?? 0) > 0) s.offered++;
      if (compromisByProp.has(p.id)) s.sold++;
      segments.set(key, s);
    }
    return Array.from(segments.entries())
      .map(([key, s]) => ({
        key,
        ...s,
        conversionPct: s.total > 0 ? Math.round((s.sold / s.total) * 100) : 0,
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }

  const byType = bySegment('type');
  const byQuartier = bySegment('quartier');
  const bySourcingType = bySegment('sourcing_type');

  // ─── Vieillissement : basé sur la DERNIÈRE ACTION MÉTIER ─────────────
  // Plus updated_at (qui change à chaque édition triviale).
  // Sources d'activité : visites, offres, compromis, sourcing_date, created_at.
  const dormants: DormantProperty[] = [];
  const pipelineAges: number[] = [];
  for (const p of properties) {
    if (TERMINAL_STATUSES.has(p.status) || compromisByProp.has(p.id)) continue;

    const propVisits = visitsByProp.get(p.id) ?? [];
    const propOffers = offersByProp.get(p.id) ?? [];
    const lastVisit = propVisits.length > 0
      ? propVisits.map((v) => v.visited_at).sort().reverse()[0]
      : null;
    const lastOffer = propOffers.length > 0
      ? propOffers.map((o) => o.offer_date).sort().reverse()[0]
      : null;
    const lastEvent = [lastOffer, lastVisit, p.sourcing_date, p.created_at]
      .filter((x): x is string => !!x)
      .sort()
      .reverse()[0];
    if (!lastEvent) continue;

    const daysSince = Math.round((now.getTime() - new Date(lastEvent).getTime()) / 86_400_000);
    pipelineAges.push(daysSince);
    if (daysSince > 60) {
      const partner = p.partner_id ? partnersMap.get(p.partner_id) : null;
      dormants.push({
        id: p.id,
        name: p.name ?? '—',
        status: p.status,
        daysSinceLastEvent: daysSince,
        partner_name: partner?.agency_name,
      });
    }
  }
  dormants.sort((a, b) => b.daysSinceLastEvent - a.daysSinceLastEvent);

  const avgPipelineAgeDays = pipelineAges.length > 0
    ? Math.round(pipelineAges.reduce((a, b) => a + b, 0) / pipelineAges.length)
    : null;

  // ─── Bandeau "biens à compléter" ─────────────────────────────────────
  const incompletes: IncompleteProperty[] = [];
  for (const p of properties) {
    if (TERMINAL_STATUSES.has(p.status) || compromisByProp.has(p.id)) continue;
    const missing: string[] = [];
    if (!p.type) missing.push('type');
    if (!p.quartier) missing.push('quartier');
    if (!p.sourcing_type) missing.push('canal de sourcing');
    if (missing.length > 0) {
      incompletes.push({ id: p.id, name: p.name ?? '—', missingFields: missing });
    }
  }
  incompletes.sort((a, b) => b.missingFields.length - a.missingFields.length);

  return {
    weeklySourced,
    weeklyNewPartners,
    funnel,
    delays,
    topPartners,
    byType,
    byQuartier,
    bySourcingType,
    dormants: dormants.slice(0, 30),
    incompletes: incompletes.slice(0, 50),
    totals: {
      totalProperties: total,
      activePipeline: properties.filter((p) => !TERMINAL_STATUSES.has(p.status) && !compromisByProp.has(p.id)).length,
      avgPipelineAgeDays,
      medianTotalDelayDays: median(d_total),
    },
  };
}
