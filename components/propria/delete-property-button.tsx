'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, AlertTriangle } from 'lucide-react';
import { softDeletePropertyAction } from '@/app/(team)/propria/biens/[id]/actions';

/**
 * Bouton de suppression d'un bien Propria.
 * Affiché UNIQUEMENT si userRole='ceo' (la prop conditionne l'affichage,
 * mais la sécurité réelle est côté RPC SECURITY DEFINER).
 *
 * Confirmation typée : le CEO doit taper le nom du bien pour activer le bouton
 * + saisir une raison (min 5 chars).
 *
 * Soft-delete : pose deleted_at = NOW() sur le bien + ses propria_units.
 * Pas de hard DELETE, donc restauration possible via SQL en cas d'erreur.
 */
export function DeletePropertyButton({
  propertyId,
  propertyName,
  ownerName,
  userRole,
  unitsCount,
}: {
  propertyId: string;
  propertyName: string;
  ownerName?: string | null;
  userRole: string;
  unitsCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [typedName, setTypedName] = useState('');
  const [reason, setReason] = useState('');
  const router = useRouter();

  if (userRole !== 'ceo') return null;

  const nameMatch = typedName.trim() === propertyName.trim();
  const reasonValid = reason.trim().length >= 5;
  const canSubmit = nameMatch && reasonValid && !pending;

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.append('property_id', propertyId);
    fd.append('reason', reason.trim());
    start(async () => {
      const r = await softDeletePropertyAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.push('/propria/biens');
    });
  }

  function close() {
    if (pending) return;
    setOpen(false);
    setTypedName('');
    setReason('');
    setError(null);
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs px-3 py-2 rounded border border-red-300 text-red-800 hover:bg-red-50 flex items-center gap-1.5"
      >
        <Trash2 className="w-3.5 h-3.5" />
        Supprimer ce bien
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-lg w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-2 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-red-600" />
              Supprimer le bien
            </h3>
            <p className="text-sm text-stoniz-gray-600 mb-4">
              Action <strong>réversible</strong> (soft-delete) — le bien sera caché
              partout mais conservé en base. Restauration possible via SQL si
              besoin.
            </p>

            <div className="bg-stoniz-gray-50 rounded p-3 mb-4 text-sm">
              <div className="text-stoniz-gray-500 text-xs uppercase tracking-wide mb-1">
                Bien à supprimer
              </div>
              <div className="font-medium">{propertyName}</div>
              {ownerName && (
                <div className="text-xs text-stoniz-gray-600 mt-0.5">{ownerName}</div>
              )}
              <div className="text-xs text-amber-700 mt-2">
                {unitsCount} lot{unitsCount > 1 ? 's' : ''} également supprimé{unitsCount > 1 ? 's' : ''}
              </div>
            </div>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                  Tape le nom du bien pour confirmer
                </label>
                <input
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  placeholder={propertyName}
                  className={`w-full border rounded px-3 py-2 text-sm ${
                    typedName.length > 0 && !nameMatch
                      ? 'border-red-300'
                      : 'border-stoniz-gray-300'
                  }`}
                />
                {typedName.length > 0 && !nameMatch && (
                  <div className="text-xs text-red-700 mt-1">
                    Le nom ne correspond pas exactement.
                  </div>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                  Raison (min 5 caractères)
                </label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex: bien démo, propriétaire retiré, doublon…"
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-700 mb-3 bg-red-50 p-2 rounded">{error}</div>
            )}

            <div className="flex gap-2 justify-end">
              <button
                onClick={close}
                disabled={pending}
                className="px-4 py-2 text-sm border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="px-4 py-2 text-sm bg-red-700 text-white rounded hover:bg-red-800 disabled:opacity-40"
              >
                {pending ? '…' : 'Supprimer définitivement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
