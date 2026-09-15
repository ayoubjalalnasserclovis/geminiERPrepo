import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { MovementForm } from '@/components/propria/movement-form';
import { getActiveLotOptions, getLotLabelMap } from '@/lib/propria/lots';
import { PropriaDeleteButton } from '@/components/propria/propria-delete-button';
import { PropriaBulkDeleteForm } from '@/components/propria/propria-bulk-delete-form';

export default async function MovementsPage() {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const [movRes, consRes, profRes, lotOptions, lotLabels] = await Promise.all([
    // Soft-delete : la vue propria_stock_status exclut déjà les mouvements
    // supprimés — cette liste doit faire pareil, sinon la somme affichée ne
    // retombe pas sur le stock théorique.
    supabase.from('propria_stock_movements')
      .select('id, consumable_id, movement_type, movement_date, quantity, unit_price_mad, source_destination, propria_unit_id, responsible_id, notes')
      .is('deleted_at', null)
      .order('movement_date', { ascending: false })
      .limit(100),
    supabase.from('propria_consumables').select('id, reference, name, category, unit, unit_price_mad')
      .eq('is_active', true).order('name'),
    supabase.from('profiles').select('id, full_name').neq('role', 'client'),
    getActiveLotOptions(),
    getLotLabelMap(),
  ]);

  const cons = new Map((consRes.data ?? []).map((c: any) => [c.id, c]));
  const profs = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
          <Link href="/propria/stock" className="hover:text-stoniz-black">Stock</Link> · Mouvements
        </div>
        <h1 className="text-2xl md:text-3xl font-display">Mouvements de stock</h1>
      </div>

      <details open className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Enregistrer un mouvement</summary>
        <MovementForm
          consumables={(consRes.data ?? []) as any[]}
          lots={lotOptions}
        />
      </details>

      <PropriaBulkDeleteForm table="propria_stock_movements">
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
            <tr>
              <th className="px-2 py-2"></th>
              <th className="px-3 py-2 text-left">Date</th>
              <th className="px-3 py-2 text-left">Produit</th>
              <th className="px-3 py-2 text-center">Type</th>
              <th className="px-3 py-2 text-right">Quantité</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2 text-left">Source/Dest.</th>
              <th className="px-3 py-2 text-left">Lot</th>
              <th className="px-3 py-2 text-left">Responsable</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {(movRes.data ?? []).map((m: any) => {
              const c = cons.get(m.consumable_id) as any;
              const lotLabel = m.propria_unit_id ? (lotLabels.get(m.propria_unit_id) ?? '—') : '—';
              const total = m.unit_price_mad ? Number(m.quantity) * Number(m.unit_price_mad) : null;
              return (
                <tr key={m.id}>
                  <td className="px-2 py-2 text-center"><input type="checkbox" data-bulk-id={m.id} /></td>
                  <td className="px-3 py-2 text-xs">{new Date(m.movement_date).toLocaleDateString('fr-FR')}</td>
                  <td className="px-3 py-2 text-xs">{c ? `${c.reference} · ${c.name}` : '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                      m.movement_type === 'entree' ? 'bg-emerald-100 text-emerald-800' :
                      m.movement_type === 'sortie' ? 'bg-orange-100 text-orange-800' :
                      'bg-stoniz-gray-100 text-stoniz-gray-700'
                    }`}>{m.movement_type}</span>
                  </td>
                  <td className={`px-3 py-2 text-right text-xs ${
                    m.movement_type === 'sortie' ? 'text-orange-700' : 'text-emerald-700'
                  }`}>
                    {m.movement_type === 'sortie' ? '−' : '+'}{m.quantity} {c?.unit ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right text-xs">
                    {total != null ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(total) + ' DH' : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">{m.source_destination ?? '—'}</td>
                  <td className="px-3 py-2 text-xs">{lotLabel}</td>
                  <td className="px-3 py-2 text-xs">{profs.get(m.responsible_id) ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    <PropriaDeleteButton table="propria_stock_movements" id={m.id} />
                  </td>
                </tr>
              );
            })}
            {(movRes.data ?? []).length === 0 && (
              <tr><td colSpan={10} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucun mouvement enregistré pour l'instant.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
      </PropriaBulkDeleteForm>
    </div>
  );
}
