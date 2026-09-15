'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';
import { updateProjectMetadataAction } from '@/app/(team)/projects/[id]/edit-metadata-actions';

/**
 * Bouton "Éditer" sur la fiche projet pour le CEO : permet de saisir
 * prix du bien + dates clés (compromis, acte, travaux, livraison).
 * Utile pour les projets PROPRIA legacy où ces infos n'étaient pas
 * dans l'import CSV.
 */
export function ProjectMetadataEditButton({
  projectId,
  propertyId,
  initialPrice,
  initialCompromis,
  initialActe,
  initialTravauxStart,
  initialTravauxEnd,
  initialLivraison,
  userRole,
}: {
  projectId: string;
  propertyId?: string | null;
  initialPrice?: number | null;
  initialCompromis?: string | null;
  initialActe?: string | null;
  initialTravauxStart?: string | null;
  initialTravauxEnd?: string | null;
  initialLivraison?: string | null;
  userRole: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [price, setPrice] = useState(initialPrice?.toString() ?? '');
  const [compromis, setCompromis] = useState(initialCompromis ?? '');
  const [acte, setActe] = useState(initialActe ?? '');
  const [travauxStart, setTravauxStart] = useState(initialTravauxStart ?? '');
  const [travauxEnd, setTravauxEnd] = useState(initialTravauxEnd ?? '');
  const [livraison, setLivraison] = useState(initialLivraison ?? '');
  const router = useRouter();

  if (userRole !== 'ceo') return null;

  function submit() {
    setError(null);
    start(async () => {
      const r = await updateProjectMetadataAction({
        project_id: projectId,
        property_id: propertyId,
        price: price ? Number(price) : null,
        compromis_date: compromis,
        acte_authentique_date: acte,
        travaux_start_date: travauxStart,
        travaux_end_date: travauxEnd,
        livraison_date: livraison,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-stoniz-gray-600 hover:underline flex items-center gap-1"
      >
        <Pencil className="w-3 h-3" />
        Éditer
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-medium mb-4">Éditer prix + dates clés</h3>

            <div className="space-y-3">
              {propertyId && (
                <div>
                  <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                    Prix du bien (€)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    placeholder="Ex: 240000"
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                    Date compromis
                  </label>
                  <input
                    type="date"
                    value={compromis}
                    onChange={(e) => setCompromis(e.target.value)}
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                    Acte authentique
                  </label>
                  <input
                    type="date"
                    value={acte}
                    onChange={(e) => setActe(e.target.value)}
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                    Début travaux
                  </label>
                  <input
                    type="date"
                    value={travauxStart}
                    onChange={(e) => setTravauxStart(e.target.value)}
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                    Fin travaux
                  </label>
                  <input
                    type="date"
                    value={travauxEnd}
                    onChange={(e) => setTravauxEnd(e.target.value)}
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-stoniz-gray-700 mb-1">
                    Date livraison
                  </label>
                  <input
                    type="date"
                    value={livraison}
                    onChange={(e) => setLivraison(e.target.value)}
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>

            {error && (
              <div className="text-xs text-red-700 mt-3 bg-red-50 p-2 rounded">{error}</div>
            )}

            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setOpen(false)}
                disabled={pending}
                className="px-4 py-2 text-sm border border-stoniz-gray-300 rounded hover:bg-stoniz-gray-50"
              >
                Annuler
              </button>
              <button
                onClick={submit}
                disabled={pending}
                className="px-4 py-2 text-sm bg-stoniz-black text-white rounded hover:bg-stoniz-gray-800 disabled:opacity-40"
              >
                {pending ? '…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
