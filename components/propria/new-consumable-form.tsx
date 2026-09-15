'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Plus, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { createConsumableAction } from '@/app/(team)/propria/stock/actions';

// Mêmes catégories que côté serveur — un seul endroit à éditer pour les codes
const CATEGORIES: { value: string; prefix: string }[] = [
  { value: 'Cuisine',         prefix: 'CUI' },
  { value: 'Linge',           prefix: 'LIN' },
  { value: 'Toilettes',       prefix: 'TOI' },
  { value: 'Salle de bain',   prefix: 'SDB' },
  { value: 'Ménage',          prefix: 'MEN' },
  { value: 'Décoration',      prefix: 'DEC' },
  { value: 'Mobilier',        prefix: 'MOB' },
  { value: 'Électroménager',  prefix: 'ELE' },
  { value: 'Vaisselle',       prefix: 'VAI' },
  { value: 'Petit-déjeuner',  prefix: 'PDJ' },
  { value: 'Hygiène',         prefix: 'HYG' },
  { value: 'Autre',           prefix: 'AUT' },
];

const UNITS = [
  { value: 'pcs',     label: 'Pièce(s)' },
  { value: 'paire',   label: 'Paire' },
  { value: 'lot',     label: 'Lot' },
  { value: 'kg',      label: 'Kilogramme' },
  { value: 'g',       label: 'Gramme' },
  { value: 'L',       label: 'Litre' },
  { value: 'mL',      label: 'Millilitre' },
  { value: 'm',       label: 'Mètre' },
  { value: 'rouleau', label: 'Rouleau' },
  { value: 'boîte',   label: 'Boîte' },
  { value: 'paquet',  label: 'Paquet' },
  { value: 'sachet',  label: 'Sachet' },
  { value: 'carton',  label: 'Carton' },
];

export function NewConsumableForm({
  existingSuppliers,
  existingPreviews,
}: {
  existingSuppliers: string[];
  /** Pour chaque préfixe catégorie, dernière référence existante (preview) */
  existingPreviews: Record<string, string>;
}) {
  const [category, setCategory] = useState<string>('');
  const prefix = CATEGORIES.find(c => c.value === category)?.prefix ?? '';
  const previewRef = prefix ? nextRefPreview(prefix, existingPreviews[prefix]) : '';

  // Combobox fournisseur
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierOpen, setSupplierOpen] = useState(false);
  const filteredSuppliers = supplierQuery
    ? existingSuppliers.filter(s => s.toLowerCase().includes(supplierQuery.toLowerCase()))
    : existingSuppliers.slice(0, 10);
  const exactSupplier = existingSuppliers.find(s => s.toLowerCase() === supplierQuery.trim().toLowerCase());
  const showCreateSupplier = supplierQuery.trim().length >= 2 && !exactSupplier;

  // Toast léger (auto-dismiss)
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.kind === 'success' ? 2500 : 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await createConsumableAction(formData);
        setToast({ kind: 'success', message: 'Consommable ajouté ✓' });
        formRef.current?.reset();
        setCategory('');
        setSupplierQuery('');
      } catch (err: any) {
        setToast({
          kind: 'error',
          message: err?.message ? `Erreur : ${err.message}` : 'Erreur lors de l’ajout',
        });
      }
    });
  }

  const inputCls = 'mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-stoniz-black/30';
  const labelCls = 'text-xs text-stoniz-gray-600';

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* 1. Catégorie (en premier — pilote la référence) */}
      <div>
        <label className={labelCls}>Catégorie *</label>
        <select
          name="category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          required
          className={inputCls}
        >
          <option value="">— Choisir —</option>
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.value} ({c.prefix})</option>
          ))}
        </select>
      </div>

      {/* 2. Référence auto-générée (read-only, preview live) */}
      <div>
        <label className={labelCls}>
          Référence
          <span className="ml-1 text-stoniz-gray-500 text-[10px]">(auto)</span>
        </label>
        <input
          type="text"
          value={previewRef}
          disabled
          placeholder="Choisis une catégorie…"
          className={`${inputCls} bg-stoniz-gray-50 text-stoniz-gray-600 font-mono`}
        />
        {/* Champ caché vide → l'action serveur la régénère côté serveur (anti-collision) */}
        <input type="hidden" name="reference" value="" />
      </div>

      {/* 3. Nom */}
      <div>
        <label className={labelCls}>Nom du produit *</label>
        <input name="name" required placeholder="ex : Liquide vaisselle 1L" className={inputCls} />
      </div>

      {/* 4. Unité */}
      <div>
        <label className={labelCls}>Unité *</label>
        <select name="unit" required defaultValue="" className={inputCls}>
          <option value="">— Choisir —</option>
          {UNITS.map(u => (
            <option key={u.value} value={u.value}>{u.label}</option>
          ))}
        </select>
      </div>

      {/* 5. Prix unitaire */}
      <div>
        <label className={labelCls}>Prix unitaire (MAD) *</label>
        <input
          name="unit_price_mad"
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="ex : 18.50"
          className={inputCls}
        />
      </div>

      {/* 6. Stock initial */}
      <div>
        <label className={labelCls}>Stock initial *</label>
        <input
          name="initial_stock"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="0"
          className={inputCls}
        />
      </div>

      {/* 7. Seuil minimum */}
      <div>
        <label className={labelCls}>Seuil d'alerte minimum *</label>
        <input
          name="min_threshold"
          type="number"
          step="0.01"
          min="0"
          required
          placeholder="ex : 5"
          className={inputCls}
        />
      </div>

      {/* 8. Qté de commande par défaut */}
      <div>
        <label className={labelCls}>Qté commande par défaut *</label>
        <input
          name="default_order_qty"
          type="number"
          step="0.01"
          min="0.01"
          required
          placeholder="ex : 20"
          className={inputCls}
        />
      </div>

      {/* 9. Fournisseur — combobox (existant ou créer à la volée) */}
      <div className="relative">
        <label className={labelCls}>Fournisseur *</label>
        <div className="relative mt-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stoniz-gray-400 pointer-events-none" />
          <input
            type="text"
            value={supplierQuery}
            onChange={(e) => { setSupplierQuery(e.target.value); setSupplierOpen(true); }}
            onFocus={() => setSupplierOpen(true)}
            onBlur={() => setTimeout(() => setSupplierOpen(false), 150)}
            placeholder="Rechercher ou créer…"
            required
            className={`${inputCls} mt-0 pl-8`}
          />
          <input type="hidden" name="supplier" value={supplierQuery} />
        </div>
        {supplierOpen && (filteredSuppliers.length > 0 || showCreateSupplier) && (
          <div className="absolute z-20 mt-1 w-full bg-white border border-stoniz-gray-200 rounded-md shadow-lg max-h-56 overflow-y-auto">
            {filteredSuppliers.map(s => (
              <button
                type="button"
                key={s}
                onClick={() => { setSupplierQuery(s); setSupplierOpen(false); }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-stoniz-gray-50 flex items-center gap-2"
              >
                {s === supplierQuery && <Check className="w-3 h-3 text-stoniz-black" />}
                <span className={s === supplierQuery ? 'font-medium' : ''}>{s}</span>
              </button>
            ))}
            {showCreateSupplier && (
              <div className="border-t border-stoniz-gray-200">
                <button
                  type="button"
                  onClick={() => setSupplierOpen(false)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-yellow/20 flex items-center gap-2"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Créer « <strong>{supplierQuery.trim()}</strong> »
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="md:col-span-3">
        <button
          type="submit"
          disabled={!category || isPending}
          className="w-full bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {isPending ? 'Ajout en cours…' : '+ Ajouter le consommable'}
        </button>
      </div>

      {/* Toast léger (bottom-right, auto-dismiss) */}
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
    </form>
  );
}

function nextRefPreview(prefix: string, lastRef: string | undefined): string {
  if (!lastRef) return `${prefix}-001`;
  const m = lastRef.match(/-(\d+)$/);
  if (!m) return `${prefix}-001`;
  const next = parseInt(m[1], 10) + 1;
  return `${prefix}-${String(next).padStart(3, '0')}`;
}
