'use client';

import { useTransition } from 'react';
import { deleteProposalAction } from '@/app/(team)/projects/[id]/proposals/actions';

export function RemoveProposalButton({
  proposalId,
  projectId,
  propertyName,
}: {
  proposalId: string;
  projectId: string;
  propertyName: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Retirer la proposition "${propertyName}" ? Le client ne la verra plus.`)) return;
        start(async () => {
          await deleteProposalAction(proposalId, projectId);
        });
      }}
      className="text-xs text-red-600 hover:text-red-800 hover:underline disabled:opacity-50"
    >
      {pending ? '…' : 'Retirer'}
    </button>
  );
}
