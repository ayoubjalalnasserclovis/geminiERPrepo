import Link from 'next/link';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { NewConsumableForm } from '@/components/propria/new-consumable-form';
import { AlertTriangle, ShoppingCart, Boxes, Download } from 'lucide-react';
import { StockTableEditable } from './stock-table-editable';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { single, multi, search, escapeIlike as parseEscapeIlike, type SP } from '@/lib/list-filters/parse';

function fmtMad(n: any) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}

const LOW_STOCK_OPTIONS = [
  { v: 'yes', label: 'Faible stock seulement' },
  { v: 'no',  label: 'Hors faible stock' },
];

export default async function StockListPage({
  searchParams,
}: { searchParams: SP }) {
  // CEO 2026-07-13 : finance ajouté (lecture seule + export CSV) pour clôtures
  // et rapprochement comptable de la valeur du stock.
  await requireRole(['ceo','developer','assistante','propria','finance']);
  const me = await getSessionUser();
  const canEdit = me?.role === 'ceo' || me?.role === 'assistante' || me?.role === 'propria';
  const canExport = me?.role === 'ceo' || me?.role === 'finance' || me?.role === 'propria';
  const supabase = createClient();

  const { data: stock } = await supabase
    .from('propria_stock_status')
    .select('*')
    .order('category', { ascending: true })
    .order('name', { ascending: true });

  const { data: suppliersRows } = await supabase
    .from('propria_consumables')
    .select('supplier')
    .not('supplier', 'is', null);
  const existingSuppliers = Array.from(
    new Set((suppliersRows ?? []).map((r: any) => String(r.supplier).trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, 'fr'));

  const { data: refsRows } = await supabase
    .from('propria_consumables')
    .select('reference')
    .not('reference', 'is', null);
  const existingPreviews: Record<string, string> = {};
  for (const row of refsRows ?? []) {
    const ref = String((row as any).reference ?? '');
    const m = ref.match(/^([A-Z]{2,4})-(\d+)$/);
    if (!m) continue;
    const prefix = m[1];
    const num = parseInt(m[2], 10);
    const cur = existingPreviews[prefix];
    const curNum = cur ? parseInt(cur.split('-')[1], 10) : 0;
    if (num > curNum) existingPreviews[prefix] = ref;
  }

  const rows = (stock ?? []) as any[];

  // ─── Parse toolbar ─────────────────────────────────────────────────────
  const q = search(searchParams);
  const categories = multi(searchParams, 'category');
  const lowStock = single(searchParams, 'low_stock');
  // Legacy : ?status=rupture / ?status=alerte conservés
  const legacyStatus = single(searchParams, 'status');
  const legacyCategory = single(searchParams, 'category');

  let filtered = rows.filter(r => {
    if (legacyStatus && r.status !== legacyStatus) return false;
    if (categories.length && !categories.includes(r.category)) return false;
    if (legacyCategory && !categories.length && r.category !== legacyCategory) return false;
    if (lowStock === 'yes' && r.status === 'ok') return false;
    if (lowStock === 'no' && r.status !== 'ok') return false;
    if (q) {
      const needle = q.toLowerCase();
      const name = String(r.name ?? '').toLowerCase();
      const ref = String(r.reference ?? '').toLowerCase();
      const supplier = String(r.supplier ?? '').toLowerCase();
      if (!name.includes(needle) && !ref.includes(needle) && !supplier.includes(needle)) return false;
    }
    return true;
  });

  const allCategories = [...new Set(rows.map(r => r.category))].sort();
  const ruptures = rows.filter(r => r.status === 'rupture').length;
  const alertes = rows.filter(r => r.status === 'alerte').length;
  const totalValue = rows.reduce((s, r) => s + Number(r.stock_value_mad ?? 0), 0);
  const budgetCmd = rows.reduce((s, r) => s + (Number(r.qty_to_order ?? 0) * Number(r.unit_price_mad ?? 0)), 0);

  // ─── Options dynamiques ─────────────────────────────────────────────
  const categoryOptions = allCategories.map(c => ({ v: c as string, label: c as string }));

  const filters: FilterDef[] = [
    { kind: 'multi',  key: 'category',  label: 'Catégorie',   options: categoryOptions },
    { kind: 'single', key: 'low_stock', label: 'Faible stock', options: LOW_STOCK_OPTIONS },
  ];

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Stock
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Stock consommables</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canExport && (
            <a
              href="/api/propria/stock/export"
              className="inline-flex items-center gap-1.5 border border-stoniz-gray-300 bg-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50"
              title="Télécharger l'état actuel du stock en CSV (Excel-compatible)"
            >
              <Download className="w-4 h-4" />
              Exporter CSV
            </a>
          )}
          <Link
            href="/propria/stock/mouvements"
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800"
          >
            + Mouvement de stock
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Boxes className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-2xl font-display">{fmtMad(totalValue)}</div>
          <div className="text-xs text-stoniz-gray-600">Valeur totale stock</div>
        </div>
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <AlertTriangle className="w-4 h-4 text-red-600 mb-2" />
          <div className="text-2xl font-display text-red-900">{ruptures}</div>
          <div className="text-xs text-red-700">Articles en rupture</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
          <AlertTriangle className="w-4 h-4 text-orange-600 mb-2" />
          <div className="text-2xl font-display text-orange-900">{alertes}</div>
          <div className="text-xs text-orange-700">Articles en alerte</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <ShoppingCart className="w-4 h-4 text-blue-500 mb-2" />
          <div className="text-2xl font-display">{fmtMad(budgetCmd)}</div>
          <div className="text-xs text-stoniz-gray-600">Budget de commande</div>
        </div>
      </div>

      {/* Filtres rapides legacy (status) conservés */}
      <div className="flex flex-wrap gap-2 mb-4 text-xs">
        <Link href="/propria/stock"
          className={`px-3 py-1.5 rounded-full ${!legacyStatus ? 'bg-stoniz-black text-white' : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`}
        >Tous</Link>
        <Link href="/propria/stock?status=rupture"
          className={`px-3 py-1.5 rounded-full ${legacyStatus === 'rupture' ? 'bg-red-600 text-white' : 'bg-red-50 text-red-700 hover:bg-red-100'}`}
        >🔴 Ruptures</Link>
        <Link href="/propria/stock?status=alerte"
          className={`px-3 py-1.5 rounded-full ${legacyStatus === 'alerte' ? 'bg-orange-600 text-white' : 'bg-orange-50 text-orange-700 hover:bg-orange-100'}`}
        >🟠 Alertes</Link>
      </div>

      {/* Toolbar unifiée */}
      <div className="mb-4">
        <ListToolbar
          moduleKey="propria-stock"
          count={{ filtered: filtered.length, total: rows.length }}
          filters={filters}
          searchHint="nom article, référence, fournisseur"
        />
      </div>

      {/* Nouveau consommable */}
      <details className="bg-white border border-stoniz-gray-200 rounded-xl p-5 mb-6">
        <summary className="cursor-pointer font-medium">+ Ajouter un consommable</summary>
        <NewConsumableForm
          existingSuppliers={existingSuppliers}
          existingPreviews={existingPreviews}
        />
      </details>

      <StockTableEditable
        rows={filtered.map((r: any) => ({
          id: r.id,
          reference: r.reference,
          name: r.name,
          category: r.category,
          unit: r.unit,
          current_stock: Number(r.current_stock ?? 0),
          min_threshold: Number(r.min_threshold ?? 0),
          qty_to_order: Number(r.qty_to_order ?? 0),
          default_order_qty: r.default_order_qty != null ? Number(r.default_order_qty) : null,
          unit_price_mad: Number(r.unit_price_mad ?? 0),
          stock_value_mad: Number(r.stock_value_mad ?? 0),
          status: r.status,
          supplier: r.supplier,
        }))}
        canEdit={canEdit}
      />

      <p className="text-[11px] text-stoniz-gray-500 mt-3">
        💡 Clique sur une cellule (nom, seuil, à cmd, prix, fournisseur) pour la modifier directement.
        Pour le stock, le clic ouvre une fenêtre d&apos;ajustement qui enregistre un mouvement traçable.
      </p>
    </div>
  );
}
