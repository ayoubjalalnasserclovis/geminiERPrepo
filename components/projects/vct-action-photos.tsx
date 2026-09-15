'use client';

import { useRef, useState, useTransition } from 'react';
import { Camera, X } from 'lucide-react';
import {
  uploadVctActionPhotoAction,
  deleteVctActionPhotoAction,
} from '@/app/(team)/projects/[id]/reception/actions';

export function VctActionPhotos({
  actionId,
  projectId,
  photoPaths,
  canEdit = true,
}: {
  actionId: string;
  projectId: string;
  photoPaths: string[];
  canEdit?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set('file', file);
    fd.set('action_id', actionId);
    fd.set('project_id', projectId);
    startTransition(async () => {
      try {
        await uploadVctActionPhotoAction(fd);
        if (fileInputRef.current) fileInputRef.current.value = '';
      } catch (err: any) {
        setError(err?.message ?? 'Erreur upload');
      }
    });
  }

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 flex-wrap">
        {photoPaths.map((path, i) => (
          <PhotoThumb
            key={path}
            path={path}
            index={i}
            actionId={actionId}
            projectId={projectId}
            canEdit={canEdit}
          />
        ))}

        {canEdit && (
          <label className={`cursor-pointer flex items-center justify-center w-14 h-14 border-2 border-dashed border-stoniz-gray-300 rounded hover:border-stoniz-black hover:bg-stoniz-gray-50 transition-colors ${
            isPending ? 'opacity-50 pointer-events-none' : ''
          }`}>
            <Camera className="w-4 h-4 text-stoniz-gray-500" />
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/heic"
              onChange={handleFileChange}
              className="hidden"
              disabled={isPending}
            />
          </label>
        )}
      </div>

      {error && (
        <p className="text-[11px] text-red-600 mt-1">{error}</p>
      )}
      {isPending && (
        <p className="text-[11px] text-stoniz-gray-500 mt-1">📤 Upload en cours…</p>
      )}
    </div>
  );
}

function PhotoThumb({
  path, index, actionId, projectId, canEdit,
}: {
  path: string;
  index: number;
  actionId: string;
  projectId: string;
  canEdit: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const photoUrl = `/api/vct/action-photo?path=${encodeURIComponent(path)}`;

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Supprimer cette photo ?')) return;
    startTransition(async () => {
      try {
        await deleteVctActionPhotoAction(actionId, path, projectId);
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
        className="block w-14 h-14 rounded overflow-hidden border border-stoniz-gray-200 hover:border-stoniz-black bg-stoniz-gray-100"
        title={`Photo #${index + 1} — cliquer pour agrandir`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={photoUrl}
          alt={`Preuve ${index + 1}`}
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
