'use client';

import { useState, useEffect, useCallback, useRef, forwardRef } from 'react';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, Trash2, Play } from 'lucide-react';

/**
 * Lightbox plein écran réutilisable (CEO 2026-06-10, étendu 2026-06-24).
 *
 * - Modal plein écran avec navigation prev/next
 * - Support photos + vidéos (HTML5 <video controls>)
 * - Bouton téléchargement (44×44 mobile-friendly + label desktop)
 * - Bouton suppression toujours visible (si onDelete fourni)
 * - Vignettes plus grandes (160×160 par défaut)
 * - Click vignette → lightbox
 * - Touches clavier : ← → flèches pour naviguer, Esc pour fermer
 * - Swipe tactile mobile (gauche/droite) avec animation
 * - Galerie de vignettes en bas (scroll-x, auto-scroll vers courante)
 * - Compteur X/N haut centre
 * - Préchargement N+1 / N-1 pour éviter le flash
 *
 * Usage minimal :
 *   <MediaGallery items={[{ url, name, kind: 'image' }, ...]} />
 */

export type MediaItem = {
  url: string;
  name?: string;
  kind: 'image' | 'video' | 'pdf';
  thumbnailUrl?: string;
  /** Label additionnel affiché sous la vignette */
  caption?: string;
};

export function MediaGallery({
  items,
  thumbnailSize = 160,
  columns = 3,
}: {
  items: MediaItem[];
  thumbnailSize?: number;
  columns?: number;
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (items.length === 0) return null;

  return (
    <>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(${thumbnailSize}px, 1fr))` }}
      >
        {items.map((item, i) => (
          <MediaThumbnail
            key={i}
            item={item}
            size={thumbnailSize}
            onClick={() => setOpenIndex(i)}
          />
        ))}
      </div>

      {openIndex !== null && (
        <MediaLightbox
          items={items}
          startIndex={openIndex}
          onClose={() => setOpenIndex(null)}
        />
      )}
    </>
  );
}

function MediaThumbnail({
  item,
  size,
  onClick,
}: {
  item: MediaItem;
  size: number;
  onClick: () => void;
}) {
  const url = item.thumbnailUrl ?? item.url;
  const isVideo = item.kind === 'video';
  const isPdf = item.kind === 'pdf';

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative overflow-hidden rounded-lg border border-stoniz-gray-200 hover:border-stoniz-black transition-colors bg-stoniz-gray-50"
      style={{ width: '100%', aspectRatio: '1 / 1', minHeight: size }}
      title={item.name ?? 'Voir en plein écran'}
    >
      {isPdf ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-stoniz-gray-600">
          <div className="text-4xl">📄</div>
          <div className="text-[10px] truncate max-w-full px-2">{item.name ?? 'PDF'}</div>
        </div>
      ) : isVideo ? (
        <>
          <video
            src={item.url}
            className="w-full h-full object-cover"
            muted
            preload="metadata"
          />
          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
            <div className="bg-white/90 rounded-full p-2">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            </div>
          </div>
        </>
      ) : (
        <img
          src={url}
          alt={item.name ?? ''}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}

      {/* Overlay hover */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
        <ZoomIn className="w-6 h-6 text-white drop-shadow" />
      </div>

      {item.caption && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent text-white text-[10px] px-2 py-1 truncate">
          {item.caption}
        </div>
      )}
    </button>
  );
}

/** Seuil minimal de déplacement horizontal pour déclencher un swipe (px). */
const SWIPE_THRESHOLD = 50;
/** Seuil pour différencier un swipe horizontal d'un scroll vertical. */
const SWIPE_LOCK_RATIO = 1.2;
/** Bornes : nombre max d'items au-delà duquel on n'affiche plus la galerie de vignettes pleine. */
const THUMB_GALLERY_MAX = 200;

export function MediaLightbox({
  items,
  startIndex,
  onClose,
  onDelete,
  showThumbnails = true,
}: {
  items: MediaItem[];
  startIndex: number;
  onClose: () => void;
  /** Optionnel : si fourni, affiche un bouton suppression sur le média courant. */
  onDelete?: (item: MediaItem, index: number) => void;
  /** Optionnel : afficher la galerie de vignettes en bas. Défaut true. */
  showThumbnails?: boolean;
}) {
  const [index, setIndex] = useState(startIndex);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; locked: 'horizontal' | 'vertical' | null } | null>(null);
  const thumbsContainerRef = useRef<HTMLDivElement | null>(null);
  const thumbRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const item = items[index];

  const prev = useCallback(() => {
    setIsAnimating(true);
    setIndex((i) => (i === 0 ? items.length - 1 : i - 1));
    setSwipeOffset(0);
  }, [items.length]);
  const next = useCallback(() => {
    setIsAnimating(true);
    setIndex((i) => (i === items.length - 1 ? 0 : i + 1));
    setSwipeOffset(0);
  }, [items.length]);
  const goTo = useCallback((targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= items.length) return;
    setIsAnimating(true);
    setIndex(targetIndex);
    setSwipeOffset(0);
  }, [items.length]);

  // Navigation clavier
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [prev, next, onClose]);

  // Auto-scroll vignette courante visible
  useEffect(() => {
    const el = thumbRefs.current[index];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }, [index]);

  // Fin d'animation (laisser le translate revenir à 0 après changement d'index)
  useEffect(() => {
    if (!isAnimating) return;
    const t = setTimeout(() => setIsAnimating(false), 220);
    return () => clearTimeout(t);
  }, [isAnimating]);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, locked: null };
  }
  function onTouchMove(e: React.TouchEvent) {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!start.locked) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        // Lock direction au-delà d'un petit déplacement
        if (Math.abs(dx) > Math.abs(dy) * SWIPE_LOCK_RATIO) {
          start.locked = 'horizontal';
        } else if (Math.abs(dy) > Math.abs(dx) * SWIPE_LOCK_RATIO) {
          start.locked = 'vertical';
        }
      }
    }
    if (start.locked === 'horizontal') {
      // Empêcher le scroll page tant qu'on swipe latéralement
      e.preventDefault?.();
      setSwipeOffset(dx);
    }
  }
  function onTouchEnd() {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!start || start.locked !== 'horizontal') {
      setSwipeOffset(0);
      return;
    }
    if (Math.abs(swipeOffset) > SWIPE_THRESHOLD && items.length > 1) {
      if (swipeOffset < 0) next();
      else prev();
    } else {
      // Snap back animé
      setIsAnimating(true);
      setSwipeOffset(0);
    }
  }

  function download(e?: React.MouseEvent) {
    e?.stopPropagation();
    try {
      const a = document.createElement('a');
      a.href = item.url;
      a.download = item.name ?? 'media';
      // target _blank en fallback CORS
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {
      window.open(item.url, '_blank', 'noopener');
    }
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!onDelete) return;
    const confirmMsg = `Supprimer ${item.name ?? 'ce média'} ?`;
    if (typeof window !== 'undefined' && !window.confirm(confirmMsg)) return;
    const removedIndex = index;
    onDelete(item, removedIndex);
    // Ajuster l'index local si on supprime le dernier
    if (items.length <= 1) {
      onClose();
      return;
    }
    if (removedIndex >= items.length - 1) {
      setIndex(Math.max(0, removedIndex - 1));
    }
  }

  // Indices à précharger (N-1 et N+1) si N > 1
  const preloadIndices: number[] = [];
  if (items.length > 1) {
    preloadIndices.push((index + 1) % items.length);
    preloadIndices.push((index - 1 + items.length) % items.length);
  }

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[100] flex flex-col"
      onClick={onClose}
    >
      {/* Bar du haut */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between gap-2 p-3 sm:p-4 z-20 bg-gradient-to-b from-black/70 to-transparent">
        <div className="text-white text-xs sm:text-sm truncate flex-1 min-w-0">
          {item.name ?? `Media ${index + 1}`}
        </div>
        {/* Compteur centre */}
        {items.length > 1 && (
          <div className="text-white/80 text-xs sm:text-sm tabular-nums shrink-0 px-2">
            {index + 1} / {items.length}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={download}
            className="bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-full sm:rounded-md min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:px-3 sm:py-2 inline-flex items-center justify-center gap-1.5"
            title="Télécharger"
            aria-label="Télécharger"
          >
            <Download className="w-5 h-5 sm:w-4 sm:h-4" />
            <span className="hidden sm:inline text-sm">Télécharger</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="bg-white/10 hover:bg-white/20 active:bg-white/30 text-white rounded-full min-w-[44px] min-h-[44px] inline-flex items-center justify-center"
            title="Fermer (Esc)"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Navigation desktop : flèches latérales */}
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); prev(); }}
            className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 z-20 items-center justify-center"
            title="Précédent (←)"
            aria-label="Précédent"
          >
            <ChevronLeft className="w-6 h-6" />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); next(); }}
            className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 bg-white/10 hover:bg-white/20 text-white rounded-full p-3 z-20 items-center justify-center"
            title="Suivant (→)"
            aria-label="Suivant"
          >
            <ChevronRight className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Contenu principal — capte swipe + drag visuel */}
      <div
        className="flex-1 flex items-center justify-center px-2 sm:px-16 pt-16 pb-24 sm:pb-28 select-none touch-pan-y"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className="max-w-full max-h-full flex items-center justify-center"
          style={{
            transform: `translateX(${swipeOffset}px)`,
            transition: isAnimating ? 'transform 200ms ease-out' : 'none',
            willChange: 'transform',
          }}
        >
          {item.kind === 'video' ? (
            <video
              key={item.url}
              src={item.url}
              controls
              autoPlay
              className="max-w-full max-h-[70vh] sm:max-h-[80vh] rounded"
            />
          ) : item.kind === 'pdf' ? (
            <iframe
              src={item.url}
              className="w-[95vw] sm:w-[85vw] h-[70vh] sm:h-[80vh] bg-white rounded"
              title={item.name ?? 'PDF'}
            />
          ) : (
            <img
              src={item.url}
              alt={item.name ?? ''}
              className="max-w-full max-h-[70vh] sm:max-h-[80vh] object-contain rounded"
              draggable={false}
            />
          )}
        </div>
      </div>

      {/* Préchargement N+1 / N-1 (images uniquement) */}
      {preloadIndices.map((i) => {
        const it = items[i];
        if (!it || it.kind !== 'image') return null;
        return (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={`preload-${i}-${it.url}`}
            src={it.url}
            alt=""
            aria-hidden="true"
            className="absolute opacity-0 pointer-events-none w-px h-px"
            loading="eager"
          />
        );
      })}

      {/* Bouton suppression — bas droite, toujours visible si onDelete fourni */}
      {onDelete && (
        <button
          type="button"
          onClick={handleDelete}
          className="absolute bottom-24 sm:bottom-28 right-3 sm:right-6 z-20 bg-white/95 hover:bg-red-50 active:bg-red-100 text-red-600 rounded-full min-w-[44px] min-h-[44px] inline-flex items-center justify-center gap-1.5 shadow-lg sm:px-4"
          title="Supprimer"
          aria-label="Supprimer ce média"
        >
          <Trash2 className="w-5 h-5" />
          <span className="hidden sm:inline text-sm font-medium">Supprimer</span>
        </button>
      )}

      {/* Caption */}
      {item.caption && (
        <div className="absolute bottom-20 sm:bottom-24 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs sm:text-sm px-3 py-1.5 rounded max-w-[90%] truncate z-10">
          {item.caption}
        </div>
      )}

      {/* Galerie vignettes — bas */}
      {showThumbnails && items.length > 1 && items.length <= THUMB_GALLERY_MAX && (
        <div
          className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent pt-4 pb-2 px-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={thumbsContainerRef}
            className="flex gap-2 overflow-x-auto pb-1 px-1"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' } as React.CSSProperties}
          >
            {items.map((it, i) => (
              <LightboxThumb
                key={`${i}-${it.url}`}
                ref={(el) => { thumbRefs.current[i] = el; }}
                item={it}
                active={i === index}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Vignette du carrousel bas du lightbox. Composant top-level pour éviter
 * le piège React Field-in-closure (mémoire stoniz_react_field_closure_pattern).
 */
const LightboxThumb = forwardRef<
  HTMLButtonElement,
  { item: MediaItem; active: boolean; onClick: () => void }
>(function LightboxThumb({ item, active, onClick }, ref) {
  const isVideo = item.kind === 'video';
  const isPdf = item.kind === 'pdf';
  const previewUrl = item.thumbnailUrl ?? (isVideo || isPdf ? undefined : item.url);

  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={[
        'shrink-0 relative overflow-hidden rounded-md border-2 transition-all',
        'w-16 h-16 sm:w-20 sm:h-20',
        active
          ? 'border-amber-400 opacity-100 scale-105'
          : 'border-white/20 opacity-60 hover:opacity-90',
      ].join(' ')}
      title={item.name ?? ''}
      aria-current={active ? 'true' : undefined}
    >
      {isPdf ? (
        <div className="w-full h-full flex items-center justify-center bg-stoniz-gray-700 text-white text-xl">📄</div>
      ) : isVideo ? (
        previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-stoniz-gray-700">
            <Play className="w-5 h-5 text-white" fill="currentColor" />
          </div>
        )
      ) : previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={previewUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : null}
      {isVideo && previewUrl && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30">
          <Play className="w-4 h-4 text-white drop-shadow" fill="currentColor" />
        </div>
      )}
    </button>
  );
});
