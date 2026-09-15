'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { X, Search, ArrowUpDown } from 'lucide-react';

/**
 * Drawer affichant la liste complète des paiements à recouvrer.
 * Ouvert via un bouton "Voir tous (X)" depuis le bandeau RecouvrementBanner.
 *
 * Features : recherche par projet/client, tri par date ou montant.
 */

export type RecouvrementItem = {
  id: string;
  kind: 'travaux' | 'achats';
  project_id: string;
  project_ref: string;
  client_name: string;
  amount_mad: number;
  scheduled_date: string;
  delay_days: number;
};

function fmtMad(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' DH';
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' });
}

export function RecouvrementDrawerButton({
  items,
  label,
  variant,
}: {
  items: RecouvrementItem[];
  label: string;
  variant: 'retard' | 'venir';
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sortKey, setSortKey] = useState<'date' | 'amount'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const filtered = useMemo(() => {
    const query = q.toLowerCase().trim();
    let list = items;
    if (query) {
      list = items.filter(
        (i) =>
          i.project_ref.toLowerCase().includes(query) ||
          i.client_name.toLowerCase().includes(query),
      );
    }
    list = [...list].sort((a, b) => {
      let cmp = 0;
      if (sortKey === 'date') cmp = a.scheduled_date.localeCompare(b.scheduled_date);
      else cmp = a.amount_mad - b.amount_mad;
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [items, q, sortKey, sortDir]);

  const total = filtered.reduce((s, i) => s + i.amount_mad, 0);

  function toggleSort(k: 'date' | 'amount') {
    if (sortKey === k) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(k);
      setSortDir('asc');
    }
  }

  if (items.length === 0) return null;

  const color = variant === 'retard'
    ? 'text-red-700 hover:text-red-900'
    : 'text-orange-700 hover:text-orange-900';

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`text-xs ${color} hover:underline font-medium`}
      >
        {label} →
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex justify-end"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full max-w-2xl h-full overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="sticky top-0 bg-white border-b border-stoniz-gray-200 p-5 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-medium">
                  {variant === 'retard' ? '🔴' : '🟠'} {variant === 'retard' ? 'Paiements en retard' : 'À encaisser dans 30 jours'}
                </h2>
                <p className="text-xs text-stoniz-gray-600 mt-0.5">
                  {filtered.length} paiement{filtered.length > 1 ? 's' : ''} · <strong>{fmtMad(total)}</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stoniz-gray-500 hover:text-stoniz-black"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Toolbar */}
            <div className="p-4 border-b border-stoniz-gray-100 flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 text-stoniz-gray-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Rechercher par projet ou client…"
                  className="w-full border border-stoniz-gray-300 rounded px-7 py-1.5 text-xs"
                />
              </div>
              <button
                type="button"
                onClick={() => toggleSort('date')}
                className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1 ${sortKey === 'date' ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'}`}
              >
                <ArrowUpDown className="w-3 h-3" /> Date {sortKey === 'date' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
              <button
                type="button"
                onClick={() => toggleSort('amount')}
                className={`text-xs px-2 py-1 rounded border inline-flex items-center gap-1 ${sortKey === 'amount' ? 'bg-stoniz-black text-white border-stoniz-black' : 'border-stoniz-gray-300 hover:bg-stoniz-gray-50'}`}
              >
                <ArrowUpDown className="w-3 h-3" /> Montant {sortKey === 'amount' ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            </div>

            {/* Liste */}
            <ul className="divide-y divide-stoniz-gray-100">
              {filtered.map((i) => (
                <li key={`${i.kind}-${i.id}`}>
                  <Link
                    href={`/projects/${i.project_id}/${i.kind}`}
                    onClick={() => setOpen(false)}
                    className={`block px-5 py-3 hover:bg-stoniz-gray-50 transition-colors border-l-4 ${variant === 'retard' ? 'border-l-red-400 hover:bg-red-50' : 'border-l-orange-400 hover:bg-orange-50'}`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-sm font-medium truncate">{i.project_ref}</span>
                      <span className={`text-sm font-mono font-medium ${variant === 'retard' ? 'text-red-800' : 'text-orange-800'}`}>
                        {fmtMad(i.amount_mad)}
                      </span>
                    </div>
                    <div className="text-xs text-stoniz-gray-600 truncate">{i.client_name}</div>
                    <div className="text-[10px] flex items-center gap-2 mt-1">
                      <span className={variant === 'retard' ? 'text-red-700' : 'text-orange-700'}>
                        Échéance {fmtDate(i.scheduled_date)}
                      </span>
                      <span className={`font-medium ${variant === 'retard' ? 'text-red-700' : 'text-orange-700'}`}>
                        {i.delay_days < 0
                          ? `🔴 Retard ${Math.abs(i.delay_days)}j`
                          : i.delay_days === 0
                            ? "🟠 Aujourd'hui"
                            : `Dans ${i.delay_days}j`}
                      </span>
                      <span className="bg-stoniz-gray-100 px-1 rounded text-stoniz-gray-700 uppercase">{i.kind}</span>
                    </div>
                  </Link>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-5 py-8 text-center text-sm text-stoniz-gray-500">
                  Aucun résultat pour cette recherche
                </li>
              )}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
