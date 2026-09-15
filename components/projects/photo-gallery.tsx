'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, X, Loader2 } from 'lucide-react';
import {
  uploadProjectPhotoAction,
  deleteProjectPhotoAction,
} from '@/app/actions/photos';
import { processPhoto } from '@/lib/photos/process-photo';

export type Photo = {
  id: string;
  kind: 'before' | 'after' | 'verified' | 'defaut' | 'reference';
  storage_path: string;
  caption: string | null;
  width: number | null;
  height: number | null;
};

export type EntityType = 'vct_action' | 'pv_reserve' | 'vct_item' | 'pv_item' | 'intervention' | 'project';

type KindOption = {
  value: Photo['kind'];
  label: string;
  emoji: string;
  cls: string;
};

// Kinds proposés selon le contexte
const KIND_PRESETS: Record<EntityType, KindOption[]> = {
  vct_action: [
    { value: 'before',   label: 'Avant correction',  emoji: '📷', cls: 'bg-red-100 text-red-800 border-red-300' },
    { value: 'after',    label: 'Après correction',  emoji: '✓',  cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
    { value: 'verified', label: 'Contre-vérif',      emoji: '🔍', cls: 'bg-blue-100 text-blue-800 border-blue-300' },
  ],
  pv_reserve: [
    { value: 'before',   label: 'État au PV',        emoji: '📷', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'after',    label: 'Réserve levée',     emoji: '✓',  cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ],
  vct_item: [
    { value: 'defaut',    label: 'Photo du défaut',  emoji: '📷', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'reference', label: 'Référence',         emoji: '📍', cls: 'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-300' },
  ],
  pv_item: [
    { value: 'defaut',    label: 'Photo du défaut',  emoji: '📷', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'reference', label: 'Référence',         emoji: '📍', cls: 'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-300' },
  ],
  intervention: [
    { value: 'before',   label: 'Avant',  emoji: '📷', cls: 'bg-orange-100 text-orange-800 border-orange-300' },
    { value: 'after',    label: 'Après',  emoji: '✓',  cls: 'bg-emerald-100 text-emerald-800 border-emerald-300' },
  ],
  project: [
    { value: 'reference', label: 'Photo',  emoji: '📷', cls: 'bg-stoniz-gray-100 text-stoniz-gray-700 border-stoniz-gray-300' },
  ],
};

export function PhotoGallery({
  projectId,
  entityType,
  entityId,
  photos,
  canEdit = true,
  compact = false,
}: {
  projectId: string;
  entityType: EntityType;
  entityId: string;
  photos: Photo[];
  canEdit?: boolean;
  compact?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingKind, setPendingKind] = useState<Photo['kind'] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const kinds = KIND_PRESETS[entityType] ?? KIND_PRESETS.project;
  const photosByKind = kinds.map(k => ({
    kind: k,
    items: photos.filter(p => p.kind === k.value),
  }));

  function triggerUpload(kind: Photo['kind']) {
    setError(null);
    setPendingKind(kind);
    fileInputRef.current?.click();
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const kind = pendingKind;
    if (!file || !kind) return;

    try {
      // Pipeline client : HEIC→JPEG, compress, hash
      const processed = await processPhoto(file);
      const fd = new FormData();
      fd.set('file', processed.file);
      fd.set('project_id', projectId);
      fd.set('entity_type', entityType);
      fd.set('entity_id', entityId);
      fd.set('kind', kind);
      fd.set('hash_sha256', processed.hash);
      fd.set('width', String(processed.width));
      fd.set('height', String(processed.height));

      startTransition(async () => {
        try {
          const result = await uploadProjectPhotoAction(fd);
          if ((result as any)?.skipped) {
            setError('Cette photo a déjà été uploadée (détectée par empreinte SHA-256).');
          }
        } catch (err: any) {
          setError(err?.message ?? 'Erreur upload');
        }
      });
    } catch (err: any) {
      setError(`Échec compression : ${err?.message ?? err}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
      setPendingKind(null);
    }
  }

  return (
    <div className={compact ? 'mt-1' : 'mt-2'}>
      <div className="space-y-2">
        {photosByKind.map(({ kind, items }) => (
          (items.length > 0 || canEdit) && (
            <div key={kind.value} className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${kind.cls} font-medium`}>
                {kind.emoji} {kind.label}
              </span>
              {items.map(p => (
                <PhotoThumb
                  key={p.id}
                  photo={p}
                  canEdit={canEdit}
                  compact={compact}
                />
              ))}
              {canEdit && (
                <button
                  type="button"
                  onClick={() => triggerUpload(kind.value)}
                  disabled={isPending}
                  className={`flex items-center justify-center border-2 border-dashed border-stoniz-gray-300 rounded hover:border-stoniz-black hover:bg-stoniz-gray-50 transition-colors ${
                    compact ? 'w-10 h-10' : 'w-14 h-14'
                  } ${isPending ? 'opacity-50 cursor-not-allowed' : ''}`}
                  title={`Ajouter une photo (${kind.label.toLowerCase()})`}
                >
                  {isPending && pendingKind === kind.value
                    ? <Loader2 className="w-4 h-4 text-stoniz-gray-500 animate-spin" />
                    : <Camera className="w-4 h-4 text-stoniz-gray-500" />}
                </button>
              )}
            </div>
          )
        ))}
      </div>

      {/* Input file caché — partagé entre tous les kinds */}
      {canEdit && (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={handleFileChange}
          className="hidden"
        />
      )}

      {error && (
        <p className="text-[11px] text-red-600 mt-1">{error}</p>
      )}
    </div>
  );
}

function PhotoThumb({ photo, canEdit, compact }: { photo: Photo; canEdit: boolean; compact: boolean }) {
  const [isPending, startTransition] = useTransition();
  const photoUrl = `/api/project-photos?id=${photo.id}`;
  const size = compact ? 'w-10 h-10' : 'w-14 h-14';

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Supprimer cette photo ?')) return;
    startTransition(async () => {
      try {
        await deleteProjectPhotoAction(photo.id);
      } catch (err: any) {
        alert(err?.message ?? 'Erreur suppression');
      }
    });
  }

  return (
    <div className={`relative group ${isPending ? 'opacity-50' : ''}`}>
      <a
        href={photoUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={`block ${size} rounded overflow-hidden border border-stoniz-gray-200 hover:border-stoniz-black bg-stoniz-gray-100`}
        title={photo.caption ?? 'Cliquer pour agrandir'}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={photo.caption ?? 'Photo'}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      </a>
      {canEdit && (
        <button
          type="button"
          onClick={handleDelete}
          disabled={isPending}
          className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700"
          title="Supprimer cette photo"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
}
