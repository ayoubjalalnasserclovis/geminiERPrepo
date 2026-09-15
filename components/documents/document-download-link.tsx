'use client';

import { useState, useTransition } from 'react';
import { getDocumentSignedUrl } from '@/app/(team)/projects/[id]/documents/actions';

export function DocumentDownloadLink({ documentId }: { documentId: string }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  return (
    <div className="inline-flex flex-col gap-1 items-start">
      <button
        disabled={pending}
        className="underline text-sm text-stoniz-black hover:text-stoniz-black/70"
        onClick={() => {
          setErr(null);
          start(async () => {
            const r = await getDocumentSignedUrl(documentId);
            if (r.url) {
              window.open(r.url, '_blank');
            } else {
              setErr(r.error ?? 'Téléchargement impossible');
            }
          });
        }}
      >
        {pending ? '…' : '📥 Télécharger'}
      </button>
      {err && <span className="text-[11px] text-red-600 max-w-[200px]">{err}</span>}
    </div>
  );
}
