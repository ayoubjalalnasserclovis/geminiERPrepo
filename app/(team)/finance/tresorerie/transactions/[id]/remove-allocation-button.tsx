'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { removeAllocationAction } from '../actions';

export function RemoveAllocationButton({
  allocationId,
  transactionId,
}: {
  allocationId: string;
  transactionId: string;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function onClick() {
    if (!confirm('Supprimer cette allocation ?\n\nLes lignes encaissement/payment créées automatiquement sur le projet seront également annulées.')) return;
    setSubmitting(true);
    try {
      const result = await removeAllocationAction(allocationId, transactionId);
      if (!result.ok) {
        alert('error' in result ? result.error : 'Erreur inattendue');
      }
    } catch (err: any) {
      alert(err?.message ?? 'Erreur réseau');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={submitting}
      title="Supprimer cette allocation"
      className="text-xs text-stoniz-gray-400 hover:text-red-600 inline-flex items-center gap-1 mt-1"
    >
      <X className="w-3 h-3" /> {submitting ? 'Suppression…' : 'Retirer'}
    </button>
  );
}
