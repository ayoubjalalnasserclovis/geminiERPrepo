import { getSessionUser } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Card } from '@/components/ui/card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DocumentDownloadLink } from '@/components/documents/document-download-link';
import { ClientDocumentUpload } from '@/components/documents/client-document-upload';
import { formatDate } from '@/lib/utils/format';

/**
 * Mapping type de document → phase logique du projet.
 * Sert à grouper les documents par étape sur l'espace client.
 */
const TYPE_TO_PHASE: Record<string, PhaseKey> = {
  // ─── Sourcing : recherche + sécurisation du bien
  cahier_des_charges:       'sourcing',
  titre_foncier:            'sourcing',
  compromis:                'sourcing',

  // ─── Design : conception architecturale + devis chantier
  dossier_architecture:     'design',
  plans_3d:                 'design',
  plan_bet:                 'design',
  lots_techniques:          'design',
  shopping_list:            'design',
  devis_travaux:            'design',

  // ─── Travaux : chantier
  permis_travaux:           'travaux',
  autorisation_travaux:     'travaux',
  photos_chantier:          'travaux',

  // ─── Livraison : remise du bien
  pv_livraison:             'livraison',

  // ─── Mise en location : exploitation
  contrat_gestion_propria:  'mise_en_location',
  contrat_eau:              'mise_en_location',
  contrat_electricite:      'mise_en_location',
  contrat_assurance:        'mise_en_location',
  contrat_internet:         'mise_en_location',

  // ─── Administratif transverse : pas de phase
  contrat_mission:          'admin',
  piece_identite:           'admin',
  cin:                      'admin',
  rib:                      'admin',
  procuration:              'admin',
  justificatif_financement: 'admin',
  // CEO 2026-08-19 (session C) : le type libre « autre » a désormais sa propre
  // rubrique « Documents divers » (avant il se noyait dans Administratif).
  autre:                    'divers',
};

type PhaseKey = 'sourcing' | 'design' | 'travaux' | 'livraison' | 'mise_en_location' | 'divers' | 'admin';

const PHASE_META: Record<PhaseKey, { label: string; emoji: string; description: string; order: number }> = {
  sourcing:         { order: 1, label: 'Sourcing',          emoji: '🔍', description: 'Recherche et sécurisation de votre bien' },
  design:           { order: 2, label: 'Design',            emoji: '✨', description: 'Conception architecturale et plans' },
  travaux:          { order: 3, label: 'Travaux',           emoji: '🛠️', description: 'Chantier et suivi des artisans' },
  livraison:        { order: 4, label: 'Livraison',         emoji: '📦', description: 'Remise officielle de votre bien' },
  mise_en_location: { order: 5, label: 'Mise en location',  emoji: '🏡', description: 'Exploitation locative et contrats' },
  divers:           { order: 8, label: 'Documents divers',  emoji: '📁', description: 'Documents complémentaires partagés par votre équipe' },
  admin:            { order: 9, label: 'Administratif',     emoji: '📂', description: 'Documents personnels et contrats Stoniz' },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  contrat_mission: 'Contrat de mission Stoniz',
  compromis: 'Compromis de vente',
  plans_3d: 'Plans 3D',
  plan_bet: 'Plan bureau d\'études',
  lots_techniques: 'Lots techniques',
  shopping_list: 'Shopping list',
  devis_travaux: 'Devis travaux',
  permis_travaux: 'Permis de travaux',
  autorisation_travaux: 'Autorisation de travaux',
  titre_foncier: 'Titre foncier',
  contrat_eau: 'Contrat eau',
  contrat_electricite: 'Contrat électricité',
  contrat_assurance: 'Contrat assurance',
  contrat_internet: 'Contrat internet',
  photos_chantier: 'Photos chantier',
  pv_livraison: 'PV de livraison',
  cahier_des_charges: 'Cahier des charges',
  piece_identite: "Pièce d'identité",
  cin: 'CIN',
  rib: 'RIB',
  procuration: 'Procuration',
  justificatif_financement: 'Justificatif de financement',
  contrat_gestion_propria: 'Contrat de gestion PROPRIA',
  dossier_architecture: 'Dossier architecture',
  autre: 'Autre',
  guide_phase: 'Guide de phase Stoniz',
};

export default async function ClientDocumentsPage() {
  const user = await getSessionUser();
  if (!user) return null;
  const supabase = createClient();

  // Récupérer les projets du client pour le sélecteur d'upload
  const { data: projectsRaw } = await supabase
    .from('projects')
    .select('id, property:properties(name)')
    .is('deleted_at', null);
  const projects = (projectsRaw ?? []).map((p: any, idx) => ({
    id: p.id,
    reference: p.property?.name ?? `Projet ${idx + 1}`,
  }));

  // Documents visibles + acquittements de guides de phase
  const [documentsRes, ackRes] = await Promise.all([
    supabase.from('documents')
      .select('*')
      .eq('is_visible_to_client', true)
      .is('deleted_at', null)
      .order('created_at', { ascending: false }),
    supabase.from('phase_acknowledgments')
      .select('project_id, phase, acknowledged_at')
      .order('acknowledged_at', { ascending: false }),
  ]);

  const realDocs = documentsRes.data ?? [];

  // Convertit chaque guide de phase acquitté en entrée "document virtuel"
  // pour qu'il apparaisse dans la phase correspondante avec lien direct vers le PDF.
  const GUIDE_LABELS: Record<string, string> = {
    sourcing: 'Guide Stoniz — Phase Sourcing',
    design: 'Guide Stoniz — Phase Design',
    travaux: 'Guide Stoniz — Phase Travaux',
    mise_en_location: 'Guide Stoniz — Phase Mise en location',
  };
  const guideDocs = (ackRes.data ?? []).map((a: any) => ({
    id: `guide-${a.project_id}-${a.phase}`,
    name: GUIDE_LABELS[a.phase] ?? `Guide phase ${a.phase}`,
    type: 'guide_phase',
    uploaded_by_role: 'stoniz',
    created_at: a.acknowledged_at,
    requires_client_validation: false,
    client_validation_status: null,
    status: 'recu',
    // Marqueur + URL publique : pas de signedUrl à générer, lien direct vers /guides/
    is_guide: true,
    public_url: `/guides/stoniz-guide-${a.phase === 'mise_en_location' ? 'mise-en-location' : a.phase}.pdf`,
    phase_key: a.phase as PhaseKey,
  }));

  const all = [...realDocs, ...guideDocs];

  // CEO 2026-08-19 (session C) : documents « nouveaux » = déposés par Stoniz,
  // visibles, jamais ouverts par le client (client_first_viewed_at NULL).
  const newDocsCount = realDocs.filter(
    (d: any) => d.uploaded_by_role === 'stoniz' && !d.client_first_viewed_at,
  ).length;

  // Groupement par phase logique (déduite du type, ou phase_key pour les guides)
  const byPhase = new Map<PhaseKey, any[]>();
  for (const d of all) {
    const phase: PhaseKey = d.is_guide ? d.phase_key : (TYPE_TO_PHASE[d.type] ?? 'admin');
    if (!byPhase.has(phase)) byPhase.set(phase, []);
    byPhase.get(phase)!.push(d);
  }
  // Tri par date dans chaque phase (plus récent en haut)
  for (const docs of byPhase.values()) {
    docs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  }

  // Ordre d'affichage des phases (selon PHASE_META.order)
  const orderedPhases = (Object.entries(PHASE_META) as [PhaseKey, typeof PHASE_META[PhaseKey]][])
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([key]) => key);

  return (
    <div>
      <div className="flex items-end justify-between mb-2 flex-wrap gap-4">
        <div>
          <h1 className="font-display text-3xl">Mes documents</h1>
          <p className="text-stoniz-gray-500">
            Tous les documents de votre projet, classés par phase.
          </p>
        </div>
        <ClientDocumentUpload projects={projects ?? []} />
      </div>

      {newDocsCount > 0 && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-900">
          🔵 {newDocsCount} document{newDocsCount > 1 ? 's' : ''} que vous n'avez pas encore consulté{newDocsCount > 1 ? 's' : ''} — repérez le badge « Nouveau » ci-dessous.
        </div>
      )}

      <div className="mt-8 space-y-6">
        {all.length === 0 ? (
          <EmptyState
            title="Aucun document pour le moment"
            description={projects && projects.length > 0
              ? "Vous pouvez envoyer vos documents (pièce d'identité, RIB, etc.) via le bouton ci-dessus."
              : "Votre projet n'est pas encore actif."}
          />
        ) : (
          orderedPhases.map((phase) => {
            const docs = byPhase.get(phase);
            if (!docs || docs.length === 0) return null;
            const meta = PHASE_META[phase];
            return (
              <PhaseSection
                key={phase}
                title={`${meta.emoji} ${meta.label}`}
                description={meta.description}
                count={docs.length}
                docs={docs}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

function PhaseSection({
  title,
  description,
  count,
  docs,
}: {
  title: string;
  description: string;
  count: number;
  docs: any[];
}) {
  return (
    <Card>
      <div className="mb-3 flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-display text-xl">
            {title} <span className="text-grey-text font-normal text-base">({count})</span>
          </h2>
          <p className="text-sm text-stoniz-gray-600 mt-1">{description}</p>
        </div>
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Nom</TH>
            <TH>Type</TH>
            <TH>Source</TH>
            <TH>Date</TH>
            <TH>Statut</TH>
            <TH></TH>
          </TR>
        </THead>
        <TBody>
          {docs.map((d: any) => (
            <TR key={d.id}>
              <TD className="font-medium">
                <div className="flex items-center gap-2 flex-wrap">
                  <span>{d.label ?? d.name}</span>
                  {/* CEO 2026-08-19 (session C) : badge « Nouveau » tant que le
                      client n'a pas ouvert le document */}
                  {!d.is_guide && d.uploaded_by_role === 'stoniz' && !d.client_first_viewed_at && (
                    <Badge variant="info">Nouveau</Badge>
                  )}
                </div>
                {Array.isArray(d.tags) && d.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {d.tags.map((t: string) => (
                      <span key={t} className="text-[10px] bg-stoniz-gray-100 border border-stoniz-gray-200 rounded-full px-1.5 py-0.5 text-stoniz-gray-600 font-normal">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </TD>
              <TD>{DOC_TYPE_LABELS[d.type] ?? d.type}</TD>
              <TD>
                <Badge variant={d.uploaded_by_role === 'client' ? 'info' : 'default'}>
                  {d.uploaded_by_role === 'client' ? 'Moi' : 'Stoniz'}
                </Badge>
              </TD>
              <TD className="text-sm text-stoniz-gray-500">{formatDate(d.created_at)}</TD>
              <TD>
                {d.client_validation_status === 'validated' && (
                  <Badge variant="success">
                    ✓ Validé{d.client_validation_at && ` le ${formatDate(d.client_validation_at)}`}
                  </Badge>
                )}
                {d.client_validation_status === 'refused' && <Badge variant="error">Refusé</Badge>}
                {d.client_validation_status === 'more_info' && <Badge variant="warning">Infos demandées</Badge>}
                {d.requires_client_validation &&
                  (!d.client_validation_status || d.client_validation_status === 'pending') && (
                    <Badge variant="warning">À valider</Badge>
                  )}
                {!d.requires_client_validation &&
                  !['validated', 'refused', 'more_info'].includes(d.client_validation_status) && (
                    <Badge>{d.status === 'valide' ? 'Reçu' : d.status}</Badge>
                  )}
              </TD>
              <TD>
                {d.is_guide ? (
                  <a
                    href={d.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-stoniz-black underline underline-offset-4 hover:text-stoniz-black/70"
                  >
                    📥 Télécharger
                  </a>
                ) : (
                  <DocumentDownloadLink documentId={d.id} />
                )}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}
