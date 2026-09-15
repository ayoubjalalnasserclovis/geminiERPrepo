'use client';

import { useState, useTransition, useRef, useEffect } from 'react';
import { Trash2, Upload, Image as ImageIcon, Video } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  createPropertyMediaUploadUrl,
  recordPropertyMediaAction,
  deletePropertyMediaAction,
  getPropertyMediaSignedUrls,
} from '@/app/(team)/properties/[id]/media/actions';
import { uploadToSignedUrl } from '@/lib/media/upload-direct';
import { processPhoto } from '@/lib/photos/process-photo';
import { processVideo } from '@/lib/media/process-video';
import { MediaLightbox, type MediaItem } from '@/components/media/media-lightbox';

type Media = { id: string; type: string; storage_path: string; is_cover: boolean; url: string | null };

const MEDIA_TYPE_LABELS: Record<string, string> = {
  photo: 'Photo du bien',
  video_bien: 'Vidéo du bien',
  video_facade: 'Extérieur / façade',
  video_parties_communes: 'Parties communes',
};

const SECTIONS = [
  { type: 'photo',                  label: 'Photos du bien',           icon: ImageIcon },
  { type: 'video_parties_communes', label: 'Intérieur parties communes', icon: ImageIcon },
  { type: 'video_facade',           label: 'Extérieur de la résidence',  icon: ImageIcon },
  { type: 'video_bien',             label: 'Vidéo du bien',            icon: Video },
];

export function PropertyMediaGallery({
  propertyId,
  media,
}: {
  propertyId: string;
  media: Media[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; phase?: string; current?: string } | null>(null);
  const [localMedia, setLocalMedia] = useState<Media[]>(media);
  const formRef = useRef<HTMLFormElement>(null);
  // CEO 2026-06-11 : lightbox plein écran sur clic photo/vidéo, navigation
  // dans l'ENSEMBLE des médias du bien (toutes sections confondues).
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Helper : détecte si un média est une vidéo selon son extension de stockage.
  const VIDEO_EXTS = ['mp4','mov','m4v','webm','mkv','avi','3gp','3g2','quicktime'];
  function isMediaVideo(m: Media) {
    const ext = (m.storage_path?.split('.').pop() ?? '').toLowerCase();
    return VIDEO_EXTS.includes(ext);
  }

  // Liste globale dans l'ordre d'affichage (= ordre des SECTIONS).
  const orderedMedia: Media[] = SECTIONS.flatMap(s => localMedia.filter(m => m.type === s.type && !!m.url));
  const mediaItems: MediaItem[] = orderedMedia.map(m => ({
    url: m.url!,
    kind: isMediaVideo(m) ? ('video' as const) : ('image' as const),
    name: MEDIA_TYPE_LABELS[m.type] ?? 'Média',
    caption: m.is_cover ? 'Photo de couverture' : undefined,
  }));

  // Si le parent met à jour `media` (ex: revalidation server-side), on synchronise.
  useEffect(() => { setLocalMedia(media); }, [media]);

  async function refreshMedia() {
    const m = await getPropertyMediaSignedUrls(propertyId);
    setLocalMedia(m as Media[]);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setProgress(null);

    const form = e.currentTarget;
    const type = (form.elements.namedItem('type') as HTMLSelectElement).value;
    const filesInput = form.elements.namedItem('file') as HTMLInputElement;
    const files = filesInput.files;
    if (!files || files.length === 0) { setError('Aucun fichier sélectionné'); return; }

    const arr = Array.from(files);
    setProgress({ done: 0, total: arr.length });

    start(async () => {
      for (let i = 0; i < arr.length; i++) {
        const original = arr[i];
        try {
          // 1. Préparation : compression côté navigateur. Photos → WebP ≤ 1 Mo.
          //    Vidéos → 720p H.264 (best-effort, repli sur l'original si échec).
          setProgress({ done: i, total: arr.length, phase: 'Préparation', current: original.name });
          let toUpload = original;
          if (original.type.startsWith('image/')) {
            try {
              const processed = await processPhoto(original);
              toUpload = processed.file;
            } catch {
              // Compression impossible (format exotique) → on envoie l'original.
              toUpload = original;
            }
          } else if (original.type.startsWith('video/')) {
            setProgress({ done: i, total: arr.length, phase: 'Compression vidéo', current: original.name });
            // processVideo renvoie toujours un fichier valide (compressé ou original).
            const processed = await processVideo(original);
            toUpload = processed.file;
          }

          // 2. Le serveur autorise et délivre une URL signée à usage unique.
          const urlRes = await createPropertyMediaUploadUrl({
            propertyId,
            type,
            fileName: toUpload.name,
            fileType: toUpload.type,
            fileSize: toUpload.size,
          });
          if (!urlRes.ok) throw new Error(urlRes.error);

          // 3. Envoi DIRECT navigateur → stockage (contourne la limite serveur).
          setProgress({ done: i, total: arr.length, phase: 'Envoi', current: original.name });
          await uploadToSignedUrl(urlRes.path, urlRes.token, toUpload);

          // 4. Enregistrement de la fiche média.
          const recRes = await recordPropertyMediaAction({
            propertyId,
            type,
            storagePath: urlRes.path,
          });
          if (!recRes.ok) throw new Error(recRes.error);
        } catch (e: any) {
          setError(`Échec sur "${original.name}" : ${e?.message ?? 'erreur inconnue'}`);
          setProgress(null);
          await refreshMedia();
          return;
        }
        setProgress({ done: i + 1, total: arr.length });
      }
      formRef.current?.reset();
      setProgress(null);
      setOpen(false);
      await refreshMedia();
    });
  }

  function remove(mediaId: string) {
    if (!confirm('Supprimer ce média ?')) return;
    start(async () => {
      await deletePropertyMediaAction(mediaId, propertyId);
      await refreshMedia();
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Médias du bien</CardTitle>
          <Button size="sm" onClick={() => setOpen(true)}>+ Ajouter un média</Button>
        </div>
      </CardHeader>
      <CardContent>
        {localMedia.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500">
            Aucun média. Ajoutez des photos, des vidéos, et capturez l'extérieur de la résidence.
          </p>
        ) : (
          <div className="space-y-6">
            {SECTIONS.map(section => {
              const items = localMedia.filter(m => m.type === section.type);
              if (items.length === 0) return null;
              const Icon = section.icon;
              return (
                <div key={section.type}>
                  <div className="flex items-center gap-2 mb-2 text-sm font-medium text-stoniz-gray-600">
                    <Icon className="w-4 h-4" />
                    {section.label} ({items.length})
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {items.map(m => {
                      // Détection vidéo vs image basée sur l'EXTENSION du fichier (mime réel),
                      // pas sur la catégorie business `type` (qui peut être video_parties_communes
                      // ou video_facade alors que l'utilisateur a uploadé une PHOTO).
                      const isVideo = isMediaVideo(m);
                      // Index dans la liste globale (toutes sections), pour le lightbox.
                      const lightboxIdx = orderedMedia.findIndex(x => x.id === m.id);
                      return (
                        <div key={m.id} className="relative group rounded-lg overflow-hidden bg-stoniz-gray-100 aspect-video">
                          <button
                            type="button"
                            onClick={() => lightboxIdx >= 0 && setLightboxIndex(lightboxIdx)}
                            className="absolute inset-0 cursor-zoom-in"
                            title="Cliquer pour agrandir"
                            disabled={!m.url}
                          >
                            {m.url ? (
                              isVideo ? (
                                <>
                                  <video src={m.url} className="w-full h-full object-cover pointer-events-none" muted preload="metadata" />
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                                    <div className="bg-white/90 rounded-full p-3">
                                      <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                                    </div>
                                  </div>
                                </>
                              ) : (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={m.url} alt="" className="w-full h-full object-cover transition-transform group-hover:scale-105" />
                              )
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-xs text-stoniz-gray-500">Indisponible</div>
                            )}
                          </button>
                          {m.is_cover && (
                            <Badge variant="warning" className="absolute top-2 left-2 z-10 pointer-events-none">Couverture</Badge>
                          )}
                          <button
                            onClick={() => remove(m.id)}
                            disabled={pending}
                            className="absolute top-2 right-2 z-10 p-1.5 rounded-md bg-white/90 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-100"
                            title="Supprimer"
                          >
                            <Trash2 className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {open && (
          <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
            <form ref={formRef} onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
              <h2 className="font-display text-xl">Ajouter un média</h2>

              <div>
                <Label>Catégorie</Label>
                <select name="type" required className="w-full h-10 rounded-md border bg-white px-3 text-sm">
                  <option value="photo">Photo du bien</option>
                  <option value="video_parties_communes">Intérieur — parties communes</option>
                  <option value="video_facade">Extérieur — façade / résidence</option>
                  <option value="video_bien">Vidéo du bien</option>
                </select>
              </div>

              <div>
                <Label>Fichiers (vous pouvez en sélectionner plusieurs, max 1 Go chacun)</Label>
                <input type="file" name="file" accept="image/*,video/*"
                  multiple required className="w-full text-sm" />
                <p className="text-xs text-stoniz-gray-500 mt-1">
                  Astuce : Cmd+clic (ou Ctrl+clic) pour sélectionner plusieurs fichiers.
                </p>
              </div>

              {error && <div className="text-sm text-red-600">{error}</div>}
              {progress && (
                <div className="text-sm text-stoniz-gray-600">
                  {progress.phase ? `${progress.phase}…` : 'Upload en cours…'} {progress.done} / {progress.total}
                  {progress.current && (
                    <span className="block text-xs text-stoniz-gray-500 truncate">{progress.current}</span>
                  )}
                  <div className="w-full bg-stoniz-gray-100 rounded-full h-1.5 mt-1">
                    <div className="bg-stoniz-black h-1.5 rounded-full transition-all"
                      style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Annuler</Button>
                <Button type="submit" disabled={pending}>
                  {pending ? `Upload… ${progress ? `(${progress.done}/${progress.total})` : ''}` : 'Envoyer'}
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Lightbox plein écran (CEO 2026-06-11) — navigation dans tous les médias du bien */}
        {lightboxIndex !== null && mediaItems.length > 0 && (
          <MediaLightbox
            items={mediaItems}
            startIndex={Math.min(lightboxIndex, mediaItems.length - 1)}
            onClose={() => setLightboxIndex(null)}
          />
        )}
      </CardContent>
    </Card>
  );
}
