'use client';

import { useMemo, useState } from 'react';
import type { ScopeGroup } from '@/lib/propria/intervention-scope';

type Opt = { id: string; label: string; sub?: string };
export type WalletOpt = {
  id: string;
  label: string;
  balance_mad: number;
  is_validated_lock: boolean;
};
// Chantier 14 : résas en cours / à venir pour le sélecteur « Réservation liée »
// (code résa propagé dans hostaway_ref).
export type InterventionResaOption = {
  hostaway_id: number;
  unit_id: string | null;
  guest_name: string | null;
  arrival_date: string;
  departure_date: string;
};

function fmtMad(n: number) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' DH';
}

export function InterventionForm({
  initial,
  scopeGroups,
  types,
  providers,
  profiles,
  wallets = [],
  defaultWalletId = null,
  reservations = [],
  action,
  submitLabel = 'Enregistrer',
}: {
  initial?: Partial<Record<string, any>>;
  scopeGroups: ScopeGroup[];
  types: Opt[];
  providers: Opt[];
  profiles: Opt[];
  wallets?: WalletOpt[];
  defaultWalletId?: string | null;
  reservations?: InterventionResaOption[];
  action: (fd: FormData) => Promise<void | { ok: true } | { ok: false; error: string }>;
  submitLabel?: string;
}) {
  const v = initial ?? {};
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cost, setCost] = useState<string>(String(v.cost_propria_mad ?? ''));
  // Lot sélectionné (suivi pour filtrer les résas du sélecteur « Réservation liée »)
  const [scope, setScope] = useState<string>(String(v.scope ?? ''));
  // Code résa propagé (hostaway_ref) — rempli par le sélecteur ou à la main.
  const [hostawayRef, setHostawayRef] = useState<string>(String(v.hostaway_ref ?? ''));
  const [walletId, setWalletId] = useState<string>(
    String(v.paid_from_wallet_id ?? defaultWalletId ?? '')
  );
  // Type : 'intervention' (technique) vs 'tache' (non-technique). Influence
  // les libellés ailleurs dans la page mais on garde TOUS les champs car
  // une tâche peut aussi avoir un coût (ex: achat de piles).
  const [kind, setKind] = useState<'intervention' | 'tache'>(
    (v.kind === 'tache' ? 'tache' : 'intervention') as 'intervention' | 'tache',
  );

  // Résas en cours / à venir du lot choisi (scope "unit:<uuid>" uniquement)
  const scopeUnitId = scope.startsWith('unit:') ? scope.slice(5) : null;
  const lotResas = useMemo(
    () => (scopeUnitId ? reservations.filter((r) => r.unit_id === scopeUnitId) : []),
    [reservations, scopeUnitId],
  );

  const selectedWallet = wallets.find((w) => w.id === walletId);
  const costNum = Number(cost);
  const isCostValid = !Number.isNaN(costNum) && costNum > 0;
  const newBalance = selectedWallet ? selectedWallet.balance_mad - (isCostValid ? costNum : 0) : null;
  const wouldGoNegative = newBalance != null && newBalance < 0;
  const expenseLocked = !!selectedWallet?.is_validated_lock && walletId === String(v.paid_from_wallet_id ?? '');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await action(new FormData(e.currentTarget));
      if (r && typeof r === 'object' && 'ok' in r && !r.ok) {
        setErr(r.error ?? 'Erreur inconnue');
        setBusy(false);
      }
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur inattendue');
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
        {/* ─── Type : intervention vs tâche ────────────────────────────── */}
        <div className="sm:col-span-2">
          <label className={label}>Type *</label>
          <input type="hidden" name="kind" value={kind} />
          <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setKind('intervention')}
              className={`text-left border rounded-md p-3 transition ${
                kind === 'intervention'
                  ? 'border-stoniz-black bg-stoniz-gray-50'
                  : 'border-stoniz-gray-200 hover:border-stoniz-gray-400 bg-white'
              }`}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                🔧 Intervention
                {kind === 'intervention' && <span className="text-stoniz-black text-xs">✓</span>}
              </div>
              <div className="text-[11px] text-stoniz-gray-600 mt-0.5">
                Action <strong>technique</strong> : plomberie, électricité, réparation, ménage post-séjour…
              </div>
            </button>
            <button
              type="button"
              onClick={() => setKind('tache')}
              className={`text-left border rounded-md p-3 transition ${
                kind === 'tache'
                  ? 'border-stoniz-black bg-stoniz-gray-50'
                  : 'border-stoniz-gray-200 hover:border-stoniz-gray-400 bg-white'
              }`}
            >
              <div className="text-sm font-medium flex items-center gap-2">
                📋 Tâche
                {kind === 'tache' && <span className="text-stoniz-black text-xs">✓</span>}
              </div>
              <div className="text-[11px] text-stoniz-gray-600 mt-0.5">
                Action <strong>logistique</strong> : livraison clés, dépôt consommable, changer piles…
              </div>
            </button>
          </div>
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Lot concerné *</label>
          <select name="scope" value={scope} onChange={(e) => setScope(e.target.value)} required className={input}>
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
          <label className={label}>
            {kind === 'tache' ? 'Catégorie de tâche' : "Type d'intervention"}
          </label>
          <select name="intervention_type_id" defaultValue={v.intervention_type_id ?? ''} className={input}>
            <option value="">— Texte libre ci-dessous —</option>
            {types.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>{kind === 'tache' ? 'Catégorie' : 'Type'} libre (si pas dans la liste)</label>
          <input type="text" name="type_label" defaultValue={v.type_label ?? ''} className={input} />
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Description *</label>
          <textarea name="description" defaultValue={v.description ?? ''} required rows={3} className={input} />
        </div>

        <div>
          <label className={label}>Date *</label>
          <input
            type="date"
            name="occurred_at"
            required
            defaultValue={v.occurred_at ?? new Date().toISOString().slice(0, 10)}
            className={input}
          />
        </div>
        <div>
          <label className={label}>Urgence *</label>
          <select name="urgency" defaultValue={v.urgency ?? 'normale'} required className={input}>
            <option value="critique">🔴 Critique</option>
            <option value="haute">🟠 Haute</option>
            <option value="normale">🟡 Normale</option>
            <option value="basse">🟢 Basse</option>
          </select>
        </div>

        <div>
          <label className={label}>Assignée à (terrain)</label>
          <select name="assigned_to_id" defaultValue={v.assigned_to_id ?? ''} className={input}>
            <option value="">— Personne pour l'instant —</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Échéance</label>
          <input
            type="date"
            name="due_date"
            defaultValue={v.due_date ?? ''}
            className={input}
          />
        </div>

        <div>
          <label className={label}>Suivi par (back office)</label>
          <select name="responsable_id" defaultValue={v.responsable_id ?? ''} className={input}>
            <option value="">—</option>
            {profiles.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className={label}>Prestataire externe</label>
          <select name="provider_id" defaultValue={v.provider_id ?? ''} className={input}>
            <option value="">—</option>
            {providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>

        <div>
          <label className={label}>Coût Propria (DH)</label>
          <input
            type="number" step="0.01" name="cost_propria_mad"
            value={cost} onChange={(e) => setCost(e.target.value)}
            disabled={expenseLocked}
            className={input}
          />
        </div>
        <div>
          <label className={label}>Refacturation client (DH)</label>
          <input type="number" step="0.01" name="client_billing_mad" defaultValue={v.client_billing_mad ?? ''} className={input} />
        </div>

        <div>
          <label className={label}>À la charge</label>
          <select name="charge_to" defaultValue={v.charge_to ?? 'a_definir'} className={input}>
            <option value="a_definir">À définir</option>
            <option value="client">Client</option>
            <option value="propria">Propria</option>
            <option value="copropriete">Copropriété</option>
          </select>
        </div>

        {/* ─── Caisse Propria depuis laquelle la dépense est tirée ───── */}
        <div className="sm:col-span-2 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-3 space-y-2">
          <div>
            <label className={label}>
              💰 Payé depuis la caisse de
              {isCostValid && <span className="text-stoniz-gray-500"> · requis dès qu'un coût est saisi</span>}
            </label>
            <select
              name="paid_from_wallet_id"
              value={walletId}
              onChange={(e) => setWalletId(e.target.value)}
              disabled={expenseLocked}
              className={input}
            >
              <option value="">— Aucune caisse (pas de débours cash) —</option>
              {wallets.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.label} · Solde {fmtMad(w.balance_mad)}
                </option>
              ))}
            </select>
            {wallets.length === 0 && (
              <p className="text-[11px] text-amber-700 mt-1">
                Aucune caisse Propria active. Crée d'abord une caisse dans /propria/caisse.
              </p>
            )}
          </div>

          {selectedWallet && isCostValid && (
            <div className={`text-xs rounded p-2 border ${
              wouldGoNegative
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}>
              {wouldGoNegative ? '⚠ ' : '✓ '}
              Solde après cette dépense : <strong>{fmtMad(newBalance!)}</strong>
              {wouldGoNegative && ' — le collaborateur avance sur ses fonds propres en attendant la prochaine dotation.'}
            </div>
          )}

          {expenseLocked && (
            <div className="text-xs bg-stoniz-gray-100 border border-stoniz-gray-300 rounded p-2 text-stoniz-gray-700">
              🔒 La dépense liée a déjà été validée par le back-office.
              Pour modifier le coût ou la caisse, fais "Dévalider" la dépense depuis /propria/caisse.
            </div>
          )}
        </div>
        {/* ─── Réservation liée (chantier 14 : code résa propagé) ────── */}
        {reservations.length > 0 && (
          <div>
            <label className={label}>Réservation liée (du lot choisi)</label>
            <select
              value={lotResas.some((r) => String(r.hostaway_id) === hostawayRef) ? hostawayRef : ''}
              onChange={(e) => { if (e.target.value) setHostawayRef(e.target.value); }}
              disabled={!scopeUnitId}
              className={input}
            >
              <option value="">— Sans résa identifiée —</option>
              {lotResas.map((r) => (
                <option key={r.hostaway_id} value={String(r.hostaway_id)}>
                  #{r.hostaway_id} · {r.guest_name ?? 'Voyageur'} · {r.arrival_date} → {r.departure_date}
                </option>
              ))}
            </select>
            {scopeUnitId && lotResas.length === 0 && (
              <p className="text-[11px] text-stoniz-gray-500 mt-1">
                Aucune résa en cours/à venir pour ce lot — saisie manuelle possible ci-contre.
              </p>
            )}
          </div>
        )}
        <div>
          <label className={label}>Réf. résa (code propagé, optionnel)</label>
          <input
            type="text"
            name="hostaway_ref"
            value={hostawayRef}
            onChange={(e) => setHostawayRef(e.target.value)}
            className={input}
          />
        </div>
        <div>
          <label className={label}>Intégré dans Hostaway *</label>
          <select
            name="hostaway_integrated"
            defaultValue={v.hostaway_integrated === true ? 'oui' : v.hostaway_integrated === false ? 'non' : 'non'}
            required
            className={input}
          >
            <option value="oui">Oui</option>
            <option value="non">Non</option>
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Observations</label>
          <textarea name="observations" defaultValue={v.observations ?? ''} rows={2} className={input} />
        </div>
      </div>

      <div className="flex justify-end mt-5">
        <button
          type="submit"
          disabled={busy}
          className="w-full sm:w-auto bg-stoniz-black text-white px-5 py-2.5 sm:py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50"
        >
          {busy ? 'Enregistrement...' : submitLabel}
        </button>
      </div>
    </form>
  );
}
