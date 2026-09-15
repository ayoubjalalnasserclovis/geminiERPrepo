'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

export type CollectProfileOption = { id: string; label: string };

type CollectTaskResult =
  | { ok: true; already: boolean; interventionId: string }
  | { ok: false; error: string };

/**
 * Bouton « Créer tâche de collecte » (chantier 14, point 2).
 * - Si une tâche de collecte ouverte existe déjà pour cette résa
 *   (existingTaskId fourni par le serveur), affiche un lien vers la tâche.
 * - Sinon : modale (assigné, échéance, note) → Server Action qui crée la
 *   propria_interventions kind='tache' avec le code résa dans hostaway_ref.
 */
export function CollectTaskButton({
  source,
  reservationId,
  amountLabel,
  existingTaskId,
  profiles,
  createAction,
}: {
  source: 'cash' | 'direct';
  reservationId: string;
  amountLabel: string;
  existingTaskId?: string | null;
  profiles: CollectProfileOption[];
  createAction: (input: unknown) => Promise<CollectTaskResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (existingTaskId) {
    return (
      <Link
        href={`/propria/interventions/${existingTaskId}`}
        className="text-xs text-emerald-700 hover:underline whitespace-nowrap"
        title="Une tâche de collecte ouverte existe déjà pour cette résa"
      >
        ✓ Tâche créée →
      </Link>
    );
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await createAction({
        source,
        reservation_id: reservationId,
        assigned_to_id: (fd.get('assigned_to_id') as string) || null,
        due_date: (fd.get('due_date') as string) || null,
        note: (fd.get('note') as string) || null,
      });
      if (!res.ok) { setErr(res.error); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs border border-stoniz-gray-300 px-2 py-1 rounded hover:bg-stoniz-gray-50 whitespace-nowrap"
        title="Créer une tâche terrain de collecte du cash"
      >
        📋 Tâche de collecte
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-display text-lg">Tâche de collecte cash</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1 rounded hover:bg-stoniz-gray-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-stoniz-gray-600 mb-4">
              Montant à récupérer : <strong>{amountLabel}</strong>. La tâche apparaîtra
              dans /propria/interventions (et « Mes tâches » de l’assigné).
            </p>

            <form onSubmit={onSubmit} className="space-y-3 text-left">
              <div>
                <label className="text-xs text-stoniz-gray-600">Assignée à</label>
                <select
                  name="assigned_to_id"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                >
                  <option value="">— Personne pour l’instant —</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-stoniz-gray-600">Échéance</label>
                <input
                  type="date"
                  name="due_date"
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-stoniz-gray-600">Note (optionnel)</label>
                <textarea
                  name="note"
                  rows={2}
                  maxLength={500}
                  placeholder="Ex : passer avant 18h, voir le gardien"
                  className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>

              {err && <p className="text-xs text-red-600">{err}</p>}

              <button
                type="submit"
                disabled={pending}
                className="w-full bg-stoniz-black text-white py-2 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
              >
                {pending ? 'Création…' : '+ Créer la tâche'}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Bouton « Encaisser » d'une résa directe : prompt du montant (pattern
 * UpsellAmountButton), incrémente collected_mad côté serveur. Le reste à
 * encaisser reste dérivé (total − collecté).
 */
export function DirectCollectButton({
  id,
  resteMad,
  collectAction,
}: {
  id: string;
  resteMad: number;
  collectAction: (id: string, amountMad: number) => Promise<void>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function onClick() {
    const raw = window.prompt(
      `Montant encaissé (MAD) — reste dû : ${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(resteMad)} DH`,
      String(resteMad || ''),
    );
    if (raw === null) return;
    const val = Number(raw.replace(',', '.'));
    if (!Number.isFinite(val) || val <= 0) return;
    setErr(null);
    start(async () => {
      try {
        await collectAction(id, val);
        router.refresh();
      } catch (e: any) {
        setErr(e?.message ?? 'Erreur');
      }
    });
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="text-xs bg-stoniz-black text-white px-2.5 py-1 rounded hover:bg-stoniz-gray-800 disabled:opacity-50 whitespace-nowrap"
      >
        {pending ? '…' : '💵 Encaisser'}
      </button>
      {err && <span className="text-[10px] text-red-600">{err}</span>}
    </span>
  );
}
