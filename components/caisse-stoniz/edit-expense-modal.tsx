'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, X } from 'lucide-react';
import { updateStonizExpenseAction } from '@/app/(team)/caisse-stoniz/actions';

/**
 * Édition d'une dépense Caisse STONIZ (CEO 2026-06-22).
 *
 * Affiche un petit bouton "✏️ Éditer" qui ouvre une modale avec un formulaire
 * minimal (montant, description, catégorie). Soumet via la server action
 * updateStonizExpenseAction(id, { amount, label, category }).
 *
 * Visibilité contrôlée côté parent — n'affiche le bouton que si l'utilisateur
 * en a le droit (auteur ou CEO).
 */
export function EditExpenseModal({
  expense,
  categories,
}: {
  expense: {
    id: string;
    amount_mad: number | string | null;
    description: string | null;
    category: string | null;
  };
  categories: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState(String(expense.amount_mad ?? ''));
  const [label, setLabel] = useState(expense.description ?? '');
  const [category, setCategory] = useState(expense.category ?? '');
  const [customCategory, setCustomCategory] = useState('');

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const finalCategory = category === '__other__'
      ? customCategory.trim() || null
      : (category || null);
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      setError('Montant invalide');
      return;
    }
    if (!label.trim()) {
      setError('Description requise');
      return;
    }
    start(async () => {
      try {
        const res = await updateStonizExpenseAction(expense.id, {
          amount_mad: amountNum,
          description: label.trim(),
          category: finalCategory,
        });
        if (res && typeof res === 'object' && 'ok' in res && (res as any).ok === false) {
          setError((res as any).error ?? 'Erreur inconnue');
          return;
        }
        setOpen(false);
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur réseau');
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-stoniz-gray-500 hover:text-stoniz-black text-[11px]"
        title="Modifier cette dépense"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-stoniz-gray-200 p-4 flex items-center justify-between">
              <h2 className="font-display text-lg inline-flex items-center gap-2">
                <Pencil className="w-4 h-4 text-stoniz-gray-600" />
                Modifier la dépense
              </h2>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                className="text-stoniz-gray-500 hover:text-stoniz-black p-1 disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="p-4 space-y-3 overflow-y-auto">
              <div>
                <label className="text-xs text-stoniz-gray-600 block mb-1">Montant (MAD) *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-stoniz-black"
                />
              </div>

              <div>
                <label className="text-xs text-stoniz-gray-600 block mb-1">Description *</label>
                <input
                  type="text"
                  required
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-stoniz-black"
                />
              </div>

              <div>
                <label className="text-xs text-stoniz-gray-600 block mb-1">Catégorie</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-stoniz-black"
                >
                  <option value="">— Aucune —</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {expense.category && !categories.includes(expense.category) && (
                    <option value={expense.category}>{expense.category}</option>
                  )}
                  <option value="__other__">+ Autre…</option>
                </select>
                {category === '__other__' && (
                  <input
                    type="text"
                    placeholder="Nouvelle catégorie"
                    value={customCategory}
                    onChange={(e) => setCustomCategory(e.target.value)}
                    className="mt-2 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-base sm:text-sm focus:outline-none focus:border-stoniz-black"
                  />
                )}
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-xs rounded p-2.5">
                  {error}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={close}
                  disabled={pending}
                  className="px-3 py-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="px-4 py-2 text-sm bg-stoniz-black text-white rounded hover:bg-stoniz-gray-800 disabled:opacity-50"
                >
                  {pending ? 'Enregistrement…' : 'Sauvegarder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
