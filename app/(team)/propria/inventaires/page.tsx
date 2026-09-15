import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { createInventoryAction } from './actions';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';

const TYPE_LABELS: Record<string, string> = {
  general: 'Général',
  entree: 'Entrée séjour',
  sortie: 'Sortie séjour',
  controle: 'Contrôle',
};

export default async function InventoriesListPage({
  searchParams,
}: { searchParams: { unit?: string } }) {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  let q = supabase.from('propria_inventories')
    .select('id, propria_unit_id, inventory_date, type, status, performed_by, notes')
    .is('deleted_at', null)
    .order('inventory_date', { ascending: false })
    .limit(200);
  if (searchParams.unit) q = q.eq('propria_unit_id', searchParams.unit);

  const [invRes, profRes, lotOptions, lotLabels] = await Promise.all([
    q,
    supabase.from('profiles').select('id, full_name').neq('role', 'client'),
    getActiveLotOptions(),
    getLotLabelMap(),
  ]);

  const rows = (invRes.data ?? []) as any[];
  const profMap = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Inventaires
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Inventaires des biens</h1>
      </div>

      <details open={rows.length === 0} className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Démarrer un inventaire</summary>
        <form action={createInventoryAction} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <select name="propria_unit_id" required defaultValue={searchParams.unit ?? ''}
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            <option value="">— Lot (listing) *</option>
            {lotOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <input name="inventory_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)}
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm" />
          <select name="type" defaultValue="general" className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm">
            {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input name="notes" placeholder="Notes (optionnel)"
            className="border border-stoniz-gray-300 rounded px-3 py-2 text-sm md:col-span-2" />
          <button className="bg-stoniz-black text-white py-2 rounded text-sm">Démarrer</button>
        </form>
      </details>

      <PropriaBulkDeleteForm table="propria_inventories">
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Effectué par</th>
              <th className="px-3 py-2 text-center">Statut</th>
              <th className="px-3 py-2"></th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map(r => {
              const lotLabel = r.propria_unit_id ? (lotLabels.get(r.propria_unit_id) ?? '—') : '—';
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-2 py-2 text-center"><input type="checkbox" data-bulk-id={r.id} /></td>
                  <td className="px-3 py-2 text-xs">{new Date(r.inventory_date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2 text-xs">{lotLabel}</td>
                  <td className="px-3 py-2 text-xs">{TYPE_LABELS[r.type] ?? r.type}</td>
                  <td className="px-3 py-2 text-xs">{profMap.get(r.performed_by) ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      r.status === 'termine' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {r.status === 'termine' ? '✓ Terminé' : '🔄 En cours'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link href={`/propria/inventaires/${r.id}`} className="text-xs hover:underline">→</Link>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_inventories" id={r.id} />
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucun inventaire pour l'instant.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      </PropriaBulkDeleteForm>
    </div>
  );
}
