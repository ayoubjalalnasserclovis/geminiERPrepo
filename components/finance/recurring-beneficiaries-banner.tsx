'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Sparkles, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Bandeau de groupement intelligent (CEO 2026-06-16).
 *
 * Détecte les bénéficiaires qui reviennent plusieurs fois dans les
 * transactions non / partiellement allouées et propose en 1 clic d'aller
 * filtrer dessus pour les traiter en bloc.
 *
 * Exemple : "5 transactions OUACHAOU TRAVAUX (70 000 MAD au total) — Voir"
 *
 * Le clic met `?q=OUACHAOU TRAVAUX` dans l'URL, ce qui active le filtre
 * et te permet d'utiliser la sélection multiple existante (TransactionsBulkTable)
 * pour allouer en bloc.
 */

type Tx = {
  id: string;
  beneficiary: string | null;
  label: string | null;
  amount: number;
  operation_date: string | null;
};

function cleanBeneficiary(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function RecurringBeneficiariesBanner({ transactions }: { transactions: Tx[] }) {
  const [open, setOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, { name: string; count: number; total: number; ids: string[] }>();
    for (const t of transactions) {
      const raw = (t.beneficiary || '').trim();
      if (!raw || raw.length < 3) continue;
      const key = cleanBeneficiary(raw);
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        existing.total += t.amount;
        existing.ids.push(t.id);
      } else {
        map.set(key, { name: raw, count: 1, total: t.amount, ids: [t.id] });
      }
    }
    return Array.from(map.values())
      .filter((g) => g.count >= 2)
      .sort((a, b) => b.total - a.total);
  }, [transactions]);

  if (groups.length === 0) return null;

  const top = groups.slice(0, open ? groups.length : 4);
  const fmtMad = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';

  return (
    <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-indigo-700" />
          <span className="text-sm font-medium text-indigo-900">
            Bénéficiaires récurrents à allouer en bloc
          </span>
          <span className="text-xs text-indigo-700">
            ({groups.length} bénéficiaire{groups.length > 1 ? 's' : ''} détecté{groups.length > 1 ? 's' : ''})
          </span>
        </div>
        {groups.length > 4 && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs text-indigo-700 hover:text-indigo-900"
          >
            {open ? (
              <>
                <ChevronDown className="w-3 h-3" />
                Voir moins
              </>
            ) : (
              <>
                <ChevronRight className="w-3 h-3" />
                Voir tous ({groups.length})
              </>
            )}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {top.map((g) => (
          <Link
            key={g.name}
            href={`?q=${encodeURIComponent(g.name)}`}
            className="flex items-center justify-between gap-3 bg-white border border-indigo-100 rounded-lg px-3 py-2 hover:border-indigo-300 hover:shadow-sm transition-all"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stoniz-black truncate">{g.name}</div>
              <div className="text-[11px] text-stoniz-gray-500">
                {g.count} transactions · {fmtMad(g.total)}
              </div>
            </div>
            <span className="text-xs text-indigo-700 shrink-0">Filtrer →</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
