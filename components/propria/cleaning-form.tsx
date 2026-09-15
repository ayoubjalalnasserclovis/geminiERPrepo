'use client';

import { useState } from 'react';
import type { ScopeGroup } from '@/lib/propria/intervention-scope';

type Opt = { id: string; label: string };

/**
 * Formulaire création/édition d'un ménage. Dégraissé vs InterventionForm :
 * pas de coût, pas de prestataire, pas de Hostaway, pas de paiement caisse.
 * Une dame de ménage est salariée, son temps de travail est tracé par le
 * workflow (created_at → submitted_at).
 */
export function CleaningForm({
  initial,
  scopeGroups,
  types,
  profiles,
  action,
  submitLabel = 'Enregistrer',
}: {
  initial?: Partial<Record<string, any>>;
  scopeGroups: ScopeGroup[];
  types: Opt[];
  profiles: Opt[];
  action: (fd: FormData) => Promise<{ ok: true; id?: string } | { ok: false; error: string }>;
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
      // r est undefined si l'action a fait un redirect() (NEXT_REDIRECT re-throwé)
      // — dans ce cas le catch ne se déclenche pas non plus, on est arrivé ici
      // sans erreur visible côté React. Si r est défini et ok=false on affiche.
      if (r && !r.ok) {
        setErr(r.error);
        setBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur inconnue');
      setBusy(false);
    }
  }

  const input = 'mt-1 w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm';
  const label = 'text-xs text-stoniz-gray-600';

  return (
    <form onSubmit={onSubmit} className="bg-white border border-stoniz-gray-200 rounded-xl p-4 sm:p-6 max-w-3xl">
      {err && <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{err}</div>}

      {/* 1 colonne sur mobile, 2 colonnes dès sm — les col-span suivent */}
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
          <label className={label}>Type de ménage *</label>
          <select name="cleaning_type_id" defaultValue={v.cleaning_type_id ?? ''} required className={input}>
            <option value="">— Choisir un type —</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Urgence</label>
          <select name="urgency" defaultValue={v.urgency ?? 'normale'} className={input}>
            <option value="critique">🔴 Critique</option>
            <option value="haute">🟠 Haute</option>
            <option value="normale">🟡 Normale</option>
            <option value="basse">🟢 Basse</option>
          </select>
        </div>

        <div>
          <label className={label}>Date prévue *</label>
          <input
            type="date" name="occurred_at" required
            defaultValue={v.occurred_at ?? new Date().toISOString().slice(0, 10)}
            className={input}
          />
        </div>
        <div>
          <label className={label}>Échéance (optionnel)</label>
          <input
            type="date" name="due_date"
            defaultValue={v.due_date ?? ''}
            className={input}
          />
        </div>

        <div>
          <label className={label}>Assignée à (dame de ménage)</label>
          <select name="assigned_to_id" defaultValue={v.assigned_to_id ?? ''} className={input}>
            <option value="">— Personne pour l'instant —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Suivi par (back office)</label>
          <select name="responsable_id" defaultValue={v.responsable_id ?? ''} className={input}>
            <option value="">—</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Description / consignes</label>
          <textarea
            name="description" defaultValue={v.description ?? ''} rows={3}
            placeholder="Ex : Insister sur la cuisine, draps changés, vidage poubelles…"
            className={input}
          />
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Observations</label>
          <textarea
            name="observations" defaultValue={v.observations ?? ''} rows={2}
            placeholder="Notes internes back office"
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
