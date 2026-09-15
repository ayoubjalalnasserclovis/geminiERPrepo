'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';

/**
 * Toggle "Pondéré / Plat" pour le tab P&L projet.
 *
 * Mode pondéré (défaut) : charges salariales allouées au prorata des
 * coefficients de phase (settings/pl-config).
 * Mode plat : charges salariales réparties uniformément sur tous les projets
 * de la période, indépendamment de la phase.
 *
 * État stocké dans l'URL via `?mode=weighted|flat` pour permettre le partage
 * d'un lien et préserver le mode au refresh.
 *
 * CEO 2026-06-30 Phase B3.
 */
export function PLModeToggle({ mode }: { mode: 'weighted' | 'flat' }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  function setMode(next: 'weighted' | 'flat') {
    if (next === mode) return;
    const sp = new URLSearchParams(Array.from(params?.entries() ?? []));
    sp.set('mode', next);
    start(() => {
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
      router.refresh();
    });
  }

  return (
    <div
      className="inline-flex items-center rounded-md border border-grey-line bg-white p-0.5"
      role="tablist"
      aria-label="Mode d'allocation des charges salariales"
    >
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'weighted'}
        onClick={() => setMode('weighted')}
        disabled={pending}
        className={
          mode === 'weighted'
            ? 'px-3 py-1.5 text-sm font-medium rounded bg-stoniz-black text-white'
            : 'px-3 py-1.5 text-sm font-medium rounded text-stoniz-gray-600 hover:text-stoniz-black disabled:opacity-50'
        }
      >
        Pondéré
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'flat'}
        onClick={() => setMode('flat')}
        disabled={pending}
        className={
          mode === 'flat'
            ? 'px-3 py-1.5 text-sm font-medium rounded bg-stoniz-black text-white'
            : 'px-3 py-1.5 text-sm font-medium rounded text-stoniz-gray-600 hover:text-stoniz-black disabled:opacity-50'
        }
      >
        Plat
      </button>
    </div>
  );
}
