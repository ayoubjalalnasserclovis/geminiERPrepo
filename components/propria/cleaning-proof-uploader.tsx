'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Camera } from 'lucide-react';
import {
  createCleaningProofUploadUrl,
  recordCleaningProofAction,
  deleteCleaningProofAction,
} from '@/app/(team)/propria/menage/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { processPhoto } from '@/lib/photos/process-photo';
import { processVideo } from '@/lib/media/process-video';
import { addWatermark, buildDefaultWatermark } from '@/lib/photos/watermark';
import { MediaLightbox, type MediaItem } from '@/components/media/media-lightbox';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

export type CleaningProof = {
  id: string;
  storagePath: string;
  mimeType: string | null;
  uploadedById: string | null;
  createdAt: string;
  signedUrl: string | null;
  section?: 'general' | 'checklist' | 'equipment' | 'incident';
  checklistItemKey?: string | null;
};

export function CleaningProofUploader({
  cleaningId,
  proofs,
  uploaderNames,
  canUpload,
  canDelete,
  section = 'general',
  checklistItemKey = null,
  compact = false,
  title,
}: {
  cleaningId: string;
  proofs: CleaningProof[];
  uploaderNames: Record<string, string>;
  canUpload: boolean;
  canDelete: boolean;
  /** Catégorie de la preuve (par défaut "general"). */
  section?: 'general' | 'checklist' | 'equipment' | 'incident';
  /** Clé d'item de checklist (si section='checklist' ou 'equipment'). */
  checklistItemKey?: string | null;
  /** Variante allégée (pour intégration dans une grille checklist). */
  compact?: boolean;
  /** Titre custom (par défaut "Preuves"). */
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // CEO 2026-06-11 : lightbox plein écran sur clic photo/vidéo
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Construit la liste pour le lightbox depuis les preuves disponibles
  const mediaItems: MediaItem[] = proofs
    .filter((p) => !!p.signedUrl)
    .map((p) => ({
      url: p.signedUrl!,
      // Audio WhatsApp (.opus/.ogg) : lu via <video> du lightbox (HTML5 gère l'audio-only)
      kind: ((p.mimeType ?? '').startsWith('video/') || (p.mimeType ?? '').startsWith('audio/'))
        ? 'video' as const : 'image' as const,
      name: `Preuve ménage du ${new Date(p.createdAt).toLocaleDateString('fr-FR')}`,
      caption: p.uploadedById && uploaderNames[p.uploadedById]
        ? `Déposée par ${uploaderNames[p.uploadedById]}`
        : undefined,
    }));
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);

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
            try {
              const compressed = (await processPhoto(original)).file;
              // Watermark "Marrakech · date heure" — best-effort
              try {
                toUpload = await addWatermark(compressed, buildDefaultWatermark());
              } catch (e) {
                console.warn('[watermark] echec, upload sans watermark', e);
                toUpload = compressed;
              }
            } catch { toUpload = original; }
          } else if (original.type.startsWith('video/')) {
            setProgress({ done: i, total: arr.length, phase: 'Compression vidéo' });
            toUpload = (await processVideo(original)).file;
          }

          const urlRes = await createCleaningProofUploadUrl({
            cleaningId,
            filename: toUpload.name,
            contentType: toUpload.type,
          });
          if (!urlRes || !urlRes.ok) throw new Error(urlRes?.error ?? 'Erreur inconnue');

          setProgress({ done: i, total: arr.length, phase: 'Envoi' });
          await uploadToSignedUrl(urlRes.path, urlRes.token, toUpload, 'intervention-proofs');

          const recRes = await recordCleaningProofAction({
            cleaningId,
            storagePath: urlRes.path,
            mimeType: toUpload.type,
            sizeBytes: toUpload.size,
            section,
            checklistItemKey,
          });
          if (!recRes || !recRes.ok) throw new Error(recRes?.error ?? 'Erreur inconnue');
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'erreur inconnue';
          setError(`Échec sur « ${original.name} » : ${msg}`);
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
        const r = await deleteCleaningProofAction(proofId, cleaningId);
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
    <div className={compact
      ? 'bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-lg p-3'
      : 'bg-white border border-stoniz-gray-200 rounded-xl p-5'}>
      <div className={`flex items-center justify-between ${compact ? 'mb-2' : 'mb-4'}`}>
        <h2 className={compact ? 'text-sm font-medium' : 'font-display text-lg'}>
          {title ?? `Preuves (${proofs.length})`}
        </h2>
        {canUpload && (
          <label className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 cursor-pointer inline-flex items-center gap-2">
            <Camera className="w-4 h-4" />
            {pending ? 'Envoi…' : 'Ajouter photo / vidéo'}
            {/* Chantier 3 marathon (U15) : pas de capture="environment" — il
                force l'appareil photo sur Android et BLOQUE la sélection
                depuis la galerie / le dossier WhatsApp Media. L'accept inclut
                l'audio (notes vocales WhatsApp .opus/.ogg/.aac). */}
            <input
              type="file"
              accept="image/*,video/*,audio/*,.opus,.ogg,.aac,.m4a"
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
            ? 'Aucune preuve déposée. Prenez une photo ou une vidéo du ménage réalisé pour soumettre.'
            : 'Aucune preuve déposée pour le moment.'}
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {proofs.map(p => {
            const isVideo = (p.mimeType ?? '').startsWith('video/');
            // index dans mediaItems (peut différer si certaines preuves sans signedUrl)
            const lightboxIdx = mediaItems.findIndex((m) => m.url === p.signedUrl);
            return (
              <div key={p.id} className="relative group rounded-lg overflow-hidden bg-stoniz-gray-100">
                <button
                  type="button"
                  onClick={() => lightboxIdx >= 0 && setLightboxIndex(lightboxIdx)}
                  className="aspect-video block w-full cursor-zoom-in relative"
                  title="Cliquer pour agrandir"
                  disabled={!p.signedUrl}
                >
                  {p.signedUrl ? (
                    isVideo ? (
                      <>
                        <video src={p.signedUrl} className="w-full h-full object-cover pointer-events-none" muted preload="metadata" />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                          <div className="bg-white/90 rounded-full p-3">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                          </div>
                        </div>
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.signedUrl} alt="Preuve ménage" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-xs text-stoniz-gray-500">Indisponible</div>
                  )}
                </button>
                <div className="px-2 py-1.5 text-[11px] text-stoniz-gray-600 bg-white">
                  {p.uploadedById && uploaderNames[p.uploadedById]
                    ? uploaderNames[p.uploadedById]
                    : 'Inconnu'} · {fmtDate(p.createdAt)}
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
