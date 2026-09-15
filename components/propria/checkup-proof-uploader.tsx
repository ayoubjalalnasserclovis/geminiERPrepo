'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Camera } from 'lucide-react';
import {
  createCheckupProofUploadUrl,
  recordCheckupProofAction,
  deleteCheckupProofAction,
} from '@/app/(team)/propria/checkups/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { processPhoto } from '@/lib/photos/process-photo';
import { processVideo } from '@/lib/media/process-video';
import { addWatermark, buildDefaultWatermark } from '@/lib/photos/watermark';
import { MediaLightbox, type MediaItem } from '@/components/media/media-lightbox';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

// Limite dure côté client (bucket = 200 Mo). On capte avant d'entamer la pipeline
// pour éviter qu'une compression échoue avec un message obscur (bug Amine
// 2026-06-24 : 0 photo pendant 4h sur iPhone, probable HEIC géant qui crashait
// addWatermark sans message clair).
const MAX_FILE_SIZE = 200 * 1024 * 1024;
const ACCEPTED_PREFIXES = ['image/', 'video/'];

export type CheckupProof = {
  id: string;
  storagePath: string;
  mimeType: string | null;
  uploadedById: string | null;
  createdAt: string;
  signedUrl: string | null;
  itemKey: string | null;
};

/**
 * Uploader de preuves check-up — clone du pattern ménage
 * (cleaning-proof-uploader) : compression photo + watermark, upload direct
 * navigateur → bucket 'intervention-proofs' (chemin checkups/<id>/...),
 * lightbox plein écran.
 */
export function CheckupProofUploader({
  checkupId,
  proofs,
  uploaderNames,
  canUpload,
  canDelete,
  itemKey = null,
  compact = false,
  title,
}: {
  checkupId: string;
  proofs: CheckupProof[];
  uploaderNames: Record<string, string>;
  canUpload: boolean;
  canDelete: boolean;
  /** Clé d'item de checklist (null = photo générale). */
  itemKey?: string | null;
  /** Variante allégée (intégration dans la grille checklist). */
  compact?: boolean;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string } | null>(null);

  const mediaItems: MediaItem[] = proofs
    .filter((p) => !!p.signedUrl)
    .map((p) => ({
      url: p.signedUrl!,
      kind: (p.mimeType ?? '').startsWith('video/') ? 'video' as const : 'image' as const,
      name: `Photo check-up du ${new Date(p.createdAt).toLocaleDateString('fr-FR')}`,
      caption: p.uploadedById && uploaderNames[p.uploadedById]
        ? `Déposée par ${uploaderNames[p.uploadedById]}`
        : undefined,
    }));

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    setError(null);
    setProgress({ done: 0, total: arr.length });

    // Pré-validation taille + type AVANT toute pipeline async, pour donner un
    // message clair à l'utilisateur terrain (CEO 2026-06-24 — bug Amine).
    for (const f of arr) {
      if (f.size > MAX_FILE_SIZE) {
        setError(`« ${f.name} » dépasse la limite de 200 Mo. Réduis la qualité ou découpe la vidéo.`);
        setProgress(null);
        e.target.value = '';
        return;
      }
      if (!ACCEPTED_PREFIXES.some((p) => f.type.startsWith(p))) {
        setError(`« ${f.name} » : seules les photos et vidéos sont acceptées (reçu : ${f.type || 'type inconnu'}).`);
        setProgress(null);
        e.target.value = '';
        return;
      }
    }

    start(async () => {
      for (let i = 0; i < arr.length; i++) {
        const original = arr[i];
        try {
          setProgress({ done: i, total: arr.length, phase: 'Préparation' });
          let toUpload = original;
          if (original.type.startsWith('image/')) {
            try {
              const compressed = (await processPhoto(original)).file;
              try {
                toUpload = await addWatermark(compressed, buildDefaultWatermark());
              } catch (e) {
                console.warn('[watermark] echec, upload sans watermark', e);
                toUpload = compressed;
              }
            } catch (procErr) {
              // Photo qui résiste à processPhoto (HEIC corrompu, image >50 MP qui
              // OOM le worker browser-image-compression) : on tente l'upload du
              // fichier ORIGINAL — le bucket accepte heic/heif/jpeg/png.
              console.warn('[processPhoto] echec, upload sans compression', procErr);
              toUpload = original;
            }
          } else if (original.type.startsWith('video/')) {
            setProgress({ done: i, total: arr.length, phase: 'Compression vidéo' });
            try {
              toUpload = (await processVideo(original)).file;
            } catch (procErr) {
              console.warn('[processVideo] echec, upload de l\'original', procErr);
              toUpload = original;
            }
          }

          const urlRes = await createCheckupProofUploadUrl({
            checkupId,
            filename: toUpload.name,
            contentType: toUpload.type,
          });
          // Pattern défensif canon (cf. mémoire stoniz 2026-06-22/23, bugs Salma
          // et "Erreur serveur réponse vide") : Vercel rejette la server action
          // → urlRes peut être undefined → !urlRes.ok crashe. On garde la garde.
          if (!urlRes || !urlRes.ok) {
            throw new Error(
              (urlRes && 'error' in urlRes ? urlRes.error : null)
                ?? 'Session expirée ou serveur indisponible (réponse vide). Recharge la page.',
            );
          }

          setProgress({ done: i, total: arr.length, phase: 'Envoi' });
          await uploadToSignedUrl(urlRes.path, urlRes.token, toUpload, 'intervention-proofs');

          const recRes = await recordCheckupProofAction({
            checkupId,
            storagePath: urlRes.path,
            mimeType: toUpload.type,
            sizeBytes: toUpload.size,
            itemKey,
          });
          if (!recRes || !recRes.ok) {
            throw new Error(
              (recRes && 'error' in recRes ? recRes.error : null)
                ?? 'Enregistrement échec (réponse vide). Recharge la page.',
            );
          }
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
    if (!confirm('Supprimer cette photo ?')) return;
    setError(null);
    start(async () => {
      try {
        const r = await deleteCheckupProofAction(proofId, checkupId);
        if (!r || !r.ok) { setError(r?.error ?? 'Erreur inconnue'); return; }
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
      <div className={`flex items-center justify-between gap-2 ${compact ? 'mb-2' : 'mb-4'}`}>
        <h2 className={compact ? 'text-sm font-medium' : 'font-display text-lg'}>
          {title ?? `Photos (${proofs.length})`}
        </h2>
        {canUpload && (
          /* Chantier 5 mobile : split caméra (capture directe) vs galerie
             (choix dans pellicule). Sur desktop, "Caméra" ouvre la webcam si dispo. */
          <div className="flex gap-1.5">
            {/* Touch targets Apple HIG 44×44px min (chantier 5 — anciennement 40px). */}
            <label className="bg-stoniz-black text-white px-3 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 cursor-pointer inline-flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center">
              <Camera className="w-4 h-4" />
              <span className="hidden sm:inline">Caméra</span>
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
            <label className="bg-white border border-stoniz-gray-300 text-stoniz-gray-800 px-3 py-2 rounded-md text-sm hover:bg-stoniz-gray-50 cursor-pointer inline-flex items-center gap-1 min-h-[44px] min-w-[44px] justify-center">
              <span>📁</span>
              <span className="hidden sm:inline">Galerie</span>
              <input
                type="file"
                accept="image/*,video/*"
                multiple
                className="hidden"
                disabled={pending}
                onChange={onPick}
              />
            </label>
          </div>
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
        <p className={compact ? 'text-xs text-stoniz-gray-500' : 'text-sm text-stoniz-gray-500'}>
          Aucune photo déposée.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {proofs.map(p => {
            const isVideo = (p.mimeType ?? '').startsWith('video/');
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
                      <img src={p.signedUrl} alt="Photo check-up" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
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
                  /* Bug d'origine : opacity-0 group-hover:opacity-100 → invisible sur
                     mobile (pas de hover tactile). Maintenant visible par défaut sur
                     mobile, masqué/hover seulement à partir de sm. Touch 44×44px. */
                  <button
                    onClick={() => remove(p.id)}
                    disabled={pending}
                    className="absolute top-2 right-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-md bg-white/90 shadow-sm opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity hover:bg-red-100"
                    title="Supprimer"
                    aria-label="Supprimer la photo"
                  >
                    <Trash2 className="w-5 h-5 text-red-600" />
                  </button>
                )}
              </div>
            );
          })}
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
