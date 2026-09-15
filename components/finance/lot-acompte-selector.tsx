'use client';

import { useEffect, useMemo, useState } from 'react';
import { Check, Clock, FileText, Sparkles, Plus, Landmark, AlertCircle } from 'lucide-react';
import { fetchProjectAcomptes, type Lot } from '@/app/actions/project-acomptes';

/**
 * Sélecteur unifié lot + acompte pour l'allocation banque (CEO 2026-06-16).
 *
 * Affiche tous les lots du projet avec leurs acomptes pending + payés non
 * rapprochés. Le user peut :
 *   - cliquer un acompte précis → rattachement (UPDATE de l'acompte existant)
 *   - cocher "Créer un nouvel acompte" → création (le serveur gère le lot
 *     via garde-fou anti-orphelin)
 *
 * Émet via hidden inputs : `existing_acompte_id` OU rien (cas création — le
 * serveur trouvera/créera le lot pour ce bénéficiaire).
 *
 * Utilisé par :
 *   - QuickAllocateButton (popover ⚡)
 *   - AllocationForm (page détail transaction)
 */

function fmtMad(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function cleanName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function LotAcompteSelector({
  projectId,
  kind,
  transactionAmount,
  beneficiary,
  /** Nom du hidden input à émettre pour le lot (travaux_lot_id ou achats_lot_id) */
  lotInputName,
}: {
  projectId: string;
  kind: 'travaux' | 'achats';
  /** Montant restant de la transaction (pour matching) */
  transactionAmount: number;
  /** Bénéficiaire de la transaction (pour matching artisan) */
  beneficiary: string | null;
  lotInputName: 'travaux_lot_id' | 'achats_lot_id';
}) {
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosenAcompteId, setChosenAcompteId] = useState<string | null>(null);
  const [createNew, setCreateNew] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setLots(null);
      setChosenAcompteId(null);
      setCreateNew(false);
      return;
    }
    setLoading(true);
    setChosenAcompteId(null);
    setCreateNew(false);
    fetchProjectAcomptes(projectId, kind, transactionAmount, beneficiary ?? undefined)
      .then((r) => {
        setLots(r.lots);
        for (const l of r.lots) {
          const best = l.pending_acomptes.find((a) => a.is_best_match);
          if (best) { setChosenAcompteId(best.id); break; }
        }
        if (!chosenAcompteId) {
          for (const l of r.lots) {
            const bestPaid = l.paid_acomptes.find((a) => a.is_best_match && !a.is_fully_bank_allocated);
            if (bestPaid) { setChosenAcompteId(bestPaid.id); break; }
          }
        }
      })
      .catch((e) => setError(e?.message ?? 'Erreur de chargement des lots'))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, kind, transactionAmount, beneficiary]);

  const hasLikelyMatch = useMemo(() => {
    if (!lots) return false;
    return lots.some((l) => [...l.pending_acomptes, ...l.paid_acomptes].some((a) => (a.match_score ?? 0) >= 0.5));
  }, [lots]);

  // Tri lots : ceux qui ont le bénéficiaire en haut
  const lotsSorted = useMemo(() => {
    if (!lots) return [];
    const benef = (beneficiary || '').toLowerCase();
    return [...lots].sort((a, b) => {
      const aMatch = benef && cleanName(a.partner_name).includes(benef);
      const bMatch = benef && cleanName(b.partner_name).includes(benef);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return a.numero - b.numero;
    });
  }, [lots, beneficiary]);

  return (
    <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-stoniz-gray-700">
          Choisir l'acompte à rattacher
        </label>
        {hasLikelyMatch && (
          <span className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5">
            <Sparkles className="w-3 h-3" />
            Suggestion auto disponible
          </span>
        )}
      </div>

      {/* Hidden inputs pour le formulaire parent */}
      {chosenAcompteId && (
        <input type="hidden" name="existing_acompte_id" value={chosenAcompteId} />
      )}

      {loading && (
        <div className="text-xs text-stoniz-gray-500 py-3 text-center">Chargement des lots…</div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-xs text-red-800">{error}</div>
      )}

      {!loading && lots && lots.length === 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
          Aucun lot {kind} sur ce projet — un lot sera créé automatiquement à l'allocation.
        </div>
      )}

      {!loading && lots && lots.length > 0 && (
        <div className="max-h-[360px] overflow-y-auto bg-white border border-stoniz-gray-200 rounded divide-y divide-stoniz-gray-100">
          {lotsSorted.map((lot) => {
            const reste = Math.max(0, lot.devis_total - lot.total_paye);
            return (
              <div key={lot.id}>
                <div className="px-3 py-1.5 text-[11px] text-stoniz-gray-700 flex items-center justify-between bg-stoniz-gray-50 border-b border-stoniz-gray-100">
                  <span className="font-medium truncate">
                    Lot {lot.numero} · {lot.category} · <span className="text-stoniz-gray-500">{lot.partner_name}</span>
                  </span>
                  <span className="text-[10px] text-stoniz-gray-500 shrink-0 ml-2">
                    Reste {fmtMad(reste)} / {fmtMad(lot.devis_total)}
                  </span>
                </div>

                {lot.pending_acomptes.length === 0 && lot.paid_acomptes.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-stoniz-gray-400 italic">
                    Aucun acompte sur ce lot
                  </div>
                )}

                {/* Acomptes pending */}
                {lot.pending_acomptes.map((a) => {
                  const selected = chosenAcompteId === a.id;
                  const isBest = !!a.is_best_match;
                  const score = a.match_score ?? 0;
                  return (
                    <button
                      type="button"
                      key={a.id}
                      onClick={() => { setChosenAcompteId(a.id); setCreateNew(false); }}
                      className={`w-full text-left px-3 py-2 hover:bg-indigo-50/40 flex items-center gap-2 ${
                        selected ? 'bg-indigo-50' : isBest ? 'bg-emerald-50/50' : 'bg-white'
                      }`}
                    >
                      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                        selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stoniz-gray-300'
                      }`}>
                        {selected && <Check className="w-2.5 h-2.5" />}
                      </span>
                      <span className="flex-1 min-w-0 text-[12px]">
                        <span className="font-medium">Acompte {a.acompte_number ?? '?'}</span>
                        <span className="ml-1.5 font-mono">{fmtMad(a.amount_total)}</span>
                        {a.scheduled_date && (
                          <span className="ml-1.5 text-[10px] text-stoniz-gray-500 inline-flex items-center gap-0.5">
                            <Clock className="w-2.5 h-2.5" /> {fmtDate(a.scheduled_date)}
                          </span>
                        )}
                        {a.notes && (
                          <span className="block text-[10px] text-stoniz-gray-500 truncate">{a.notes}</span>
                        )}
                      </span>
                      {isBest && (
                        <span className="text-[9px] uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded shrink-0 font-semibold inline-flex items-center gap-0.5">
                          <Sparkles className="w-2.5 h-2.5" /> Match
                        </span>
                      )}
                      {!isBest && score >= 0.5 && (
                        <span className="text-[9px] uppercase tracking-wider text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded shrink-0">
                          Proche
                        </span>
                      )}
                      <span className="text-[9px] uppercase tracking-wider text-orange-700 bg-orange-50 px-1 py-0.5 rounded shrink-0">
                        Planifié
                      </span>
                    </button>
                  );
                })}

                {/* Acomptes déjà payés */}
                {lot.paid_acomptes.length > 0 && (
                  <details className="text-[10px]" open={lot.paid_acomptes.some((a) => !a.is_fully_bank_allocated)}>
                    <summary className="px-3 py-1 text-stoniz-gray-500 cursor-pointer hover:text-stoniz-black">
                      {lot.paid_acomptes.length} acompte{lot.paid_acomptes.length > 1 ? 's' : ''} déjà payé{lot.paid_acomptes.length > 1 ? 's' : ''}
                      {lot.paid_acomptes.some((a) => !a.is_fully_bank_allocated) && (
                        <span className="ml-1.5 text-amber-700">
                          · {lot.paid_acomptes.filter((a) => !a.is_fully_bank_allocated).length} à rapprocher
                        </span>
                      )}
                    </summary>
                    {lot.paid_acomptes.map((a) => {
                      if (a.is_fully_bank_allocated) {
                        return (
                          <div key={a.id} className="px-3 py-1.5 flex items-center gap-2 text-stoniz-gray-400 bg-stoniz-gray-50/40">
                            <FileText className="w-2.5 h-2.5" />
                            <span className="flex-1">
                              Acompte {a.acompte_number ?? '?'} · {fmtMad(a.amount_paid)} payé {fmtDate(a.paid_at)}
                            </span>
                            <span className="text-[9px] uppercase tracking-wider text-emerald-700 bg-emerald-50 px-1 py-0.5 rounded">
                              Totalement rapproché
                            </span>
                          </div>
                        );
                      }
                      const selected = chosenAcompteId === a.id;
                      const partiallyReconciled = (a.bank_allocated_total ?? 0) > 0;
                      return (
                        <button
                          type="button"
                          key={a.id}
                          onClick={() => { setChosenAcompteId(a.id); setCreateNew(false); }}
                          className={`w-full text-left px-3 py-2 hover:bg-indigo-50/40 flex items-center gap-2 ${
                            selected ? 'bg-indigo-50' : 'bg-white'
                          }`}
                        >
                          <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                            selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stoniz-gray-300'
                          }`}>
                            {selected && <Check className="w-2.5 h-2.5" />}
                          </span>
                          <span className="flex-1 min-w-0 text-[11px]">
                            <span className="font-medium">Acompte {a.acompte_number ?? '?'}</span>
                            <span className="ml-1.5 font-mono">{fmtMad(a.amount_paid)}</span>
                            <span className="ml-1.5 text-[10px] text-stoniz-gray-500">
                              payé {fmtDate(a.paid_at)}
                            </span>
                            {partiallyReconciled && (
                              <span className="block text-[10px] text-amber-700">
                                Banque : {fmtMad(a.bank_allocated_total ?? 0)} / {fmtMad(a.amount_total)} · reste {fmtMad(a.bank_remaining ?? 0)} à rapprocher
                              </span>
                            )}
                          </span>
                          <span className="text-[9px] uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shrink-0 font-semibold inline-flex items-center gap-0.5">
                            <Landmark className="w-2.5 h-2.5" /> {partiallyReconciled ? 'Compléter rapprochement' : 'À rapprocher'}
                          </span>
                        </button>
                      );
                    })}
                  </details>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Toggle créer nouveau */}
      {!loading && lots && (
        <label className={`mt-1 flex items-center gap-2 text-xs cursor-pointer ${
          hasLikelyMatch && createNew ? 'text-red-700' : 'text-stoniz-gray-700'
        }`}>
          <input
            type="checkbox"
            checked={createNew}
            onChange={(e) => {
              setCreateNew(e.target.checked);
              if (e.target.checked) setChosenAcompteId(null);
            }}
            className="w-3.5 h-3.5"
          />
          <span className="inline-flex items-center gap-1">
            <Plus className="w-3 h-3" />
            Créer un nouvel acompte (au lieu de rattacher à un existant)
          </span>
        </label>
      )}
      {hasLikelyMatch && createNew && (
        <div className="bg-red-50 border border-red-200 rounded p-2 text-[11px] text-red-800 flex items-start gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>
            Au moins un acompte planifié correspond au montant de cette transaction.
            Créer un nouveau ferait un <strong>doublon</strong>. Choisis plutôt l'acompte avec le badge "Match".
          </span>
        </div>
      )}
      <input type="hidden" name={lotInputName} value="" />
    </div>
  );
}
