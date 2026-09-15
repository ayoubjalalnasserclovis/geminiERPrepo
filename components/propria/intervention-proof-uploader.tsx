'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Camera } from 'lucide-react';
import {
  createInterventionProofUploadUrl,
  recordInterventionProofAction,
  deleteInterventionProofAction,
} from '@/app/(team)/propria/interventions/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { processPhoto } from '@/lib/photos/process-photo';
import { processVideo } from '@/lib/media/process-video';
import { MediaLightbox, type MediaItem } from '@/components/media/media-lightbox';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

export type InterventionProof = {
  id: string;
  storage_path: string;
  media_type: 'photo' | 'video';
  mime_type: string | null;
  caption: string | null;
  uploaded_by: string | null;
  created_at: string;
  url: string | null;
};

export function InterventionProofUploader({
  interventionId,
  proofs,
  uploaderNames,
  canUpload,
  canDelete,
}: {
  interventionId: string;
  proofs: InterventionProof[];
  uploaderNames: Record<string, string>;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);
  // CEO 2026-06-11 : lightbox plein écran sur clic photo/vidéo
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Construit la liste pour le lightbox depuis les preuves disponibles
  const mediaItems: MediaItem[] = proofs
    .filter((p) => !!p.url)
    .map((p) => ({
      url: p.url!,
      kind: p.media_type === 'video' ? ('video' as const) : ('image' as const),
      name: p.caption ?? `Preuve intervention du ${new Date(p.created_at).toLocaleDateString('fr-FR')}`,
      caption: p.uploaded_by && uploaderNames[p.uploaded_by]
        ? `Déposée par ${uploaderNames[p.uploaded_by]}`
        : undefined,
    }));

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setError(null);
    setProgress({ done: 0, total: arr.length });

    start(async () => {
      for (let i = 0; i < arr.length; i++) {
        const original = arr[i];
        try {
          setProgress({ done: i, total: arr.length, phase: 'Préparation' });
          let toUpload = original;
          if (original.type.startsWith('image/')) {
            try { toUpload = (await processPhoto(original)).file; } catch { toUpload = original; }
          } else if (original.type.startsWith('video/')) {
            setProgress({ done: i, total: arr.length, phase: 'Compression vidéo' });
            toUpload = (await processVideo(original)).file;
          }

          const urlRes = await createInterventionProofUploadUrl({
            interventionId,
            fileName: toUpload.name,
            fileType: toUpload.type,
            fileSize: toUpload.size,
          });
          if (!urlRes.ok) throw new Error(urlRes.error);

          setProgress({ done: i, total: arr.length, phase: 'Envoi' });
          await uploadToSignedUrl(urlRes.path, urlRes.token, toUpload, 'intervention-proofs');

          const recRes = await recordInterventionProofAction({
            interventionId,
            storagePath: urlRes.path,
            fileType: toUpload.type,
            fileSize: toUpload.size,
          });
          if (!recRes.ok) throw new Error(recRes.error);
        } catch (e: any) {
          setError(`Échec sur « ${original.name} » : ${e?.message ?? 'erreur inconnue'}`);
          setProgress(null);
          return;
        }
        setProgress({ done: i + 1, total: arr.length });
      }
      e.target.value = '';
      setProgress(null);
      router.refresh();
    });
  }

  function remove(proofId: string) {
    if (!confirm('Supprimer cette preuve ?')) return;
    setError(null);
    start(async () => {
      try {
        const r = await deleteInterventionProofAction(proofId, interventionId);
        if (!r || !r.ok) {
          setError(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-lg">Preuves ({proofs.length})</h2>
        {canUpload && (
          <label className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 cursor-pointer inline-flex items-center gap-2">
            <Camera className="w-4 h-4" />
            {pending ? 'Envoi…' : 'Ajouter photo / vidéo'}
            <input
              type="file"
              accept="image/*,video/*"
              capture="environment"
              multiple
              className="hidden"
              disabled={pending}
              onChange={onPick}
            />
          </label>
        )}
      </div>

      {error && (
        <div className="mb-3">
          <SessionExpiredBanner error={error} />
        </div>
      )}
      {progress && (
        <div className="mb-3 text-sm text-stoniz-gray-600">
          {progress.phase ?? 'Upload'}… {progress.done} / {progress.total}
          <div className="w-full bg-stoniz-gray-100 rounded-full h-1.5 mt-1">
            <div className="bg-stoniz-black h-1.5 rounded-full transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
        </div>
      )}

      {proofs.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500">
          {canUpload
            ? 'Aucune preuve déposée. Prenez une photo ou une vidéo pour prouver la réalisation.'
            : 'Aucune preuve déposée pour le moment.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {proofs.map(p => {
            const lightboxIdx = mediaItems.findIndex((m) => m.url === p.url);
            return (
              <div key={p.id} className="relative group rounded-lg overflow-hidden bg-stoniz-gray-100">
                <button
                  type="button"
                  onClick={() => lightboxIdx >= 0 && setLightboxIndex(lightboxIdx)}
                  className="aspect-video block w-full cursor-zoom-in relative"
                  title="Cliquer pour agrandir"
                  disabled={!p.url}
                >
                  {p.url ? (
                    p.media_type === 'video' ? (
                      <>
                        <video src={p.url} className="w-full h-full object-cover pointer-events-none" muted preload="metadata" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="bg-white/90 rounded-full p-3">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                        </div>
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.url} alt={p.caption ?? 'Preuve'} className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-stoniz-gray-500">Indisponible</div>
                  )}
                </button>
                <div className="px-2 py-1.5 text-[11px] text-stoniz-gray-600 bg-white">
                  {p.uploaded_by && uploaderNames[p.uploaded_by]
                    ? uploaderNames[p.uploaded_by]
                    : 'Inconnu'} · {fmtDate(p.created_at)}
                </div>
                {canDelete && (
                  <button
                    onClick={() => remove(p.id)}
                    disabled={pending}
                    className="absolute top-2 right-2 p-1.5 rounded-md bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100"
                    title="Supprimer"
                  >
                    <Trash2 className="w-4 h-4 text-red-600" />
                  </button>
                )}
              </div>
            );
          })}
          {/* Lightbox plein écran (CEO 2026-06-11) */}
          {lightboxIndex !== null && mediaItems.length > 0 && (
            <MediaLightbox
              items={mediaItems}
              startIndex={Math.min(lightboxIndex, mediaItems.length - 1)}
              onClose={() => setLightboxIndex(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
