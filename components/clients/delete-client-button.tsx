'use client';

import { useState, useTransition } from 'react';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Money } from '@/components/ui/money';
import {
  deleteClientAction,
  getClientDeletionImpactAction,
} from '@/app/(team)/clients/actions';

type Impact = {
  client_name: string;
  projects_total: number;
  projects_actifs: number;
  payments_open: number;
  payments_open_remaining: number;
};

/**
 * Bouton 🗑 + modale de confirmation suppression client.
 * Affiche les compteurs d'impact (projets liés, paiements ouverts) AVANT validation.
 * Force la saisie de "SUPPRIMER" pour activer le bouton final (anti fausse manip).
 */
export function DeleteClientButton({
  clientId,
  clientName,
}: {
  clientId: string;
  clientName: string;
}) {
  const [open, setOpen] = useState(false);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openModal() {
    setError(null);
    setConfirmText('');
    setImpact(null);
    setOpen(true);
    start(async () => {
      const r = await getClientDeletionImpactAction(clientId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r.ok) { setError(r.error); return; }
      setImpact(r.impact ?? null);
    });
  }

  function submit() {
    if (confirmText.trim().toUpperCase() !== 'SUPPRIMER') return;
    setError(null);
    start(async () => {
      const r = await deleteClientAction(clientId).catch((e: any) => ({
        ok: false, error: e?.message ?? 'Erreur',
      } as const));
      if (!r || !r.ok) { setError(r?.error ?? 'Échec'); return; }
      setOpen(false);
    });
  }

  const canConfirm = confirmText.trim().toUpperCase() === 'SUPPRIMER' && !pending;

  return (
    <>
      <button
        onClick={openModal}
        disabled={pending}
        title={`Supprimer ${clientName}`}
        className="p-1.5 rounded-md hover:bg-red-50 text-stoniz-gray-400 hover:text-red-600 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4"
          >
            <div>
              <h2 className="font-display text-xl">Supprimer ce client ?</h2>
              <p className="text-sm text-stoniz-gray-600 mt-1">
                <strong>{impact?.client_name ?? clientName}</strong>
              </p>
            </div>

            {pending && !impact ? (
              <p className="text-sm text-stoniz-gray-500">Calcul de l'impact…</p>
            ) : impact ? (
              <div className="bg-stoniz-gray-50 rounded p-3 text-sm space-y-1">
                <div className="font-semibold">Impact</div>
                <div>
                  Projets liés : <strong>{impact.projects_total}</strong>
                  {impact.projects_actifs > 0 && (
                    <span className="text-orange-700"> (dont {impact.projects_actifs} non perdu{impact.projects_actifs > 1 ? 's' : ''})</span>
                  )}
                </div>
                <div>
                  Paiements ouverts : <strong>{impact.payments_open}</strong>
                  {impact.payments_open_remaining > 0 && (
                    <span className="text-orange-700">
                      {' '}(<Money amount={impact.payments_open_remaining} /> restant à encaisser)
                    </span>
                  )}
                </div>
                {impact.projects_actifs === 0 && impact.payments_open === 0 ? (
                  <div className="text-xs text-green-700 pt-1">
                    ✓ Aucun projet actif ni paiement ouvert — suppression sans impact business.
                  </div>
                ) : (
                  <div className="text-xs text-red-700 pt-1">
                    ⚠ Suppression non destructive (soft-delete) — le client disparaît de la liste mais ses données restent en base et peuvent être restaurées via SQL.
                  </div>
                )}
              </div>
            ) : null}

            <div>
              <Label>Pour confirmer, tape <code className="bg-stoniz-gray-100 px-1 rounded">SUPPRIMER</code></Label>
              <Input
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="SUPPRIMER"
                autoFocus
                disabled={pending}
              />
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Annuler
              </Button>
              <Button
                type="button"
                onClick={submit}
                disabled={!canConfirm}
                className={canConfirm ? 'bg-red-600 hover:bg-red-700' : ''}
              >
                {pending ? 'Suppression…' : 'Supprimer définitivement'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
