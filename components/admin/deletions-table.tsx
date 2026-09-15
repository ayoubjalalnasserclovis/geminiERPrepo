'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { RotateCcw, ChevronDown, ChevronRight, AlertCircle, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { restoreDeletionAction, type DeletionRow } from '@/app/actions/deletions';

/**
 * Tableau client pour la corbeille admin.
 *
 * - Filtres (table, période, recherche) → mis à jour via query params Next
 * - Expand par ligne → affiche le snapshot JSON pretty-printed
 * - Bouton "Restaurer" CEO uniquement (note optionnelle)
 */

const TABLE_LABELS: Record<string, string> = {
  travaux_lots: 'Lot travaux',
  achats_lots: 'Lot achats',
  services_lots: 'Lot services',
  travaux_payments: 'Paiement artisan',
  achats_payments: 'Paiement fournisseur',
  services_payments: 'Paiement prestataire',
  payments: 'Honoraire Stoniz',
  travaux_encaissements: 'Encaissement travaux',
  achats_encaissements: 'Encaissement achats',
  projects: 'Projet',
  properties: 'Bien',
  partners: 'Client',
  artisans: 'Artisan / fournisseur',
  propria_interventions: 'Intervention propria',
  propria_cleanings: 'Ménage propria',
  propria_litiges: 'Litige propria',
};

const PERIODS = [
  { v: '7d', label: '7 jours' },
  { v: '30d', label: '30 jours' },
  { v: '90d', label: '90 jours' },
  { v: 'all', label: 'Tout' },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

function tableLabel(t: string): string {
  return TABLE_LABELS[t] ?? t;
}

export function DeletionsTable({
  initialRows,
  currentFilters,
  canRestore,
}: {
  initialRows: DeletionRow[];
  currentFilters: {
    tableName: string | null;
    period: string;
    search: string | null;
    showRestored: boolean;
  };
  canRestore: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [searchText, setSearchText] = useState(currentFilters.search ?? '');
  const [actionError, setActionError] = useState<string | null>(null);

  function setFilter(key: string, value: string | null) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== '') next.set(key, value);
    else next.delete(key);
    router.push(`${pathname}?${next.toString()}`);
  }

  function submitSearch(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFilter('q', searchText.trim() || null);
  }

  function resetSearch() {
    setSearchText('');
    setFilter('q', null);
  }

  async function onRestore(row: DeletionRow) {
    const note = prompt(
      `Restaurer "${row.record_label ?? tableLabel(row.table_name)}" ?\n\n` +
        `Note (optionnelle, sera enregistrée dans le log) :`,
      '',
    );
    if (note === null) return; // Annulé
    setActionError(null);
    start(async () => {
      const r = await restoreDeletionAction(row.id, note || undefined);
      if (!r.ok) {
        setActionError(r.error);
      } else {
        router.refresh();
      }
    });
  }

  // Liste unique des tables présentes pour le select
  const tablesPresent = Array.from(
    new Set([...initialRows.map((r) => r.table_name), currentFilters.tableName].filter(Boolean) as string[]),
  ).sort();

  return (
    <div className="space-y-3">
      {/* Filtres */}
      <Card className="p-3 flex flex-wrap items-center gap-2">
        <select
          value={currentFilters.tableName ?? ''}
          onChange={(e) => setFilter('table', e.target.value || null)}
          className="text-sm border border-stoniz-gray-300 rounded px-2 py-1.5 bg-white"
        >
          <option value="">Tous les types</option>
          {tablesPresent.map((t) => (
            <option key={t} value={t}>
              {tableLabel(t)}
            </option>
          ))}
        </select>

        <div className="inline-flex rounded border border-stoniz-gray-300 overflow-hidden bg-white">
          {PERIODS.map((p) => (
            <button
              key={p.v}
              type="button"
              onClick={() => setFilter('period', p.v)}
              className={`text-xs px-3 py-1.5 ${
                currentFilters.period === p.v
                  ? 'bg-stoniz-black text-white'
                  : 'hover:bg-stoniz-gray-50 text-stoniz-gray-700'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <form onSubmit={submitSearch} className="inline-flex items-center gap-1">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Rechercher dans le libellé…"
              className="text-sm border border-stoniz-gray-300 rounded pl-7 pr-2 py-1.5 w-64 bg-white"
            />
            {searchText && (
              <button
                type="button"
                onClick={resetSearch}
                className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 text-stoniz-gray-400 hover:text-stoniz-black"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <Button size="sm" type="submit">
            OK
          </Button>
        </form>

        <label className="inline-flex items-center gap-1.5 text-xs text-stoniz-gray-700 ml-auto cursor-pointer">
          <input
            type="checkbox"
            checked={currentFilters.showRestored}
            onChange={(e) => setFilter('restored', e.target.checked ? '1' : null)}
          />
          Inclure les éléments déjà restaurés
        </label>
      </Card>

      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {actionError}
        </div>
      )}

      {/* Liste */}
      {initialRows.length === 0 ? (
        <Card className="p-8 text-center text-stoniz-gray-500 text-sm">
          Aucune suppression à afficher avec ces filtres.
        </Card>
      ) : (
        <Card>
          <ul className="divide-y divide-stoniz-gray-200">
            {initialRows.map((row) => {
              const isOpen = expanded === row.id;
              const isRestored = !!row.restored_at;
              return (
                <li key={row.id} className={isRestored ? 'opacity-60' : ''}>
                  <div
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-stoniz-gray-50 cursor-pointer"
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                  >
                    {isOpen ? (
                      <ChevronDown className="w-4 h-4 text-stoniz-gray-400 shrink-0" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-stoniz-gray-400 shrink-0" />
                    )}
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-600 shrink-0">
                      {tableLabel(row.table_name)}
                    </span>
                    <span className="text-sm flex-1 truncate">
                      {row.record_label ?? <span className="italic text-stoniz-gray-400">Sans libellé</span>}
                    </span>
                    <span className="text-xs text-stoniz-gray-500 shrink-0">
                      {row.deleted_by_name ?? <span className="italic">(auteur supprimé)</span>}
                    </span>
                    <span className="text-xs text-stoniz-gray-500 shrink-0 w-32 text-right">
                      {fmtDateTime(row.deleted_at)}
                    </span>
                    {isRestored ? (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 shrink-0">
                        Restauré
                      </span>
                    ) : canRestore ? (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={(e) => {
                          e.stopPropagation();
                          onRestore(row);
                        }}
                        title="Restaurer"
                        className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:text-emerald-900 px-2 py-1 rounded hover:bg-emerald-50 disabled:opacity-50 shrink-0"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restaurer
                      </button>
                    ) : (
                      <span className="w-[80px] shrink-0" />
                    )}
                  </div>

                  {isOpen && (
                    <div className="bg-stoniz-gray-50 px-4 py-3 text-xs border-t border-stoniz-gray-200">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <span className="text-stoniz-gray-500">Table :</span>{' '}
                          <span className="font-mono">{row.table_name}</span>
                        </div>
                        <div>
                          <span className="text-stoniz-gray-500">Record ID :</span>{' '}
                          <span className="font-mono">{row.record_id}</span>
                        </div>
                        {isRestored && (
                          <>
                            <div>
                              <span className="text-stoniz-gray-500">Restauré le :</span>{' '}
                              {fmtDateTime(row.restored_at!)}
                            </div>
                            <div>
                              <span className="text-stoniz-gray-500">Restauré par :</span>{' '}
                              {row.restored_by_name ?? <span className="italic">(?)</span>}
                            </div>
                            {row.restore_note && (
                              <div className="col-span-2">
                                <span className="text-stoniz-gray-500">Note :</span> {row.restore_note}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      <details>
                        <summary className="cursor-pointer text-stoniz-gray-600 hover:text-stoniz-black select-none">
                          Snapshot complet
                        </summary>
                        <pre className="mt-2 bg-white border border-stoniz-gray-200 rounded p-2 overflow-auto max-h-80 text-[10px]">
                          {JSON.stringify(row.snapshot, null, 2)}
                        </pre>
                      </details>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
