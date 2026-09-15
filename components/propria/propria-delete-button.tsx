'use client';

import { useState, useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, CheckCircle2 } from 'lucide-react';
import { softDeletePropriaRowAction } from '@/app/(team)/propria/deletion-actions';

/**
 * Bouton de suppression réutilisable pour toute ligne d'un module Propria.
 * Soft-delete immédiat + passage en validation CEO (sauf si CEO).
 * Affiche une notification de confirmation, puis rafraîchit / redirige.
 */
export function PropriaDeleteButton({
  table,
  id,
  iconOnly = true,
  className = '',
  redirectTo,
}: {
  table: string;
  id: string;
  iconOnly?: boolean;
  className?: string;
  /** Si fourni, redirige ici après suppression (ex: depuis une fiche détail). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // La notification reste visible ~1,4s avant le rafraîchissement / la redirection.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      if (redirectTo) router.push(redirectTo);
      else router.refresh();
    }, 1400);
    return () => clearTimeout(t);
  }, [toast, redirectTo, router]);

  function onClick() {
    const reason = window.prompt('Supprimer cette ligne ?\nMotif (optionnel) :', '');
    if (reason === null) return; // annulé
    setErr(null);
    start(async () => {
      const res = await softDeletePropriaRowAction({ table, id, reason: reason || null });
      if (!res?.ok) { setErr(res?.error ?? 'Échec de la suppression'); return; }
      setToast(
        res.pending
          ? 'Ligne supprimée — en attente de ta validation'
          : 'Ligne supprimée',
      );
    });
  }

  return (
    <span className="inline-flex items-center">
      <button
        type="button"
        onClick={onClick}
        disabled={pending || toast !== null}
        title="Supprimer (passe en validation)"
        className={className || 'p-1.5 rounded-md hover:bg-red-50 text-red-600 disabled:opacity-50'}
      >
        <Trash2 className="w-4 h-4" />
        {!iconOnly && <span className="ml-1 text-xs">{pending ? 'Suppression…' : 'Supprimer'}</span>}
      </button>
      {err && <span className="ml-1 text-[10px] text-red-600">{err}</span>}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm bg-emerald-50 border-emerald-200 text-emerald-800 animate-in fade-in slide-in-from-bottom-2 duration-200"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          <span>{toast}</span>
        </div>
      )}
    </span>
  );
}
