import 'server-only';
import { createClient } from '@/lib/supabase/server';

// ============================================================================
// Helper centralisé « code résa propagé partout » (chantier 14 marathon).
// Liste les résas Hostaway en cours / à venir (statuts new/modified) avec le
// lot Propria matché — utilisé par les sélecteurs « Réservation liée » des
// modules interventions, transferts et upsell.
// ============================================================================

export type ResaOption = {
  hostaway_id: number;
  unit_id: string | null;
  guest_name: string | null;
  arrival_date: string;
  departure_date: string;
};

/**
 * Résas en cours / à venir (départ >= aujourd'hui, arrivée < horizon).
 * @param horizonDays fenêtre d'arrivées futures (défaut 60 jours)
 */
export async function getUpcomingResaOptions(horizonDays = 60): Promise<ResaOption[]> {
  const supabase = createClient();
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + horizonDays * 86400000).toISOString().slice(0, 10);

  const [resasRes, listingsRes] = await Promise.all([
    supabase
      .from('hostaway_reservations')
      .select('hostaway_id, guest_name, arrival_date, departure_date, hostaway_listing_db_id')
      .in('status', ['new', 'modified'])
      .gte('departure_date', today)
      .lte('arrival_date', horizon)
      .is('deleted_at', null)
      .order('arrival_date', { ascending: true })
      .limit(500),
    supabase
      .from('hostaway_listings')
      .select('id, propria_unit_id')
      .is('deleted_at', null),
  ]);

  const unitByListing = new Map(
    ((listingsRes.data ?? []) as any[]).map((l) => [l.id, l.propria_unit_id as string | null]),
  );

  return ((resasRes.data ?? []) as any[]).map((r) => ({
    hostaway_id: Number(r.hostaway_id),
    unit_id: r.hostaway_listing_db_id
      ? (unitByListing.get(r.hostaway_listing_db_id) ?? null)
      : null,
    guest_name: r.guest_name ?? null,
    arrival_date: r.arrival_date,
    departure_date: r.departure_date,
  }));
}
