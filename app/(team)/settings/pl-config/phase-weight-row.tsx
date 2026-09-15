'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Info, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';
import { updatePhaseWeightAction } from './actions';

/**
 * Ligne d'édition d'un coefficient de phase (Phase B2 — CEO 2026-06-30).
 *
 * - Input numérique (0 → 10) + bouton Sauvegarder
 * - Tooltip d'explication par phase (info icon)
 * - Pattern défensif : useTransition + try/catch + bandeau session expirée
 * - Lecture seule pour developer (readOnly)
 */

export type PhaseWeightRowProps = {
  phase: string;
  label: string;
  description: string;
  currentWeight: number;
  readOnly?: boolean;
};

export function PhaseWeightRow({
  phase,
  label,
  description,
  currentWeight,
  readOnly = false,
}: PhaseWeightRowProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<string>(String(currentWeight));
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);

  const dirty = Number(value) !== currentWeight;

  function onSave() {
    setError(null);
    setSavedAt(null);
    const fd = new FormData();
    fd.set('phase', phase);
    fd.set('weight', value);
    start(async () => {
      try {
        const r = await updatePhaseWeightAction(fd);
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
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-stoniz-gray-800">{label}</span>
          <button
            type="button"
            aria-label={`Explication phase ${label}`}
            onMouseEnter={() => setTooltipOpen(true)}
            onMouseLeave={() => setTooltipOpen(false)}
            onFocus={() => setTooltipOpen(true)}
            onBlur={() => setTooltipOpen(false)}
            onClick={() => setTooltipOpen((v) => !v)}
            className="relative text-stoniz-gray-400 hover:text-stoniz-gray-600"
          >
            <Info className="w-3.5 h-3.5" />
            {tooltipOpen && (
              <span
                role="tooltip"
                className="absolute left-5 top-0 z-20 w-64 text-xs text-left bg-stoniz-black text-cream rounded-md px-3 py-2 shadow-lg font-normal leading-snug whitespace-normal"
              >
                {description}
              </span>
            )}
          </button>
        </div>
        <div className="text-[10px] uppercase font-mono text-stoniz-gray-400 mt-0.5">
          {phase}
        </div>
      </td>
      <td className="py-3 pr-4 text-stoniz-gray-600 font-mono text-sm tabular-nums">
        {currentWeight.toFixed(2)}
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={10}
            step={0.1}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={readOnly || pending}
            className="w-24 px-2 py-1.5 rounded-sm border border-stoniz-gray-300 text-sm font-mono tabular-nums focus:outline-none focus:ring-2 focus:ring-stoniz-black/30 disabled:bg-stoniz-gray-50 disabled:text-stoniz-gray-500"
          />
          {!readOnly && (
            <Button
              type="button"
              size="sm"
              variant={dirty ? 'primary' : 'secondary'}
              disabled={!dirty || pending}
              onClick={onSave}
            >
              {pending ? 'Sauvegarde…' : 'Sauvegarder'}
            </Button>
          )}
          {savedAt && !error && (
            <span className="text-xs text-emerald-600 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Enregistré
            </span>
          )}
        </div>
        {error && (
          <div className="mt-1.5">
            <SessionExpiredBanner error={error} />
          </div>
        )}
      </td>
    </tr>
  );
}
