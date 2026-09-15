'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { CheckSquare, Square, Loader2, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { CATEGORY_LABELS } from '@/lib/finance/bank-categorizer';
import { bulkAllocateChargesAction } from './transactions/actions';
import { QuickAllocateButton } from '@/components/finance/quick-allocate-button';

const BULK_TYPE_LABELS: Record<string, string> = {
  cabinet_charge: 'Charge cabinet (loyer, salaires, télécom…)',
  cabinet_fiscal: 'Fiscal — DGI / TVA / IS',
  cabinet_social: 'Social — CNSS',
  frais_bancaire: 'Frais bancaire',
  intercompany: 'Intercompany (transfert entre sociétés)',
  autre: 'Autre',
};

type Tx = {
  id: string;
  operation_date: string;
  label: string | null;
  category_code: string | null;
  debit_mad: number | null;
  credit_mad: number | null;
  is_pending: boolean;
  account?: { bank_label?: string | null } | null;
  _statusLabel: 'unallocated' | 'partial' | 'allocated' | 'pending';
  _remaining: number;
};

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

function fmtNumber(n: number | null | undefined) {
  if (n == null) return '';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n));
}

function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' MAD';
}

type SortableCol = 'date' | 'debit' | 'credit' | 'category' | 'account';

export function TransactionsBulkTable({
  transactions,
  canWrite,
  sortKey,
  sortDir,
  sortHrefs,
}: {
  transactions: Tx[];
  canWrite: boolean;
  sortKey?: SortableCol;
  sortDir?: 'asc' | 'desc';
  sortHrefs?: Partial<Record<SortableCol, string>> & { date: string; debit: string; credit: string };
}) {
  const sortable = !!sortHrefs;
  function SortIcon({ col }: { col: SortableCol }) {
    if (sortKey !== col) return <ArrowUpDown className="w-3 h-3 inline opacity-30" />;
    return sortDir === 'asc'
      ? <ArrowUp className="w-3 h-3 inline text-stoniz-black" />
      : <ArrowDown className="w-3 h-3 inline text-stoniz-black" />;
  }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState<string>('cabinet_charge');
  const [bulkNote, setBulkNote] = useState<string>('');
  const [pending, start] = useTransition();
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  // On ne propose le bulk que pour les transactions encore allouables (remaining > 0, pas en attente)
  const selectableIds = useMemo(
    () => transactions.filter((t) => !t.is_pending && t._statusLabel !== 'allocated').map((t) => t.id),
    [transactions]
  );

  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const someSelected = selected.size > 0;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(selectableIds));
  }

  function clearSelection() {
    setSelected(new Set());
    setFeedback(null);
  }

  const selectedTxs = transactions.filter((t) => selected.has(t.id));
  const selectedTotalRemaining = selectedTxs.reduce((s, t) => s + t._remaining, 0);

  function onSubmit() {
    if (selected.size === 0) return;
    setFeedback(null);
    start(async () => {
      const result = await bulkAllocateChargesAction({
        transaction_ids: Array.from(selected),
        allocation_type: bulkType,
        notes: bulkNote.trim() || null,
      });
      if (!result.ok) {
        setFeedback({ kind: 'err', msg: result.error });
        return;
      }
      setFeedback({
        kind: 'ok',
        msg: `${result.created} allocation${result.created > 1 ? 's' : ''} créée${result.created > 1 ? 's' : ''}`
          + (result.skipped > 0 ? ` · ${result.skipped} déjà allouée${result.skipped > 1 ? 's' : ''} ignorée${result.skipped > 1 ? 's' : ''}.` : '.'),
      });
      setSelected(new Set());
      setBulkNote('');
    });
  }

  return (
    <div>
      {/* Barre d'action bulk — visible uniquement quand au moins 1 sélectionnée */}
      {canWrite && someSelected && (
        <div className="bg-stoniz-black text-white rounded-md p-3 mb-3 flex flex-wrap items-center gap-3">
          <div className="text-sm">
            <strong>{selected.size}</strong> sélectionnée{selected.size > 1 ? 's' : ''}
            <span className="opacity-70"> · </span>
            <strong>{fmtMad(selectedTotalRemaining)}</strong> à allouer
          </div>

          <div className="flex-1 min-w-[200px]">
            <select
              value={bulkType}
              onChange={(e) => setBulkType(e.target.value)}
              disabled={pending}
              className="w-full bg-white text-stoniz-black border-none rounded px-3 py-1.5 text-sm"
            >
              {Object.entries(BULK_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>

          <input
            type="text"
            value={bulkNote}
            onChange={(e) => setBulkNote(e.target.value)}
            disabled={pending}
            placeholder="Note (optionnel)"
            className="flex-1 min-w-[180px] bg-white text-stoniz-black border-none rounded px-3 py-1.5 text-sm"
          />

          <button
            type="button"
            onClick={onSubmit}
            disabled={pending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-1.5 rounded text-sm font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            {pending ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Allocation…</> : `Allouer ${selected.size} transaction${selected.size > 1 ? 's' : ''}`}
          </button>

          <button
            type="button"
            onClick={clearSelection}
            disabled={pending}
            className="text-xs underline opacity-70 hover:opacity-100"
          >
            Annuler
          </button>
        </div>
      )}

      {feedback && (
        <div className={`mb-3 p-3 rounded text-sm ${
          feedback.kind === 'ok'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {feedback.msg}
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          {/* CEO 2026-06-23 P1.6 : sticky thead pour garder les colonnes
              visibles quand on scroll dans la liste. */}
          <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b sticky top-0 bg-white z-10">
            <tr>
              {canWrite && (
                <th className="text-left py-2 px-2 w-8 bg-white">
                  <button
                    type="button"
                    onClick={toggleAll}
                    title={allSelected ? 'Tout désélectionner' : 'Tout sélectionner'}
                    className="text-stoniz-gray-500 hover:text-stoniz-black"
                  >
                    {allSelected
                      ? <CheckSquare className="w-4 h-4" />
                      : <Square className="w-4 h-4" />}
                  </button>
                </th>
              )}
              <th className="text-left py-2 px-2 bg-white">
                {sortable ? (
                  <Link href={sortHrefs!.date} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                    Date <SortIcon col="date" />
                  </Link>
                ) : 'Date'}
              </th>
              <th className="text-left py-2 px-2 bg-white">
                {sortable && sortHrefs!.account ? (
                  <Link href={sortHrefs!.account} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                    Compte <SortIcon col="account" />
                  </Link>
                ) : 'Compte'}
              </th>
              <th className="text-left py-2 px-2 bg-white">Libellé</th>
              <th className="text-left py-2 px-2 bg-white">
                {sortable && sortHrefs!.category ? (
                  <Link href={sortHrefs!.category} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                    Catégorie <SortIcon col="category" />
                  </Link>
                ) : 'Catégorie'}
              </th>
              <th className="text-right py-2 px-2 bg-white">
                {sortable ? (
                  <Link href={sortHrefs!.debit} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                    Débit <SortIcon col="debit" />
                  </Link>
                ) : 'Débit'}
              </th>
              <th className="text-right py-2 px-2 bg-white">
                {sortable ? (
                  <Link href={sortHrefs!.credit} className="inline-flex items-center gap-1 hover:text-stoniz-black">
                    Crédit <SortIcon col="credit" />
                  </Link>
                ) : 'Crédit'}
              </th>
              <th className="text-center py-2 px-2 bg-white">Allocation</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {transactions.map((t) => {
              const href = `/finance/tresorerie/transactions/${t.id}`;
              const cellCls = `py-1.5 px-2 ${t.is_pending ? 'opacity-60 italic' : ''}`;
              const linkCls = 'block w-full h-full hover:underline';
              const isSelectable = !t.is_pending && t._statusLabel !== 'allocated';
              const isChecked = selected.has(t.id);
              return (
                <tr key={t.id} className={`hover:bg-stoniz-gray-50 cursor-pointer ${isChecked ? 'bg-stoniz-gray-100' : ''}`}>
                  {canWrite && (
                    <td className="py-1.5 px-2 align-middle">
                      {isSelectable ? (
                        <button
                          type="button"
                          onClick={() => toggle(t.id)}
                          title="Sélectionner pour allocation groupée"
                          className="text-stoniz-gray-400 hover:text-stoniz-black"
                        >
                          {isChecked
                            ? <CheckSquare className="w-4 h-4 text-stoniz-black" />
                            : <Square className="w-4 h-4" />}
                        </button>
                      ) : (
                        <span className="block w-4 h-4" />
                      )}
                    </td>
                  )}
                  <td className={`${cellCls} whitespace-nowrap`}>
                    <Link href={href} className={linkCls}>{fmtDate(t.operation_date)}</Link>
                  </td>
                  <td className={`${cellCls} whitespace-nowrap text-stoniz-gray-600`}>
                    <Link href={href} className={linkCls}>{t.account?.bank_label}</Link>
                  </td>
                  <td className={`${cellCls} max-w-xs`}>
                    <Link href={href} className="block truncate hover:underline" title={t.label ?? ''}>
                      {t.label}
                    </Link>
                  </td>
                  <td className={cellCls}>
                    <Link href={href} className="block hover:underline">
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-700">
                        {(CATEGORY_LABELS as any)[t.category_code ?? ''] ?? t.category_code ?? '—'}
                      </span>
                    </Link>
                  </td>
                  <td className={`${cellCls} text-right text-red-700 font-mono`}>
                    <Link href={href} className={linkCls}>
                      {t.debit_mad ? fmtNumber(t.debit_mad) : ''}
                    </Link>
                  </td>
                  <td className={`${cellCls} text-right text-emerald-700 font-mono`}>
                    <Link href={href} className={linkCls}>
                      {t.credit_mad ? fmtNumber(t.credit_mad) : ''}
                    </Link>
                  </td>
                  <td className={`${cellCls} text-center text-[10px] whitespace-nowrap`}>
                    <div className="inline-flex items-center gap-1.5">
                      <Link href={href} className={linkCls}>
                        {t._statusLabel === 'pending' ? (
                          <span className="text-stoniz-gray-400">En attente</span>
                        ) : t._statusLabel === 'allocated' ? (
                          <span className="text-emerald-700">✓ Allouée</span>
                        ) : t._statusLabel === 'partial' ? (
                          <span className="text-amber-700">~ Partielle</span>
                        ) : (
                          <span className="text-orange-700 underline">À allouer</span>
                        )}
                      </Link>
                      {/* Allocation rapide inline (CEO 2026-06-16) — uniquement
                          quand il reste quelque chose à allouer. */}
                      {canWrite && t._statusLabel !== 'allocated' && t._statusLabel !== 'pending' && (
                        <QuickAllocateButton transactionId={t.id} compact />
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {canWrite && (
        <p className="text-[10px] text-stoniz-gray-500 mt-2">
          Astuce — coche plusieurs lignes identiques (salaires, loyer, abonnement, DGI, CNSS…) pour les allouer toutes en bloc avec le même type.
          Indispo pour les transactions déjà entièrement allouées.
        </p>
      )}
    </div>
  );
}
