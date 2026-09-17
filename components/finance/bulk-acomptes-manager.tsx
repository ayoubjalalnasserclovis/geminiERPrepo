'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, CalendarClock, Percent, CheckCircle2 } from 'lucide-react';
import { formatMad } from '@/lib/utils/format';
import {
  bulkManageAcomptesAction,
  type BulkAcomptesSource,
  type BulkAcomptesSkipped,
} from '@/app/(team)/projects/[id]/bulk-acomptes-actions';

/**
 * <BulkAcomptesManager> — sous-panneau "Gérer les acomptes" des actions en
 * bulk (CEO 2026-07-08). Partagé par les 3 modules : achats, travaux, services.
 *
 * L'utilisateur a déjà coché des lots dans le panneau parent. Ici il :
 *   1. cible les acomptes (tous les non payés, ou uniquement le n°N de chaque lot)
 *   2. choisit l'opération : supprimer / modifier la date / modifier le montant
 *      (montant : % du devis du lot OU MAD fixe — comme l'échéancier de
 *      planification)
 *   3. voit un aperçu par acompte AVANT d'appliquer
 *
 * Les garde-fous serveur (acomptes en validation active, lots sans devis en
 * mode %) skippent avec raison — affichée dans le résultat. Composant défini
 * au top-level (piège React field-in-closure, cf. canon 2026-06-11).
 */

export type BulkAcompteLot = {
  id: string;
  /** Ex : "Lot 12 · Menuiserie" ou catégorie service. */
  label: string;
  /** Devis du lot (fournisseur / artisan / prestataire) — null si absent. */
  devis: number | null;
};

export type BulkAcomptePayment = {
  id: string;
  lot_id: string | null;
  acompte_number: number | null;
  status: string;
  amount_total: number;
  scheduled_date: string | null;
};

const PENDING_STATUS: Record<BulkAcomptesSource, string> = {
  achats: 'pending',
  travaux: 'pending',
  services: 'planifie',
};

type Op = 'delete' | 'set_date' | 'set_amount' | 'mark_paid';

export function BulkAcomptesManager({
  projectId,
  source,
  lots,
  payments,
  onClose,
}: {
  projectId: string;
  source: BulkAcomptesSource;
  /** Uniquement les lots SÉLECTIONNÉS dans le panneau parent. */
  lots: BulkAcompteLot[];
  /** Acomptes du projet (le composant filtre sur les lots sélectionnés). */
  payments: BulkAcomptePayment[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [op, setOp] = useState<Op | null>(null);
  const [numFilter, setNumFilter] = useState<string>(''); // '' = tous
  const [dateValue, setDateValue] = useState('');
  const [amountMode, setAmountMode] = useState<'pct' | 'fixed'>('pct');
  const [amountValue, setAmountValue] = useState('');
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ affected: number; skipped: BulkAcomptesSkipped[] } | null>(null);

  const lotById = useMemo(() => new Map(lots.map((l) => [l.id, l])), [lots]);

  // Acomptes ciblés : non payés, sur les lots sélectionnés, filtre n° éventuel.
  const targets = useMemo(() => {
    const pendingStatus = PENDING_STATUS[source];
    return payments.filter((p) => {
      if (!p.lot_id || !lotById.has(p.lot_id)) return false;
      if (p.status !== pendingStatus) return false;
      if (numFilter && p.acompte_number !== Number(numFilter)) return false;
      return true;
    });
  }, [payments, lotById, numFilter, source]);

  // N° d'acomptes réellement présents (pour le select cible).
  const availableNums = useMemo(() => {
    const s = new Set<number>();
    const pendingStatus = PENDING_STATUS[source];
    for (const p of payments) {
      if (p.lot_id && lotById.has(p.lot_id) && p.status === pendingStatus && p.acompte_number != null) {
        s.add(p.acompte_number);
      }
    }
    return Array.from(s).sort((a, b) => a - b);
  }, [payments, lotById, source]);

  function previewAmount(p: BulkAcomptePayment): number | null {
    if (op !== 'set_amount') return null;
    const v = Number(amountValue);
    if (!Number.isFinite(v) || v <= 0) return null;
    if (amountMode === 'fixed') return v;
    const devis = lotById.get(p.lot_id!)?.devis ?? null;
    if (devis == null || devis <= 0) return null;
    return Math.round(devis * (v / 100) * 100) / 100;
  }

  function submit() {
    setError(null);
    if (targets.length === 0) { setError('Aucun acompte ciblé.'); return; }
    if (op === 'set_amount' && (!amountValue || Number(amountValue) <= 0)) {
      setError('Saisis une valeur strictement positive.');
      return;
    }
    if (op === 'delete' && !confirm(`Supprimer ${targets.length} acompte(s) ? Soft-delete — restaurable depuis la corbeille admin.`)) {
      return;
    }
    if (op === 'mark_paid' && !confirm(`Marquer ${targets.length} acompte(s) comme payé(s) ? Statut → payé, montant réglé = montant total, date de paiement = maintenant.`)) {
      return;
    }
    start(async () => {
      try {
        const r = await bulkManageAcomptesAction({
          project_id: projectId,
          source,
          lot_ids: lots.map((l) => l.id),
          acompte_number: numFilter ? Number(numFilter) : null,
          op: op!,
          scheduled_date: op === 'set_date' ? (dateValue || null) : undefined,
          amount_mode: op === 'set_amount' ? amountMode : undefined,
          amount_value: op === 'set_amount' ? Number(amountValue) : undefined,
        });
        if (!r || !r.ok) {
          setError((r as any)?.error ?? 'Erreur inattendue');
          return;
        }
        setResult({ affected: r.affected, skipped: r.skipped });
        router.refresh();
      } catch (e: any) {
        setError(e?.message ?? 'Erreur inattendue');
      }
    });
  }

  if (result) {
    return (
      <div className="space-y-2">
        <div className="text-xs bg-emerald-50 text-emerald-800 border border-emerald-200 rounded px-2 py-1.5">
          ✓ {result.affected} acompte{result.affected > 1 ? 's' : ''}{' '}
          {op === 'delete' ? 'supprimé' : op === 'mark_paid' ? 'marqué payé' : 'modifié'}{result.affected > 1 ? 's' : ''}.
        </div>
        {result.skipped.length > 0 && (
          <div className="text-xs bg-orange-50 text-orange-900 border border-orange-200 rounded px-2 py-1.5 space-y-0.5">
            <div className="font-medium">{result.skipped.length} ignoré{result.skipped.length > 1 ? 's' : ''} :</div>
            <ul className="list-disc list-inside">
              {result.skipped.map((s) => <li key={s.payment_id}>{s.reason}</li>)}
            </ul>
          </div>
        )}
        <button type="button" onClick={onClose} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black px-3 py-1.5 border rounded">
          Fermer
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-xs font-medium">
          Gérer les acomptes de {lots.length} lot{lots.length > 1 ? 's' : ''}
        </div>
        <button type="button" onClick={onClose} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">
          Annuler
        </button>
      </div>

      {/* Cible + opération */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={numFilter}
          onChange={(e) => setNumFilter(e.target.value)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5"
        >
          <option value="">Tous les acomptes non payés</option>
          {availableNums.map((n) => (
            <option key={n} value={String(n)}>Acompte n°{n} uniquement</option>
          ))}
        </select>

        <button type="button" onClick={() => setOp('delete')}
          className={`px-3 py-1.5 rounded text-xs border inline-flex items-center gap-1 ${op === 'delete' ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100'}`}>
          <Trash2 className="w-3 h-3" /> Supprimer
        </button>
        <button type="button" onClick={() => setOp('set_date')}
          className={`px-3 py-1.5 rounded text-xs border inline-flex items-center gap-1 ${op === 'set_date' ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:bg-stoniz-gray-50'}`}>
          <CalendarClock className="w-3 h-3" /> Modifier la date
        </button>
        <button type="button" onClick={() => setOp('set_amount')}
          className={`px-3 py-1.5 rounded text-xs border inline-flex items-center gap-1 ${op === 'set_amount' ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white text-stoniz-gray-700 border-stoniz-gray-300 hover:bg-stoniz-gray-50'}`}>
          <Percent className="w-3 h-3" /> Modifier le montant
        </button>
        <button type="button" onClick={() => setOp('mark_paid')}
          className={`px-3 py-1.5 rounded text-xs border inline-flex items-center gap-1 ${op === 'mark_paid' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'}`}>
          <CheckCircle2 className="w-3 h-3" /> Marquer payé
        </button>
      </div>

      {/* Inputs selon l'opération */}
      {op === 'set_date' && (
        <div className="flex items-center gap-2">
          <label className="text-xs text-stoniz-gray-600">Nouvelle échéance :</label>
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5"
          />
          <span className="text-[11px] text-stoniz-gray-400">(vide = effacer l&apos;échéance)</span>
        </div>
      )}
      {op === 'set_amount' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex border border-stoniz-gray-300 rounded overflow-hidden">
            <button type="button" onClick={() => setAmountMode('pct')}
              className={`px-3 py-1.5 text-xs ${amountMode === 'pct' ? 'bg-stoniz-black text-white' : 'bg-white text-stoniz-gray-700'}`}>
              % du devis
            </button>
            <button type="button" onClick={() => setAmountMode('fixed')}
              className={`px-3 py-1.5 text-xs border-l border-stoniz-gray-300 ${amountMode === 'fixed' ? 'bg-stoniz-black text-white' : 'bg-white text-stoniz-gray-700'}`}>
              MAD fixe
            </button>
          </div>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={amountValue}
            onChange={(e) => setAmountValue(e.target.value)}
            placeholder={amountMode === 'pct' ? '40' : '25000'}
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1.5 w-28"
          />
          <span className="text-xs text-stoniz-gray-500">{amountMode === 'pct' ? '%' : 'MAD'}</span>
        </div>
      )}

      {/* Aperçu */}
      {op && (
        targets.length === 0 ? (
          <div className="text-xs text-stoniz-gray-500 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded px-2 py-1.5">
            Aucun acompte non payé ne correspond à la cible sur ces lots.
          </div>
        ) : (
          <div className="border border-stoniz-gray-200 rounded max-h-48 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-stoniz-gray-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left">Lot</th>
                  <th className="px-2 py-1.5 text-left w-20">Acompte</th>
                  <th className="px-2 py-1.5 text-right w-28">Actuel</th>
                  <th className="px-2 py-1.5 text-right w-32">
                    {op === 'delete' ? 'Après'
                      : op === 'set_date' ? 'Nouvelle date'
                      : op === 'mark_paid' ? 'Statut'
                      : 'Nouveau montant'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stoniz-gray-100">
                {targets.map((p) => {
                  const after = previewAmount(p);
                  return (
                    <tr key={p.id}>
                      <td className="px-2 py-1.5 truncate max-w-[200px]">{lotById.get(p.lot_id!)?.label ?? '?'}</td>
                      <td className="px-2 py-1.5">n°{p.acompte_number ?? '?'}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {formatMad(p.amount_total)}
                        {p.scheduled_date ? <span className="text-stoniz-gray-400"> · {p.scheduled_date}</span> : null}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums">
                        {op === 'delete' && <span className="text-red-700">supprimé</span>}
                        {op === 'set_date' && (dateValue || <span className="text-stoniz-gray-400">effacée</span>)}
                        {op === 'mark_paid' && <span className="text-emerald-700 font-medium">✓ payé</span>}
                        {op === 'set_amount' && (
                          after != null
                            ? <span className="font-medium">{formatMad(after)}</span>
                            : <span className="text-orange-700">{amountMode === 'pct' ? 'pas de devis' : '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      )}

      {op && targets.length > 0 && (
        <p className="text-[11px] text-stoniz-gray-500">
          Les acomptes en validation active seront ignorés automatiquement (raison affichée après application).
        </p>
      )}

      {error && (
        <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1.5">{error}</div>
      )}

      {op && targets.length > 0 && (
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className={`px-3 py-1.5 rounded text-xs text-white disabled:opacity-50 ${op === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-stoniz-black'}`}
        >
          {pending ? '…' : `Appliquer à ${targets.length} acompte${targets.length > 1 ? 's' : ''}`}
        </button>
      )}
    </div>
  );
}
