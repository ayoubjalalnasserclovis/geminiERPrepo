import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PropriaCarteMap } from '@/components/propria/carte-map';
import type { CarteLot, CarteProperty } from '@/components/propria/carte-types';

/**
 * Vue Carte des lots Propria (CHANTIER 10 — marathon Propria).
 *
 * Deux niveaux : Projet (1 marqueur par bien) / Logement (1 marqueur par lot).
 * Tous les KPI sont DÉRIVÉS ici, server-side, depuis les sources :
 *   - CA mois en cours + CA 12 mois : hostaway_reservations.total_price,
 *     réparti au prorata des nuits (même canon que la vue
 *     v_propria_listing_monthly_performance), statuts 'new'/'modified'.
 *   - Note moyenne : hostaway_reviews.rating_normalized (toujours /5).
 *   - Occupation 30 j : nuits occupées / 30.
 *   - Dernier ménage clôturé : propria_cleanings (status 'cloture').
 *   - Dernier audit qualité : module check-up pas encore livré → « — ».
 * Rien n'est stocké : la page recalcule à chaque rendu.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function toUtcDay(iso: string): number {
  // Date ISO 'YYYY-MM-DD' → index de jour UTC (entier).
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
}

export default async function PropriaCartePage() {
  const user = await requireRole(['ceo', 'developer', 'assistante', 'propria']);
  const supabase = createClient();

  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const today = toUtcDay(todayIso);
  const monthStart = toUtcDay(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`,
  );
  const d365 = today - 365;
  const d30 = today - 30;
  const d365Iso = new Date(d365 * DAY_MS).toISOString().slice(0, 10);

  const [propsRes, unitsRes, listingsRes, resasRes, reviewsRes, cleaningsRes] =
    await Promise.all([
      supabase
        .from('properties')
        .select('id, name, propria_internal_code, quartier, latitude, longitude')
        .not('propria_managed_at', 'is', null)
        .is('deleted_at', null)
        .order('name'),
      supabase
        .from('propria_units')
        .select('id, code, property_id')
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code'),
      supabase
        .from('hostaway_listings')
        .select('id, propria_unit_id')
        .not('propria_unit_id', 'is', null)
        .is('deleted_at', null),
      // Résas chevauchant les 12 derniers mois (+ futures pour le statut du jour).
      supabase
        .from('hostaway_reservations')
        .select('hostaway_listing_db_id, arrival_date, departure_date, nights, status, total_price, currency')
        .in('status', ['new', 'modified'])
        .not('hostaway_listing_db_id', 'is', null)
        .is('deleted_at', null)
        .gte('departure_date', d365Iso)
        .limit(5000),
      supabase
        .from('hostaway_reviews')
        .select('propria_unit_id, hostaway_listing_db_id, rating_normalized')
        .not('rating_normalized', 'is', null)
        .is('deleted_at', null)
        .limit(5000),
      supabase
        .from('propria_cleanings')
        .select('propria_unit_id, occurred_at')
        .eq('status', 'cloture')
        .not('propria_unit_id', 'is', null)
        .is('deleted_at', null)
        .order('occurred_at', { ascending: false })
        .limit(5000),
    ]);

  const properties = propsRes.data ?? [];
  const propertyIds = new Set(properties.map((p: any) => p.id));
  const units = (unitsRes.data ?? []).filter((u: any) => propertyIds.has(u.property_id));

  // listing Hostaway (uuid) → lot
  const listingToUnit = new Map<string, string>();
  for (const l of listingsRes.data ?? []) {
    if ((l as any).propria_unit_id) listingToUnit.set((l as any).id, (l as any).propria_unit_id);
  }

  // ─── KPI par lot, tout dérivé en mémoire ────────────────────────────────
  type Acc = {
    caMonth: number; ca12m: number; currency: string | null;
    occupiedNights30: Set<number>; nbResas12m: number; occupiedToday: boolean;
    ratingSum: number; nbReviews: number; lastCleaning: string | null;
    hasListing: boolean;
  };
  const acc = new Map<string, Acc>();
  const getAcc = (unitId: string): Acc => {
    let a = acc.get(unitId);
    if (!a) {
      a = {
        caMonth: 0, ca12m: 0, currency: null,
        occupiedNights30: new Set(), nbResas12m: 0, occupiedToday: false,
        ratingSum: 0, nbReviews: 0, lastCleaning: null, hasListing: false,
      };
      acc.set(unitId, a);
    }
    return a;
  };
  for (const unitId of Array.from(listingToUnit.values())) getAcc(unitId).hasListing = true;

  for (const r of (resasRes.data ?? []) as any[]) {
    const unitId = listingToUnit.get(r.hostaway_listing_db_id);
    if (!unitId) continue;
    const a = getAcc(unitId);
    const arrival = toUtcDay(r.arrival_date);
    const departure = toUtcDay(r.departure_date);
    if (departure <= arrival) continue;
    const span = departure - arrival;
    const nightsCount = Math.max(Number(r.nights ?? 0), span);
    const pricePerNight = Number(r.total_price ?? 0) / (nightsCount || 1);
    if (!a.currency && r.currency) a.currency = r.currency;
    // Prorata nuit par nuit (même canon que la vue performance mensuelle).
    for (let night = arrival; night < departure; night++) {
      if (night >= monthStart && night <= today + 31) {
        // CA du mois en cours : toutes les nuits du mois (passées + à venir).
        const nightDate = new Date(night * DAY_MS);
        const sameMonth =
          nightDate.getUTCFullYear() === now.getUTCFullYear() &&
          nightDate.getUTCMonth() === now.getUTCMonth();
        if (sameMonth) a.caMonth += pricePerNight;
      }
      if (night >= d365 && night <= today) a.ca12m += pricePerNight;
      if (night >= d30 && night < today) a.occupiedNights30.add(night);
    }
    if (departure > d365 && arrival <= today) a.nbResas12m += 1;
    if (arrival <= today && today < departure) a.occupiedToday = true;
  }

  for (const rv of (reviewsRes.data ?? []) as any[]) {
    const unitId = rv.propria_unit_id ?? listingToUnit.get(rv.hostaway_listing_db_id ?? '');
    if (!unitId) continue;
    const a = getAcc(unitId);
    a.ratingSum += Number(rv.rating_normalized);
    a.nbReviews += 1;
  }

  for (const c of (cleaningsRes.data ?? []) as any[]) {
    const a = getAcc(c.propria_unit_id);
    // Résultat trié occurred_at DESC → le premier vu par lot est le dernier ménage.
    if (!a.lastCleaning) a.lastCleaning = c.occurred_at;
  }

  // ─── Structures sérialisables pour le composant client ──────────────────
  const lotsByProperty = new Map<string, CarteLot[]>();
  for (const u of units as any[]) {
    const a = acc.get(u.id);
    const lot: CarteLot = {
      unitId: u.id,
      code: u.code ?? '—',
      caMonth: a ? Math.round(a.caMonth) : 0,
      ca12m: a ? Math.round(a.ca12m) : 0,
      currency: a?.currency ?? null,
      avgRating: a && a.nbReviews > 0 ? Math.round((a.ratingSum / a.nbReviews) * 100) / 100 : null,
      nbReviews: a?.nbReviews ?? 0,
      occupancy30: a ? Math.round((a.occupiedNights30.size / 30) * 100) : 0,
      nbResas12m: a?.nbResas12m ?? 0,
      lastCleaning: a?.lastCleaning ?? null,
      occupiedToday: a?.occupiedToday ?? false,
      hasListing: a?.hasListing ?? false,
    };
    const arr = lotsByProperty.get(u.property_id) ?? [];
    arr.push(lot);
    lotsByProperty.set(u.property_id, arr);
  }

  const carteProperties: CarteProperty[] = (properties as any[]).map((p) => {
    const lots = lotsByProperty.get(p.id) ?? [];
    const withReviews = lots.filter((l) => l.avgRating != null);
    const ratingWeighted = withReviews.reduce((s, l) => s + (l.avgRating ?? 0) * l.nbReviews, 0);
    const nbReviews = withReviews.reduce((s, l) => s + l.nbReviews, 0);
    const lastCleaning = lots.reduce<string | null>(
      (best, l) => (l.lastCleaning && (!best || l.lastCleaning > best) ? l.lastCleaning : best),
      null,
    );
    return {
      id: p.id,
      name: p.name,
      code: p.propria_internal_code ?? null,
      quartier: p.quartier ?? null,
      lat: p.latitude != null ? Number(p.latitude) : null,
      lng: p.longitude != null ? Number(p.longitude) : null,
      lots,
      agg: {
        caMonth: lots.reduce((s, l) => s + l.caMonth, 0),
        ca12m: lots.reduce((s, l) => s + l.ca12m, 0),
        currency: lots.find((l) => l.currency)?.currency ?? null,
        avgRating: nbReviews > 0 ? Math.round((ratingWeighted / nbReviews) * 100) / 100 : null,
        nbReviews,
        occupancy30: lots.length > 0
          ? Math.round(lots.reduce((s, l) => s + l.occupancy30, 0) / lots.length)
          : 0,
        nbResas12m: lots.reduce((s, l) => s + l.nbResas12m, 0),
        lastCleaning,
        occupiedToday: lots.some((l) => l.occupiedToday),
      },
    };
  });

  const canEdit = ['ceo', 'assistante', 'propria'].includes(user.role);
  const unplacedCount = carteProperties.filter((p) => p.lat == null || p.lng == null).length;

  return (
    <div className="max-w-[1400px]">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Carte
      </div>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between mb-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-display">🗺️ Carte des lots</h1>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            {carteProperties.length} bien{carteProperties.length > 1 ? 's' : ''} Propria ·{' '}
            {units.length} lot{units.length > 1 ? 's' : ''} actif{units.length > 1 ? 's' : ''}
            {unplacedCount > 0 && canEdit && (
              <> · {unplacedCount} à localiser (panneau à droite de la carte)</>
            )}
          </p>
        </div>
      </div>

      <PropriaCarteMap properties={carteProperties} canEdit={canEdit} />
    </div>
  );
}
