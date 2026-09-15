'use client';

import { useMemo, useRef, useState, useTransition, useEffect } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { createMovementAction } from '@/app/(team)/propria/stock/actions';

export type ConsumableOpt = {
  id: string;
  reference: string;
  name: string;
  category: string;
  unit: string | null;
  unit_price_mad: number | null;
};

export type LotOpt = {
  id: string;
  label: string;
};

export function MovementForm({
  consumables,
  lots,
}: {
  consumables: ConsumableOpt[];
  lots: LotOpt[];
}) {
  const [consumableId, setConsumableId] = useState('');
  const [movementType, setMovementType] = useState<'entree' | 'sortie' | 'ajustement'>('sortie');

  const selected = useMemo(
    () => consumables.find(c => c.id === consumableId) ?? null,
    [consumables, consumableId],
  );

  // Prix : seulement pertinent pour les entrées (achat).
  // Pré-rempli avec le prix catalogue, modifiable, fallback côté serveur si vide.
  const [unitPrice, setUnitPrice] = useState<string>('');

  // Quand on change de produit en mode "entrée", on pré-remplit le prix catalogue
  useEffect(() => {
    if (movementType === 'entree' && selected?.unit_price_mad != null) {
      setUnitPrice(String(selected.unit_price_mad));
    }
  }, [selected, movementType]);

  // Quand on quitte le mode "entrée", on nettoie le champ prix (il sera caché)
  useEffect(() => {
    if (movementType !== 'entree') setUnitPrice('');
  }, [movementType]);

  // Toast léger
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
        await createMovementAction(formData);
        setToast({ kind: 'success', message: 'Mouvement enregistré ✓' });
        formRef.current?.reset();
        setConsumableId('');
        setMovementType('sortie');
        setUnitPrice('');
      } catch (err: any) {
        setToast({
          kind: 'error',
          message: err?.message ? `Erreur : ${err.message}` : 'Erreur lors de l’enregistrement',
        });
      }
    });
  }

  const showPriceField = movementType === 'entree';
  const inputCls = 'border border-stoniz-gray-300 rounded px-3 py-2 text-sm';

  return (
    <>
      <form
        ref={formRef}
        onSubmit={handleSubmit}
        className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3"
      >
        {/* Produit */}
        <select
          name="consumable_id"
          required
          value={consumableId}
          onChange={(e) => setConsumableId(e.target.value)}
          className={`${inputCls} md:col-span-2`}
        >
          <option value="">— Produit *</option>
          {consumables.map(c => (
            <option key={c.id} value={c.id}>
              {c.reference} · {c.name} ({c.category})
            </option>
          ))}
        </select>

        {/* Type */}
        <select
          name="movement_type"
          required
          value={movementType}
          onChange={(e) => setMovementType(e.target.value as any)}
          className={inputCls}
        >
          <option value="entree">Entrée (réception)</option>
          <option value="sortie">Sortie (utilisation)</option>
          <option value="ajustement">Ajustement</option>
        </select>

        {/* Date */}
        <input
          name="movement_date"
          type="date"
          required
          defaultValue={new Date().toISOString().slice(0, 10)}
          className={inputCls}
        />

        {/* Quantité */}
        <input
          name="quantity"
          type="number"
          step="0.01"
          required
          placeholder={`Quantité *${selected?.unit ? ` (${selected.unit})` : ''}`}
          className={inputCls}
        />

        {/* Prix unitaire : visible uniquement pour les entrées */}
        {showPriceField ? (
          <div className="flex flex-col">
            <input
              name="unit_price_mad"
              type="number"
              step="0.01"
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="Prix unit. MAD"
              className={inputCls}
            />
            {selected?.unit_price_mad != null && (
              <span className="text-[10px] text-stoniz-gray-500 mt-1">
                Prix catalogue : {selected.unit_price_mad} DH
                {Number(unitPrice) > 0 && Number(unitPrice) !== Number(selected.unit_price_mad) && (
                  <span className="text-orange-600 ml-1">· différent du catalogue</span>
                )}
              </span>
            )}
          </div>
        ) : (
          // Place-holder vide pour conserver la grille 3 colonnes
          <div aria-hidden className="hidden md:block" />
        )}

        {/* Lot (si sortie) */}
        <select name="propria_unit_id" className={inputCls}>
          <option value="">— Lot (si sortie) —</option>
          {lots.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>

        {/* Source/Destination */}
        <input
          name="source_destination"
          placeholder="Source/Destination"
          className={`${inputCls} md:col-span-2`}
        />

        {/* Notes */}
        <input
          name="notes"
          placeholder="Notes"
          className={`${inputCls} md:col-span-3`}
        />

        <div className="md:col-span-3">
          <button
            type="submit"
            disabled={isPending}
            className="w-full bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
          >
            {isPending ? 'Enregistrement…' : 'Enregistrer le mouvement'}
          </button>
        </div>
      </form>

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
    </>
  );
}
