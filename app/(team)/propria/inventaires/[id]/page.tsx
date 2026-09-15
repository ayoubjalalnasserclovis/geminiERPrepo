import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  completeInventoryAction,
  reseedInventoryAction,
} from '../actions';
import { InventoryEditor } from '@/components/propria/inventory-editor';
import { BackLink } from '@/components/ui/back-link';

const TYPE_LABEL: Record<string, string> = {
  general: 'Inventaire général',
  entree: 'Entrée locataire',
  sortie: 'Sortie locataire',
  controle: 'Contrôle ponctuel',
};

export default async function InventoryDetailPage({ params }: { params: { id: string } }) {
  await requireRole(['ceo','developer','assistante','propria']);
  const supabase = createClient();

  const [invRes, itemsRes, unitsRes, profRes] = await Promise.all([
    supabase.from('propria_inventories').select('*').eq('id', params.id).single(),
    supabase.from('propria_inventory_items')
      .select('id, category, name, quantity_expected, quantity_found, condition, observations, template_item_id, created_at')
      .eq('inventory_id', params.id),
    supabase.from('propria_units_enriched').select('unit_id, display_label, property_id'),
    supabase.from('profiles').select('id, full_name').neq('role', 'client'),
  ]);

  if (!invRes.data) notFound();
  const inv = invRes.data;
  const items = (itemsRes.data ?? []) as any[];
  const unit = (unitsRes.data ?? []).find((u: any) => u.unit_id === inv.propria_unit_id);
  const profMap = new Map((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  const isLocked = inv.status === 'termine';

  // Tri par display_order du template (les items custom finissent en bas)
  // On utilise un join implicite via le template_item_id et l'ordre du seed.
  const { data: tplOrder } = await supabase
    .from('propria_inventory_template_items')
    .select('id, display_order');
  const orderMap = new Map((tplOrder ?? []).map((t: any) => [t.id, t.display_order]));
  items.sort((a: any, b: any) => {
    const oa = orderMap.get(a.template_item_id) ?? 999999;
    const ob = orderMap.get(b.template_item_id) ?? 999999;
    if (oa !== ob) return oa - ob;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Compteur global pour CTA "marquer terminé"
  const completedCount = items.filter(i => i.quantity_found != null || i.condition != null).length;

  return (
    <div className="max-w-5xl">
      <BackLink href="/propria/inventaires" label="Retour aux inventaires" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            Inventaire
          </div>
          <h1 className="text-2xl md:text-3xl font-display">
            {new Date(inv.inventory_date).toLocaleDateString('fr-FR')} —{' '}
            {unit ? (
              <Link href={`/propria/biens/${(unit as any).property_id}`} className="hover:underline">
                {(unit as any).display_label}
              </Link>
            ) : '—'}
          </h1>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            {TYPE_LABEL[inv.type] ?? inv.type} · effectué par {profMap.get(inv.performed_by) ?? '—'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isLocked && items.length > 0 && (
            <>
              <form action={async () => { 'use server'; await reseedInventoryAction(params.id); }}>
                <button
                  className="text-xs border border-stoniz-gray-300 px-3 py-2 rounded-md hover:bg-stoniz-gray-50"
                  title="Re-charge les items du template (ajoute uniquement ceux qui manquent)"
                >
                  ↻ Re-charger template
                </button>
              </form>
              <form action={async () => { 'use server'; await completeInventoryAction(params.id); }}>
                <button className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm hover:bg-emerald-700">
                  ✓ Marquer terminé
                </button>
              </form>
            </>
          )}
          {isLocked && (
            <span className="bg-emerald-100 text-emerald-800 text-xs px-3 py-1 rounded-full">
              ✓ Inventaire terminé
            </span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <p className="font-medium mb-2">Inventaire vide</p>
          <p className="text-sm text-stoniz-gray-600 mb-4">
            Le template d'items standards n'a pas pu être appliqué.
          </p>
          <form action={async () => { 'use server'; await reseedInventoryAction(params.id); }}>
            <button className="inline-block bg-stoniz-black text-white px-4 py-2 rounded-md text-sm">
              ↻ Charger la checklist standard
            </button>
          </form>
        </div>
      ) : (
        <InventoryEditor
          inventoryId={params.id}
          items={items}
          isLocked={isLocked}
        />
      )}
    </div>
  );
}
