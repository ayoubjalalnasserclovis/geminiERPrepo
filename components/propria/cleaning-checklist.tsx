'use client';

import { CheckCircle2, Circle } from 'lucide-react';
import { expandChecklist } from '@/lib/propria/cleaning-checklist';
import { CleaningProofUploader, type CleaningProof } from './cleaning-proof-uploader';

/**
 * Affiche la checklist ménage organisée en sections, avec pour chaque item :
 *  - libellé + hint
 *  - statut visuel (✓ si au moins 1 photo déposée)
 *  - mini-uploader inline (peut accepter N photos)
 *
 * La liste d'items est expansée selon nb_chambres et nb_sdb de la suite.
 */
export function CleaningChecklistGrid({
  cleaningId,
  proofs,
  uploaderNames,
  nbChambres,
  nbSdb,
  canUpload,
  canDelete,
}: {
  cleaningId: string;
  proofs: CleaningProof[];
  uploaderNames: Record<string, string>;
  nbChambres: number | null | undefined;
  nbSdb: number | null | undefined;
  canUpload: boolean;
  canDelete: boolean;
}) {
  const sections = expandChecklist(nbChambres, nbSdb);
  const proofsByKey = new Map<string, CleaningProof[]>();
  for (const p of proofs) {
    if (p.section !== 'checklist' && p.section !== 'equipment') continue;
    const key = p.checklistItemKey ?? '__no_key__';
    const arr = proofsByKey.get(key) ?? [];
    arr.push(p);
    proofsByKey.set(key, arr);
  }

  // Compteur global de progression
  const allItems = sections.flatMap((s) => s.items);
  const itemsDone = allItems.filter((i) => (proofsByKey.get(i.expandedKey)?.length ?? 0) > 0).length;
  const progressPct = Math.round((itemsDone / Math.max(1, allItems.length)) * 100);

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-lg">✅ Checklist photos/vidéos</h2>
          <p className="text-xs text-stoniz-gray-500 mt-0.5">
            Chaque item accepte plusieurs photos. La date et le lieu sont ajoutés automatiquement.
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-display">{itemsDone}/{allItems.length}</div>
          <div className="text-[11px] uppercase text-stoniz-gray-500">items couverts</div>
        </div>
      </div>

      <div className="w-full bg-stoniz-gray-100 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${progressPct === 100 ? 'bg-emerald-500' : 'bg-amber-400'}`}
          style={{ width: `${progressPct}%` }}
        />
      </div>

      {sections.map(({ section, items }) => (
        <section key={section.key} className="space-y-2">
          <header>
            <h3 className="text-sm font-medium text-stoniz-gray-800">{section.title}</h3>
            {section.description && (
              <p className="text-xs text-stoniz-gray-500">{section.description}</p>
            )}
          </header>
          <div className="space-y-2">
            {items.map((item) => {
              const itemProofs = proofsByKey.get(item.expandedKey) ?? [];
              const done = itemProofs.length > 0;
              const isEquipment = section.key === 'equipements';
              return (
                <div
                  key={item.expandedKey}
                  className={`border rounded-lg p-3 ${
                    done
                      ? 'border-emerald-300 bg-emerald-50/40'
                      : 'border-stoniz-gray-200 bg-stoniz-gray-50/30'
                  }`}
                >
                  {/* Chantier 5 marathon (U21) : repère VISUEL d'abord —
                      gros emoji + image « bon exemple » (si générée), pour les
                      équipes qui ne lisent pas le français. ✅ géant une fois
                      la photo prise. */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="relative flex-shrink-0">
                        {item.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.image}
                            alt=""
                            className="w-14 h-14 rounded-lg object-cover border border-stoniz-gray-200 bg-white"
                            // Image IA pas encore déposée → on cache, l'emoji reste
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <span className={`${item.image ? 'absolute -bottom-1.5 -right-1.5 text-lg drop-shadow' : 'text-3xl leading-none'}`}>
                          {item.emoji ?? '📸'}
                        </span>
                        {done && (
                          <span className="absolute -top-2 -right-2 bg-emerald-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm shadow">
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium flex items-center gap-1.5">
                          {done
                            ? <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                            : <Circle className="w-4 h-4 text-stoniz-gray-400 flex-shrink-0" />}
                          {item.displayLabel}
                        </div>
                        {item.hint && (
                          <div className="text-[11px] text-stoniz-gray-500">{item.hint}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-[11px] text-stoniz-gray-500 flex-shrink-0">
                      {itemProofs.length} photo{itemProofs.length > 1 ? 's' : ''}
                    </div>
                  </div>
                  <CleaningProofUploader
                    cleaningId={cleaningId}
                    proofs={itemProofs}
                    uploaderNames={uploaderNames}
                    canUpload={canUpload}
                    canDelete={canDelete}
                    section={isEquipment ? 'equipment' : 'checklist'}
                    checklistItemKey={item.expandedKey}
                    compact
                    title={undefined}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
