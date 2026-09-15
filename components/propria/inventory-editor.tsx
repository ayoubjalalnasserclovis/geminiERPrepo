'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { Plus, X, CheckCircle2, AlertCircle } from 'lucide-react';
import {
  updateInventoryItemAction,
  addInventoryItemAction,
  deleteInventoryItemAction,
  markCategoryAbsentAction,
} from '@/app/(team)/propria/inventaires/actions';

const CONDITIONS: { value: string; label: string; cls: string }[] = [
  { value: 'neuf',      label: '✨ Neuf',       cls: 'bg-emerald-100 text-emerald-800' },
  { value: 'bon',       label: '✓ Bon',         cls: 'bg-blue-100 text-blue-800' },
  { value: 'usage',     label: '○ Usagé',       cls: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  { value: 'endommage', label: '⚠ Endommagé',  cls: 'bg-orange-100 text-orange-800' },
  { value: 'manquant',  label: '✕ Manquant',    cls: 'bg-red-100 text-red-800' },
];

export type InventoryItem = {
  id: string;
  category: string | null;
  name: string;
  quantity_expected: number;
  quantity_found: number | null;
  condition: string | null;
  observations: string | null;
};

export function InventoryEditor({
  inventoryId,
  items,
  isLocked,
}: {
  inventoryId: string;
  items: InventoryItem[];
  isLocked: boolean;
}) {
  // Toast léger
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ kind, message });
    setTimeout(() => setToast(null), kind === 'success' ? 1500 : 3500);
  }

  // Groupage par catégorie + tri par display_order implicite (déjà trié côté serveur)
  const groups = useMemo(() => {
    const map = new Map<string, InventoryItem[]>();
    for (const it of items) {
      const key = it.category ?? 'Sans catégorie';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  // Progression : items "traités" (quantity_found défini OU condition définie)
  const totalItems = items.length;
  const doneItems = items.filter(i => i.quantity_found != null || i.condition != null).length;
  const progress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;

  function persistRow(itemId: string, patch: Partial<InventoryItem>) {
    const fd = new FormData();
    fd.set('item_id', itemId);
    fd.set('inventory_id', inventoryId);
    if (patch.quantity_found != null) fd.set('quantity_found', String(patch.quantity_found));
    if (patch.condition) fd.set('condition', patch.condition);
    if (patch.observations != null) fd.set('observations', patch.observations);
    startTransition(async () => {
      try {
        await updateInventoryItemAction(fd);
      } catch (e: any) {
        showToast('error', e?.message ?? 'Erreur de sauvegarde');
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Barre de progression */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-stoniz-gray-600">
            Progression — {doneItems} / {totalItems} items traités
          </span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="h-2 bg-stoniz-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all ${progress === 100 ? 'bg-emerald-500' : 'bg-stoniz-black'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {isPending && (
          <div className="text-[11px] text-stoniz-gray-500 mt-2">💾 Sauvegarde en cours…</div>
        )}
      </div>

      {/* Catégories */}
      {groups.map(([category, rows]) => {
        const totalCat = rows.length;
        const doneCat = rows.filter(r => r.quantity_found != null || r.condition != null).length;
        return (
          <CategorySection
            key={category}
            category={category}
            rows={rows}
            inventoryId={inventoryId}
            isLocked={isLocked}
            persistRow={persistRow}
            showToast={showToast}
            counter={{ done: doneCat, total: totalCat }}
          />
        );
      })}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm
            animate-in fade-in slide-in-from-bottom-2 duration-200
            ${toast.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'}`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            : <AlertCircle className="w-4 h-4 text-red-600" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function CategorySection({
  category, rows, inventoryId, isLocked, persistRow, showToast, counter,
}: {
  category: string;
  rows: InventoryItem[];
  inventoryId: string;
  isLocked: boolean;
  persistRow: (id: string, patch: Partial<InventoryItem>) => void;
  showToast: (kind: 'success' | 'error', msg: string) => void;
  counter: { done: number; total: number };
}) {
  const [showAdd, setShowAdd] = useState(false);
  const isComplete = counter.done === counter.total && counter.total > 0;

  return (
    <section className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
      <header className="px-4 py-3 bg-stoniz-gray-50 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="font-medium">{category}</h3>
          <span className={`text-[10px] px-2 py-0.5 rounded-full ${
            isComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-stoniz-gray-200 text-stoniz-gray-700'
          }`}>
            {counter.done} / {counter.total}
          </span>
        </div>
        {!isLocked && (
          <div className="flex items-center gap-3">
            <form action={async () => {
              await markCategoryAbsentAction(inventoryId, category);
            }}>
              <button className="text-[11px] text-stoniz-gray-500 hover:text-red-700 underline">
                Tout marquer absent
              </button>
            </form>
          </div>
        )}
      </header>

      <table className="w-full text-sm">
        <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b border-stoniz-gray-100">
          <tr>
            <th className="px-3 py-2 text-left">Objet</th>
            <th className="px-3 py-2 text-center w-20">Attendu</th>
            <th className="px-3 py-2 text-center w-24">Trouvé</th>
            <th className="px-3 py-2 text-center w-32">État</th>
            <th className="px-3 py-2 text-left">Observations</th>
            {!isLocked && <th className="w-8"></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-stoniz-gray-100">
          {rows.map(it => (
            <ItemRow
              key={it.id}
              item={it}
              inventoryId={inventoryId}
              isLocked={isLocked}
              onPersist={persistRow}
              onError={(msg) => showToast('error', msg)}
            />
          ))}

          {/* Ajout item custom */}
          {!isLocked && (
            <tr>
              <td colSpan={6} className="px-3 py-2 bg-stoniz-gray-50/50">
                {showAdd ? (
                  <AddCustomItemForm
                    inventoryId={inventoryId}
                    category={category}
                    onDone={() => setShowAdd(false)}
                    onError={(msg) => showToast('error', msg)}
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="flex items-center gap-1.5 text-xs text-stoniz-gray-600 hover:text-stoniz-black"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Ajouter un objet custom à {category}
                  </button>
                )}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function ItemRow({
  item, inventoryId, isLocked, onPersist, onError,
}: {
  item: InventoryItem;
  inventoryId: string;
  isLocked: boolean;
  onPersist: (id: string, patch: Partial<InventoryItem>) => void;
  onError: (msg: string) => void;
}) {
  const [qty, setQty] = useState<string>(item.quantity_found?.toString() ?? '');
  const [cond, setCond] = useState<string>(item.condition ?? '');
  const [obs, setObs] = useState<string>(item.observations ?? '');

  const rowBg =
    cond === 'manquant' ? 'bg-red-50/50' :
    cond === 'endommage' ? 'bg-orange-50/50' : '';

  return (
    <tr className={rowBg}>
      <td className="px-3 py-2 text-sm">{item.name}</td>
      <td className="px-3 py-2 text-center text-xs text-stoniz-gray-600">
        {item.quantity_expected}
      </td>
      <td className="px-3 py-2 text-center">
        <input
          type="number"
          min="0"
          value={qty}
          disabled={isLocked}
          onChange={(e) => setQty(e.target.value)}
          onBlur={() => {
            if (qty === '' && item.quantity_found == null) return;
            const num = qty === '' ? null : Number(qty);
            if (num === item.quantity_found) return;
            onPersist(item.id, { quantity_found: num as any });
          }}
          className="w-16 border border-stoniz-gray-200 rounded px-2 py-1 text-xs text-center"
          placeholder={String(item.quantity_expected)}
        />
      </td>
      <td className="px-3 py-2 text-center">
        <select
          value={cond}
          disabled={isLocked}
          onChange={(e) => {
            const v = e.target.value;
            setCond(v);
            if (v === item.condition) return;
            onPersist(item.id, { condition: v || null });
          }}
          className="border border-stoniz-gray-200 rounded px-2 py-1 text-xs bg-transparent w-full"
        >
          <option value="">—</option>
          {CONDITIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={obs}
          disabled={isLocked}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => {
            if (obs === (item.observations ?? '')) return;
            onPersist(item.id, { observations: obs || null });
          }}
          placeholder="ex: rayure côté gauche…"
          className="w-full border border-stoniz-gray-200 rounded px-2 py-1 text-xs"
        />
      </td>
      {!isLocked && (
        <td className="text-right pr-2">
          <form action={async () => {
            await deleteInventoryItemAction(item.id, inventoryId);
          }}>
            <button
              type="submit"
              className="text-stoniz-gray-400 hover:text-red-600"
              title="Supprimer cet item"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        </td>
      )}
    </tr>
  );
}

function AddCustomItemForm({
  inventoryId, category, onDone, onError,
}: {
  inventoryId: string;
  category: string;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await addInventoryItemAction(fd);
        formRef.current?.reset();
        onDone();
      } catch (err: any) {
        onError(err?.message ?? 'Erreur ajout item');
      }
    });
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="flex items-center gap-2 flex-wrap"
    >
      <input type="hidden" name="inventory_id" value={inventoryId} />
      <input type="hidden" name="category" value={category} />
      <input
        name="name"
        required
        placeholder="Nom de l'objet"
        autoFocus
        className="flex-1 border border-stoniz-gray-300 rounded px-2 py-1 text-xs min-w-[180px]"
      />
      <input
        name="quantity_expected"
        type="number"
        min="1"
        defaultValue="1"
        className="w-16 border border-stoniz-gray-300 rounded px-2 py-1 text-xs text-center"
      />
      <button
        type="submit"
        disabled={isPending}
        className="text-xs bg-stoniz-black text-white px-3 py-1 rounded hover:bg-stoniz-gray-800 disabled:opacity-50"
      >
        {isPending ? '…' : 'Ajouter'}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="text-xs text-stoniz-gray-500 hover:text-stoniz-black"
      >
        Annuler
      </button>
    </form>
  );
}
