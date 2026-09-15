'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';
import { updateTargetPayrollAction } from './actions';

/**
 * Ligne d'édition de la cible de masse salariale pour un mois donné
 * (Phase B2 — CEO 2026-06-30).
 *
 * Canon couleurs Stoniz :
 *   - écart négatif (réel > cible) → orange (anomalie à percevoir)
 *   - écart positif (réel < cible) → vert
 *   - cible non renseignée → gris/italique
 */

export type TargetPayrollRowProps = {
  month: string; // YYYY-MM
  monthLabel: string;
  actualEur: number;
  targetEur: number | null;
  readOnly?: boolean;
};

function fmtEur(v: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v);
}

export function TargetPayrollRow({
  month,
  monthLabel,
  actualEur,
  targetEur,
  readOnly = false,
}: TargetPayrollRowProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<string>(
    targetEur != null ? String(targetEur) : '',
  );
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const numericValue = value.trim() === '' ? null : Number(value);
  const dirty = numericValue !== targetEur;

  // Écart = réel − cible. Positif = on dépasse la cible (orange).
  const ecart =
    targetEur != null && targetEur > 0 ? actualEur - targetEur : null;
  const ecartPct =
    ecart != null && targetEur && targetEur > 0
      ? Math.round((ecart / targetEur) * 1000) / 10
      : null;

  function onSave() {
    setError(null);
    setSavedAt(null);
    if (numericValue == null || isNaN(numericValue)) {
      setError('Montant invalide');
      return;
    }
    const fd = new FormData();
    fd.set('month', month);
    fd.set('amount', String(numericValue));
    start(async () => {
      try {
        const r = await updateTargetPayrollAction(fd);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        setSavedAt(Date.now());
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur inconnue');
      }
    });
  }

  return (
    <tr className="border-b border-stoniz-gray-100 last:border-0">
      <td className="py-2.5 pr-4 font-mono text-xs text-stoniz-gray-700">
        {monthLabel}
      </td>
      <td className="py-2.5 pr-4 font-mono text-sm tabular-nums">
        {actualEur > 0 ? fmtEur(actualEur) : <span className="text-stoniz-gray-400">—</span>}
      </td>
      <td className="py-2.5 pr-4">
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={100}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={readOnly || pending}
            placeholder="—"
            className="w-28 px-2 py-1 rounded-sm border border-stoniz-gray-300 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-stoniz-black/30 disabled:bg-stoniz-gray-50 disabled:text-stoniz-gray-500"
          />
          {!readOnly && dirty && (
            <Button
              type="button"
              size="sm"
              variant="primary"
              disabled={pending}
              onClick={onSave}
            >
              {pending ? '…' : 'OK'}
            </Button>
          )}
          {savedAt && !error && (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          )}
        </div>
        {error && (
          <div className="mt-1.5">
            <SessionExpiredBanner error={error} />
          </div>
        )}
      </td>
      <td className="py-2.5 pr-4 text-sm tabular-nums">
        {ecart == null ? (
          <span className="text-stoniz-gray-400">—</span>
        ) : ecart > 0 ? (
          <span className="text-orange-600 font-medium">
            +{fmtEur(ecart)}
            {ecartPct != null && (
              <span className="text-[10px] text-orange-500 ml-1">
                ({ecartPct.toFixed(1)}%)
              </span>
            )}
          </span>
        ) : ecart < 0 ? (
          <span className="text-emerald-700">
            {fmtEur(ecart)}
            {ecartPct != null && (
              <span className="text-[10px] text-emerald-600 ml-1">
                ({ecartPct.toFixed(1)}%)
              </span>
            )}
          </span>
        ) : (
          <span className="text-stoniz-gray-500">0 €</span>
        )}
      </td>
    </tr>
  );
}
