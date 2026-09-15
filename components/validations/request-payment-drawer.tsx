'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  X, ShieldCheck, AlertTriangle, FileWarning, CalendarClock,
  ChevronDown, ChevronUp, CheckCircle2, ExternalLink,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { formatMad } from '@/lib/utils/format';
import { SessionExpiredBanner, useSessionExpiredRedirect } from '@/components/auth/session-expired-banner';
import { requestPaymentForExistingAcomptesAction } from '@/app/(team)/validations/request-bulk-actions';
import { PayerAccountField } from '@/components/validations/payer-account-field';
import type { PayerAccount } from '@/lib/finance/payer-account';

/**
 * <RequestPaymentDrawer> — drawer client réutilisable achats + travaux
 * (Phase B3 du flux multi-lots — CEO 2026-06-25).
 *
 * Comportements :
 *   1. À l'ouverture, préfiltre J+30 : tout acompte avec scheduled_date <= +30j
 *      (et sans demande active) est coché par défaut.
 *   2. Acomptes groupés par fournisseur (FK si dispo, name en fallback).
 *   3. Acomptes avec demande active : checkbox grisée + badge "déjà en cours".
 *   4. Acomptes dont la fiche fournisseur est incomplète : badge ambre
 *      "fiche incomplète" sur l'en-tête de groupe (le serveur skippera mais on
 *      laisse l'utilisateur les voir).
 *   5. Récap live en footer sticky + champ notes + radio urgency + bouton.
 *
 * Pattern défensif : useTransition + try/catch + `!r || !r.ok` +
 * SessionExpiredBanner — cf. canon Phase B + Trésorerie B.
 *
 * Couleurs canon Stoniz :
 *   - orange = à percevoir / warning (échéance proche)
 *   - ambre = anomalie (fiche incomplète / pas de devis)
 *   - rouge réservé pertes réelles → on ne l'utilise qu'au bouton "Envoyer" si
 *     urgent (cohérent avec request-approval-button).
 */

export type Acompte = {
  id: string;
  lot_id: string;
  lot_name: string;
  acompte_number: number | null;
  amount_total: number;
  currency: string;
  scheduled_date: string | null;
  supplier_name: string;
  supplier_id: string | null;
  has_quote: boolean;
  artisan_fiche_ok: boolean;
  has_active_request: boolean;
};

export type RequestPaymentDrawerProps = {
  open: boolean;
  onClose: () => void;
  projectId: string;
  source: 'achats' | 'travaux';
  acomptes: Acompte[];
  /**
   * CEO 2026-06-25 (Phase B6) : préfiltre par lot. Si fourni, le drawer ne montre
   * QUE les acomptes dont `lot_id` est dans la liste. Un bandeau "filtré sur N lots
   * sélectionnés" apparaît en haut avec un lien pour retirer le préfiltre.
   *
   * Le préfiltre J+30 (auto-coche les acomptes échus à 30j) reste appliqué
   * PAR-DESSUS la liste filtrée, conformément à la décision CEO.
   */
  preselectedLotIds?: string[];
};

// ── Helpers UI ────────────────────────────────────────────────────────────

const J30_MS = 30 * 24 * 60 * 60 * 1000;

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function formatDateShort(dateStr: string | null): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function groupKey(a: Acompte): string {
  return a.supplier_id ? `id:${a.supplier_id}` : `name:${a.supplier_name}`;
}

// ── Composant principal ───────────────────────────────────────────────────

export function RequestPaymentDrawer({
  open, onClose, projectId, source, acomptes, preselectedLotIds,
}: RequestPaymentDrawerProps) {
  const router = useRouter();
  const handleAuthError = useSessionExpiredRedirect();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [urgency, setUrgency] = useState<'normal' | 'urgent'>('normal');
  const [notes, setNotes] = useState('');
  // Compte payeur (CEO 2026-07-08) : OBLIGATOIRE avant envoi. S'applique à
  // tous les batches créés par cet envoi.
  const [payerAccount, setPayerAccount] = useState<PayerAccount | null>(null);
  const [payerError, setPayerError] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // CEO 2026-06-25 (Phase B6) : possibilité de retirer le préfiltre lot depuis l'UI.
  // On garde un state local plutôt que de muter la prop, pour pouvoir basculer
  // "voir tous les acomptes" sans démonter le drawer.
  const [activeLotFilter, setActiveLotFilter] = useState<string[] | null>(null);
  const [result, setResult] = useState<{
    batches: Array<{ batch_id: string; supplier_name: string; n_acomptes: number;
                     total_mad: number; currency: string; approval_id: string }>;
    skipped: Array<{ payment_id: string; reason: string }>;
  } | null>(null);

  // Resync du préfiltre lot quand le drawer s'ouvre (la prop peut changer
  // d'une ouverture à l'autre puisque le panel passe la sélection courante).
  useEffect(() => {
    if (!open) return;
    setActiveLotFilter(
      Array.isArray(preselectedLotIds) && preselectedLotIds.length > 0
        ? preselectedLotIds
        : null,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectedLotIds?.join(',')]);

  // Liste effectivement affichée (après préfiltre lot s'il est actif).
  const visibleAcomptes = useMemo(() => {
    if (!activeLotFilter || activeLotFilter.length === 0) return acomptes;
    const set = new Set(activeLotFilter);
    return acomptes.filter((a) => set.has(a.lot_id));
  }, [acomptes, activeLotFilter]);

  // Préfiltre J+30 à l'ouverture (s'applique PAR-DESSUS le préfiltre lot)
  useEffect(() => {
    if (!open) return;
    setError(null);
    setResult(null);
    setPayerAccount(null);
    setPayerError(false);
    const threshold = Date.now() + J30_MS;
    const next = new Set<string>();
    for (const a of visibleAcomptes) {
      if (a.has_active_request) continue;
      if (!a.scheduled_date) continue;
      const t = new Date(a.scheduled_date).getTime();
      if (Number.isFinite(t) && t <= threshold) next.add(a.id);
    }
    setSelected(next);
  // On veut bien re-préfiltrer à chaque ouverture / quand le filtre lot change,
  // pas à chaque keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeLotFilter]);

  // ESC pour fermer
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ── Groupage par fournisseur ──────────────────────────────────────────
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; supplierName: string; ficheOk: boolean; items: Acompte[] }>();
    for (const a of visibleAcomptes) {
      const k = groupKey(a);
      const g = map.get(k);
      if (g) {
        g.items.push(a);
        if (!a.artisan_fiche_ok) g.ficheOk = false;
      } else {
        map.set(k, {
          key: k,
          supplierName: a.supplier_name,
          ficheOk: a.artisan_fiche_ok,
          items: [a],
        });
      }
    }
    // Tri : fournisseur alpha
    return Array.from(map.values()).sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'fr'));
  }, [visibleAcomptes]);

  // ── Récap ──────────────────────────────────────────────────────────────
  const selectedAcomptes = useMemo(
    () => visibleAcomptes.filter((a) => selected.has(a.id)),
    [visibleAcomptes, selected],
  );
  const totalAmount = selectedAcomptes.reduce((s, a) => s + a.amount_total, 0);
  const totalCurrency = selectedAcomptes[0]?.currency ?? 'MAD';
  const nSuppliers = new Set(selectedAcomptes.map(groupKey)).size;

  // ── Toggle helpers ─────────────────────────────────────────────────────
  function toggleOne(id: string, allowed: boolean) {
    if (!allowed) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleGroup(g: typeof groups[number], on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const a of g.items) {
        if (a.has_active_request) continue;
        if (on) next.add(a.id); else next.delete(a.id);
      }
      return next;
    });
  }
  function toggleCollapse(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  // ── Submit ─────────────────────────────────────────────────────────────
  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    const ids = Array.from(selected);
    if (ids.length === 0) {
      setError('Aucun acompte sélectionné.');
      return;
    }
    if (!payerAccount) {
      setPayerError(true);
      return;
    }
    start(async () => {
      try {
        const r = await requestPaymentForExistingAcomptesAction({
          project_id: projectId,
          source,
          payment_ids: ids,
          urgency,
          request_notes: notes || null,
          payer_account: payerAccount,
        });
        if (!r || !r.ok) {
          const msg = (r as any)?.error ?? 'Erreur inattendue';
          handleAuthError(msg);
          setError(msg);
          return;
        }
        setResult({ batches: r.batches_created, skipped: r.skipped });
        router.refresh();
      } catch (err: any) {
        const msg = err?.message ?? 'Erreur inattendue';
        handleAuthError(msg);
        setError(msg);
      }
    });
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />

      {/* Drawer */}
      <aside
        className={cn(
          'relative ml-auto h-full w-full sm:w-[480px] bg-white shadow-2xl',
          'flex flex-col',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header sticky */}
        <header className="sticky top-0 z-10 bg-white border-b border-grey-line px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-display text-lg flex items-center gap-2">
              <ShieldCheck className="w-5 h-5" />
              Demander un paiement
            </div>
            <p className="text-xs text-stoniz-gray-500 mt-0.5">
              {source === 'achats' ? 'Module achats' : 'Module travaux'} ·
              {' '}{visibleAcomptes.length} acompte{visibleAcomptes.length > 1 ? 's' : ''} éligible{visibleAcomptes.length > 1 ? 's' : ''}
              {activeLotFilter && activeLotFilter.length > 0 && acomptes.length !== visibleAcomptes.length && (
                <span className="text-stoniz-gray-400"> · {acomptes.length} au total</span>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-stoniz-gray-500 hover:bg-stoniz-gray-100 hover:text-stoniz-gray-700"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body scrollable */}
        <form onSubmit={submit} className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {result ? (
              <SuccessPanel
                batches={result.batches}
                skipped={result.skipped}
                onClose={onClose}
              />
            ) : (
              <>
                {/* Bandeau préfiltre lot (CEO 2026-06-25 — Phase B6).
                    N'apparaît que si l'utilisateur a ouvert le drawer depuis le
                    panneau "Sélection multiple" avec des lots cochés. Lien pour
                    voir tous les acomptes éligibles du projet. */}
                {activeLotFilter && activeLotFilter.length > 0 && (
                  <div className="text-xs bg-blue-50 border border-blue-200 rounded-md p-3 flex items-start gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-700 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="text-blue-900">
                        Filtré sur <strong>{activeLotFilter.length}</strong> lot{activeLotFilter.length > 1 ? 's' : ''} sélectionné{activeLotFilter.length > 1 ? 's' : ''}.
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveLotFilter(null)}
                        className="text-blue-700 hover:underline mt-0.5"
                      >
                        Voir tous les acomptes éligibles du projet ({acomptes.length})
                      </button>
                    </div>
                  </div>
                )}
                {visibleAcomptes.length === 0 ? (
                  <div className="text-sm text-stoniz-gray-500 bg-stoniz-gray-50 border border-grey-line rounded-md p-4">
                    {activeLotFilter && activeLotFilter.length > 0
                      ? 'Aucun acompte éligible pour les lots sélectionnés. Crée d\'abord les acomptes via « Planifier acomptes » sur ces lots.'
                      : 'Aucun acompte éligible pour ce projet. Crée d\'abord les acomptes via « Planifier acomptes » sur les lots concernés.'}
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-stoniz-gray-500 bg-stoniz-gray-50 border border-grey-line rounded-md p-3">
                      Les acomptes échus dans les 30 prochains jours sont cochés automatiquement.
                      Tu peux désélectionner ou ajouter d'autres acomptes manuellement.
                    </div>

                    {groups.map((g) => {
                      const allowable = g.items.filter((a) => !a.has_active_request);
                      const allSelected = allowable.length > 0
                        && allowable.every((a) => selected.has(a.id));
                      const isCollapsed = collapsed.has(g.key);

                      return (
                        <div key={g.key} className="border border-grey-line rounded-md overflow-hidden">
                          {/* Header fournisseur */}
                          <div className="bg-stoniz-gray-50 px-3 py-2 flex items-center gap-2">
                            <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={allSelected}
                                disabled={allowable.length === 0}
                                onChange={(e) => toggleGroup(g, e.target.checked)}
                                className="accent-stoniz-black"
                              />
                              <span className="font-medium text-sm truncate">{g.supplierName}</span>
                              <span className="text-xs text-stoniz-gray-500 shrink-0">
                                ({g.items.length})
                              </span>
                            </label>
                            {!g.ficheOk && (
                              <span className="inline-flex items-center gap-1 text-[11px] bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 rounded">
                                <AlertTriangle className="w-3 h-3" />
                                fiche incomplète
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleCollapse(g.key)}
                              className="p-1 text-stoniz-gray-500 hover:text-stoniz-gray-800"
                              aria-label={isCollapsed ? 'Déplier' : 'Replier'}
                            >
                              {isCollapsed
                                ? <ChevronDown className="w-4 h-4" />
                                : <ChevronUp className="w-4 h-4" />}
                            </button>
                          </div>

                          {/* Liste acomptes */}
                          {!isCollapsed && (
                            <ul className="divide-y divide-grey-line">
                              {g.items.map((a) => (
                                <AcompteRow
                                  key={a.id}
                                  acompte={a}
                                  checked={selected.has(a.id)}
                                  onToggle={() => toggleOne(a.id, !a.has_active_request)}
                                />
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </>
            )}
          </div>

          {/* Footer sticky : récap + form */}
          {!result && visibleAcomptes.length > 0 && (
            <footer className="sticky bottom-0 z-10 bg-white border-t border-grey-line px-5 py-4 space-y-3">
              <div className="text-sm bg-stoniz-gray-50 border border-grey-line rounded-md px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span><strong>{selectedAcomptes.length}</strong> acompte{selectedAcomptes.length > 1 ? 's' : ''}</span>
                <span className="text-stoniz-gray-400">·</span>
                <span><strong>{formatMad(totalAmount)}</strong>{totalCurrency !== 'MAD' ? ` (${totalCurrency})` : ''}</span>
                <span className="text-stoniz-gray-400">·</span>
                <span><strong>{nSuppliers}</strong> fournisseur{nSuppliers > 1 ? 's' : ''}</span>
              </div>

              <PayerAccountField
                value={payerAccount}
                onChange={(v) => { setPayerAccount(v); setPayerError(false); }}
                name="bulk-payer-account"
                showError={payerError}
              />

              <div>
                <Label>Notes (optionnel)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="Contexte, échéances, urgence…"
                />
              </div>

              <div>
                <Label>Urgence</Label>
                <div className="flex gap-2 mt-1">
                  <label className="flex-1 border rounded-md px-3 py-2 cursor-pointer text-sm has-[:checked]:border-stoniz-black has-[:checked]:bg-stoniz-gray-50">
                    <input
                      type="radio"
                      name="bulk-urgency"
                      value="normal"
                      checked={urgency === 'normal'}
                      onChange={() => setUrgency('normal')}
                      className="mr-2"
                    />
                    Normal
                  </label>
                  <label className="flex-1 border rounded-md px-3 py-2 cursor-pointer text-sm has-[:checked]:border-red-500 has-[:checked]:bg-red-50">
                    <input
                      type="radio"
                      name="bulk-urgency"
                      value="urgent"
                      checked={urgency === 'urgent'}
                      onChange={() => setUrgency('urgent')}
                      className="mr-2"
                    />
                    Urgent
                  </label>
                </div>
              </div>

              <SessionExpiredBanner error={error} />

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
                  Annuler
                </Button>
                <Button type="submit" disabled={pending || selectedAcomptes.length === 0}>
                  {pending
                    ? 'Envoi…'
                    : `Envoyer ${nSuppliers || 0} demande${nSuppliers > 1 ? 's' : ''} groupée${nSuppliers > 1 ? 's' : ''}`}
                </Button>
              </div>
            </footer>
          )}
        </form>
      </aside>
    </div>
  );
}

// ── Sous-composants ───────────────────────────────────────────────────────

function AcompteRow({
  acompte, checked, onToggle,
}: {
  acompte: Acompte;
  checked: boolean;
  onToggle: () => void;
}) {
  const days = daysUntil(acompte.scheduled_date);
  const overdue = days != null && days < 0;
  const soon = days != null && days >= 0 && days <= 30;
  const isDisabled = acompte.has_active_request;

  return (
    <li className={cn(
      'px-3 py-2 flex items-start gap-2 text-sm',
      isDisabled && 'bg-stoniz-gray-50 text-stoniz-gray-400',
    )}>
      <input
        type="checkbox"
        checked={checked}
        disabled={isDisabled}
        onChange={onToggle}
        className="mt-1 accent-stoniz-black shrink-0"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn('truncate', isDisabled && 'line-through')}>
            {acompte.lot_name}
          </span>
          {acompte.acompte_number != null && (
            <span className="text-[11px] bg-stoniz-gray-100 text-stoniz-gray-700 border border-grey-line px-1.5 py-0.5 rounded">
              Acompte {acompte.acompte_number}
            </span>
          )}
          {!acompte.has_quote && (
            <span className="inline-flex items-center gap-1 text-[11px] bg-amber-50 text-amber-900 border border-amber-200 px-1.5 py-0.5 rounded">
              <FileWarning className="w-3 h-3" />
              devis manquant
            </span>
          )}
          {acompte.has_active_request && (
            <span className="text-[11px] bg-stoniz-gray-200 text-stoniz-gray-700 px-1.5 py-0.5 rounded">
              déjà en cours
            </span>
          )}
        </div>
        <div className="text-xs text-stoniz-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="w-3 h-3" />
            {formatDateShort(acompte.scheduled_date)}
          </span>
          {overdue && (
            <span className="text-amber-700">en retard ({Math.abs(days!)} j)</span>
          )}
          {soon && !overdue && (
            <span className="text-orange-700">échéance dans {days} j</span>
          )}
        </div>
      </div>
      <div className="shrink-0 font-medium tabular-nums">
        {formatMad(acompte.amount_total)}
      </div>
    </li>
  );
}

function SuccessPanel({
  batches, skipped, onClose,
}: {
  batches: Array<{ batch_id: string; supplier_name: string; n_acomptes: number;
                   total_mad: number; currency: string; approval_id: string }>;
  skipped: Array<{ payment_id: string; reason: string }>;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="bg-green-50 border border-green-200 rounded-md p-3 flex items-start gap-2">
        <CheckCircle2 className="w-5 h-5 text-green-700 shrink-0 mt-0.5" />
        <div className="text-sm text-green-900 flex-1">
          <div className="font-medium">
            {batches.length} demande{batches.length > 1 ? 's' : ''} envoyée{batches.length > 1 ? 's' : ''}
          </div>
          <p className="text-xs text-green-800 mt-0.5">
            Finance et CEO ont reçu la notification par email.
          </p>
        </div>
      </div>

      {batches.length > 0 && (
        <ul className="divide-y divide-grey-line border border-grey-line rounded-md">
          {batches.map((b) => (
            <li key={b.batch_id} className="px-3 py-2 text-sm flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="truncate font-medium">{b.supplier_name}</div>
                <div className="text-xs text-stoniz-gray-500">
                  {b.n_acomptes} acompte{b.n_acomptes > 1 ? 's' : ''} ·
                  {' '}{formatMad(b.total_mad)}{b.currency !== 'MAD' ? ` (${b.currency})` : ''}
                </div>
              </div>
              <Link
                href={`/validations#${b.approval_id}`}
                className="inline-flex items-center gap-1 text-xs text-stoniz-black hover:underline shrink-0"
              >
                Voir <ExternalLink className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {skipped.length > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-md p-3 space-y-1">
          <div className="text-sm font-medium text-orange-900">
            {skipped.length} acompte{skipped.length > 1 ? 's' : ''} ignoré{skipped.length > 1 ? 's' : ''}
          </div>
          <ul className="text-xs text-orange-900 space-y-0.5 list-disc list-inside">
            {skipped.map((s) => (
              <li key={s.payment_id}>{s.reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end">
        <Button type="button" variant="secondary" onClick={onClose}>
          Fermer
        </Button>
      </div>
    </div>
  );
}
