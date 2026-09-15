'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  markRecordCompleteAction,
  markRecordSubmittedAction,
  markRecordArchivedAction,
  downloadPoliceRecordPdfAction,
  deletePoliceRecordAction,
} from '../actions';
import type { PoliceRecordStatus } from '@/lib/propria/police-records';

/**
 * Boutons de workflow pour la fiche : marquer complète / déposée / archivée /
 * télécharger PDF / supprimer (CEO only).
 *
 * Composant client volontairement compact : pas d'animations, pas de modale,
 * juste des boutons et un message d'erreur sous le panel quand ça échoue.
 */
export function WorkflowButtons({
  id,
  status,
  canWrite,
  canArchive,
  canDelete,
}: {
  id: string;
  status: PoliceRecordStatus;
  canWrite: boolean;
  canArchive: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function withBusy<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
    setBusy(key);
    setErr(null);
    try {
      return await fn();
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur inconnue');
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleComplete() {
    const res = await withBusy('complete', () => markRecordCompleteAction(id));
    if (res && res.ok) router.refresh();
    else if (res && !res.ok) setErr(res.error);
  }

  async function handleSubmit() {
    if (!confirm('Confirmer le dépôt au commissariat ? La fiche sera verrouillée.')) return;
    const res = await withBusy('submit', () => markRecordSubmittedAction(id));
    if (res && res.ok) router.refresh();
    else if (res && !res.ok) setErr(res.error);
  }

  async function handleArchive() {
    if (!confirm('Archiver cette fiche ?')) return;
    const res = await withBusy('archive', () => markRecordArchivedAction(id));
    if (res && res.ok) router.refresh();
    else if (res && !res.ok) setErr(res.error);
  }

  async function handleDelete() {
    if (!confirm('Supprimer définitivement cette fiche (soft-delete) ?')) return;
    const res = await withBusy('delete', () => deletePoliceRecordAction(id));
    if (res && res.ok) router.push('/propria/fiches-police');
    else if (res && !res.ok) setErr(res.error);
  }

  async function handleDownloadPdf() {
    const res = await withBusy('pdf', () => downloadPoliceRecordPdfAction(id));
    if (!res || !res.ok) {
      if (res && !res.ok) setErr(res.error);
      return;
    }
    // base64 → Blob → trigger download
    const bin = atob(res.pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = res.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function handlePrint() {
    // Imprime via download PDF puis open(blob) dans une nouvelle fenêtre.
    const res = await withBusy('print', () => downloadPoliceRecordPdfAction(id));
    if (!res || !res.ok) {
      if (res && !res.ok) setErr(res.error);
      return;
    }
    const bin = atob(res.pdfBase64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => {
        setTimeout(() => win.print(), 300);
      });
    }
  }

  const btn = 'px-4 py-2 rounded-md text-sm whitespace-nowrap disabled:opacity-50';
  const primary = `${btn} bg-stoniz-black text-white hover:bg-stoniz-gray-800`;
  const secondary = `${btn} border border-stoniz-gray-300 hover:border-stoniz-black`;
  const danger = `${btn} border border-red-300 text-red-700 hover:bg-red-50`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === 'draft' && canWrite && (
          <button
            type="button"
            onClick={handleComplete}
            disabled={busy === 'complete'}
            className={primary}
          >
            {busy === 'complete' ? 'Validation…' : '✓ Marquer complète'}
          </button>
        )}

        {status === 'complete' && canWrite && (
          <>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={busy === 'submit'}
              className={primary}
            >
              {busy === 'submit' ? 'Envoi…' : '🔒 Marquer déposée commissariat'}
            </button>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={busy === 'pdf'}
              className={secondary}
            >
              {busy === 'pdf' ? 'Génération…' : '📄 Télécharger PDF'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={busy === 'print'}
              className={secondary}
            >
              {busy === 'print' ? 'Préparation…' : '🖨 Imprimer'}
            </button>
          </>
        )}

        {status === 'submitted' && (
          <>
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={busy === 'pdf'}
              className={secondary}
            >
              {busy === 'pdf' ? 'Génération…' : '📄 Télécharger PDF'}
            </button>
            <button
              type="button"
              onClick={handlePrint}
              disabled={busy === 'print'}
              className={secondary}
            >
              {busy === 'print' ? 'Préparation…' : '🖨 Imprimer'}
            </button>
            {canArchive && (
              <button
                type="button"
                onClick={handleArchive}
                disabled={busy === 'archive'}
                className={secondary}
              >
                {busy === 'archive' ? 'Archivage…' : '📦 Archiver'}
              </button>
            )}
          </>
        )}

        {status === 'archived' && (
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={busy === 'pdf'}
            className={secondary}
          >
            {busy === 'pdf' ? 'Génération…' : '📄 Télécharger PDF'}
          </button>
        )}

        {canDelete && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy === 'delete'}
            className={danger}
          >
            {busy === 'delete' ? 'Suppression…' : '🗑 Supprimer'}
          </button>
        )}
      </div>

      {err && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {err}
        </div>
      )}
    </div>
  );
}
