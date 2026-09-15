'use client';

import { useState, useTransition, useRef } from 'react';
import { FileCheck, Upload, Trash2, Download, ShieldCheck, Landmark, FileText, Shield } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  uploadArtisanDocumentAction, deleteArtisanDocumentAction, getArtisanDocumentSignedUrl,
} from '@/app/(team)/artisans/[id]/documents/actions';
import { formatDate } from '@/lib/utils/format';

type ArtisanDoc = {
  id: string;
  name: string;
  type: string;
  document_number: string | null;
  document_date: string | null;
  created_at: string;
};

const DOC_TYPES = [
  { value: 'attestation_regularite_fiscale', label: 'Attestation de régularité fiscale', icon: ShieldCheck },
  { value: 'attestation_rib',                label: 'Attestation de RIB',                 icon: Landmark },
  { value: 'attestation_cnss',               label: 'Attestation CNSS',                   icon: Shield },
  { value: 'attestation_assurance',          label: 'Attestation d\'assurance',           icon: Shield },
  { value: 'autre',                          label: 'Autre document',                     icon: FileText },
];

const LABELS = Object.fromEntries(DOC_TYPES.map(t => [t.value, t.label]));

export function ArtisanDocuments({
  artisanId, documents,
}: {
  artisanId: string;
  documents: ArtisanDoc[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set('artisan_id', artisanId);
    fd.set('type', open ?? 'autre');

    start(async () => {
      const r = await uploadArtisanDocumentAction(fd);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      formRef.current?.reset();
      setOpen(null);
    });
  }

  function remove(id: string) {
    if (!confirm('Supprimer ce document ?')) return;
    start(async () => { await deleteArtisanDocumentAction(id, artisanId); });
  }

  async function openDoc(id: string) {
    const r = await getArtisanDocumentSignedUrl(id);
    if (r.ok && (r as any).url) window.open((r as any).url, '_blank');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Documents administratifs</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {DOC_TYPES.map(t => {
            const docs = documents.filter(d => d.type === t.value);
            const Icon = t.icon;
            return (
              <div key={t.value} className="border-b pb-3 last:border-0">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 text-sm font-medium text-stoniz-gray-700">
                    <Icon className="w-4 h-4" />
                    {t.label} ({docs.length})
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setOpen(t.value)}>
                    <Upload className="w-3.5 h-3.5" /> Ajouter
                  </Button>
                </div>
                {docs.length === 0 ? (
                  <p className="text-xs text-stoniz-gray-500 ml-6">Aucun document uploadé</p>
                ) : (
                  <ul className="space-y-1 text-sm ml-6">
                    {docs.map(d => (
                      <li key={d.id} className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
                        <button onClick={() => openDoc(d.id)}
                          className="flex items-center gap-2 text-left hover:underline flex-1 min-w-0">
                          <Download className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate">
                            {d.document_number ? `${d.document_number} — ` : ''}{d.name}
                          </span>
                        </button>
                        <div className="flex items-center gap-3 text-xs text-stoniz-gray-500">
                          {d.document_date && <span>{formatDate(d.document_date)}</span>}
                          <button onClick={() => remove(d.id)} disabled={pending}
                            className="text-red-600 hover:bg-red-50 p-1 rounded">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {open && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
            onClick={() => setOpen(null)}>
            <form ref={formRef} onSubmit={submit}
              className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3"
              onClick={e => e.stopPropagation()}>
              <h2 className="font-display text-xl">Ajouter : {LABELS[open]}</h2>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>N° document</Label>
                  <Input name="document_number" placeholder="Ex : 2026/AT-1234" />
                </div>
                <div>
                  <Label>Date du document</Label>
                  <Input name="document_date" type="date"
                    defaultValue={new Date().toISOString().slice(0,10)} />
                </div>
              </div>

              <div>
                <Label>Fichier (PDF / image, max 25 MB) *</Label>
                <input type="file" name="file" required
                  accept=".pdf,.png,.jpg,.jpeg,.webp,.heic"
                  className="w-full text-sm py-2" />
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(null)} disabled={pending}>
                  Annuler
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? 'Upload…' : 'Envoyer'}
                </Button>
              </div>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
