'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { attachToStonizPaymentAction } from '../actions';

export function AutoAttachButton({
  transactionId,
  source,
  sourceId,
  projectId,
  amountMad,
}: {
  transactionId: string;
  source: string;
  sourceId: string;
  projectId: string | null;
  amountMad: number;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('transaction_id', transactionId);
      fd.append('source', source);
      fd.append('source_id', sourceId);
      if (projectId) fd.append('project_id', projectId);
      fd.append('amount_mad', amountMad.toString());
      const result = await attachToStonizPaymentAction(fd);
      if (!result.ok) {
        setError('error' in result ? result.error : 'Erreur inattendue');
      }
    } catch (err: any) {
      setError(err?.message ?? 'Erreur réseau');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="ml-3">
      <button
        type="button"
        onClick={onClick}
        disabled={submitting}
        className="bg-purple-700 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-purple-800 disabled:opacity-50 inline-flex items-center gap-1.5"
      >
        {submitting ? <><Loader2 className="w-3 h-3 animate-spin" /> Rattachement…</> : 'Rattacher'}
      </button>
      {error && <div className="text-[10px] text-red-600 mt-1 max-w-[120px]">{error}</div>}
    </div>
  );
}
