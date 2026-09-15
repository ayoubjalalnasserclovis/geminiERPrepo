'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, X, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  selectFinalPropertyAction,
  selectFinalPropertyOnBehalfAction,
  unselectFinalPropertyAction,
} from '@/app/(team)/projects/[id]/proposals/actions';

export function SelectFinalPropertyButton({
  projectId, propertyId, propertyName, isSelected, hasOtherFinal, clientAccepted,
}: {
  projectId: string;
  propertyId: string;
  propertyName: string;
  isSelected: boolean;
  hasOtherFinal: boolean;
  /** Le client a-t-il déjà accepté cette proposition dans son portail ? */
  clientAccepted: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showOnBehalfModal, setShowOnBehalfModal] = useState(false);
  const [reason, setReason] = useState('');

  function select() {
    if (!confirm(`Sélectionner « ${propertyName} » comme bien définitif du projet ?\n\nLes autres propositions en attente seront annulées. Le bien sera réservé (status "offre") et le projet pourra passer en phase Design.`)) return;
    setError(null);
    start(async () => {
      const r = await selectFinalPropertyAction({ project_id: projectId, property_id: propertyId });
      if (!r.ok) setError(r.error ?? 'Erreur');
    });
  }

  function submitOnBehalf() {
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      setError('Le motif doit contenir au moins 10 caractères.');
      return;
    }
    setError(null);
    start(async () => {
      const r = await selectFinalPropertyOnBehalfAction({
        project_id: projectId,
        property_id: propertyId,
        reason: trimmed,
      });
      if (!r.ok) {
        setError(r.error ?? 'Erreur');
        return;
      }
      setShowOnBehalfModal(false);
      setReason('');
    });
  }

  function unselect() {
    if (!confirm('Annuler la sélection de ce bien comme bien final du projet ?\n\nLe bien redeviendra disponible et le projet ne pourra plus passer en Design tant qu\'un nouveau bien n\'est pas sélectionné.')) return;
    setError(null);
    start(async () => {
      const r = await unselectFinalPropertyAction(projectId);
      if (!r.ok) setError(r.error ?? 'Erreur');
    });
  }

  if (isSelected) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 border border-green-300 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4" />
          Bien retenu pour le projet
        </div>
        <button onClick={unselect} disabled={pending}
          className="text-xs text-stoniz-gray-500 hover:text-red-600 inline-flex items-center gap-1">
          <X className="w-3 h-3" /> {pending ? '…' : 'Annuler la sélection'}
        </button>
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
    );
  }

  if (hasOtherFinal) {
    return (
      <span className="text-xs text-stoniz-gray-500 italic">
        Un autre bien est déjà sélectionné
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {clientAccepted ? (
        <Button size="sm" onClick={select} disabled={pending}>
          🏠 {pending ? 'Sélection…' : 'Sélectionner ce bien'}
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => { setShowOnBehalfModal(true); setError(null); }}
          disabled={pending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-amber-300 bg-amber-50 hover:bg-amber-100 text-sm text-amber-900 disabled:opacity-50"
          title="À utiliser uniquement si le client est indisponible (vacances, no-show)"
        >
          <UserCheck className="w-4 h-4" />
          Valider au nom du client
        </button>
      )}
      {error && <div className="text-xs text-red-600">{error}</div>}

      {showOnBehalfModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
             onClick={() => !pending && setShowOnBehalfModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
               onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="text-lg font-semibold flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-amber-600" />
                Validation au nom du client
              </h3>
              <p className="text-sm text-stoniz-gray-600 mt-1">
                Vous vous apprêtez à valider <strong>« {propertyName} »</strong> comme bien
                définitif à la place du client. Une bannière ambre l'indiquera de façon
                permanente sur la fiche projet, et l'action sera loggée dans l'historique.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">
                Motif <span className="text-red-600">*</span>
                <span className="text-xs text-stoniz-gray-500 ml-2 font-normal">
                  (min. 10 caractères)
                </span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="Ex : client en vacances jusqu'au 5/09, validation reçue par WhatsApp le 30/08"
                className="w-full border rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-stoniz-black"
                autoFocus
                disabled={pending}
              />
              <div className="text-xs text-stoniz-gray-500 mt-1 text-right">
                {reason.trim().length} / 10
              </div>
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowOnBehalfModal(false)}
                disabled={pending}
                className="px-4 py-2 text-sm rounded-md border hover:bg-stoniz-gray-50"
              >
                Annuler
              </button>
              <Button
                size="sm"
                onClick={submitOnBehalf}
                disabled={pending || reason.trim().length < 10}
              >
                {pending ? 'Validation…' : 'Valider au nom du client'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
