'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Zap, X, Sparkles, AlertCircle, Search, Check, Plus, Clock, FileText, Landmark } from 'lucide-react';
import { fetchQuickAllocateContext, type QuickAllocateContext } from '@/app/actions/quick-allocate';
import { fetchProjectAcomptes, type Lot } from '@/app/actions/project-acomptes';
import { allocateTransactionAction } from '@/app/(team)/finance/tresorerie/transactions/actions';

/**
 * Allocation rapide inline (CEO 2026-06-16, v2).
 *
 * Flow :
 *   1. Bouton ⚡ → popover
 *   2. Suggestion auto (type + projet) basée sur l'apprentissage
 *   3. Si type ∈ {travaux, achats} + projet sélectionné → on charge les lots
 *      du projet avec leurs acomptes pending. L'utilisateur clique sur
 *      l'acompte exact à rattacher (UPDATE) OU sur "Créer un nouvel acompte"
 *      (le serveur applique alors le garde-fou anti-orphelin pour le lot).
 *   4. Si type autre → simple allocation cabinet/propria sans lot.
 *
 * Résout le piège "5e acompte créé au lieu de matcher le 1er pending".
 */

const TYPE_OPTIONS: Array<{ v: string; label: string; needsProject: boolean; hasLots: boolean }> = [
  { v: 'travaux',          label: 'Travaux (projet)',         needsProject: true,  hasLots: true  },
  { v: 'achats',           label: 'Achats (projet)',          needsProject: true,  hasLots: true  },
  { v: 'services',         label: 'Services (projet)',        needsProject: true,  hasLots: false },
  { v: 'honoraires',       label: 'Honoraires Stoniz',        needsProject: true,  hasLots: false },
  { v: 'propria',          label: 'Propria',                  needsProject: false, hasLots: false },
  { v: 'cabinet_charge',   label: 'Cabinet · charges',        needsProject: false, hasLots: false },
  { v: 'cabinet_fiscal',   label: 'Cabinet · fiscal',         needsProject: false, hasLots: false },
  { v: 'cabinet_social',   label: 'Cabinet · social',         needsProject: false, hasLots: false },
  { v: 'frais_bancaire',   label: 'Frais bancaire',           needsProject: false, hasLots: false },
  { v: 'intercompany',     label: 'Intercompany',             needsProject: false, hasLots: false },
  { v: 'autre',            label: 'Autre / À qualifier',      needsProject: false, hasLots: false },
];

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

export function QuickAllocateButton({
  transactionId,
  compact = false,
}: {
  transactionId: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<QuickAllocateContext | null>(null);
  const [pending, start] = useTransition();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');
  const [projectSearch, setProjectSearch] = useState('');
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [loadingLots, setLoadingLots] = useState(false);
  const [chosenAcompteId, setChosenAcompteId] = useState<string | null>(null);
  const [createNew, setCreateNew] = useState(false);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Charge le contexte à l'ouverture
  useEffect(() => {
    if (!open || ctx) return;
    setLoading(true);
    fetchQuickAllocateContext(transactionId)
      .then((c) => {
        setCtx(c);
        if (c.suggestion.allocation_type) setType(c.suggestion.allocation_type);
        if (c.suggestion.project_id) setProjectId(c.suggestion.project_id);
        setAmount(c.transaction.remaining.toFixed(2));
      })
      .catch((e) => setError(e?.message ?? 'Erreur de chargement'))
      .finally(() => setLoading(false));
  }, [open, transactionId, ctx]);

  // Charge les lots+acomptes quand projet + type travaux/achats sélectionnés
  const typeOpt = TYPE_OPTIONS.find((t) => t.v === type);
  const hasLots = typeOpt?.hasLots ?? false;
  const needsProject = typeOpt?.needsProject ?? false;

  useEffect(() => {
    if (!projectId || !hasLots || !ctx) {
      setLots(null);
      setChosenAcompteId(null);
      setCreateNew(false);
      return;
    }
    setLoadingLots(true);
    setChosenAcompteId(null);
    setCreateNew(false);
    fetchProjectAcomptes(
      projectId,
      type as 'travaux' | 'achats',
      ctx.transaction.remaining,
      ctx.transaction.beneficiary ?? undefined,
    )
      .then((r) => {
        setLots(r.lots);
        // Auto-sélectionne le meilleur match (CEO 2026-06-16) pour éviter
        // la création d'un doublon par inattention.
        for (const l of r.lots) {
          const best = l.pending_acomptes.find((a) => a.is_best_match);
          if (best) {
            setChosenAcompteId(best.id);
            break;
          }
        }
      })
      .catch((e) => setError(e?.message ?? 'Erreur de chargement des lots'))
      .finally(() => setLoadingLots(false));
  }, [projectId, hasLots, type, ctx]);

  // Y a-t-il au moins un acompte pending qui pourrait matcher la transaction ?
  const hasLikelyMatch = useMemo(() => {
    if (!lots) return false;
    return lots.some((l) => l.pending_acomptes.some((a) => (a.match_score ?? 0) >= 0.5));
  }, [lots]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filteredProjects = useMemo(() => {
    if (!ctx) return [];
    const q = projectSearch.trim().toLowerCase();
    if (!q) return ctx.projects.slice(0, 30);
    return ctx.projects
      .filter(
        (p) =>
          p.reference.toLowerCase().includes(q) ||
          p.client.toLowerCase().includes(q),
      )
      .slice(0, 30);
  }, [ctx, projectSearch]);

  // Lots avec leurs candidats acomptes — on suggère ceux qui matchent
  // le bénéficiaire de la transaction en haut.
  const lotsSorted = useMemo(() => {
    if (!lots || !ctx) return [];
    const txBenef = ctx.transaction.beneficiary ? cleanName(ctx.transaction.beneficiary) : '';
    return [...lots].sort((a, b) => {
      const aMatch = txBenef && cleanName(a.partner_name).includes(txBenef);
      const bMatch = txBenef && cleanName(b.partner_name).includes(txBenef);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return a.numero - b.numero;
    });
  }, [lots, ctx]);

  function submit() {
    if (!type) {
      setError('Choisis un type');
      return;
    }
    if (needsProject && !projectId) {
      setError('Choisis un projet');
      return;
    }
    if (hasLots && !chosenAcompteId && !createNew) {
      setError("Choisis un acompte à rattacher ou clique sur 'Créer un nouvel acompte'");
      return;
    }
    const n = Number(amount);
    if (!isFinite(n) || n <= 0) {
      setError('Montant invalide');
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set('transaction_id', transactionId);
    fd.set('allocation_type', type);
    fd.set('amount_mad', String(n));
    if (needsProject && projectId) fd.set('project_id', projectId);
    if (chosenAcompteId) fd.set('existing_acompte_id', chosenAcompteId);
    if (notes.trim()) fd.set('notes', notes.trim());
    fd.set('force_create', 'true');
    start(async () => {
      const r = await allocateTransactionAction(fd);
      if (!('ok' in r) || !r.ok) {
        setError((r as any).error ?? 'Erreur lors de l\'allocation');
        return;
      }
      setOpen(false);
      setCtx(null);
      setLots(null);
      setChosenAcompteId(null);
      setCreateNew(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setOpen(true);
        }}
        title="Allouer rapide"
        className={`inline-flex items-center gap-1 ${
          compact
            ? 'text-[10px] px-1.5 py-0.5 text-stoniz-gray-500 hover:text-stoniz-black'
            : 'text-xs px-2 py-1 text-indigo-700 hover:text-indigo-900 hover:bg-indigo-50 rounded'
        }`}
      >
        <Zap className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {!compact && <span>Allouer</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-start justify-center pt-16 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            ref={popoverRef}
            className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-stoniz-gray-200 flex items-center justify-between">
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-base inline-flex items-center gap-2">
                  <Zap className="w-4 h-4 text-indigo-700" />
                  Allocation rapide
                </h3>
                {ctx && (
                  <p className="text-[11px] text-stoniz-gray-500 mt-0.5 truncate">
                    {ctx.transaction.beneficiary ?? ctx.transaction.label} · {fmtMad(ctx.transaction.remaining)} restant
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-stoniz-gray-400 hover:text-stoniz-black p-1 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto">
              {loading && (
                <div className="text-center text-sm text-stoniz-gray-500 py-6">Chargement…</div>
              )}

              {ctx && (
                <>
                  {ctx.suggestion.allocation_type && (
                    <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-2.5 text-[11px] flex items-start gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-700 shrink-0 mt-0.5" />
                      <div className="text-indigo-900">
                        Suggestion :{' '}
                        <span className="font-medium">
                          {TYPE_OPTIONS.find((t) => t.v === ctx.suggestion.allocation_type)?.label}
                        </span>
                        {ctx.suggestion.project_id && (() => {
                          const p = ctx.projects.find((x) => x.id === ctx.suggestion.project_id);
                          return p ? <> · projet <span className="font-medium">{p.reference}</span></> : null;
                        })()}
                        {ctx.suggestion.source === 'learned' && (
                          <span className="text-stoniz-gray-500"> (mapping appris)</span>
                        )}
                        {ctx.suggestion.source === 'beneficiary_match' && (
                          <span className="text-stoniz-gray-500"> (bénéficiaire déjà alloué)</span>
                        )}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">
                      Type d'allocation
                    </label>
                    <select
                      value={type}
                      onChange={(e) => {
                        setType(e.target.value);
                        if (!TYPE_OPTIONS.find((t) => t.v === e.target.value)?.needsProject) {
                          setProjectId('');
                        }
                      }}
                      className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1.5 bg-white"
                    >
                      <option value="">— Choisir —</option>
                      {TYPE_OPTIONS.map((t) => (
                        <option key={t.v} value={t.v}>{t.label}</option>
                      ))}
                    </select>
                  </div>

                  {needsProject && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">
                        Projet
                      </label>
                      <div className="relative mb-1">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
                        <input
                          value={projectSearch}
                          onChange={(e) => setProjectSearch(e.target.value)}
                          placeholder="Rechercher par client ou référence…"
                          className="w-full text-sm border border-stoniz-gray-300 rounded pl-7 pr-2 py-1.5 bg-white"
                        />
                      </div>
                      <div className="max-h-[160px] overflow-y-auto border border-stoniz-gray-200 rounded">
                        {filteredProjects.length === 0 ? (
                          <div className="text-xs text-stoniz-gray-400 italic px-2 py-3 text-center">
                            Aucun projet ne correspond
                          </div>
                        ) : (
                          <ul className="divide-y divide-stoniz-gray-100">
                            {filteredProjects.map((p) => {
                              const selected = projectId === p.id;
                              return (
                                <li key={p.id}>
                                  <button
                                    type="button"
                                    onClick={() => setProjectId(p.id)}
                                    className={`w-full text-left px-2.5 py-1.5 hover:bg-stoniz-gray-50 flex items-center gap-2 ${
                                      selected ? 'bg-indigo-50' : ''
                                    }`}
                                  >
                                    <span
                                      className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                        selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stoniz-gray-300'
                                      }`}
                                    >
                                      {selected && <Check className="w-2.5 h-2.5" />}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                      <span className="block text-sm truncate">{p.client}</span>
                                      <span className="block text-[10px] text-stoniz-gray-500 truncate">
                                        {p.reference}
                                        {p.status !== 'actif' && (
                                          <span className="ml-1.5 text-amber-700">· {p.status}</span>
                                        )}
                                      </span>
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Sélection acompte (travaux/achats avec projet) */}
                  {hasLots && projectId && (
                    <div>
                      <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1.5">
                        Choisis l'acompte à rattacher
                      </label>
                      {loadingLots && (
                        <div className="text-xs text-stoniz-gray-500 py-3 text-center">Chargement des lots…</div>
                      )}
                      {!loadingLots && (!lots || lots.length === 0) && (
                        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2.5">
                          Aucun lot {type} sur ce projet. Un lot sera créé automatiquement à l'allocation.
                          <div className="mt-1 text-stoniz-gray-700">
                            → Coche "Créer un nouvel acompte" ci-dessous.
                          </div>
                        </div>
                      )}
                      {!loadingLots && lots && lots.length > 0 && (
                        <div className="max-h-[280px] overflow-y-auto border border-stoniz-gray-200 rounded divide-y divide-stoniz-gray-100">
                          {lotsSorted.map((lot) => {
                            const reste = Math.max(0, lot.devis_total - lot.total_paye);
                            return (
                              <div key={lot.id} className="bg-stoniz-gray-50/50">
                                <div className="px-2.5 py-1.5 text-[11px] text-stoniz-gray-700 flex items-center justify-between border-b border-stoniz-gray-100">
                                  <span className="font-medium truncate">
                                    Lot {lot.numero} · {lot.category} · <span className="text-stoniz-gray-500">{lot.partner_name}</span>
                                  </span>
                                  <span className="text-[10px] text-stoniz-gray-500 shrink-0 ml-2">
                                    Reste {fmtMad(reste)} / {fmtMad(lot.devis_total)}
                                  </span>
                                </div>
                                {lot.pending_acomptes.length === 0 && lot.paid_acomptes.length === 0 && (
                                  <div className="px-3 py-2 text-[11px] text-stoniz-gray-400 italic">
                                    Aucun acompte planifié — utilise "Créer un nouvel acompte"
                                  </div>
                                )}
                                {lot.pending_acomptes.map((a) => {
                                  const selected = chosenAcompteId === a.id;
                                  const isBest = !!a.is_best_match;
                                  const score = a.match_score ?? 0;
                                  return (
                                    <button
                                      type="button"
                                      key={a.id}
                                      onClick={() => { setChosenAcompteId(a.id); setCreateNew(false); }}
                                      className={`w-full text-left px-3 py-2 hover:bg-indigo-50/40 flex items-center gap-2.5 ${
                                        selected ? 'bg-indigo-50' : isBest ? 'bg-emerald-50/50' : 'bg-white'
                                      }`}
                                    >
                                      <span
                                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                          selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stoniz-gray-300'
                                        }`}
                                      >
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
                                      const selected = chosenAcompteId === a.id;
                                      // Totalement rapproché → invisible pour double-allocation
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
                                      const partiallyReconciled = (a.bank_allocated_total ?? 0) > 0;
                                      // Acompte payé manuellement (avec ou sans rapprochement partiel) → cliquable
                                      return (
                                        <button
                                          type="button"
                                          key={a.id}
                                          onClick={() => { setChosenAcompteId(a.id); setCreateNew(false); }}
                                          className={`w-full text-left px-3 py-2 hover:bg-indigo-50/40 flex items-center gap-2.5 ${
                                            selected ? 'bg-indigo-50' : 'bg-white'
                                          }`}
                                        >
                                          <span
                                            className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                              selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-stoniz-gray-300'
                                            }`}
                                          >
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
                                                Banque : {fmtMad(a.bank_allocated_total ?? 0)} / {fmtMad(a.amount_total)} · reste {fmtMad(a.bank_remaining ?? 0)}
                                              </span>
                                            )}
                                          </span>
                                          <span className="text-[9px] uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded shrink-0 font-semibold inline-flex items-center gap-0.5">
                                            <Landmark className="w-2.5 h-2.5" /> {partiallyReconciled ? 'Compléter' : 'À rapprocher'}
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

                      {/* Toggle "créer nouveau" — avec warning si un match existe */}
                      <label className={`mt-2 flex items-center gap-2 text-xs cursor-pointer ${
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
                      {hasLikelyMatch && createNew && (
                        <div className="mt-2 bg-red-50 border border-red-200 rounded p-2 text-[11px] text-red-800 flex items-start gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                          <span>
                            Au moins un acompte planifié correspond au montant de cette transaction.
                            Créer un nouveau ferait un <strong>doublon</strong>. Décoche cette case et
                            choisis plutôt l'acompte avec le badge "Match".
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">
                      Montant (MAD)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1.5 bg-white font-mono"
                    />
                    <p className="text-[10px] text-stoniz-gray-500 mt-0.5">
                      Restant à allouer : <span className="font-mono">{ctx.transaction.remaining.toFixed(2)}</span> MAD
                      {amount && Number(amount) !== ctx.transaction.remaining && (
                        <button
                          type="button"
                          onClick={() => setAmount(ctx.transaction.remaining.toFixed(2))}
                          className="ml-2 text-indigo-700 hover:underline"
                        >
                          Tout
                        </button>
                      )}
                    </p>
                  </div>

                  <div>
                    <label className="block text-[10px] uppercase tracking-wide text-stoniz-gray-500 mb-1">
                      Notes (optionnel)
                    </label>
                    <input
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ex : versement final, acompte n°2…"
                      className="w-full text-sm border border-stoniz-gray-300 rounded px-2 py-1.5 bg-white"
                    />
                  </div>

                  {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-2 text-xs text-red-800 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span>{error}</span>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-3 border-t border-stoniz-gray-200 bg-stoniz-gray-50 flex items-center justify-between gap-2">
              <a
                href={`/finance/tresorerie/transactions/${transactionId}`}
                className="text-[11px] text-stoniz-gray-500 hover:text-stoniz-black"
                onClick={(e) => e.stopPropagation()}
              >
                Allocation avancée →
              </a>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="text-xs px-3 py-1.5 rounded border border-stoniz-gray-300 hover:bg-white"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || loading || !type}
                  className="text-xs px-3 py-1.5 rounded bg-stoniz-black text-white hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  <Zap className="w-3 h-3" />
                  {pending ? 'Allocation…' : chosenAcompteId ? 'Rattacher' : 'Allouer'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
