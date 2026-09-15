import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Star } from 'lucide-react';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';
import { ListingMetricForm } from '@/components/propria/listing-metric-form';

const PLATFORM_LABEL: Record<string, string> = {
  airbnb: 'Airbnb', booking: 'Booking', vrbo: 'VRBO', direct: 'Direct',
};

export default async function ListingsPage({
  searchParams,
}: { searchParams: { unit?: string } }) {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  let q = supabase.from('propria_listing_metrics')
    .select('id, propria_unit_id, platform, measured_at, rating, nb_reviews, occupancy_rate, notes')
    .is('deleted_at', null)
    .order('measured_at', { ascending: false })
    .limit(500);
  if (searchParams.unit) q = q.eq('propria_unit_id', searchParams.unit);

  const [metricsRes, lotOptions, lotLabels] = await Promise.all([
    q,
    getActiveLotOptions(),
    getLotLabelMap(),
  ]);

  const metrics = (metricsRes.data ?? []) as any[];

  // Dernière note par (lot, platform)
  const latestByLot = lotOptions.map((o) => {
    const mp = metrics.filter(m => m.propria_unit_id === o.id);
    const airbnb = mp.find(m => m.platform === 'airbnb');
    const booking = mp.find(m => m.platform === 'booking');
    return { lot: o, airbnb, booking };
  }).filter(b => b.airbnb || b.booking);

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Notes annonces
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Notes Airbnb / Booking</h1>
        <p className="text-sm text-stoniz-gray-600 mt-2">
          Saisir mensuellement la note moyenne et le nombre d'avis pour suivre l'évolution dans le temps.
        </p>
      </div>

      <ListingMetricForm lotOptions={lotOptions as any} />

      {/* Latest snapshot */}
      <h2 className="font-display text-lg mb-3">Photographie actuelle</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 mb-8">
        {latestByLot.map(({ lot, airbnb, booking }) => (
          <div key={lot.id} className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
            <div className="font-medium mb-3">{lot.label}</div>
            <div className="space-y-2">
              {airbnb && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-pink-700">Airbnb</span>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {airbnb.rating ?? '—'}
                    </span>
                    <span className="text-xs text-stoniz-gray-500">({airbnb.nb_reviews ?? 0})</span>
                  </div>
                </div>
              )}
              {booking && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-blue-700">Booking</span>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                      {booking.rating ?? '—'}
                    </span>
                    <span className="text-xs text-stoniz-gray-500">({booking.nb_reviews ?? 0})</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {latestByLot.length === 0 && (
          <div className="md:col-span-3 bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center text-stoniz-gray-600">
            Aucune note enregistrée pour l'instant. Commence en ajoutant la note actuelle d'un lot.
          </div>
        )}
      </div>

      {/* Historique */}
      <h2 className="font-display text-lg mb-3">Historique des mesures</h2>
      <PropriaBulkDeleteForm table="propria_listing_metrics">
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Plateforme</th>
              <th className="px-3 py-2 text-right">Note</th>
              <th className="px-3 py-2 text-right">Avis</th>
              <th className="px-3 py-2 text-right">Occup. %</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {metrics.map(m => {
              const lotLabel = m.propria_unit_id ? (lotLabels.get(m.propria_unit_id) ?? '—') : '—';
              return (
                <tr key={m.id}>
                  <td className="px-2 py-2 text-center"><input type="checkbox" data-bulk-id={m.id} /></td>
                  <td className="px-3 py-2 text-xs">{new Date(m.measured_at).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2 text-xs">{lotLabel}</td>
                  <td className="px-3 py-2 text-xs">{PLATFORM_LABEL[m.platform] ?? m.platform}</td>
                  <td className="px-3 py-2 text-right text-xs">{m.rating ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-xs">{m.nb_reviews ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-xs">{m.occupancy_rate ? `${m.occupancy_rate}%` : '—'}</td>
                  <td className="px-3 py-2 text-xs">{m.notes ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_listing_metrics" id={m.id} />
                  </td>
                </tr>
              );
            })}
            {metrics.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucune mesure enregistrée.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      </PropriaBulkDeleteForm>
    </div>
  );
}
