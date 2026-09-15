'use client';

import { useState, useTransition, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import {
  uploadDocumentAction,
  createDocumentUploadUrlAction,
  recordDocumentAction,
} from '@/app/(team)/projects/[id]/documents/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

// CEO 2026-06-18 : au-delà de 4 MB on bascule sur upload direct
// (presigned URL) pour passer la limite Vercel (~4.5MB sur Hobby).
const INLINE_THRESHOLD = 4 * 1024 * 1024;

const DOC_TYPES: { value: string; label: string; suggestsValidation?: boolean }[] = [
  { value: 'contrat_mission',         label: 'Contrat de mission' },
  { value: 'compromis',               label: 'Compromis de vente' },
  { value: 'plans_3d',                label: 'Plans 3D (dossier archi)',           suggestsValidation: true },
  { value: 'lots_techniques',         label: 'Lots techniques (dossier archi)',    suggestsValidation: true },
  { value: 'shopping_list',           label: 'Shopping list (dossier archi)',      suggestsValidation: true },
  { value: 'plan_bet',                label: "Plan bureau d'études (BET)",         suggestsValidation: true },
  { value: 'devis_travaux',           label: 'Devis travaux (consolidé tous lots)', suggestsValidation: true },
  { value: 'permis_travaux',          label: 'Permis de travaux' },
  { value: 'autorisation_travaux',    label: 'Autorisation de travaux' },
  { value: 'titre_foncier',           label: 'Titre foncier' },
  { value: 'contrat_eau',             label: 'Contrat eau' },
  { value: 'contrat_electricite',     label: 'Contrat électricité' },
  { value: 'contrat_assurance',       label: 'Contrat d\'assurance' },
  { value: 'contrat_internet',        label: 'Contrat internet' },
  { value: 'photos_chantier',         label: 'Photos chantier' },
  { value: 'pv_livraison',            label: 'PV de livraison' },
  { value: 'contrat_gestion_propria', label: 'Contrat de gestion PROPRIA' },
  { value: 'dossier_architecture',    label: 'Dossier architecture (autre)' },
  { value: 'piece_identite',          label: "Pièce d'identité" },
  { value: 'cin',                     label: 'CIN' },
  { value: 'rib',                     label: 'RIB' },
  { value: 'procuration',             label: 'Procuration' },
  { value: 'justificatif_financement', label: 'Justificatif de financement' },
  { value: 'autre',                   label: 'Autre' },
];

export function DocumentUpload({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState('contrat_mission');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const typeDef = DOC_TYPES.find(t => t.value === selectedType);
  const defaultValidation = typeDef?.suggestsValidation ?? false;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get('file') as File | null;
    const type = fd.get('type') as string;
    const isVisible = fd.get('is_visible_to_client') === 'on';
    const requiresValid = fd.get('requires_client_validation') === 'on';
    // CEO 2026-08-19 (session C) : libellé personnalisé + tags libres
    const label = ((fd.get('label') as string) ?? '').trim();
    const tagsRaw = ((fd.get('tags') as string) ?? '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    if (!file || !file.size) { setError('Fichier manquant'); return; }

    start(async () => {
      try {
        // Petit fichier → server action classique (rapide, simple)
        if (file.size <= INLINE_THRESHOLD) {
          fd.append('project_id', projectId);
          const r = await uploadDocumentAction(fd);
          // Garde-fou : si la server action throw sans enveloppe, r peut être
          // undefined côté client (Next 14 useTransition).
          if (!r || !r.ok) { setError((r && 'error' in r ? r.error : null) ?? 'Erreur serveur (réponse vide)'); return; }
        } else {
          // Gros fichier (> 4MB) → upload direct vers Supabase (presigned URL)
          // CEO 2026-06-18 : passe la limite Vercel (~4.5MB sur Hobby plan).
          const urlRes = await createDocumentUploadUrlAction({
            project_id: projectId,
            type,
            filename: file.name,
            content_type: file.type,
            size_bytes: file.size,
          });
          if (!urlRes || !urlRes.ok) { setError((urlRes && 'error' in urlRes ? urlRes.error : null) ?? 'Erreur URL (réponse vide)'); return; }
          try {
            await uploadToSignedUrl(urlRes.path, urlRes.token, file, 'documents');
          } catch (e: any) {
            setError(`Upload échec : ${e?.message ?? 'inconnue'}`);
            return;
          }
          const recordRes = await recordDocumentAction({
            project_id: projectId,
            type,
            name: file.name,
            storage_path: urlRes.path,
            mime_type: file.type,
            size_bytes: file.size,
            is_visible_to_client: isVisible,
            requires_client_validation: requiresValid,
            label: label || null,
            tags: tags.length > 0 ? tags : null,
          });
          if (!recordRes || !recordRes.ok) { setError((recordRes && 'error' in recordRes ? recordRes.error : null) ?? 'Enregistrement échec (réponse vide)'); return; }
        }
        formRef.current?.reset();
        setOpen(false);
      } catch (e: any) {
        // Capture finale — empêche toute exception non gérée de remonter à l'error boundary Next.
        console.error('[DocumentUpload] exception non gérée', e);
        setError(e?.message ?? 'Erreur inattendue. Réessayez.');
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Ajouter un document</Button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form ref={formRef} onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-xl">Ajouter un document</h2>

            <div>
              <Label>Type</Label>
              <select name="type" value={selectedType} onChange={e => setSelectedType(e.target.value)}
                required className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <Label>Fichier (max 1 Go — PDF, images, Word, Excel, vidéos)</Label>
              <input type="file" name="file" required className="w-full text-sm" />
            </div>

            {/* CEO 2026-08-19 (session C) : libellé personnalisé + tags —
                surtout utiles pour la rubrique « Documents divers » (type Autre),
                mais disponibles pour tous les types. */}
            <div>
              <Label>Libellé affiché (optionnel)</Label>
              <input type="text" name="label" placeholder='Ex : "Plan cuisine V2" — sinon le nom du fichier'
                className="w-full h-10 rounded-md border bg-white px-3 text-sm" />
            </div>
            <div>
              <Label>Tags (optionnel, séparés par des virgules)</Label>
              <input type="text" name="tags" placeholder="Ex : cuisine, plan, v2"
                className="w-full h-10 rounded-md border bg-white px-3 text-sm" />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center gap-2">
                <input type="checkbox" name="is_visible_to_client" defaultChecked id="vis" />
                <Label htmlFor="vis" className="mb-0">Visible par le client</Label>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" name="requires_client_validation" id="valid"
                  defaultChecked={defaultValidation} key={selectedType /* force re-render */} />
                <Label htmlFor="valid" className="mb-0">Demander validation au client</Label>
              </div>
              {typeDef?.suggestsValidation && (
                <p className="text-xs text-stoniz-gray-500 ml-6">
                  💡 Pour ce type de document, une validation client est recommandée.
                </p>
              )}
            </div>

            <SessionExpiredBanner error={error} />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={pending}>{pending ? 'Upload…' : 'Envoyer'}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
