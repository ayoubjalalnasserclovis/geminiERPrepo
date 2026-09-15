'use client';

import { useState, useTransition, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, Pencil, Archive } from 'lucide-react';
import { patchConsumableFieldAction, adjustStockAction, archiveConsumableAction } from './actions';

export type StockRow = {
  id: string;
  reference: string;
  name: string;
  category: string;
  unit: string | null;
  current_stock: number;
  min_threshold: number;
  qty_to_order: number;
  default_order_qty: number | null;
  unit_price_mad: number;
  stock_value_mad: number;
  status: 'rupture' | 'alerte' | 'ok';
  supplier: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  rupture: 'bg-red-100 text-red-800',
  alerte: 'bg-orange-100 text-orange-800',
  ok: 'bg-emerald-100 text-emerald-800',
};
const STATUS_LABEL: Record<string, string> = {
  rupture: '🔴 Rupture',
  alerte: '🟠 Alerte',
  ok: '🟢 OK',
};

function fmt(n: any): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n));
}
function fmtMad(n: any): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Number(n)) + ' DH';
}

export function StockTableEditable({
  rows,
  canEdit,
}: {
  rows: StockRow[];
  canEdit: boolean;
}) {
  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-stoniz-gray-50 text-xs text-stoniz-gray-600">
          <tr>
            <th className="px-3 py-2 text-left">Réf.</th>
            <th className="px-3 py-2 text-left">Produit</th>
            <th className="px-3 py-2 text-left">Catégorie</th>
            <th className="px-3 py-2 text-right">Stock</th>
            <th className="px-3 py-2 text-right">Seuil</th>
            <th className="px-3 py-2 text-right">À cmd</th>
            <th className="px-3 py-2 text-right">Prix u.</th>
            <th className="px-3 py-2 text-right">Valeur</th>
            <th className="px-3 py-2 text-center">Statut</th>
            <th className="px-3 py-2 text-left">Fournisseur</th>
            {canEdit && <th className="px-3 py-2 text-center w-12">Suppr.</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-stoniz-gray-100">
          {rows.map((r) => (
            <StockRowItem key={r.id} row={r} canEdit={canEdit} />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={canEdit ? 11 : 10} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                Aucun consommable pour ces filtres.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StockRowItem({ row, canEdit }: { row: StockRow; canEdit: boolean }) {
  const [stockDrawerOpen, setStockDrawerOpen] = useState(false);
  return (
    <tr className="hover:bg-stoniz-gray-50">
      <td className="px-3 py-2 font-mono text-xs">{row.reference}</td>
      <td className="px-3 py-2 text-xs">
        <EditableText
          value={row.name}
          field="name"
          consumableId={row.id}
          canEdit={canEdit}
          minWidth="160px"
        />
      </td>
      <td className="px-3 py-2 text-xs">{row.category}</td>

      {/* Stock — clic ouvre le drawer d'ajustement */}
      <td className={`px-3 py-2 text-right text-xs font-medium ${
        row.status === 'rupture' ? 'text-red-700' :
        row.status === 'alerte' ? 'text-orange-700' : ''
      }`}>
        {canEdit ? (
          <button
            type="button"
            onClick={() => setStockDrawerOpen(true)}
            className="hover:underline hover:text-stoniz-black"
            title="Cliquer pour ajuster le stock"
          >
            {fmt(row.current_stock)} {row.unit ?? ''}
          </button>
        ) : (
          <>{fmt(row.current_stock)} {row.unit ?? ''}</>
        )}
      </td>

      <td className="px-3 py-2 text-right text-xs text-stoniz-gray-600">
        <EditableNumber
          value={row.min_threshold}
          field="min_threshold"
          consumableId={row.id}
          canEdit={canEdit}
        />
      </td>

      <td className="px-3 py-2 text-right text-xs">
        <EditableNumber
          value={row.default_order_qty ?? 0}
          field="default_order_qty"
          consumableId={row.id}
          canEdit={canEdit}
          placeholder="—"
        />
      </td>

      <td className="px-3 py-2 text-right text-xs">
        <EditableNumber
          value={row.unit_price_mad}
          field="unit_price_mad"
          consumableId={row.id}
          canEdit={canEdit}
          suffix=" DH"
        />
      </td>

      <td className="px-3 py-2 text-right text-xs">{fmtMad(row.stock_value_mad)}</td>

      <td className="px-3 py-2 text-center">
        <span className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[row.status]}`}>
          {STATUS_LABEL[row.status]}
        </span>
      </td>

      <td className="px-3 py-2 text-xs">
        <EditableText
          value={row.supplier ?? ''}
          field="supplier"
          consumableId={row.id}
          canEdit={canEdit}
          placeholder="—"
          minWidth="120px"
        />
      </td>

      {canEdit && (
        <td className="px-3 py-2 text-center">
          <ArchiveButton consumableId={row.id} name={row.name} />
        </td>
      )}

      {stockDrawerOpen && (
        <PortaledModal>
          <AdjustStockDrawer row={row} onClose={() => setStockDrawerOpen(false)} />
        </PortaledModal>
      )}
    </tr>
  );
}

function PortaledModal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

function EditableText({
  value,
  field,
  consumableId,
  canEdit,
  placeholder = '',
  minWidth = '100px',
}: {
  value: string;
  field: string;
  consumableId: string;
  canEdit: boolean;
  placeholder?: string;
  minWidth?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (val === value) { setEditing(false); return; }
    setError(null);
    start(async () => {
      const r = await patchConsumableFieldAction({ id: consumableId, field, value: val });
      if (!r.ok) {
        setError(r.error);
        setVal(value);
        return;
      }
      setEditing(false);
    });
  }

  if (!canEdit) return <span>{value || placeholder}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-left hover:underline hover:text-stoniz-black inline-flex items-center gap-1 group"
        title="Cliquer pour modifier"
      >
        {value || <span className="text-stoniz-gray-400">{placeholder}</span>}
        <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-50" />
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setVal(value); setEditing(false); }
        }}
        autoFocus
        disabled={pending}
        style={{ minWidth }}
        className="px-1.5 py-0.5 text-xs border border-stoniz-gray-300 rounded"
      />
      {pending && <Loader2 className="w-3 h-3 animate-spin text-stoniz-gray-500" />}
      {error && <span className="text-[9px] text-red-600">{error}</span>}
    </div>
  );
}

function EditableNumber({
  value,
  field,
  consumableId,
  canEdit,
  placeholder = '',
  suffix = '',
}: {
  value: number;
  field: string;
  consumableId: string;
  canEdit: boolean;
  placeholder?: string;
  suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save() {
    if (Number(val) === value) { setEditing(false); return; }
    setError(null);
    start(async () => {
      const r = await patchConsumableFieldAction({ id: consumableId, field, value: val });
      if (!r.ok) {
        setError(r.error);
        setVal(String(value));
        return;
      }
      setEditing(false);
    });
  }

  if (!canEdit) return <span>{value > 0 ? fmt(value) + suffix : placeholder}</span>;

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="text-right hover:underline hover:text-stoniz-black"
        title="Cliquer pour modifier"
      >
        {value > 0 ? fmt(value) + suffix : <span className="text-stoniz-gray-400">{placeholder || '—'}</span>}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        step="any"
        min="0"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') { setVal(String(value)); setEditing(false); }
        }}
        autoFocus
        disabled={pending}
        className="w-20 px-1.5 py-0.5 text-xs text-right border border-stoniz-gray-300 rounded font-mono"
      />
      {pending && <Loader2 className="w-3 h-3 animate-spin text-stoniz-gray-500" />}
      {error && <span className="text-[9px] text-red-600">{error}</span>}
    </div>
  );
}

function AdjustStockDrawer({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const [newStock, setNewStock] = useState(String(row.current_stock));
  const [notes, setNotes] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setError(null);
    start(async () => {
      const r = await adjustStockAction({
        consumable_id: row.id,
        new_stock: newStock,
        notes: notes || null,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onClose();
    });
  }

  const target = Number(newStock);
  const delta = Number.isNaN(target) ? null : target - row.current_stock;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="font-display text-xl">Ajuster le stock</h2>
            <p className="text-xs text-stoniz-gray-500 mt-1">{row.reference} · {row.name}</p>
          </div>
          <button onClick={onClose} className="text-stoniz-gray-400 hover:text-stoniz-black">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="bg-stoniz-gray-50 rounded p-3 text-xs space-y-1">
          <div>Stock actuel : <strong>{fmt(row.current_stock)} {row.unit}</strong></div>
        </div>

        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Nouveau stock (en {row.unit ?? 'unité'})</label>
          <input
            type="number"
            step="any"
            min="0"
            value={newStock}
            onChange={(e) => setNewStock(e.target.value)}
            autoFocus
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
          />
          {delta !== null && delta !== 0 && (
            <p className={`text-[11px] mt-1 ${delta > 0 ? 'text-emerald-700' : 'text-orange-700'}`}>
              {delta > 0 ? `+ ${fmt(delta)}` : `− ${fmt(Math.abs(delta))}`} {row.unit} ·
              un mouvement {delta > 0 ? "d'entrée" : 'de sortie'} sera enregistré
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-stoniz-gray-600 block mb-1">Note (optionnel)</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex : Recomptage inventaire, casse, retour…"
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
        </div>

        {error && <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-700">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending || newStock === '' || delta === 0}
            className="bg-stoniz-black hover:bg-stoniz-gray-800 disabled:opacity-50 text-white px-4 py-2 rounded text-sm"
          >
            {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Enregistrer l\'ajustement'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ArchiveButton({ consumableId, name }: { consumableId: string; name: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    if (!confirm(`Archiver "${name}" ?\n\nL'article ne sera plus visible dans la liste mais son historique sera conservé.`)) return;
    setError(null);
    start(async () => {
      const r = await archiveConsumableAction(consumableId);
      if (!r.ok) {
        setError(r.error);
        alert(r.error);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      title="Archiver ce consommable"
      className="text-stoniz-gray-400 hover:text-red-600 disabled:opacity-30"
    >
      {pending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
    </button>
  );
}
