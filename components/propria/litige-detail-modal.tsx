'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  X, Plus, Trash2, FileText, Camera, Wrench, ClipboardList,
  Sparkles, ExternalLink, AlertCircle,
} from 'lucide-react';
import {
  addLitigeItemAction,
  deleteLitigeItemAction,
  getLitigeItemsAction,
  setLitigeAircoverRefAction,
  getLastCleaningProofsForLitigeAction,
  createInterventionFromLitigeAction,
  type LitigeItemWithUrls,
} from '@/app/(team)/propria/litiges/actions';
import { CommentsThread } from '@/components/propria/comments-thread';

type Profile = { id: string; full_name: string | null };

function fmtMad(n: number): string {
  return Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

/**
 * Détail d'un litige (chantier 6 marathon U11) :
 * - lignes multi-éléments (décision B4) avec facture + photos par ligne,
 * - totaux dérivés (coût réel / demandé / marge),
 * - N° dossier AirCover,
 * - photos du dernier ménage du lot (lecture seule),
 * - fil de commentaires partagé (décision B5),
 * - boutons « Créer tâche » / « Créer intervention ».
 */
export function LitigeDetailModal({
  litigeId,
  title,
  subtitle,
  aircoverReference,
  profiles,
  canDeleteComments,
  onClose,
}: {
  litigeId: string;
  title: string;
  subtitle: string;
  aircoverReference: string | null;
  profiles: Profile[];
  canDeleteComments: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  // Lignes
  const [items, setItems] = useState<LitigeItemWithUrls[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  // AirCover
  const [aircover, setAircover] = useState(aircoverReference ?? '');

  // Photos dernier ménage (chargées à la demande)
  const [cleaningProofs, setCleaningProofs] = useState<
    | null
    | { cleaning: { id: string; occurred_at: string; status: string }; proofs: { id: string; signedUrl: string | null; mimeType: string }[] }
    | { error: string }
  >(null);
  const [loadingProofs, setLoadingProofs] = useState(false);

  // Tâche / intervention créée
  const [createdLink, setCreatedLink] = useState<string | null>(null);

  async function reloadItems() {
    const r = await getLitigeItemsAction(litigeId);
    if (r.ok) setItems(r.items);
    else setErr(r.error);
    setLoadingItems(false);
  }

  useEffect(() => {
    reloadItems();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [litigeId]);

  const totalCost = items.reduce((s, i) => s + (i.cost_real_mad ?? 0), 0);
  const totalClaimed = items.reduce((s, i) => s + (i.amount_claimed_mad ?? 0), 0);
  const marge = totalClaimed - totalCost;

  function addItem(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fd.set('litige_id', litigeId);
    setErr(null);
    start(async () => {
      const r = await addLitigeItemAction(fd)
        .catch((ex: any) => ({ ok: false as const, error: ex?.message ?? 'Erreur' }));
      if (!r.ok) { setErr(r.error); return; }
      formRef.current?.reset();
      await reloadItems();
      router.refresh();
    });
  }

  function deleteItem(itemId: string) {
    start(async () => {
      const r = await deleteLitigeItemAction({ item_id: itemId });
      if (!r.ok) { setErr(r.error); return; }
      await reloadItems();
      router.refresh();
    });
  }

  function saveAircover() {
    start(async () => {
      const r = await setLitigeAircoverRefAction({ litige_id: litigeId, aircover_reference: aircover || null });
      if (!r.ok) setErr(r.error);
      else router.refresh();
    });
  }

  function loadCleaningProofs() {
    setLoadingProofs(true);
    start(async () => {
      const r = await getLastCleaningProofsForLitigeAction(litigeId);
      setCleaningProofs(r.ok ? { cleaning: r.cleaning, proofs: r.proofs } : { error: r.error });
      setLoadingProofs(false);
    });
  }

  function createFrom(kind: 'tache' | 'intervention') {
    setErr(null);
    start(async () => {
      const r = await createInterventionFromLitigeAction({ litige_id: litigeId, kind });
      if (!r.ok) { setErr(r.error); return; }
      setCreatedLink(`/propria/interventions/${r.id}`);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-stoniz-gray-200 px-5 py-3 flex items-center justify-between z-10">
          <div>
            <div className="text-base font-medium">{title}</div>
            <div className="text-[11px] text-stoniz-gray-500">{subtitle}</div>
          </div>
          <button type="button" onClick={onClose} className="text-stoniz-gray-500 hover:text-stoniz-black">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* N° dossier AirCover */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="text-[11px] font-medium text-stoniz-gray-700 mb-1 block">
                N° dossier AirCover
              </label>
              <input value={aircover} onChange={(e) => setAircover(e.target.value)}
                placeholder="Ex : 1234567890"
                className="w-full border border-stoniz-gray-300 rounded px-2 py-1.5 text-xs" />
            </div>
            <button type="button" onClick={saveAircover} disabled={pending}
              className="bg-stoniz-black text-white px-3 py-1.5 rounded text-[11px] disabled:opacity-50">
              Enregistrer
            </button>
          </div>

          {/* Lignes du litige */}
          <div>
            <div className="text-xs font-medium mb-2">Éléments du litige (tout en MAD)</div>
            {loadingItems ? (
              <div className="text-[11px] text-stoniz-gray-400">Chargement…</div>
            ) : items.length === 0 ? (
              <div className="text-[11px] text-stoniz-gray-400 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-3">
                Aucune ligne — ajoute le premier élément ci-dessous (ex : table cassée, TV disparue…).
              </div>
            ) : (
              <table className="w-full text-[11px]">
                <thead className="text-stoniz-gray-600 uppercase text-[9px]">
                  <tr>
                    <th className="text-left py-1">Élément</th>
                    <th className="text-right py-1">Coût réel</th>
                    <th className="text-right py-1">Demandé</th>
                    <th className="text-center py-1">Pièces</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-stoniz-gray-100">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className="py-1.5 pr-2">{i.description}</td>
                      <td className="text-right whitespace-nowrap">{i.cost_real_mad != null ? fmtMad(i.cost_real_mad) : '—'}</td>
                      <td className="text-right whitespace-nowrap">{i.amount_claimed_mad != null ? fmtMad(i.amount_claimed_mad) : '—'}</td>
                      <td className="text-center">
                        <span className="inline-flex items-center gap-1.5">
                          {i.invoiceUrl && (
                            <a href={i.invoiceUrl} target="_blank" rel="noreferrer" title="Facture"
                              className="text-blue-600 hover:text-blue-800">
                              <FileText className="w-3 h-3" />
                            </a>
                          )}
                          {i.photoUrls.map((u, idx) => (
                            <a key={idx} href={u} target="_blank" rel="noreferrer" title={`Photo ${idx + 1}`}
                              className="text-stoniz-gray-600 hover:text-stoniz-black">
                              <Camera className="w-3 h-3" />
                            </a>
                          ))}
                          {!i.invoiceUrl && i.photoUrls.length === 0 && <span className="text-stoniz-gray-300">—</span>}
                        </span>
                      </td>
                      <td className="text-right">
                        <button type="button" onClick={() => deleteItem(i.id)} disabled={pending}
                          title="Supprimer la ligne" className="text-stoniz-gray-400 hover:text-red-600">
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-stoniz-gray-200 font-medium">
                    <td className="py-1.5">Total</td>
                    <td className="text-right whitespace-nowrap">{fmtMad(totalCost)}</td>
                    <td className="text-right whitespace-nowrap">{fmtMad(totalClaimed)}</td>
                    <td colSpan={2} />
                  </tr>
                  <tr>
                    <td className="py-1 text-[10px] text-stoniz-gray-500">Marge (demandé − coût)</td>
                    <td colSpan={2}
                      className={`text-right font-medium whitespace-nowrap ${marge >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                      {marge >= 0 ? '+' : ''}{fmtMad(marge)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            )}

            {/* Ajout d'une ligne */}
            <form ref={formRef} onSubmit={addItem}
              className="mt-3 bg-stoniz-beige border border-stoniz-gray-200 rounded p-3 space-y-2">
              <div className="text-[10px] font-medium inline-flex items-center gap-1">
                <Plus className="w-3 h-3" /> Ajouter un élément
              </div>
              <input name="description" required placeholder="Description (ex : table basse cassée) *"
                className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]" />
              <div className="grid grid-cols-2 gap-2">
                <input name="cost_real_mad" type="number" step="0.01" min="0"
                  placeholder="Coût réel Stoniz (MAD)"
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]" />
                <input name="amount_claimed_mad" type="number" step="0.01" min="0"
                  placeholder="Montant demandé (MAD)"
                  className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-[11px]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[9px] text-stoniz-gray-500 block">Facture (PDF/image)</label>
                  <input name="invoice" type="file" accept="application/pdf,image/*" className="w-full text-[10px]" />
                </div>
                <div>
                  <label className="text-[9px] text-stoniz-gray-500 block">Photos (multiple)</label>
                  <input name="photos" type="file" accept="image/*" multiple className="w-full text-[10px]" />
                </div>
              </div>
              <button type="submit" disabled={pending}
                className="bg-stoniz-black text-white px-3 py-1 rounded text-[10px] disabled:opacity-50">
                {pending ? 'Ajout…' : 'Ajouter la ligne'}
              </button>
            </form>
          </div>

          {/* Créer tâche / intervention */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium">Suites opérationnelles</div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => createFrom('tache')} disabled={pending}
                className="bg-stoniz-gray-100 border border-stoniz-gray-300 px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-stoniz-gray-200 disabled:opacity-50">
                <ClipboardList className="w-3 h-3" /> Créer une tâche
              </button>
              <button type="button" onClick={() => createFrom('intervention')} disabled={pending}
                className="bg-stoniz-gray-100 border border-stoniz-gray-300 px-3 py-1.5 rounded text-[11px] inline-flex items-center gap-1 hover:bg-stoniz-gray-200 disabled:opacity-50">
                <Wrench className="w-3 h-3" /> Créer une intervention
              </button>
            </div>
            {createdLink && (
              <div className="text-[11px] text-emerald-700">
                ✓ Créée —{' '}
                <Link href={createdLink} className="underline inline-flex items-center gap-0.5">
                  ouvrir <ExternalLink className="w-2.5 h-2.5" />
                </Link>
              </div>
            )}
          </div>

          {/* Photos du dernier ménage */}
          <div className="space-y-1.5">
            <div className="text-xs font-medium inline-flex items-center gap-1">
              <Sparkles className="w-3 h-3" /> Photos du dernier ménage
            </div>
            {cleaningProofs == null ? (
              <button type="button" onClick={loadCleaningProofs} disabled={loadingProofs}
                className="bg-stoniz-gray-100 border border-stoniz-gray-300 px-3 py-1.5 rounded text-[11px] hover:bg-stoniz-gray-200 disabled:opacity-50">
                {loadingProofs ? 'Chargement…' : 'Afficher les preuves du dernier ménage du lot'}
              </button>
            ) : 'error' in cleaningProofs ? (
              <div className="text-[11px] text-stoniz-gray-500">{cleaningProofs.error}</div>
            ) : (
              <div className="space-y-2">
                <div className="text-[10px] text-stoniz-gray-500">
                  Ménage du {cleaningProofs.cleaning.occurred_at || '—'} ({cleaningProofs.cleaning.status}) —{' '}
                  <Link href={`/propria/menage/${cleaningProofs.cleaning.id}`}
                    className="text-blue-600 underline inline-flex items-center gap-0.5">
                    ouvrir le ménage <ExternalLink className="w-2.5 h-2.5" />
                  </Link>
                </div>
                {cleaningProofs.proofs.length === 0 ? (
                  <div className="text-[11px] text-stoniz-gray-400">Aucune preuve sur ce ménage.</div>
                ) : (
                  <div className="grid grid-cols-4 sm:grid-cols-6 gap-2">
                    {cleaningProofs.proofs.map((p) => (
                      p.signedUrl ? (
                        p.mimeType.startsWith('image/') ? (
                          <a key={p.id} href={p.signedUrl} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.signedUrl} alt="Preuve ménage"
                              className="w-full h-16 object-cover rounded border border-stoniz-gray-200" />
                          </a>
                        ) : (
                          <a key={p.id} href={p.signedUrl} target="_blank" rel="noreferrer"
                            className="w-full h-16 rounded border border-stoniz-gray-200 flex items-center justify-center text-[9px] text-stoniz-gray-500 bg-stoniz-gray-50">
                            {p.mimeType.split('/')[0]}
                          </a>
                        )
                      ) : null
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Commentaires partagés (décision B5) */}
          <div className="border-t border-stoniz-gray-100 pt-3">
            <CommentsThread entityType="litige" entityId={litigeId}
              profiles={profiles} canDelete={canDeleteComments} />
          </div>

          {err && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 flex items-start gap-2">
              <AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />
              {err}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
