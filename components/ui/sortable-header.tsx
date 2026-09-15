'use client';

import { Suspense, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

/**
 * Header de colonne triable — toggle entre (rien) → asc → desc → (rien).
 * État persisté dans l'URL via ?sort=field&dir=asc/desc
 * Lecture côté serveur via parseSort(searchParams).
 */

export function SortableHeader({
  field,
  children,
  className,
}: {
  field: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Suspense fallback={<th className={className}>{children}</th>}>
      <SortableHeaderInner field={field} className={className}>{children}</SortableHeaderInner>
    </Suspense>
  );
}

function SortableHeaderInner({
  field, children, className,
}: {
  field: string; children: React.ReactNode; className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  const current = sp.get('sort');
  const dir = sp.get('dir') ?? 'desc';
  const isActive = current === field;

  function toggle() {
    const params = new URLSearchParams(sp.toString());
    if (!isActive) {
      params.set('sort', field);
      params.set('dir', 'desc');
    } else if (dir === 'desc') {
      params.set('dir', 'asc');
    } else {
      params.delete('sort');
      params.delete('dir');
    }
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  const Icon = !isActive ? ChevronsUpDown : (dir === 'asc' ? ChevronUp : ChevronDown);

  return (
    <th className={className}>
      <button
        type="button"
        onClick={toggle}
        className={`inline-flex items-center gap-1 hover:text-stoniz-black transition-colors ${
          isActive ? 'text-stoniz-black font-semibold' : 'text-stoniz-gray-600'
        }`}
      >
        {children}
        <Icon className="w-3 h-3 inline-block" />
      </button>
    </th>
  );
}
