'use client';

import { useState } from 'react';
import { downloadWeeklyRecapXlsxAction } from './actions';

/**
 * Bouton "Export Excel récap semaine".
 * Déclenche l'action server qui renvoie le XLSX en base64, puis trigger
 * un téléchargement navigateur via un Blob.
 */
export function WeeklyRecapDownloadButton({ weekStart }: { weekStart: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setErr(null);
    try {
      const res = await downloadWeeklyRecapXlsxAction(weekStart);
      if (!res.ok) {
        setErr(res.error);
        setBusy(false);
        return;
      }
      // base64 → Blob → trigger download
      const bin = atob(res.xlsxBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur inconnue');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        className="border border-stoniz-gray-300 hover:border-stoniz-black px-4 py-2 rounded-md text-sm whitespace-nowrap disabled:opacity-50"
        title={`Récap semaine du ${weekStart} (lundi → dimanche)`}
      >
        {busy ? 'Génération…' : '📊 Export Excel semaine'}
      </button>
      {err && <span className="text-xs text-red-600 max-w-xs text-right">{err}</span>}
    </div>
  );
}
