'use client';

import { useState, useTransition } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { initializePropriaUnitsAction } from '@/app/(team)/projects/[id]/suites/actions';

type Unit = {
  id: string;
  order_index: number;
  code: string;
  propria_apartment_door?: string | null;
  is_active: boolean;
};

type Props = {
  projectId: string;
  nbSuitesPrevues: number;
  units: Unit[];
  userRole: string;
  clientFullName: string;  // pour pré-fill last name MAJ
};

/** Extrait le dernier mot d'un nom complet et le met en MAJUSCULES.
 *  Ex: "Karim Zaidi" → "ZAIDI", "Mehdy Ghaouti" → "GHAOUTI" */
function defaultLibelle(fullName: string): string {
  const trimmed = (fullName ?? '').trim();
  if (!trimmed) return '';
  const parts = trimmed.split(/\s+/);
  return parts[parts.length - 1].toUpperCase();
}

export function ProjectSuitesCard({ projectId, nbSuitesPrevues, units, userRole, clientFullName }: Props) {
  const [open, setOpen] = useState(false);
  const [libelle, setLibelle] = useState(() => defaultLibelle(clientFullName));
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const canEdit = userRole === 'ceo' || userRole === 'chef_projet';
  const nbRealised = units.filter(u => u.is_active).length;
  const ecartPrevu = nbSuitesPrevues - nbRealised;
  const needsInit = nbRealised === 0 && nbSuitesPrevues > 0;
  const nbToCreate = Math.max(0, nbSuitesPrevues - nbRealised);

  function openModal() {
    setError(null);
    setLibelle(defaultLibelle(clientFullName));
    setOpen(true);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!libelle.trim()) { setError('Libellé requis'); return; }

    start(async () => {
      const r = await initializePropriaUnitsAction({
        project_id: projectId,
        libelle: libelle.trim(),
      }).catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' } as const));
      if (!r.ok) { setError(r.error); return; }
      setOpen(false);
    });
  }

  // Aperçu en temps réel des codes qui seront créés
  const previewCodes = (() => {
    const norm = libelle.trim().toUpperCase();
    if (!norm) return [];
    const startIdx = nbRealised + 1;
    return Array.from({ length: nbToCreate }, (_, i) => `${norm} ${startIdx + i}`);
  })();

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Suites du bien</CardTitle>
        </CardHeader>
        <CardContent>
          {nbSuitesPrevues === 0 ? (
            <p className="text-sm text-stoniz-gray-500">
              Aucune suite renseignée sur le bien. Complète <code className="bg-stoniz-gray-100 px-1 rounded">nb_suites</code> sur la fiche bien.
            </p>
          ) : needsInit ? (
            <div className="space-y-3">
              <p className="text-sm">
                <strong>{nbSuitesPrevues} suite{nbSuitesPrevues > 1 ? 's' : ''} prévue{nbSuitesPrevues > 1 ? 's' : ''}</strong> au sourcing.
                Aucune n'est encore matérialisée pour ce projet.
              </p>
              {canEdit && (
                <Button onClick={openModal} disabled={pending}>
                  Initialiser les {nbSuitesPrevues} suites
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-lg">
                  {nbRealised} suite{nbRealised > 1 ? 's' : ''}
                </span>
                {ecartPrevu !== 0 && (
                  <Badge variant="warning">
                    {nbSuitesPrevues} prévue{nbSuitesPrevues > 1 ? 's' : ''} au sourcing
                    {ecartPrevu > 0 ? ` (${ecartPrevu} à créer)` : ` (${Math.abs(ecartPrevu)} en trop)`}
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {units.filter(u => u.is_active).sort((a, b) => a.order_index - b.order_index).map(u => (
                  <div key={u.id} className="border rounded-md px-3 py-2 text-sm hover:bg-stoniz-gray-50">
                    <div className="font-medium">{u.code}</div>
                    <div className="text-xs text-stoniz-gray-500">
                      {u.propria_apartment_door ? `Porte ${u.propria_apartment_door}` : `Ordre ${u.order_index}`}
                    </div>
                  </div>
                ))}
              </div>

              {ecartPrevu > 0 && canEdit && (
                <Button size="sm" variant="secondary" onClick={openModal} disabled={pending}>
                  + Créer les {ecartPrevu} suite{ecartPrevu > 1 ? 's' : ''} manquante{ecartPrevu > 1 ? 's' : ''}
                </Button>
              )}

              <p className="text-xs text-stoniz-gray-500">
                💡 Pour modifier le nombre de suites, change <code>nb_suites</code> sur la fiche bien puis reviens ici.
                La suppression d'une suite avec achats rattachés nécessitera un re-routing (à venir).
              </p>
            </div>
          )}

          {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
        </CardContent>
      </Card>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form
            onSubmit={submit}
            onClick={e => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-4"
          >
            <h2 className="font-display text-xl">Initialiser les suites</h2>
            <p className="text-sm text-stoniz-gray-600">
              {nbToCreate} suite{nbToCreate > 1 ? 's' : ''} va être créée{nbToCreate > 1 ? 's' : ''} pour ce projet.
              Choisis le libellé business utilisé dans Propria et les rapports.
            </p>

            <div>
              <Label>Libellé</Label>
              <Input
                value={libelle}
                onChange={e => setLibelle(e.target.value.toUpperCase())}
                placeholder="Ex: ZAIDI, WARDA, MEHDY"
                autoFocus
                required
                maxLength={30}
              />
              <p className="text-xs text-stoniz-gray-500 mt-1">
                Pré-rempli avec le nom de famille du client. Modifie si besoin.
              </p>
            </div>

            {previewCodes.length > 0 && (
              <div className="bg-stoniz-gray-50 rounded p-3 text-sm">
                <div className="text-xs text-stoniz-gray-500 mb-1">Aperçu des codes créés :</div>
                <div className="font-mono text-sm flex flex-wrap gap-2">
                  {previewCodes.map(c => (
                    <span key={c} className="bg-white border rounded px-2 py-0.5">{c}</span>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="text-sm text-red-600">{error}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending || !libelle.trim()}>
                {pending ? 'Création…' : `Créer ${nbToCreate} suite${nbToCreate > 1 ? 's' : ''}`}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
