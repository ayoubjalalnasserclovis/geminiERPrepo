'use client';

import { useState } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';

type GalleryPhoto = {
  id: string;
  entity_type: string;
  entity_id: string;
  kind: string;
  storage_path: string;
  caption: string | null;
  width: number | null;
  height: number | null;
  uploaded_at: string;
  uploaded_by: string | null;
  entity_label: string | null;
  uploader_name: string;
  kind_label: string;
  kind_cls: string;
  entity_type_label: string;
};

function fmtDate(d: string): string {
  const dt = new Date(d);
  return dt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function PhotoGalleryPageClient({
  projectId,
  photos,
}: {
  projectId: string;
  photos: GalleryPhoto[];
}) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  function close() { setLightboxIdx(null); }
  function next() {
    if (lightboxIdx === null) return;
    setLightboxIdx((lightboxIdx + 1) % photos.length);
  }
  function prev() {
    if (lightboxIdx === null) return;
    setLightboxIdx((lightboxIdx - 1 + photos.length) % photos.length);
  }

  return (
    <>
      {/* Grille masonry-like */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {photos.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setLightboxIdx(i)}
            className="group bg-white border border-stoniz-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-shadow text-left"
          >
            <div className="aspect-square bg-stoniz-gray-100 overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/project-photos?id=${p.id}`}
                alt={p.caption ?? p.entity_label ?? 'Photo'}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
              />
            </div>
            <div className="p-2.5 space-y-1">
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.kind_cls}`}>
                  {p.kind_label}
                </span>
                <span className="text-[10px] text-stoniz-gray-500">{p.entity_type_label}</span>
              </div>
              {p.entity_label && (
                <p className="text-xs text-stoniz-gray-700 line-clamp-2" title={p.entity_label}>
                  {p.entity_label}
                </p>
              )}
              <p className="text-[10px] text-stoniz-gray-500">
                {fmtDate(p.uploaded_at)} · {p.uploader_name}
              </p>
            </div>
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightboxIdx !== null && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={close}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); close(); }}
            className="absolute top-4 right-4 text-white hover:opacity-70 z-10"
            aria-label="Fermer"
          >
            <X className="w-8 h-8" />
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-4 text-white hover:opacity-70 z-10 p-2"
                aria-label="Précédent"
              >
                <ChevronLeft className="w-10 h-10" />
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-4 text-white hover:opacity-70 z-10 p-2"
                aria-label="Suivant"
              >
                <ChevronRight className="w-10 h-10" />
              </button>
            </>
          )}

          <div
            className="max-w-5xl max-h-[90vh] flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/project-photos?id=${photos[lightboxIdx].id}`}
              alt={photos[lightboxIdx].caption ?? 'Photo'}
              className="max-w-full max-h-[80vh] object-contain"
            />
            <div className="mt-4 text-white text-center space-y-1">
              <div className="flex items-center justify-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded-full ${photos[lightboxIdx].kind_cls}`}>
                  {photos[lightboxIdx].kind_label}
                </span>
                <span className="text-xs opacity-70">{photos[lightboxIdx].entity_type_label}</span>
              </div>
              {photos[lightboxIdx].entity_label && (
                <p className="text-sm">{photos[lightboxIdx].entity_label}</p>
              )}
              {photos[lightboxIdx].caption && (
                <p className="text-sm italic">"{photos[lightboxIdx].caption}"</p>
              )}
              <p className="text-xs opacity-70">
                {fmtDate(photos[lightboxIdx].uploaded_at)} · {photos[lightboxIdx].uploader_name}
              </p>
              <a
                href={`/api/project-photos?id=${photos[lightboxIdx].id}`}
                download
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 text-xs mt-2 px-3 py-1.5 bg-white/10 hover:bg-white/20 rounded transition-colors"
              >
                <Download className="w-3 h-3" /> Télécharger
              </a>
              <p className="text-[10px] opacity-50 mt-2">
                {lightboxIdx + 1} / {photos.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
