'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { bulkSoftDeletePropriaAction } from '@/app/(team)/propria/deletion-actions';

/**
 * Enveloppe une liste pour la suppression EN LOT — SANS <form> (pour pouvoir
 * cohabiter avec les mini-formulaires d'action déjà présents dans les lignes).
 *
 * Le parent ajoute sur chaque ligne une case :
 *   <input type="checkbox" data-bulk-id={id} />
 * Ce composant lit les cases cochées dans son conteneur et appelle l'action.
 */
export function PropriaBulkDeleteForm({
  table,
  children,
}: {
  table: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const [count, setCount] = useState(0);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function recount() {
    const el = ref.current;
    if (!el) return;
    setCount(el.querySelectorAll('input[data-bulk-id]:checked').length);
  }

  function toggleAll(e: React.ChangeEvent<HTMLInputElement>) {
    const el = ref.current;
    if (!el) return;
    el.querySelectorAll<HTMLInputElement>('input[data-bulk-id]').forEach((cb) => {
      cb.checked = e.target.checked;
    });
    recount();
  }

  function onDelete() {
    const el = ref.current;
    if (!el) return;
    const ids = Array.from(el.querySelectorAll<HTMLInputElement>('input[data-bulk-id]:checked'))
      .map((cb) => cb.getAttribute('data-bulk-id') || '')
      .filter(Boolean);
    if (ids.length === 0) return;
    if (!confirm(`Supprimer ${ids.length} ligne(s) ? Elles passeront en validation.`)) return;
    setErr(null);
    start(async () => {
      const res = await bulkSoftDeletePropriaAction({ table, ids });
      if (!res?.ok) { setErr(res?.error ?? 'Échec de la suppression'); return; }
      setCount(0);
      router.refresh();
    });
  }

  return (
    <div ref={ref} onChange={recount}>
      <div className="flex items-center gap-3 mb-2">
        <label className="flex items-center gap-1.5 text-xs text-stoniz-gray-600 cursor-pointer">
          <input type="checkbox" onChange={toggleAll} /> Tout sélectionner
        </label>
        <button
          type="button"
          onClick={onDelete}
          disabled={count === 0 || pending}
          className="inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Trash2 className="w-3.5 h-3.5" />
          {pending ? 'Suppression…' : `Supprimer la sélection${count > 0 ? ` (${count})` : ''}`}
        </button>
        {err && <span className="text-xs text-red-700">{err}</span>}
      </div>
      {children}
    </div>
  );
}
