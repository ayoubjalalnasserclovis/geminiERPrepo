'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateFlowLineDateAction } from '@/app/(team)/finance/projection/actions';

/**
 * Input mois pour une ligne de flow sur la vue projection mensuelle.
 * Dispatch via id_ref préfixé (honoraires:/te:/ae:/tp:/ap:/sp:).
 * CEO 2026-08-17d.
 */
export function FlowLineMonthInput({
  idRef,
  initialMonth,
  disabled,
}: {
  idRef: string;
  /** YYYY-MM ou null */
  initialMonth: string | null;
  /** true pour les récurrents non éditables */
  disabled?: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialMonth ?? '');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (disabled) {
    return (
      <span className="text-[10px] text-stoniz-gray-400 italic" title="Estimation automatique">
        auto
      </span>
    );
  }

  function save(next: string) {
    setError(null);
    setValue(next);
    start(async () => {
      const r = await updateFlowLineDateAction({ id_ref: idRef, forecast_month: next });
      if (!r.ok) { setError(r.error); return; }
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
        className="text-[10px] px-1 py-0.5 rounded border border-stoniz-gray-300 bg-white max-w-[110px] disabled:opacity-50"
        title="Mois prévisionnel — cliquer pour changer"
      />
      {error && <span className="text-[9px] text-red-700">{error}</span>}
    </span>
  );
}
