'use client';

import { useState, useTransition, useRef } from 'react';
import { FileText, FileCheck, Upload, Trash2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import {
  uploadLotDocumentAction, deleteLotDocumentAction, getLotDocumentSignedUrl,
} from '@/app/(team)/projects/[id]/travaux/lot-documents/actions';
import { formatDate } from '@/lib/utils/format';

type LotDoc = {
  id: string;
  name: string;
  type: 'devis_artisan' | 'facture_artisan';
  document_number: string | null;
  document_date: string | null;
  created_at: string;
};

export function LotDocuments({
  projectId, lotId, artisanId, documents,
}: {
  projectId: string;
  lotId: string;
  artisanId: string | null;
  documents: LotDoc[];
}) {
  const [open, setOpen] = useState<null | 'devis_artisan' | 'facture_artisan'>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const devis = documents.filter(d => d.type === 'devis_artisan');
  const factures = documents.filter(d => d.type === 'facture_artisan');

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set('project_id', projectId);
    fd.set('lot_id', lotId);
    fd.set('type', open ?? 'devis_artisan');
    if (artisanId) fd.set('artisan_id', artisanId);

    start(async () => {
      const r = await uploadLotDocumentAction(fd);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      formRef.current?.reset();
      setOpen(null);
    });
  }

  function remove(id: string) {
    if (!confirm('Supprimer ce document ?')) return;
    start(async () => { await deleteLotDocumentAction(id, projectId); });
  }

  async function openDoc(id: string) {
    const r = await getLotDocumentSignedUrl(id);
    if (r.ok && (r as any).url) window.open((r as any).url, '_blank');
  }

  return (
    <div className="border-t pt-3 mt-3 space-y-3">
      {/* Devis */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-stoniz-gray-700">
            <FileText className="w-4 h-4" />
            Devis artisan ({devis.length})
          </div>
          <Button size="sm" variant="ghost" onClick={() => setOpen('devis_artisan')}>
            <Upload className="w-3.5 h-3.5" /> Ajouter
          </Button>
        </div>
        {devis.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500 ml-6">Aucun devis</p>
        ) : (
          <ul className="space-y-1 text-sm ml-6">
            {devis.map(d => (
              <DocRow key={d.id} doc={d} onOpen={openDoc} onDelete={remove} pending={pending} />
            ))}
          </ul>
        )}
      </div>

      {/* Factures */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium text-stoniz-gray-700">
            <FileCheck className="w-4 h-4" />
            Factures artisan ({factures.length})
          </div>
          <Button size="sm" variant="ghost" onClick={() => setOpen('facture_artisan')}>
            <Upload className="w-3.5 h-3.5" /> Ajouter
          </Button>
        </div>
        {factures.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500 ml-6">Aucune facture</p>
        ) : (
          <ul className="space-y-1 text-sm ml-6">
            {factures.map(d => (
              <DocRow key={d.id} doc={d} onOpen={openDoc} onDelete={remove} pending={pending} />
            ))}
          </ul>
        )}
      </div>

      {/* Modal upload */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(null)}>
          <form ref={formRef} onSubmit={submit}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3"
            onClick={e => e.stopPropagation()}>
            <h2 className="font-display text-xl">
              {open === 'devis_artisan' ? 'Ajouter un devis' : 'Ajouter une facture'}
            </h2>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>N° {open === 'devis_artisan' ? 'devis' : 'facture'}</Label>
                <Input name="document_number" placeholder="DV-2026-042" />
              </div>
              <div>
                <Label>Date</Label>
                <Input name="document_date" type="date" defaultValue={new Date().toISOString().slice(0,10)} />
              </div>
            </div>

            <p className="text-xs text-stoniz-gray-500 -mt-1">
              💡 Le montant est géré directement sur le lot (champs « Devis artisan » / « Facturé client »).
              Ici tu n'attaches que la pièce justificative (PDF / image).
            </p>

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
    </div>
  );
}

function DocRow({
  doc, onOpen, onDelete, pending,
}: {
  doc: LotDoc;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  pending: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-2 py-1 border-b last:border-0">
      <button onClick={() => onOpen(doc.id)} className="flex items-center gap-2 text-left hover:underline flex-1 min-w-0">
        <Download className="w-3.5 h-3.5 flex-shrink-0" />
        <span className="truncate">{doc.document_number ? `${doc.document_number} — ` : ''}{doc.name}</span>
      </button>
      <div className="flex items-center gap-3 text-xs text-stoniz-gray-500">
        {doc.document_date && <span>{formatDate(doc.document_date)}</span>}
        <button onClick={() => onDelete(doc.id)} disabled={pending}
          className="text-red-600 hover:bg-red-50 p-1 rounded">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}
