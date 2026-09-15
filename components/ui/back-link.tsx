'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

/**
 * Lien "Retour" universel.
 * - Si `href` fourni : navigation explicite vers cette page
 * - Sinon : utilise l'historique navigateur (router.back())
 */
export function BackLink({
  href,
  label = 'Retour',
}: {
  href?: string;
  label?: string;
}) {
  const router = useRouter();
  const baseClass = "inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black mb-2";

  if (href) {
    return (
      <Link href={href} className={baseClass}>
        <ArrowLeft className="w-4 h-4" /> {label}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => router.back()} className={baseClass}>
      <ArrowLeft className="w-4 h-4" /> {label}
    </button>
  );
}
