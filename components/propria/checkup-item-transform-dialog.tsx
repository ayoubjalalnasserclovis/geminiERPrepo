'use client';

import { useState, useTransition, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { transformCheckupItemAction } from '@/app/(team)/propria/checkups/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

// ─── Modale de transformation d'un item check-up (Phase C1 — CEO 2026-06-24) ─
// Extrait du code multi-cible de checkup-workflow-actions.tsx (L196-302) pour
// pouvoir être réutilisé : (1) bouton inline sur chaque item non-OK pendant
// le terrain, (2) modale de validation finale CEO (rétro-compat).
//
// Comportement :
//   - 3 checkboxes : Tâche / Intervention / Litige
//   - Litige disabled si pas de contexte Hostaway < 30j
//   - Si une cible a déjà été créée pour cet item → checkbox cochée + grisée
//     + texte "Déjà transformé" (mode information sans re-création)
//   - Bouton "Créer" : appelle transformCheckupItemAction (server)
//   - Pattern défensif : useTransition + try/catch + !r || !r.ok + bandeau

export type LitigeType =
  | 'caution'
  | 'degats'
  | 'frais_contestes'
  | 'annulation_tardive'
  | 'tapage'
  | 'menage'
  | 'autre';

export type CheckupItemTransformDialogProps = {
  open: boolean;
  onClose: () => void;
  checkupId: string;
  itemKey: string;
  itemLabel: string;
  itemEmoji?: string;
  itemNote?: string | null;
  /** Hostaway < 30j présent sur le lot — sinon litige disabled. */
  hasHostawayContext: boolean;
  /** IDs déjà créés pour cet item (idempotence côté UI). */
  alreadyTransformed?: {
    tache?: string;
    intervention?: string;
    litige?: string;
  };
};

export function CheckupItemTransformDialog({
  open,
  onClose,
  checkupId,
  itemKey,
  itemLabel,
  itemEmoji = '⚠️',
  itemNote,
  hasHostawayContext,
  alreadyTransformed,
}: CheckupItemTransformDialogProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const lockedTache = !!alreadyTransformed?.tache;
  const lockedIntervention = !!alreadyTransformed?.intervention;
  const lockedLitige = !!alreadyTransformed?.litige;

  // État initial : si déjà transformé → coché (locked). Sinon : intervention
  // par défaut comme dans la modale validation (le cas le plus fréquent).
  const [tache, setTache] = useState<boolean>(lockedTache);
  const [intervention, setIntervention] = useState<boolean>(lockedIntervention || !lockedTache);
  const [litige, setLitige] = useState<boolean>(lockedLitige);
  const [litigeType, setLitigeType] = useState<LitigeType>('degats');
  const [litigeAmount, setLitigeAmount] = useState<string>('');

  // Description pré-remplie avec la note de l'opérateur (modifiable).
  const defaultDescription = useMemo(() => {
    const note = (itemNote ?? '').trim();
    return note ? `${itemLabel} — ${note}` : itemLabel;
  }, [itemLabel, itemNote]);
  const [description, setDescription] = useState<string>(defaultDescription);

  if (!open) return null;

  const litigeDisabled = lockedLitige || !hasHostawayContext;
  const anyAlreadyTransformed = lockedTache || lockedIntervention || lockedLitige;

  function submit() {
    setErr(null);
    // Garde-fou client : au moins une cible neuve à créer
    const newTache = tache && !lockedTache;
    const newIntervention = intervention && !lockedIntervention;
    const newLitige = litige && !lockedLitige;
    if (!newTache && !newIntervention && !newLitige) {
      setErr('Aucune nouvelle cible à créer.');
      return;
    }
    // Validation montant litige
    let amount: number | null = null;
    if (newLitige) {
      const trimmed = litigeAmount.trim();
      if (trimmed) {
        const n = Number(trimmed.replace(',', '.'));
        if (!isFinite(n) || n <= 0) {
          setErr('Montant du litige invalide.');
          return;
        }
        amount = n;
      }
    }

    start(async () => {
      try {
        const targets: {
          tache?: { description?: string };
          intervention?: { description?: string };
          litige?: { type: LitigeType; description?: string; amount?: number | null };
        } = {};
        const descTrim = description.trim();
        const descPayload = descTrim.length >= 2 ? descTrim : undefined;
        if (newTache) targets.tache = { description: descPayload };
        if (newIntervention) targets.intervention = { description: descPayload };
        if (newLitige) targets.litige = { type: litigeType, description: descPayload, amount };

        const r = await transformCheckupItemAction({
          checkup_id: checkupId,
          item_key: itemKey,
          targets,
        });
        if (!r || !r.ok) {
          setErr(r?.error ?? 'Erreur inconnue');
          return;
        }
        onClose();
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl max-w-lg w-full p-6 text-left max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl mb-1">⚡ Transformer l&apos;item</h2>
        <div className="text-sm text-stoniz-gray-700 mb-3">
          <span className="text-lg mr-1">{itemEmoji}</span>
          <span className="font-medium">{itemLabel}</span>
        </div>
        {itemNote && (
          <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md px-3 py-2 text-xs text-stoniz-gray-700 mb-3">
            <span className="text-[10px] uppercase tracking-wider text-stoniz-gray-500 mr-1">Note terrain :</span>
            {itemNote}
          </div>
        )}

        {anyAlreadyTransformed && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2 text-xs text-emerald-800 mb-3">
            <strong>✅ Déjà transformé :</strong>{' '}
            {[
              lockedTache && 'tâche',
              lockedIntervention && 'intervention',
              lockedLitige && 'litige',
            ]
              .filter(Boolean)
              .join(' · ')}
            . Coche d&apos;autres cibles pour compléter — les cases verrouillées ne seront pas re-créées.
          </div>
        )}

        <p className="text-xs text-stoniz-gray-600 mb-3">
          Coche <strong>tâche</strong>, <strong>intervention</strong> et/ou <strong>litige</strong> (combinaison libre). Tout pointe vers ce check-up source.
        </p>

        <div className="space-y-2 mb-4">
          {/* Tâche */}
          <label
            className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm ${
              lockedTache
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default'
                : tache
                  ? 'border-amber-400 bg-amber-50 text-amber-900 cursor-pointer'
                  : 'border-stoniz-gray-300 bg-white cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={tache}
              disabled={lockedTache || pending}
              onChange={(e) => setTache(e.target.checked)}
            />
            <span className="flex-1">
              📌 <strong>Tâche</strong>
              <span className="block text-[11px] text-stoniz-gray-600">
                {lockedTache ? 'Déjà créée' : 'Action interne à planifier'}
              </span>
            </span>
          </label>

          {/* Intervention */}
          <label
            className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm ${
              lockedIntervention
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default'
                : intervention
                  ? 'border-blue-400 bg-blue-50 text-blue-900 cursor-pointer'
                  : 'border-stoniz-gray-300 bg-white cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={intervention}
              disabled={lockedIntervention || pending}
              onChange={(e) => setIntervention(e.target.checked)}
            />
            <span className="flex-1">
              🔧 <strong>Intervention</strong>
              <span className="block text-[11px] text-stoniz-gray-600">
                {lockedIntervention ? 'Déjà créée' : 'Demande à un artisan/fournisseur'}
              </span>
            </span>
          </label>

          {/* Litige */}
          <label
            className={`flex items-center gap-2 px-3 py-2.5 rounded-md border text-sm ${
              lockedLitige
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 cursor-default'
                : litige
                  ? 'border-red-400 bg-red-50 text-red-900 cursor-pointer'
                  : litigeDisabled
                    ? 'border-stoniz-gray-200 bg-stoniz-gray-50 text-stoniz-gray-400 cursor-not-allowed'
                    : 'border-stoniz-gray-300 bg-white cursor-pointer'
            }`}
          >
            <input
              type="checkbox"
              checked={litige}
              disabled={litigeDisabled || pending}
              onChange={(e) => setLitige(e.target.checked)}
            />
            <span className="flex-1">
              ⚖️ <strong>Litige</strong>
              <span className="block text-[11px] text-stoniz-gray-600">
                {lockedLitige
                  ? 'Déjà créé'
                  : !hasHostawayContext
                    ? 'Indispo : pas de résa Hostaway < 30j sur ce lot'
                    : 'Contestation client (caution, dégâts…)'}
              </span>
            </span>
          </label>

          {litige && !lockedLitige && hasHostawayContext && (
            <div className="ml-6 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={litigeType}
                onChange={(e) => setLitigeType(e.target.value as LitigeType)}
                disabled={pending}
                className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs"
              >
                <option value="caution">Caution</option>
                <option value="degats">Dégâts</option>
                <option value="frais_contestes">Frais contestés</option>
                <option value="annulation_tardive">Annulation tardive</option>
                <option value="tapage">Tapage</option>
                <option value="menage">Ménage</option>
                <option value="autre">Autre</option>
              </select>
              <input
                type="text"
                inputMode="decimal"
                value={litigeAmount}
                onChange={(e) => setLitigeAmount(e.target.value)}
                disabled={pending}
                placeholder="Montant (MAD, optionnel)"
                className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs"
              />
            </div>
          )}
        </div>

        {/* Description partagée */}
        <div className="mb-3">
          <label className="block text-[11px] font-medium text-stoniz-gray-700 mb-1">
            Description (partagée tâche / intervention / litige)
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={pending}
            className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm"
            placeholder={defaultDescription}
          />
        </div>

        {err && (
          <div className="mb-3">
            <SessionExpiredBanner error={err} />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50"
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="bg-blue-600 text-white px-4 py-2 rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? 'Création…' : '⚡ Créer'}
          </button>
        </div>
      </div>
    </div>
  );
}
