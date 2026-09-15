import Link from 'next/link';
import { CheckCircle2, AlertCircle, Upload } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/format';
import { InlineDocUpload } from '@/components/documents/inline-doc-upload';
import { DeleteProjectDocButton } from '@/components/documents/delete-project-doc-button';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

/**
 * Liste des documents requis attendus du client à différentes phases.
 * - `phase` : à partir de quelle phase le doc devient attendu
 * - `uploadedBy` : 'client' ou 'stoniz'
 * - `mandatory` : bloque l'avancement / juste indicatif
 */
export type RequiredDoc = {
  type: string;
  label: string;
  uploadedBy: 'client' | 'stoniz';
  mandatory: boolean;
  description?: string;
};

export const REQUIRED_DOCS: RequiredDoc[] = [
  // Du client (onboarding)
  { type: 'piece_identite', label: "Pièce d'identité (CNI / passeport)", uploadedBy: 'client', mandatory: true },
  { type: 'cin', label: 'CIN (si client marocain)', uploadedBy: 'client', mandatory: false },
  { type: 'rib', label: 'RIB', uploadedBy: 'client', mandatory: true },
  { type: 'procuration', label: 'Procuration signée', uploadedBy: 'client', mandatory: false,
    description: 'Si signature à distance' },
  { type: 'justificatif_financement', label: 'Justificatif de financement', uploadedBy: 'client', mandatory: false,
    description: 'Si crédit' },

  // De Stoniz — phase onboarding
  { type: 'contrat_mission', label: 'Contrat de mission Stoniz', uploadedBy: 'stoniz', mandatory: true },

  // Phase sourcing/design — requis pour passer en Travaux
  { type: 'compromis', label: 'Compromis de vente', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour passer en Travaux' },
  { type: 'plans_3d', label: 'Plans 3D', uploadedBy: 'stoniz', mandatory: true,
    description: 'Dossier architecture — requis pour Travaux' },
  { type: 'lots_techniques', label: 'Lots techniques', uploadedBy: 'stoniz', mandatory: true,
    description: 'Dossier architecture — requis pour Travaux' },
  { type: 'shopping_list', label: 'Shopping list', uploadedBy: 'stoniz', mandatory: true,
    description: 'Dossier architecture — requis pour Travaux' },
  { type: 'plan_bet', label: "Plan bureau d'études (BET)", uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Travaux · doit être validé par le client' },
  { type: 'devis_travaux', label: 'Devis travaux (consolidé tous lots)', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Travaux · doit être validé par le client' },

  // Phase livraison — requis pour passer en Mise en location
  { type: 'titre_foncier', label: 'Titre foncier', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Mise en location' },
  { type: 'autorisation_travaux', label: 'Autorisation de travaux', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Mise en location' },
  { type: 'contrat_eau', label: 'Contrat eau', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Mise en location' },
  { type: 'contrat_electricite', label: 'Contrat électricité', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Mise en location' },
  { type: 'contrat_assurance', label: "Contrat d'assurance", uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Mise en location' },
  { type: 'contrat_internet', label: 'Contrat internet / fibre', uploadedBy: 'stoniz', mandatory: true,
    description: 'Requis pour Mise en location' },
];

type ExistingDoc = { id: string; type: string; created_at: string; status: string };

export function RequiredDocsChecklist({
  docs,
  showStoniz = true,
  showClient = true,
  uploadHint,
  projectId,
}: {
  docs: ExistingDoc[];
  showStoniz?: boolean;
  showClient?: boolean;
  uploadHint?: { href: string; label: string };
  projectId?: string;
}) {
  // Index existant par type
  const byType: Record<string, ExistingDoc | undefined> = {};
  docs.forEach(d => {
    // garder le plus récent par type
    if (!byType[d.type] || new Date(d.created_at) > new Date(byType[d.type]!.created_at)) {
      byType[d.type] = d;
    }
  });

  const visibleDocs = REQUIRED_DOCS.filter(d =>
    (showClient && d.uploadedBy === 'client') || (showStoniz && d.uploadedBy === 'stoniz')
  );

  const missingMandatory = visibleDocs.filter(d => d.mandatory && !byType[d.type]).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Documents requis</CardTitle>
          {missingMandatory > 0
            ? <Badge variant="warning">{missingMandatory} manquant{missingMandatory > 1 ? 's' : ''}</Badge>
            : <Badge variant="success">Complet</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        <ul className="space-y-2">
          {visibleDocs.map(req => {
            const existing = byType[req.type];
            return (
              <li key={req.type} className="flex items-start justify-between gap-3 py-2 border-b last:border-0">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {existing
                    ? <CheckCircle2 className="w-4 h-4 text-green-700 flex-shrink-0 mt-0.5" />
                    : req.mandatory
                      ? <AlertCircle className="w-4 h-4 text-orange-600 flex-shrink-0 mt-0.5" />
                      : <AlertCircle className="w-4 h-4 text-stoniz-gray-300 flex-shrink-0 mt-0.5" />}
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {req.label}
                      {!req.mandatory && <span className="text-xs text-stoniz-gray-500 ml-2">(optionnel)</span>}
                    </div>
                    {req.description && (
                      <div className="text-xs text-stoniz-gray-500">{req.description}</div>
                    )}
                    {existing && (
                      <div className="text-xs text-stoniz-gray-500 mt-0.5">
                        Reçu le {formatDate(existing.created_at)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!existing && projectId && (
                    <InlineDocUpload
                      projectId={projectId}
                      type={req.type}
                      label={req.label}
                      defaultRequiresValidation={['plans_3d','lots_techniques','shopping_list','plan_bet','devis_travaux'].includes(req.type)}
                    />
                  )}
                  {/* CEO 2026-06-30 : suppression + historique sur les docs déjà reçus.
                      Permet de corriger un mauvais upload (slot redevient libre). */}
                  {existing && (
                    <>
                      <FinanceAuditButton table="documents" recordId={existing.id} size="sm" />
                      <DeleteProjectDocButton docId={existing.id} label={req.label} size="sm" />
                    </>
                  )}
                  <Badge variant={
                    existing ? 'success' : req.mandatory ? 'warning' : 'default'
                  }>
                    {existing
                      ? (existing.status === 'valide' ? 'Validé' : 'Reçu')
                      : req.mandatory ? 'Manquant' : 'Optionnel'}
                  </Badge>
                </div>
              </li>
            );
          })}
        </ul>
        {uploadHint && (
          <div className="mt-4 pt-4 border-t">
            <Link href={uploadHint.href} className="inline-flex items-center gap-2 text-sm text-stoniz-black hover:underline">
              <Upload className="w-4 h-4" />
              {uploadHint.label}
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
