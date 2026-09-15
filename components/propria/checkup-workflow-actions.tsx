'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  startCheckupAction,
  submitCheckupAction,
  validateCheckupAction,
  cancelCheckupAction,
  reopenCheckupAction,
} from '@/app/(team)/propria/checkups/actions';
import { SessionExpiredBanner } from '@/components/auth/session-expired-banner';

export type CheckupProblemItem = {
  item_key: string;
  label: string;
  emoji: string;
  note: string | null;
};

/**
 * Boutons du workflow check-up (pattern CleaningWorkflowActions).
 * À la validation back-office : modale récapitulant les items en Problème.
 *
 * MULTI-CIBLE (chantier 2 marathon, CEO 2026-06-18) : pour chaque item Problème,
 * cocher indépendamment tâche + intervention + litige (n'importe quelle
 * combinaison). Le litige nécessite une réservation Hostaway récente.
 */
type LitigeType = 'caution'|'degats'|'frais_contestes'|'annulation_tardive'|'tapage'|'menage'|'autre';
type ItemSelection = {
  tache: boolean;
  intervention: boolean;
  litige: boolean;
  litigeType: LitigeType;
  litigeAmount: string; // input controlled
};

export function CheckupWorkflowActions({
  id,
  status,
  canValidate,
  isBackOffice,
  missingCount = 0,
  problemsMissingNote = 0,
  problemsMissingPhoto = 0,
  problemItems = [],
}: {
  id: string;
  status: string;
  canValidate: boolean;
  isBackOffice: boolean;
  /** Items de checklist non renseignés. */
  missingCount?: number;
  /** Items Problème sans note. */
  problemsMissingNote?: number;
  /** Items Problème sans photo. */
  problemsMissingPhoto?: number;
  /** Items en Problème (pour la modale de validation). */
  problemItems?: CheckupProblemItem[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [showValidate, setShowValidate] = useState(false);
  const [showSubmit, setShowSubmit] = useState(false);
  const [finalClassification, setFinalClassification] = useState<'A'|'B'|'C'|'D'>('B');
  const [finalSummary, setFinalSummary] = useState('');
  // Sélection multi-cible par item
  const [selection, setSelection] = useState<Record<string, ItemSelection>>(
    () => Object.fromEntries(problemItems.map((p) => [
      p.item_key,
      { tache: false, intervention: true, litige: false, litigeType: 'degats' as LitigeType, litigeAmount: '' },
    ])),
  );

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setErr(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r || !r.ok) {
          setErr(r?.error ?? 'Erreur inconnue');
          return;
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  function confirmValidate() {
    setErr(null);
    start(async () => {
      try {
        // Construit les creations multi-cibles à partir des cases cochées
        const creations: Array<{
          item_key: string;
          targets: {
            tache?: { description?: string; urgency?: 'critique'|'haute'|'normale'|'basse' };
            intervention?: { description?: string; urgency?: 'critique'|'haute'|'normale'|'basse' };
            litige?: { type: LitigeType; description?: string; amount?: number | null };
          };
        }> = [];
        for (const p of problemItems) {
          const sel = selection[p.item_key];
          if (!sel) continue;
          if (!sel.tache && !sel.intervention && !sel.litige) continue; // item ignoré
          const targets: (typeof creations)[number]['targets'] = {};
          if (sel.tache) targets.tache = {};
          if (sel.intervention) targets.intervention = {};
          if (sel.litige) {
            const amount = sel.litigeAmount.trim() ? Number(sel.litigeAmount.replace(',', '.')) : null;
            if (sel.litigeAmount.trim() && (!isFinite(amount as number) || (amount as number) <= 0)) {
              setErr(`Montant du litige invalide pour "${p.label}".`);
              return;
            }
            targets.litige = { type: sel.litigeType, amount };
          }
          creations.push({ item_key: p.item_key, targets });
        }
        const r = await validateCheckupAction({ checkup_id: id, creations });
        if (!r || !r.ok) { setErr(r?.error ?? 'Erreur inconnue'); return; }
        setShowValidate(false);
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : 'Erreur inconnue');
      }
    });
  }

  const submitBlockers: string[] = [];
  if (missingCount > 0) submitBlockers.push(`${missingCount} item(s) non renseigné(s)`);
  if (problemsMissingNote > 0) submitBlockers.push(`${problemsMissingNote} problème(s) sans note`);
  if (problemsMissingPhoto > 0) submitBlockers.push(`${problemsMissingPhoto} problème(s) sans photo`);
  const canSubmit = submitBlockers.length === 0;

  const btn = 'w-full sm:w-auto text-center px-4 py-2.5 sm:py-2 rounded-md text-sm disabled:opacity-50';

  return (
    <div className="flex w-full sm:w-auto flex-col items-stretch sm:items-end gap-2">
      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:justify-end">
        {status === 'a_faire' && (
          <button onClick={() => run(() => startCheckupAction(id))} disabled={pending}
            className={`${btn} bg-blue-600 text-white hover:bg-blue-700`}>
            Démarrer →
          </button>
        )}

        {status === 'en_cours' && (
          <>
            <button
              onClick={() => { setShowSubmit(true); setErr(null); }}
              disabled={pending || !canSubmit}
              title={canSubmit ? '' : submitBlockers.join(' · ')}
              className={`${btn} bg-amber-500 text-white hover:bg-amber-600`}
            >
              ✅ Soumettre →
            </button>
            {!canSubmit && (
              <span className="text-[11px] text-red-700 sm:text-right">
                {submitBlockers.join(' · ')}
              </span>
            )}
          </>
        )}

        {canValidate && status === 'a_valider' && (
          <>
            <button onClick={() => setShowValidate(true)} disabled={pending}
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}>
              ✓ Valider
            </button>
            <button onClick={() => run(() => reopenCheckupAction(id))} disabled={pending}
              className={`${btn} border border-stoniz-gray-300 hover:bg-stoniz-gray-50`}>
              ↩ Renvoyer au terrain
            </button>
          </>
        )}

        {isBackOffice && ['a_faire', 'en_cours', 'a_valider'].includes(status) && (
          <button onClick={() => run(() => cancelCheckupAction(id))} disabled={pending}
            className={`${btn} border border-stoniz-gray-300 hover:bg-stoniz-gray-50`}>
            Annuler
          </button>
        )}
      </div>

      {err && (
        <div className="max-w-md w-full">
          <SessionExpiredBanner error={err} />
        </div>
      )}

      {/* Modale de validation : transforme les problèmes cochés en tâches/interventions */}
      {showValidate && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowValidate(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 text-left max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl mb-2">✓ Valider le check-up</h2>

            {problemItems.length === 0 ? (
              <p className="text-sm text-stoniz-gray-700 mb-4">
                Aucun problème relevé — le check-up sera validé sans créer d&apos;action.
              </p>
            ) : (
              <>
                <p className="text-sm text-stoniz-gray-700 mb-3">
                  {problemItems.length} problème{problemItems.length > 1 ? 's' : ''} relevé{problemItems.length > 1 ? 's' : ''}.
                  Pour chacun, coche <strong>tâche</strong>, <strong>intervention</strong> et/ou{' '}
                  <strong>litige</strong> (combinaison libre). Tout pointe vers le check-up source.
                </p>
                <div className="space-y-3 mb-4">
                  {problemItems.map((p) => {
                    const sel = selection[p.item_key];
                    if (!sel) return null;
                    const active = sel.tache || sel.intervention || sel.litige;
                    const update = (patch: Partial<ItemSelection>) =>
                      setSelection((s) => ({ ...s, [p.item_key]: { ...sel, ...patch } }));
                    return (
                      <div key={p.item_key}
                        className={`border rounded-lg p-3 ${
                          active ? 'border-orange-300 bg-orange-50/40' : 'border-stoniz-gray-200'
                        }`}>
                        <div className="mb-2">
                          <div className="text-sm font-medium">{p.emoji} {p.label}</div>
                          {p.note && <div className="text-xs text-stoniz-gray-600 mt-0.5">{p.note}</div>}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <label className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-xs cursor-pointer ${
                            sel.tache ? 'border-amber-400 bg-amber-50 text-amber-900' : 'border-stoniz-gray-300 bg-white'
                          }`}>
                            <input type="checkbox" checked={sel.tache} onChange={(e) => update({ tache: e.target.checked })} />
                            📌 Tâche
                          </label>
                          <label className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-xs cursor-pointer ${
                            sel.intervention ? 'border-blue-400 bg-blue-50 text-blue-900' : 'border-stoniz-gray-300 bg-white'
                          }`}>
                            <input type="checkbox" checked={sel.intervention} onChange={(e) => update({ intervention: e.target.checked })} />
                            🔧 Intervention
                          </label>
                          <label className={`flex items-center gap-1.5 px-2.5 py-2 rounded-md border text-xs cursor-pointer ${
                            sel.litige ? 'border-red-400 bg-red-50 text-red-900' : 'border-stoniz-gray-300 bg-white'
                          }`}>
                            <input type="checkbox" checked={sel.litige} onChange={(e) => update({ litige: e.target.checked })} />
                            ⚖️ Litige
                          </label>
                        </div>
                        {sel.litige && (
                          <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <select
                              value={sel.litigeType}
                              onChange={(e) => update({ litigeType: e.target.value as LitigeType })}
                              className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs"
                            >
                              <option value="caution">Caution</option>
                              <option value="degats">Dégâts</option>
                              <option value="frais_contestes">Frais contestés</option>
                              <option value="annulation_tardive">Annulation tardive</option>
                              <option value="tapage">Tapage</option>
                              <option value="menage">Ménage</option>
                              <option value="autre">Autre</option>
                            </select>
                            <input
                              type="text" inputMode="decimal"
                              value={sel.litigeAmount}
                              onChange={(e) => update({ litigeAmount: e.target.value })}
                              placeholder="Montant réclamé (MAD, optionnel)"
                              className="border border-stoniz-gray-300 rounded-md px-2 py-1.5 text-xs"
                            />
                            <div className="sm:col-span-2 text-[10px] text-red-700">
                              ⚠ Litige possible uniquement si une réservation Hostaway récente (&lt; 30j) existe sur le lot.
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {err && (
              <div className="mb-3">
                <SessionExpiredBanner error={err} />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowValidate(false)} disabled={pending}
                className="px-4 py-2 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50">
                Annuler
              </button>
              <button onClick={confirmValidate} disabled={pending}
                className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm hover:bg-emerald-700">
                {pending ? 'Validation…' : 'Valider le check-up'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modale soumission : classification A/B/C/D + résumé exécutif (chantier 4) */}
      {showSubmit && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setShowSubmit(false)}>
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 text-left max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl mb-1">📋 Soumettre le check-up</h2>
            <p className="text-xs text-stoniz-gray-500 mb-4">
              Classification du logement + résumé exécutif requis avant envoi en validation.
            </p>

            <label className="block text-xs font-medium mb-1.5">Classification *</label>
            <div className="grid grid-cols-4 gap-2 mb-4">
              {([
                ['A', 'Parfait', 'bg-emerald-100 border-emerald-400 text-emerald-900'],
                ['B', 'Retouches', 'bg-amber-100 border-amber-400 text-amber-900'],
                ['C', 'Travaux', 'bg-orange-100 border-orange-400 text-orange-900'],
                ['D', 'Bloquant', 'bg-red-100 border-red-400 text-red-900'],
              ] as const).map(([letter, label, palette]) => (
                <button key={letter} type="button"
                  onClick={() => setFinalClassification(letter)}
                  className={`px-2 py-3 rounded-md border-2 text-center transition-colors ${
                    finalClassification === letter ? palette : 'bg-white border-stoniz-gray-200 hover:bg-stoniz-gray-50'
                  }`}>
                  <div className="text-2xl font-display">{letter}</div>
                  <div className="text-[10px] uppercase">{label}</div>
                </button>
              ))}
            </div>

            <label className="block text-xs font-medium mb-1.5">Résumé exécutif *</label>
            <textarea
              value={finalSummary}
              onChange={(e) => setFinalSummary(e.target.value)}
              rows={4}
              placeholder="Ex : Logement globalement exploitable. Problèmes principaux : sécurité électrique salle de bain, inventaire cuisine incomplet, stores défectueux. Remise à niveau recommandée."
              className="w-full border border-stoniz-gray-300 rounded-md px-3 py-2 text-sm mb-3"
            />
            <p className="text-[11px] text-stoniz-gray-500 mb-3">
              {finalSummary.trim().length} caractères {finalSummary.trim().length < 10 && <span className="text-red-600">(min 10)</span>}
            </p>

            {err && (
              <div className="mb-3">
                <SessionExpiredBanner error={err} />
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowSubmit(false)} disabled={pending}
                className="px-4 py-2 rounded-md text-sm border border-stoniz-gray-300 hover:bg-stoniz-gray-50">
                Annuler
              </button>
              <button
                onClick={() => {
                  setErr(null);
                  start(async () => {
                    try {
                      const r = await submitCheckupAction({ id, final_classification: finalClassification, final_summary: finalSummary });
                      if (!r || !r.ok) { setErr(r?.error ?? 'Erreur inconnue'); return; }
                      setShowSubmit(false);
                      router.refresh();
                    } catch (e) {
                      setErr(e instanceof Error ? e.message : 'Erreur inconnue');
                    }
                  });
                }}
                disabled={pending || finalSummary.trim().length < 10}
                className="bg-amber-500 text-white px-4 py-2 rounded-md text-sm hover:bg-amber-600 disabled:opacity-50">
                {pending ? 'Envoi…' : 'Soumettre →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
