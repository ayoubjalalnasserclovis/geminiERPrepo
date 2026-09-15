'use client';

import { useState, useTransition, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { uploadClientDocumentAction } from '@/app/(client)/client/documents/actions';

const DOC_TYPES = [
  { value: 'piece_identite', label: "Pièce d'identité (CNI / passeport)" },
  { value: 'cin', label: 'CIN (Maroc)' },
  { value: 'rib', label: 'RIB' },
  { value: 'procuration', label: 'Procuration signée' },
  { value: 'justificatif_financement', label: 'Justificatif de financement' },
  { value: 'autre', label: 'Autre' },
];

export function ClientDocumentUpload({ projects }: { projects: { id: string; reference: string }[] }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null); setSuccess(false);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const r = await uploadClientDocumentAction(fd);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setSuccess(true);
      formRef.current?.reset();
      setTimeout(() => setOpen(false), 1500);
    });
  }

  if (projects.length === 0) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ Envoyer un document</Button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form ref={formRef} onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-xl">Envoyer un document</h2>
            <p className="text-sm text-stoniz-gray-500">
              Votre document sera transmis à votre conseiller Stoniz et associé à votre projet.
            </p>

            {projects.length > 1 && (
              <div>
                <Label>Projet concerné</Label>
                <select name="project_id" required className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                  {projects.map(p => <option key={p.id} value={p.id}>{p.reference}</option>)}
                </select>
              </div>
            )}
            {projects.length === 1 && (
              <input type="hidden" name="project_id" value={projects[0].id} />
            )}

            <div>
              <Label>Type de document</Label>
              <select name="type" required className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>

            <div>
              <Label>Fichier (PDF, image, max 25 MB)</Label>
              <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.docx"
                required className="w-full text-sm" />
            </div>

            {error && <div className="text-sm text-red-600">{error}</div>}
            {success && <div className="text-sm text-green-700">✓ Document envoyé avec succès</div>}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Fermer</Button>
              <Button type="submit" disabled={pending}>{pending ? 'Envoi…' : 'Envoyer'}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
