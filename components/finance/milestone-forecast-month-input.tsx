'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setMilestoneForecastMonthAction } from '@/app/(team)/finance/tresorerie/honoraires-a-percevoir/actions';

/**
 * Input de saisie du mois prévisionnel d'encaissement pour un milestone.
 * S'affiche sous chaque badge milestone à venir sur la page Honoraires à
 * percevoir. Un `<input type="month">` natif — supporte YYYY-MM directement.
 *
 * CEO 2026-08-17c.
 */
export function MilestoneForecastMonthInput({
  projectId,
  milestoneType,
  initialMonth,
}: {
  projectId: string;
  milestoneType: string;
  /** YYYY-MM ou null si non saisi */
  initialMonth: string | null;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialMonth ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(next: string) {
    setError(null);
    setValue(next);
    start(async () => {
      const r = await setMilestoneForecastMonthAction({
        project_id: projectId,
        milestone_type: milestoneType,
        forecast_month: next === '' ? null : next,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <input
        type="month"
        value={value}
        onChange={(e) => save(e.target.value)}
        disabled={pending}
        className="text-[10px] px-1 py-0.5 rounded border border-stoniz-gray-300 bg-white/70 max-w-[110px] disabled:opacity-50"
        title="Mois prévisionnel d'encaissement"
      />
      {error && <span className="text-[9px] text-red-700">{error}</span>}
    </span>
  );
}
