'use client';

import { useState, useTransition } from 'react';
import { Bell, BellOff, AlertTriangle, Loader2 } from 'lucide-react';
import { setAccountAlertThresholdAction } from './actions';

function fmtMad(n: number | null) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

export function AlertThresholdCell({
  accountId,
  currentThreshold,
  currentBalance,
  canEdit,
}: {
  accountId: string;
  currentThreshold: number | null;
  currentBalance: number | null;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(
    currentThreshold == null ? '' : String(currentThreshold)
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isAlerting =
    currentThreshold != null && currentBalance != null && currentBalance < currentThreshold;
  const hasThreshold = currentThreshold != null;

  function save(rawValue: string | null) {
    setError(null);
    start(async () => {
      const result = await setAccountAlertThresholdAction(accountId, rawValue);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditing(false);
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => canEdit && setEditing(true)}
        className={`inline-flex items-center gap-1 text-xs ${
          isAlerting
            ? 'text-red-700 font-medium'
            : hasThreshold
              ? 'text-stoniz-gray-600'
              : 'text-stoniz-gray-400'
        } ${canEdit ? 'hover:text-stoniz-black cursor-pointer' : 'cursor-default'}`}
        title={canEdit ? 'Cliquer pour modifier le seuil' : 'Lecture seule'}
      >
        {isAlerting ? (
          <AlertTriangle className="w-3.5 h-3.5" />
        ) : hasThreshold ? (
          <Bell className="w-3.5 h-3.5" />
        ) : (
          <BellOff className="w-3.5 h-3.5" />
        )}
        {hasThreshold ? `Seuil ${fmtMad(currentThreshold!)}` : 'Pas de seuil'}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center gap-1 bg-white border border-stoniz-gray-300 rounded p-1">
      <input
        type="number"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="0"
        autoFocus
        className="w-24 px-2 py-0.5 text-xs font-mono border-none outline-none"
      />
      <span className="text-[10px] text-stoniz-gray-500 mr-1">MAD</span>
      <button
        type="button"
        onClick={() => save(value)}
        disabled={pending}
        className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-2 py-0.5 rounded disabled:opacity-50"
      >
        {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'OK'}
      </button>
      {hasThreshold && (
        <button
          type="button"
          onClick={() => save(null)}
          disabled={pending}
          className="bg-stoniz-gray-200 hover:bg-stoniz-gray-300 text-[10px] px-2 py-0.5 rounded disabled:opacity-50"
          title="Supprimer le seuil"
        >
          Retirer
        </button>
      )}
      <button
        type="button"
        onClick={() => { setEditing(false); setValue(currentThreshold == null ? '' : String(currentThreshold)); setError(null); }}
        disabled={pending}
        className="text-stoniz-gray-500 hover:text-stoniz-black text-[10px] px-1"
      >
        ✕
      </button>
      {error && <div className="text-[10px] text-red-600 ml-1">{error}</div>}
    </div>
  );
}
