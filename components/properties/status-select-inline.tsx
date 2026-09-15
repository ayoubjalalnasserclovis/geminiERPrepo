'use client';

import { useState, useTransition } from 'react';
import { updatePropertyStatusAction } from '@/app/(team)/properties/actions';

const OPTIONS = [
  { value: 'sourcing',    label: 'Sourcing' },
  { value: 'disponible',  label: 'Disponible' },
  { value: 'propose',     label: 'Proposé' },
  { value: 'offre',       label: 'Offre' },
  { value: 'vendu',       label: 'Vendu' },
  { value: 'perdu',       label: 'Perdu' },
  { value: 'a_verifier',  label: 'À vérifier' },
];

const COLORS: Record<string, string> = {
  sourcing:   'bg-stoniz-gray-100 text-stoniz-gray-700',
  disponible: 'bg-blue-100 text-blue-800',
  propose:    'bg-accent-light text-accent-dark',
  offre:      'bg-yellow-100 text-yellow-900',
  vendu:      'bg-green-100 text-green-800',
  perdu:      'bg-red-100 text-red-800',
  a_verifier: 'bg-purple-100 text-purple-800',
};

export function StatusSelectInline({ id, value }: { id: string; value: string }) {
  const [current, setCurrent] = useState(value);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: string) {
    const prev = current;
    setCurrent(next);
    setError(null);
    start(async () => {
      const r = await updatePropertyStatusAction(id, next);
      if (!r.ok) {
        setCurrent(prev);
        setError(r.error ?? 'Erreur');
      }
    });
  }

  return (
    <div className="relative inline-block">
      <select
        value={current}
        onChange={e => onChange(e.target.value)}
        disabled={pending}
        className={`text-xs font-medium rounded-full px-3 py-1 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-stoniz-black ${COLORS[current] ?? COLORS.sourcing} ${pending ? 'opacity-50' : ''}`}
      >
        {OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <div className="absolute top-full left-0 text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}
