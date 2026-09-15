'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import {
  resolveCleaningIncidentAction,
  declineCleaningIncidentAction,
  transformIncidentMultiAction,
} from '@/app/(team)/propria/menage/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

type Assignee = { id: string; full_name: string | null; role: string | null };
type Urgency = 'critique' | 'haute' | 'normale' | 'basse';

/**
 * Boutons d'actions sur un incident pour le back-office. Affichés tant que
 * l'incident n'est pas clos (resolved ou declined).
 *
 * 3 actions possibles (CEO 2026-06-09 : « J'ai vu » supprimé car sans valeur métier) :
 *   1. 🔧 Transformer → crée tâche ET/OU intervention ET/OU litige (multi-cible,
 *      chantier 8 marathon U8) + résout l'incident
 *   2. ✓ Résoudre    → resolved + note libre
 *   3. ✕ Décliner    → declined + motif obligatoire (non recevable)
 */
export function IncidentActions({
  incidentId,
  defaultDescription,
  defaultUrgency,
  assignees,
  hasReservation = false,
}: {
  incidentId: string;
  defaultDescription: string;
  defaultUrgency: Urgency;
  assignees: Assignee[];
  /** Le ménage source est-il lié à une résa Hostaway ? (requis pour litige) */
  hasReservation?: boolean;
}) {
  const router = useRouter();
  const [pending] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [modal, setModal] = useState<null | 'resolve' | 'decline' | 'transform'>(null);

  function close() { setModal(null); setErr(null); }

  return (
    <div className="flex flex-wrap gap-2 flex-shrink-0">
      <button
        type="button" onClick={() => { setModal('transform'); setErr(null); }} disabled={pending}
        className="text-xs border border-blue-300 bg-blue-50 text-blue-800 px-3 py-1.5 rounded hover:bg-blue-100"
      >
        🔧 Transformer
      </button>
      <button
        type="button" onClick={() => { setModal('resolve'); setErr(null); }} disabled={pending}
        className="text-xs border border-emerald-300 bg-emerald-50 text-emerald-800 px-3 py-1.5 rounded hover:bg-emerald-100"
      >
        ✓ Résoudre
      </button>
      <button
        type="button" onClick={() => { setModal('decline'); setErr(null); }} disabled={pending}
        className="text-xs border border-stoniz-gray-300 bg-stoniz-gray-50 text-stoniz-gray-700 px-3 py-1.5 rounded hover:bg-stoniz-gray-100"
      >
        ✕ Décliner
      </button>

      {err && (
        <div className="w-full">
          <SessionExpiredBanner error={err} />
        </div>
      )}

      {modal === 'resolve' && (
        <ResolveModal
          incidentId={incidentId}
          onClose={close}
          onDone={() => { close(); router.refresh(); }}
        />
      )}
      {modal === 'decline' && (
        <DeclineModal
          incidentId={incidentId}
          onClose={close}
          onDone={() => { close(); router.refresh(); }}
        />
      )}
      {modal === 'transform' && (
        <TransformModal
          incidentId={incidentId}
          defaultDescription={defaultDescription}
          defaultUrgency={defaultUrgency}
          assignees={assignees}
          hasReservation={hasReservation}
          onClose={close}
          onDone={() => { close(); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ─── Modale 1 : Résoudre (notes libres) ────────────────────────────────
function ResolveModal({
  incidentId, onClose, onDone,
}: { incidentId: string; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    setErr(null);
    start(async () => {
      try {
        const r = await resolveCleaningIncidentAction(incidentId, notes.trim() || null);
        if (!r || !(r as any).ok) { setErr((r as any)?.error ?? 'Échec'); return; }
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <ModalShell title="Résoudre l'incident" onClose={onClose}>
      <p className="text-xs text-stoniz-gray-600 mb-3">
        Marque cet incident comme résolu (problème traité sans création de tâche).
      </p>
      <label className="block text-xs text-stoniz-gray-600 mb-1">Note de résolution (optionnel)</label>
      <textarea
        value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
        placeholder="Ex : Remplacement commandé sur commandes en ligne, livraison J+3."
        className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
      />
      {err && <div className="mt-2"><SessionExpiredBanner error={err} /></div>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={pending}
          className="px-3 py-1.5 rounded text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50">
          Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending}
          className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm hover:bg-emerald-700 disabled:opacity-50">
          {pending ? '…' : '✓ Résoudre'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Modale 2 : Décliner (motif obligatoire) ───────────────────────────
function DeclineModal({
  incidentId, onClose, onDone,
}: { incidentId: string; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    if (reason.trim().length < 3) { setErr('Indique un motif (≥ 3 caractères).'); return; }
    setErr(null);
    start(async () => {
      try {
        const r = await declineCleaningIncidentAction(incidentId, reason.trim());
        if (!r || !(r as any).ok) { setErr((r as any)?.error ?? 'Échec'); return; }
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <ModalShell title="Décliner l'incident" onClose={onClose}>
      <p className="text-xs text-stoniz-gray-600 mb-3">
        Le signalement est jugé non recevable (fausse alerte, déjà connu, normal d'usage…).
      </p>
      <label className="block text-xs text-stoniz-gray-600 mb-1">Motif * (visible par la signaleuse)</label>
      <textarea
        value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
        placeholder="Ex : Usure normale, déjà signalé sur un autre incident #IN-12."
        className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
      />
      {err && <div className="mt-2"><SessionExpiredBanner error={err} /></div>}
      <div className="flex justify-end gap-2 mt-4">
        <button type="button" onClick={onClose} disabled={pending}
          className="px-3 py-1.5 rounded text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50">
          Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || reason.trim().length < 3}
          className="bg-stoniz-gray-700 text-white px-4 py-1.5 rounded text-sm hover:bg-stoniz-gray-800 disabled:opacity-50">
          {pending ? '…' : '✕ Décliner'}
        </button>
      </div>
    </ModalShell>
  );
}

// ─── Modale 3 : Transformer (multi-cible — chantier 8 marathon U8) ──────
// L'utilisateur coche 1 à 3 actions : tâche, intervention, litige.
// Exemple consultant : TV cassée → tâche d'achat + intervention installation
// + litige AirCover, lancés d'un coup.

const LITIGE_TYPES = [
  ['degats', 'Dégâts'],
  ['caution', 'Caution'],
  ['frais_contestes', 'Frais contestés'],
  ['annulation_tardive', 'Annulation tardive'],
  ['tapage', 'Tapage'],
  ['menage', 'Ménage'],
  ['autre', 'Autre'],
] as const;

type TargetState = {
  enabled: boolean;
  description: string;
  urgency: Urgency;
  assignedToId: string;
};

function TransformModal({
  incidentId, defaultDescription, defaultUrgency, assignees, hasReservation, onClose, onDone,
}: {
  incidentId: string;
  defaultDescription: string;
  defaultUrgency: Urgency;
  assignees: Assignee[];
  hasReservation: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const initialTarget: TargetState = {
    enabled: false, description: defaultDescription, urgency: defaultUrgency, assignedToId: '',
  };
  const [tache, setTache] = useState<TargetState>({ ...initialTarget });
  const [intervention, setIntervention] = useState<TargetState>({ ...initialTarget, enabled: true });
  const [litige, setLitige] = useState({
    enabled: false,
    type: 'degats' as (typeof LITIGE_TYPES)[number][0],
    description: defaultDescription,
    amount: '' as string,
  });
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const nbSelected = (tache.enabled ? 1 : 0) + (intervention.enabled ? 1 : 0) + (litige.enabled ? 1 : 0);

  function submit() {
    if (nbSelected === 0) { setErr('Choisis au moins une action.'); return; }
    for (const [label, t] of [['tâche', tache], ['intervention', intervention]] as const) {
      if (t.enabled && t.description.trim().length < 2) {
        setErr(`Description requise pour la ${label}.`); return;
      }
    }
    if (litige.enabled && litige.description.trim().length < 2) {
      setErr('Description requise pour le litige.'); return;
    }
    setErr(null);
    start(async () => {
      try {
        const r = await transformIncidentMultiAction({
          incident_id: incidentId,
          tache: tache.enabled ? {
            description: tache.description.trim(),
            urgency: tache.urgency,
            assigned_to_id: tache.assignedToId || undefined,
          } : undefined,
          intervention: intervention.enabled ? {
            description: intervention.description.trim(),
            urgency: intervention.urgency,
            assigned_to_id: intervention.assignedToId || undefined,
          } : undefined,
          litige: litige.enabled ? {
            type: litige.type,
            description: litige.description.trim(),
            amount: litige.amount ? Number(litige.amount) : undefined,
          } : undefined,
        });
        if (!r || !(r as any).ok) { setErr((r as any)?.error ?? 'Échec'); return; }
        onDone();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <ModalShell title="Transformer l'incident" onClose={onClose}>
      <p className="text-xs text-stoniz-gray-600 mb-4">
        Coche une ou plusieurs actions — elles seront créées d'un coup et
        l'incident sera marqué résolu, avec le lien vers chaque élément créé.
      </p>

      <div className="space-y-3">
        <TargetBlock
          icon="📋" title="Tâche" subtitle="Logistique (achat, dépôt, livraison clés…)"
          state={tache} setState={setTache} assignees={assignees}
        />
        <TargetBlock
          icon="🔧" title="Intervention" subtitle="Action technique (plomberie, élec, réparation…)"
          state={intervention} setState={setIntervention} assignees={assignees}
        />

        {/* Litige — uniquement si le ménage source est lié à une résa */}
        <div className={`border rounded-lg ${litige.enabled ? 'border-stoniz-black' : 'border-stoniz-gray-200'} ${!hasReservation ? 'opacity-60' : ''}`}>
          <label className="flex items-center gap-2 p-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={litige.enabled}
              disabled={!hasReservation}
              onChange={(e) => setLitige((s) => ({ ...s, enabled: e.target.checked }))}
              className="w-4 h-4"
            />
            <span className="text-sm font-medium">⚖️ Litige Airbnb</span>
            <span className="text-[11px] text-stoniz-gray-600">
              {hasReservation
                ? 'Caution, dégâts, AirCover…'
                : 'Indisponible — ménage sans réservation liée'}
            </span>
          </label>
          {litige.enabled && (
            <div className="px-3 pb-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-stoniz-gray-600 mb-1">Type *</label>
                  <select
                    value={litige.type}
                    onChange={(e) => setLitige((s) => ({ ...s, type: e.target.value as any }))}
                    className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {LITIGE_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-stoniz-gray-600 mb-1">Montant demandé (MAD, optionnel)</label>
                  <input
                    type="number" min="0" step="0.01" value={litige.amount}
                    onChange={(e) => setLitige((s) => ({ ...s, amount: e.target.value }))}
                    placeholder="Ex : 1500"
                    className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-stoniz-gray-600 mb-1">Description *</label>
                <textarea
                  value={litige.description} rows={2}
                  onChange={(e) => setLitige((s) => ({ ...s, description: e.target.value }))}
                  className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {err && <div className="mt-3"><SessionExpiredBanner error={err} /></div>}

      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} disabled={pending}
          className="px-3 py-1.5 rounded text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50">
          Annuler
        </button>
        <button type="button" onClick={submit} disabled={pending || nbSelected === 0}
          className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50">
          {pending ? '…' : nbSelected <= 1
            ? 'Créer + résoudre l’incident'
            : `Créer les ${nbSelected} éléments + résoudre l’incident`}
        </button>
      </div>
    </ModalShell>
  );
}

function TargetBlock({
  icon, title, subtitle, state, setState, assignees,
}: {
  icon: string; title: string; subtitle: string;
  state: TargetState;
  setState: (fn: (s: TargetState) => TargetState) => void;
  assignees: Assignee[];
}) {
  return (
    <div className={`border rounded-lg ${state.enabled ? 'border-stoniz-black' : 'border-stoniz-gray-200'}`}>
      <label className="flex items-center gap-2 p-3 cursor-pointer select-none">
        <input
          type="checkbox"
          checked={state.enabled}
          onChange={(e) => setState((s) => ({ ...s, enabled: e.target.checked }))}
          className="w-4 h-4"
        />
        <span className="text-sm font-medium">{icon} {title}</span>
        <span className="text-[11px] text-stoniz-gray-600">{subtitle}</span>
      </label>
      {state.enabled && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <label className="block text-xs text-stoniz-gray-600 mb-1">Description *</label>
            <textarea
              value={state.description} rows={2}
              onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
              className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-stoniz-gray-600 mb-1">Urgence</label>
              <select
                value={state.urgency}
                onChange={(e) => setState((s) => ({ ...s, urgency: e.target.value as Urgency }))}
                className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="critique">🔴 Critique</option>
                <option value="haute">🟠 Haute</option>
                <option value="normale">🟡 Normale</option>
                <option value="basse">🟢 Basse</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-stoniz-gray-600 mb-1">Assigner à (optionnel)</label>
              <select
                value={state.assignedToId}
                onChange={(e) => setState((s) => ({ ...s, assignedToId: e.target.value }))}
                className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
              >
                <option value="">— Décider plus tard —</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>{a.full_name ?? '(sans nom)'}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-xl w-full p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 className="font-display text-xl">{title}</h2>
          <button type="button" onClick={onClose} className="text-stoniz-gray-500 hover:text-stoniz-black" aria-label="Fermer">
            <X className="w-5 h-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
