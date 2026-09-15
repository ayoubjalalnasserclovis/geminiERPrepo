import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { suggestMatches } from '@/lib/hostaway/match';
import { HostawayMatchTable } from '@/components/propria/hostaway-match-table';

export default async function HostawayIntegrationPage() {
  await requireRole(['ceo', 'developer', 'assistante']);
  const supabase = createClient();

  // 1. Liste des listings Hostaway déjà synchronisés
  const { data: listings } = await supabase
    .from('hostaway_listings')
    .select('id, hostaway_id, name, address, external_listing_id, is_active, propria_unit_id, matched_at, last_synced_at')
    .is('deleted_at', null)
    .order('name');

  // 2. Suites Stoniz disponibles (active + bien sous gestion Propria)
  const { data: unitsRaw } = await supabase
    .from('propria_units')
    .select(`
      id, code,
      property:properties!inner(name, address, quartier, propria_managed_at, deleted_at)
    `)
    .is('deleted_at', null)
    .eq('is_active', true)
    .not('property.propria_managed_at', 'is', null)
    .is('property.deleted_at', null);

  const candidates = (unitsRaw ?? []).map((u: any) => ({
    id: u.id,
    code: u.code,
    property_name: u.property?.name ?? null,
    property_address: u.property?.address ?? null,
    property_quartier: u.property?.quartier ?? null,
  }));

  // 3. Pour chaque listing non matché, calcule les top 3 suggestions
  const enrichedListings = (listings ?? []).map((l: any) => {
    const suggestions = l.propria_unit_id
      ? []
      : suggestMatches(
          { hostaway_id: l.hostaway_id, name: l.name, address: l.address },
          candidates,
          3,
        );
    const matchedUnit = l.propria_unit_id
      ? candidates.find((c) => c.id === l.propria_unit_id) ?? null
      : null;
    return { ...l, suggestions, matchedUnit };
  });

  const totalCount = enrichedListings.length;
  const matchedCount = enrichedListings.filter((l) => l.propria_unit_id).length;
  const unmatchedCount = totalCount - matchedCount;

  return (
    <div className="max-w-7xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Intégrations · Hostaway
      </div>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <h1 className="text-2xl md:text-3xl font-display">🔗 Intégration Hostaway</h1>
        <Link
          href="/propria/integrations/hostaway/reservations"
          className="text-sm bg-stoniz-black text-white px-4 py-2 rounded-md hover:bg-stoniz-gray-800"
        >
          📅 Voir les réservations →
        </Link>
      </div>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Synchronise les listings Hostaway et matche-les avec les suites Stoniz (`propria_units`).
        Ce matching sert de base aux futures sync de réservations et création auto des ménages voyageurs.
      </p>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-[11px] uppercase text-stoniz-gray-500">Total Hostaway</div>
          <div className="text-2xl font-display">{totalCount}</div>
        </div>
        <div className="bg-white border border-emerald-200 rounded-xl p-4">
          <div className="text-[11px] uppercase text-emerald-700">Matchés</div>
          <div className="text-2xl font-display text-emerald-700">{matchedCount}</div>
        </div>
        <div className="bg-white border border-orange-200 rounded-xl p-4">
          <div className="text-[11px] uppercase text-orange-700">À matcher</div>
          <div className="text-2xl font-display text-orange-700">{unmatchedCount}</div>
        </div>
      </div>

      <HostawayMatchTable listings={enrichedListings as any} candidates={candidates} />
    </div>
  );
}
