'use client';

import { useState, useTransition, useRef } from 'react';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  uploadDocumentAction,
  createDocumentUploadUrlAction,
  recordDocumentAction,
} from '@/app/(team)/projects/[id]/documents/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

// CEO 2026-06-23 : aligné sur DocumentUpload. Au-delà de 4 MB, on bascule sur
// upload direct (presigned URL) pour passer la limite Vercel Server Actions
// (next.config.js : bodySizeLimit: '4mb'). Sans ça, un PDF de 5+ MB renvoyait
// "Erreur serveur (réponse vide)" car Vercel/Next rejetait la requête AVANT
// l'entrée dans la server action (useTransition reçoit undefined).
const INLINE_THRESHOLD = 4 * 1024 * 1024;
const MAX_TOTAL_SIZE = 200 * 1024 * 1024;

export function InlineDocUpload({
  projectId, type, label,
  defaultVisible = true,
  defaultRequiresValidation = false,
}: {
  projectId: string;
  type: string;
  label: string;
  defaultVisible?: boolean;
  defaultRequiresValidation?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const file = fd.get('file') as File | null;
    const isVisible = fd.get('is_visible_to_client') === 'on';
    const requiresValid = fd.get('requires_client_validation') === 'on';

    if (!file || !file.size) { setError('Fichier manquant'); return; }
    if (file.size > MAX_TOTAL_SIZE) {
      setError(`Fichier trop volumineux (max ${Math.round(MAX_TOTAL_SIZE / 1024 / 1024)} MB).`);
      return;
    }

    fd.set('project_id', projectId);
    fd.set('type', type);

    start(async () => {
      try {
        // Petit fichier (≤ 4 MB) → server action classique.
        if (file.size <= INLINE_THRESHOLD) {
          const r = await uploadDocumentAction(fd);
          // Garde-fou : si la server action throw côté serveur, r peut être undefined.
          if (!r || !r.ok) {
            setError((r && 'error' in r ? r.error : null) ?? 'Erreur serveur (réponse vide)');
            return;
          }
        } else {
          // Gros fichier (> 4 MB) → upload DIRECT vers Supabase Storage via
          // presigned URL. Évite la limite Vercel Server Actions (4 MB body).
          const urlRes = await createDocumentUploadUrlAction({
            project_id: projectId,
            type,
            filename: file.name,
            content_type: file.type,
            size_bytes: file.size,
          });
          if (!urlRes || !urlRes.ok) {
            setError((urlRes && 'error' in urlRes ? urlRes.error : null) ?? 'Erreur URL (réponse vide)');
            return;
          }
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
          });
          if (!recordRes || !recordRes.ok) {
            setError((recordRes && 'error' in recordRes ? recordRes.error : null) ?? 'Enregistrement échec (réponse vide)');
            return;
          }
        }
        formRef.current?.reset();
        setOpen(false);
      } catch (e: any) {
        console.error('[InlineDocUpload] exception non gérée', e);
        setError(e?.message ?? 'Erreur inattendue. Réessayez.');
      }
    });
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}
        className="text-xs h-7">
        <Upload className="w-3.5 h-3.5" /> Ajouter
      </Button>

      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}>
          <form ref={formRef} onSubmit={submit}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3"
            onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-xl">Ajouter : {label}</h2>

            <div>
              <Label>Fichier (PDF, image, max 200 MB) *</Label>
              <input type="file" name="file" required
                accept=".pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx"
                className="w-full text-sm py-2" />
            </div>

            <div className="space-y-2 pt-2 border-t">
              <div className="flex items-center gap-2">
                <input type="checkbox" name="is_visible_to_client" id={`vis-${type}`}
                  defaultChecked={defaultVisible} />
                <Label htmlFor={`vis-${type}`} className="mb-0">Visible par le client</Label>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" name="requires_client_validation" id={`valid-${type}`}
                  defaultChecked={defaultRequiresValidation} />
                <Label htmlFor={`valid-${type}`} className="mb-0">Demander validation au client</Label>
              </div>
            </div>

            <SessionExpiredBanner error={error} />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
                Annuler
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Upload…' : 'Envoyer'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
