'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { syncHostawayReservationsAction } from '@/app/(team)/propria/integrations/hostaway/actions';

/**
 * Bouton "Forcer sync Hostaway" — garde-fou manuel uniquement (CEO 2026-06-12).
 *
 * La sync automatique passe DÉSORMAIS par :
 *   1) Cron Vercel toutes les 15 min (cron toutes les 15 min)
 *   2) Webhooks Hostaway en temps réel (POST sur `/api/webhooks/hostaway`)
 *
 * Ce bouton ne sert que pour les cas extrêmes où le CEO veut un état
 * 100% frais immédiatement sans attendre le prochain cron. Le user ne
 * devrait JAMAIS avoir à cliquer dessus dans le workflow normal.
 */
export function DailyForceSyncButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function go() {
    setMsg(null);
    start(async () => {
      const r: any = await syncHostawayReservationsAction();
      if (r?.ok) {
        setMsg(`✓ ${r.total} résa traitées · ${r.created} créées · ${r.updated} maj`);
        router.refresh();
        setTimeout(() => setMsg(null), 8000);
      } else {
        setMsg(`✕ ${r?.error ?? 'Erreur sync'}`);
      }
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      {msg && (
        <span className={`text-xs ${msg.startsWith('✓') ? 'text-emerald-700' : 'text-red-700'}`}>
          {msg}
        </span>
      )}
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="bg-stoniz-gray-100 text-stoniz-gray-700 px-3 py-2 rounded-md text-xs hover:bg-stoniz-gray-200 disabled:opacity-50 inline-flex items-center gap-1.5"
        title="Force une sync Hostaway immédiate (garde-fou — normalement inutile)"
      >
        <RefreshCw className={`w-3.5 h-3.5 ${pending ? 'animate-spin' : ''}`} />
        {pending ? 'Sync…' : 'Forcer sync'}
      </button>
    </div>
  );
}
