'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { triggerHostawayCleaningsSyncAction } from '@/app/(team)/propria/integrations/hostaway/actions';

/**
 * Bouton "Synchroniser depuis Hostaway" sur la page ménages.
 *
 * Force la création des ménages voyageur (check-out) + poussière (check-in
 * avec gap ≥ 4j) à partir des réservations Hostaway déjà syncées.
 *
 * Le cron horaire fait déjà ça automatiquement — ce bouton sert à rattraper
 * tout de suite après une nouvelle réservation, sans attendre l'heure pile.
 *
 * CEO + developer uniquement (consomme la sync auto, action puissante).
 */
export function SyncHostawayCleaningsButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function run() {
    setMsg(null);
    start(async () => {
      const r = await triggerHostawayCleaningsSyncAction()
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any)?.ok) {
        setMsg({ kind: 'err', text: (r as any)?.error ?? 'Échec sync.' });
        return;
      }
      const created_v = (r as any).created_voyageur ?? 0;
      const created_p = (r as any).created_poussiere ?? 0;
      const cancelled = (r as any).cancelled ?? 0;
      const errors = (r as any).errors ?? [];
      const parts: string[] = [];
      if (created_v) parts.push(`${created_v} voyageur`);
      if (created_p) parts.push(`${created_p} poussière`);
      if (cancelled) parts.push(`${cancelled} annulé(s)`);
      const text = parts.length > 0
        ? `✓ ${parts.join(' · ')}`
        : '✓ Synchronisation faite — aucun nouveau ménage à créer.';
      setMsg({
        kind: errors.length > 0 ? 'err' : 'ok',
        text: errors.length > 0 ? `${text} (avec ${errors.length} erreur(s))` : text,
      });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50 inline-flex items-center gap-2 disabled:opacity-50"
        title="Crée les ménages voyageur (check-out) et poussière (check-in avec gap ≥ 4j) depuis les réservations Hostaway"
      >
        <RefreshCw className={`w-4 h-4 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Sync…' : '⚡ Sync Hostaway'}
      </button>
      {msg && (
        <div className={`text-xs px-2 py-1 rounded ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}
    </div>
  );
}
