'use client';

import { useTransition } from 'react';

const STATUS_BADGE: Record<string, string> = {
  a_faire: 'bg-amber-100 text-amber-800',
  fait: 'bg-emerald-100 text-emerald-800',
  offert: 'bg-purple-100 text-purple-800',
  anomalie: 'bg-red-100 text-red-800',
  annule: 'bg-stoniz-gray-200 text-stoniz-gray-700',
};
const STATUS_LABELS: Record<string, string> = {
  a_faire: '⏳ À faire',
  fait: '✓ Fait',
  offert: '🎁 Offert',
  anomalie: '⚠ Anomalie',
  annule: '✕ Annulé',
};

export function TransferStatusSelect({
  id,
  current,
  setStatusAction,
}: {
  id: string;
  current: string;
  setStatusAction: (id: string, status: string) => Promise<void>;
}) {
  const [pending, start] = useTransition();
  return (
    <select
      defaultValue={current}
      disabled={pending}
      onChange={(e) => {
        const v = e.target.value;
        start(async () => { await setStatusAction(id, v); });
      }}
      className={`text-[10px] px-2 py-0.5 rounded-full ${STATUS_BADGE[current]} border-0 disabled:opacity-50`}
    >
      {Object.entries(STATUS_LABELS).map(([k, v]) => (
        <option key={k} value={k}>{v}</option>
      ))}
    </select>
  );
}
