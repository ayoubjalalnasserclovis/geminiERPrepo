'use client';

import { useMemo, useState, useTransition } from 'react';
import { CheckCircle2, AlertCircle, AlertTriangle } from 'lucide-react';
import {
  updateVctItemAction,
  updatePvItemAction,
} from '@/app/(team)/projects/[id]/reception/actions';
import { PhotoGallery, type Photo } from './photo-gallery';

export type ChecklistItem = {
  id: string;
  category: string;
  name: string;
  display_order: number;
  status: string | null;
  observations: string | null;
  photos?: Photo[];
};

const VCT_STATUSES = [
  { value: 'ok',                label: '✓ Conforme',         cls: 'bg-emerald-100 text-emerald-800' },
  { value: 'defaut_mineur',    label: '⚠ Défaut mineur',    cls: 'bg-orange-100 text-orange-800' },
  { value: 'defaut_bloquant',  label: '❌ Défaut bloquant', cls: 'bg-red-100 text-red-800' },
];

const PV_STATUSES = [
  { value: 'ok',      label: '✓ Conforme', cls: 'bg-emerald-100 text-emerald-800' },
  { value: 'reserve', label: '⚠ Réserve',  cls: 'bg-orange-100 text-orange-800' },
  { value: 'refus',   label: '❌ Refus',  cls: 'bg-red-100 text-red-800' },
];

export function ReceptionChecklist({
  mode,
  parentId,
  projectId,
  items,
  isLocked = false,
}: {
  mode: 'vct' | 'pv';
  parentId: string;       // vct_id ou pv_id
  projectId: string;
  items: ChecklistItem[];
  isLocked?: boolean;
}) {
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const statuses = mode === 'vct' ? VCT_STATUSES : PV_STATUSES;
  const updateAction = mode === 'vct' ? updateVctItemAction : updatePvItemAction;

  function showToast(kind: 'success' | 'error', message: string) {
    setToast({ kind, message });
    setTimeout(() => setToast(null), kind === 'success' ? 1500 : 3500);
  }

  function persistRow(itemId: string, status: string | null, observations: string | null) {
    const fd = new FormData();
    fd.set('item_id', itemId);
    fd.set(mode === 'vct' ? 'vct_id' : 'pv_id', parentId);
    fd.set('project_id', projectId);
    if (status) fd.set('status', status);
    if (observations != null) fd.set('observations', observations);
    startTransition(async () => {
      try {
        await updateAction(fd);
      } catch (e: any) {
        showToast('error', e?.message ?? 'Erreur de sauvegarde');
      }
    });
  }

  // Groupage par catégorie
  const groups = useMemo(() => {
    const map = new Map<string, ChecklistItem[]>();
    for (const it of items) {
      if (!map.has(it.category)) map.set(it.category, []);
      map.get(it.category)!.push(it);
    }
    return Array.from(map.entries());
  }, [items]);

  const totalItems = items.length;
  const doneItems = items.filter(i => i.status != null).length;
  const progress = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
  const blockingCount = items.filter(i =>
    mode === 'vct' ? i.status === 'defaut_bloquant' : i.status === 'refus'
  ).length;
  const reservesCount = items.filter(i =>
    mode === 'vct' ? i.status === 'defaut_mineur' : i.status === 'reserve'
  ).length;

  return (
    <div className="space-y-4">
      {/* Barre de progression */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-2 text-xs">
          <span className="text-stoniz-gray-600">
            Progression — {doneItems} / {totalItems} points contrôlés
          </span>
          <span className="font-medium">{progress}%</span>
        </div>
        <div className="h-2 bg-stoniz-gray-100 rounded-full overflow-hidden mb-3">
          <div
            className={`h-full transition-all ${progress === 100 ? 'bg-emerald-500' : 'bg-stoniz-black'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex gap-3 text-xs">
          {blockingCount > 0 && (
            <span className="bg-red-100 text-red-800 px-2 py-1 rounded">
              {blockingCount} {mode === 'vct' ? 'défaut(s) bloquant(s)' : 'refus'}
            </span>
          )}
          {reservesCount > 0 && (
            <span className="bg-orange-100 text-orange-800 px-2 py-1 rounded">
              {reservesCount} {mode === 'vct' ? 'défaut(s) mineur(s)' : 'réserve(s)'}
            </span>
          )}
        </div>
        {isPending && (
          <div className="text-[11px] text-stoniz-gray-500 mt-2">💾 Sauvegarde en cours…</div>
        )}
      </div>

      {groups.map(([category, rows]) => {
        const doneCat = rows.filter(r => r.status != null).length;
        const isComplete = doneCat === rows.length;
        return (
          <section key={category} className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
            <header className="px-4 py-3 bg-stoniz-gray-50 flex items-center justify-between">
              <h3 className="font-medium">{category}</h3>
              <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                isComplete ? 'bg-emerald-100 text-emerald-800' : 'bg-stoniz-gray-200 text-stoniz-gray-700'
              }`}>
                {doneCat} / {rows.length}
              </span>
            </header>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stoniz-gray-100">
                {rows.map(it => (
                  <ItemRow
                    key={it.id}
                    item={it}
                    statuses={statuses}
                    isLocked={isLocked}
                    onPersist={persistRow}
                    projectId={projectId}
                    mode={mode}
                  />
                ))}
              </tbody>
            </table>
          </section>
        );
      })}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg border text-sm
            animate-in fade-in slide-in-from-bottom-2 duration-200
            ${toast.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-800'}`}
        >
          {toast.kind === 'success'
            ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            : <AlertCircle className="w-4 h-4 text-red-600" />}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item, statuses, isLocked, onPersist, projectId, mode,
}: {
  item: ChecklistItem;
  statuses: { value: string; label: string; cls: string }[];
  isLocked: boolean;
  onPersist: (id: string, status: string | null, observations: string | null) => void;
  projectId: string;
  mode: 'vct' | 'pv';
}) {
  const [status, setStatus] = useState<string>(item.status ?? '');
  const [obs, setObs] = useState<string>(item.observations ?? '');

  const rowBg =
    status === 'defaut_bloquant' || status === 'refus' ? 'bg-red-50/50' :
    status === 'defaut_mineur' || status === 'reserve' ? 'bg-orange-50/50' :
    status === 'ok' ? 'bg-emerald-50/30' : '';

  // Galerie TOUJOURS affichée (preuve juridique : on ne cache jamais une photo).
  // Quand l'item est "ok" et qu'il a déjà des photos historiques → mode collapsed
  // par défaut pour ne pas encombrer (l'utilisateur peut déplier d'un clic).
  const photos = item.photos ?? [];
  const hasPhotos = photos.length > 0;
  const isOkWithHistory = status === 'ok' && hasPhotos;
  const hasBefore = photos.some(p => p.kind === 'before' || p.kind === 'defaut');
  const hasAfter = photos.some(p => p.kind === 'after');
  const showFullDocBadge = hasBefore && hasAfter;

  return (
    <tr className={rowBg}>
      <td className="px-3 py-2 text-sm w-1/2">
        <div className="flex items-center gap-2 flex-wrap">
          <span>{item.name}</span>
          {showFullDocBadge && (
            <span
              className="text-[10px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full border border-emerald-300"
              title="Cet item a une photo 'avant' et une photo 'après' — preuve complète"
            >
              ✓ Avant/après documenté
            </span>
          )}
        </div>

        {isOkWithHistory ? (
          // Item OK avec historique photo → version compacte dépliable
          <details className="mt-1">
            <summary className="text-[11px] text-stoniz-gray-500 hover:text-stoniz-black cursor-pointer">
              📷 {photos.length} photo{photos.length > 1 ? 's' : ''} historique{photos.length > 1 ? 's' : ''}
            </summary>
            <PhotoGallery
              projectId={projectId}
              entityType={mode === 'vct' ? 'vct_item' : 'pv_item'}
              entityId={item.id}
              photos={photos}
              canEdit={!isLocked}
              compact
            />
          </details>
        ) : (
          // Sinon (item en défaut OU item OK sans photo) → galerie déployée directement
          <PhotoGallery
            projectId={projectId}
            entityType={mode === 'vct' ? 'vct_item' : 'pv_item'}
            entityId={item.id}
            photos={photos}
            canEdit={!isLocked}
            compact
          />
        )}
      </td>
      <td className="px-3 py-2 w-44">
        <div className="flex gap-1">
          {statuses.map(s => (
            <button
              key={s.value}
              type="button"
              disabled={isLocked}
              onClick={() => {
                const next = status === s.value ? '' : s.value;
                setStatus(next);
                onPersist(item.id, next || null, obs || null);
              }}
              className={`text-[10px] px-2 py-1 rounded transition-all ${
                status === s.value
                  ? `${s.cls} ring-2 ring-offset-1 ring-stoniz-black/20`
                  : 'bg-stoniz-gray-100 text-stoniz-gray-600 hover:bg-stoniz-gray-200'
              }`}
              title={s.label}
            >
              {s.label.split(' ')[0]}
            </button>
          ))}
        </div>
      </td>
      <td className="px-3 py-2">
        <input
          type="text"
          value={obs}
          disabled={isLocked}
          onChange={(e) => setObs(e.target.value)}
          onBlur={() => {
            if (obs === (item.observations ?? '')) return;
            onPersist(item.id, status || null, obs || null);
          }}
          placeholder="Observation…"
          className="w-full border border-stoniz-gray-200 rounded px-2 py-1 text-xs"
        />
      </td>
    </tr>
  );
}
