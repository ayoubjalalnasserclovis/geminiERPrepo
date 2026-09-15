'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { classifyRecurringAction } from './classify-actions';
import type { RecurringPaymentType } from '@/lib/finance/recurring-detector';

const OPTIONS: { value: RecurringPaymentType; label: string; className: string }[] = [
  { value: 'salaire',     label: 'Salaire',     className: 'bg-blue-100 text-blue-800' },
  { value: 'prestataire', label: 'Prestataire', className: 'bg-purple-100 text-purple-800' },
  { value: 'loyer',       label: 'Loyer',       className: 'bg-amber-100 text-amber-800' },
  { value: 'abonnement',  label: 'Abonnement',  className: 'bg-cyan-100 text-cyan-800' },
  { value: 'autre',       label: 'Autre',       className: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  { value: 'ignore',      label: 'Ignorer',     className: 'bg-red-100 text-red-800' },
];

export function RecurringTypeSelect({
  beneficiary,
  current,
  canWrite,
}: {
  beneficiary: string;
  current: RecurringPaymentType;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState<RecurringPaymentType>(current);
  const [error, setError] = useState<string | null>(null);

  function onChange(next: RecurringPaymentType) {
    if (next === value) return;
    setError(null);
    const prev = value;
    setValue(next);
    start(async () => {
      const r = await classifyRecurringAction({ beneficiary, type: next });
      if (!r.ok) {
        setError(r.error ?? 'Erreur');
        setValue(prev);
        return;
      }
      router.refresh();
    });
  }

  const opt = OPTIONS.find(o => o.value === value) ?? OPTIONS[4];

  if (!canWrite) {
    return (
      <span className={`inline-block text-xs px-2 py-0.5 rounded ${opt.className}`}>
        {opt.label}
      </span>
    );
  }

  return (
    <div className="inline-flex items-center gap-1.5">
      <span className={`inline-block text-xs px-2 py-0.5 rounded ${opt.className}`}>
        {opt.label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as RecurringPaymentType)}
        disabled={pending}
        className="text-xs border rounded px-1 py-0.5 bg-white disabled:opacity-50"
        title={error ?? 'Classifier ce bénéficiaire'}
      >
        {OPTIONS.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}
