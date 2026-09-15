'use client';

import { useState } from 'react';
import type { ScopeGroup } from '@/lib/propria/intervention-scope';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

type Opt = { id: string; label: string };

/**
 * Formulaire création/édition d'un check-up logement (chantier 11.a — MVP).
 * Volontairement minimal : lot ou bien entier + assigné + échéance + consignes.
 * La checklist se remplit sur la fiche, pas ici.
 */
export function CheckupForm({
  initial,
  scopeGroups,
  profiles,
  action,
  submitLabel = 'Enregistrer',
}: {
  initial?: Partial<Record<string, any>>;
  scopeGroups: ScopeGroup[];
  profiles: Opt[];
  /** Server action défensive : retourne { ok } | { ok:false, error } (redirect = throw NEXT_REDIRECT silencieux). */
  action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string } | void>;
  submitLabel?: string;
}) {
  const v = initial ?? {};
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await action(new FormData(e.currentTarget));
      // r peut être void (legacy) ou { ok }. Si {ok:false}, on remonte l'erreur.
      if (r && r.ok === false) {
        setErr(r.error);
        setBusy(false);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      setBusy(false);
    }
  }

  const input = 'mt-1 w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm';
  const label = 'text-xs text-stoniz-gray-600';

  return (
    <form onSubmit={onSubmit} className="bg-white border border-stoniz-gray-200 rounded-xl p-4 sm:p-6 max-w-3xl">
      {err && <div className="mb-4"><SessionExpiredBanner error={err} /></div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className={label}>Lot concerné *</label>
          <select name="scope" defaultValue={v.scope ?? ''} required className={input}>
            <option value="">— Sélectionner un lot ou le bien entier —</option>
            {scopeGroups.map(g => (
              <optgroup key={g.propertyId} label={g.propertyLabel}>
                <option value={`property:${g.propertyId}`}>{g.propertyLabel} · Bien entier</option>
                {g.units.map(u => (
                  <option key={u.id} value={`unit:${u.id}`}>{g.propertyLabel} · {u.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div>
          <label className={label}>Assigné à (contrôleur)</label>
          <select name="assigned_to_id" defaultValue={v.assigned_to_id ?? ''} className={input}>
            <option value="">— Personne pour l'instant —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Échéance</label>
          <input
            type="date" name="due_date"
            defaultValue={v.due_date ?? ''}
            className={input}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Observations / consignes</label>
          <textarea
            name="observations" defaultValue={v.observations ?? ''} rows={2}
            placeholder="Ex : Vérifier en priorité la clim de la chambre, fuite signalée par un voyageur…"
            className={input}
          />
        </div>
      </div>

      <div className="flex justify-end mt-5">
        <button
          type="submit" disabled={busy}
          className="w-full sm:w-auto bg-stoniz-black text-white px-5 py-2.5 sm:py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {busy ? 'Enregistrement…' : submitLabel}
        </button>
      </div>
    </form>
  );
}
