'use client';

import { useMemo, useState, useTransition } from 'react';
import { CalendarPlus, ShieldCheck, Truck } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { formatMad } from '@/lib/utils/format';
import {
  bulkPlanAchatAcomptesAction,
  bulkUpdateAchatLotsAction,
} from '@/app/(team)/projects/[id]/achats/actions';
import { requestBatchApprovalAction } from '@/app/(team)/validations/actions';
import { ACHAT_LOT_STATUSES } from '@/lib/finance/achats-calc';
import { PayerAccountField } from '@/components/validations/payer-account-field';
import type { PayerAccount } from '@/lib/finance/payer-account';

type Lot = {
  id: string;
  numero: number;
  category: string | null;
  description: string | null;
  supplier_id: string | null;
  supplier_name: string;
  devis_fournisseur_mad: number | null;
};

type Acompte = {
  id: string;
  lot_id: string | null;
  acompte_number: number | null;
  status: string;
};

/**
 * Panneau "Planifier des acomptes par fournisseur" — au-dessus du tableau des
 * lots achats. Pour un fournisseur choisi, liste tous ses lots du projet,
 * permet la sélection multi, et crée d'un coup N acomptes avec date d'échéance
 * commune (montant en % du devis ou en montant fixe).
 */
export function BulkPlanAcomptes({
  projectId,
  lots,
  payments,
}: {
  projectId: string;
  lots: Lot[];
  payments: Acompte[];
}) {
  // ─── Construction de la liste des fournisseurs présents sur le projet ───
  const suppliers = useMemo(() => {
    const seen = new Map<string, { key: string; label: string; lotCount: number }>();
    lots.forEach((l) => {
      const key = l.supplier_id ?? `name:${l.supplier_name}`;
      const existing = seen.get(key);
      if (existing) existing.lotCount++;
      else seen.set(key, { key, label: l.supplier_name, lotCount: 1 });
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [lots]);

  // ─── État ────────────────────────────────────────────────────────────────
  const [actionMode, setActionMode] = useState<'plan' | 'update'>('plan');
  const [supplierKey, setSupplierKey] = useState<string>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // CEO 2026-06-18 (chantier C1) : tableau de jalons (installments).
  // Chaque jalon a son propre montant et sa propre date — 1 ligne par
  // acompte avec scheduled_date individuelle.
  type Installment = { amount_mode: 'pct' | 'fixed'; amount_value: string; scheduled_date: string };
  function isoPlus(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
  const [installments, setInstallments] = useState<Installment[]>([
    { amount_mode: 'pct', amount_value: '30', scheduled_date: isoPlus(0) },
  ]);
  function addInstallment() {
    setInstallments((arr) => [
      ...arr,
      { amount_mode: 'pct', amount_value: '30', scheduled_date: isoPlus((arr.length + 1) * 30) },
    ]);
  }
  function removeInstallment(idx: number) {
    setInstallments((arr) => arr.filter((_, i) => i !== idx));
  }
  function updateInstallment(idx: number, patch: Partial<Installment>) {
    setInstallments((arr) => arr.map((i, j) => (j === idx ? { ...i, ...patch } : i)));
  }
  function applyTemplate(t: 'p30_40_30' | 'p50_50' | 'p25_x4' | 'p100') {
    if (t === 'p30_40_30') setInstallments([
      { amount_mode: 'pct', amount_value: '30', scheduled_date: isoPlus(0) },
      { amount_mode: 'pct', amount_value: '40', scheduled_date: isoPlus(30) },
      { amount_mode: 'pct', amount_value: '30', scheduled_date: isoPlus(60) },
    ]);
    else if (t === 'p50_50') setInstallments([
      { amount_mode: 'pct', amount_value: '50', scheduled_date: isoPlus(0) },
      { amount_mode: 'pct', amount_value: '50', scheduled_date: isoPlus(45) },
    ]);
    else if (t === 'p25_x4') setInstallments([
      { amount_mode: 'pct', amount_value: '25', scheduled_date: isoPlus(0) },
      { amount_mode: 'pct', amount_value: '25', scheduled_date: isoPlus(30) },
      { amount_mode: 'pct', amount_value: '25', scheduled_date: isoPlus(60) },
      { amount_mode: 'pct', amount_value: '25', scheduled_date: isoPlus(90) },
    ]);
    else setInstallments([
      { amount_mode: 'pct', amount_value: '100', scheduled_date: isoPlus(0) },
    ]);
  }

  // Détection dates aplaties (warn) : 2 jalons même date dans le même bulk
  const flatDatesWarning = useMemo(() => {
    const dates = installments.map((i) => i.scheduled_date);
    const distinct = new Set(dates);
    return installments.length >= 2 && distinct.size < installments.length;
  }, [installments]);

  const [notes, setNotes] = useState<string>('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  // ─── Mode "update" : champs statut + livraison sur les N lots cochés ────
  const [bulkStatus, setBulkStatus] = useState<string>('');
  const [bulkLivraisonEstimee, setBulkLivraisonEstimee] = useState<string>('');
  const [bulkLivraisonReelle, setBulkLivraisonReelle] = useState<string>('');

  // ─── Batch venant d'être créé : permet d'enchaîner sur "Demander validation groupée" ──
  const [lastBatch, setLastBatch] = useState<{
    id: string;
    count: number;
    supplierLabel: string;
    requested: boolean;
  } | null>(null);
  const [requestPending, startRequest] = useTransition();
  // Compte payeur du batch (CEO 2026-07-08) : OBLIGATOIRE avant l'envoi
  // de la demande de validation groupée.
  const [batchPayerAccount, setBatchPayerAccount] = useState<PayerAccount | null>(null);
  const [batchPayerError, setBatchPayerError] = useState(false);

  // ─── Lots du fournisseur sélectionné, avec calcul du prochain acompte ──
  const lotsOfSupplier = useMemo(() => {
    if (!supplierKey) return [];
    return lots
      .filter((l) => (l.supplier_id ?? `name:${l.supplier_name}`) === supplierKey)
      .map((l) => {
        const taken = new Set<number>();
        payments.forEach((p) => {
          if (p.lot_id === l.id && p.acompte_number != null) taken.add(Number(p.acompte_number));
        });
        let nextNum: number | null = null;
        for (let i = 1; i <= 6; i++) {
          if (!taken.has(i)) { nextNum = i; break; }
        }
        return { ...l, nextNum, takenCount: taken.size };
      })
      .sort((a, b) => a.numero - b.numero);
  }, [supplierKey, lots, payments]);

  // ─── Handlers ────────────────────────────────────────────────────────────
  function changeSupplier(key: string) {
    setSupplierKey(key);
    setSelected(new Set());
    setMsg(null);
    setLastBatch(null);
    setBulkStatus('');
    setBulkLivraisonEstimee('');
    setBulkLivraisonReelle('');
  }

  function changeMode(mode: 'plan' | 'update') {
    setActionMode(mode);
    setMsg(null);
    setLastBatch(null);
  }

  function toggleLot(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    // En mode plan, on ne coche que les lots avec un acompte libre.
    // En mode update, on coche tous les lots (y compris 6/6 acomptes).
    const candidates = actionMode === 'plan'
      ? lotsOfSupplier.filter((l) => l.nextNum != null)
      : lotsOfSupplier;
    if (selected.size === candidates.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(candidates.map((l) => l.id)));
    }
  }

  function submit() {
    if (selected.size === 0) { setMsg({ kind: 'err', text: 'Sélectionnez au moins un lot.' }); return; }
    if (installments.length === 0) {
      setMsg({ kind: 'err', text: 'Ajoute au moins un jalon.' });
      return;
    }
    for (let i = 0; i < installments.length; i++) {
      const inst = installments[i];
      if (!inst.amount_value || Number(inst.amount_value) <= 0) {
        setMsg({ kind: 'err', text: `Jalon ${i + 1} : renseigne un montant > 0.` });
        return;
      }
      if (!inst.scheduled_date) {
        setMsg({ kind: 'err', text: `Jalon ${i + 1} : renseigne la date d'échéance.` });
        return;
      }
    }
    // Confirmation si dates aplaties (chantier C1 — warn)
    if (flatDatesWarning) {
      const ok = window.confirm(
        '⚠ Plusieurs jalons ont la même date d\'échéance.\n\n' +
        'Cela va créer un pic artificiel dans la projection cashflow ' +
        '(plusieurs acomptes vont tomber le même jour).\n\n' +
        'Continuer quand même ?',
      );
      if (!ok) return;
    }

    setMsg(null);
    setLastBatch(null);
    const currentSupplier = suppliers.find((s) => s.key === supplierKey);
    start(async () => {
      const r = await bulkPlanAchatAcomptesAction({
        project_id: projectId,
        lot_ids: Array.from(selected),
        installments: installments.map((inst) => ({
          amount_mode: inst.amount_mode,
          amount_value: Number(inst.amount_value),
          scheduled_date: inst.scheduled_date,
        })),
        notes: notes || null,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));

      if (!r?.ok) {
        setMsg({ kind: 'err', text: r?.error ?? 'Échec de la création.' });
        return;
      }
      const skippedText = r.skipped && r.skipped.length > 0
        ? ` · ${r.skipped.length} lot${r.skipped.length > 1 ? 's' : ''} ignoré${r.skipped.length > 1 ? 's' : ''}`
        : '';
      const nbAcomptes = r.createdCount * installments.length;
      setMsg({
        kind: 'ok',
        text: `${nbAcomptes} acompte${nbAcomptes > 1 ? 's' : ''} planifié${nbAcomptes > 1 ? 's' : ''} sur ${r.createdCount} lot${r.createdCount > 1 ? 's' : ''} (${installments.length} jalon${installments.length > 1 ? 's' : ''} par lot)${skippedText}.`,
      });
      setSelected(new Set());
      // Mémorise le batch pour proposer la demande de validation groupée
      if (r.batchId && r.createdCount > 0) {
        setLastBatch({
          id: r.batchId,
          count: nbAcomptes,
          supplierLabel: currentSupplier?.label ?? '',
          requested: false,
        });
      }
    });
  }

  // ─── Mode "update" : bulk mise à jour statut + livraison ─────────────
  function submitUpdate() {
    if (selected.size === 0) {
      setMsg({ kind: 'err', text: 'Sélectionnez au moins un lot.' });
      return;
    }
    if (!bulkStatus && !bulkLivraisonEstimee && !bulkLivraisonReelle) {
      setMsg({ kind: 'err', text: 'Renseigne au moins un champ à mettre à jour.' });
      return;
    }
    setMsg(null);
    setLastBatch(null);
    start(async () => {
      const r = await bulkUpdateAchatLotsAction({
        project_id: projectId,
        lot_ids: Array.from(selected),
        status: bulkStatus || null,
        date_livraison_estimee: bulkLivraisonEstimee || null,
        date_livraison_reelle: bulkLivraisonReelle || null,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!r?.ok) {
        setMsg({ kind: 'err', text: r?.error ?? 'Échec de la mise à jour.' });
        return;
      }
      const updated = (r as any).updatedCount ?? 0;
      const parts: string[] = [];
      if (bulkStatus) {
        const lbl = ACHAT_LOT_STATUSES.find((s) => s.value === bulkStatus)?.label ?? bulkStatus;
        parts.push(`statut → ${lbl}`);
      }
      if (bulkLivraisonEstimee) parts.push(`livraison estimée ${bulkLivraisonEstimee}`);
      if (bulkLivraisonReelle) parts.push(`livraison réelle ${bulkLivraisonReelle}`);
      setMsg({
        kind: 'ok',
        text: `✓ ${updated} lot${updated > 1 ? 's' : ''} mis à jour (${parts.join(' · ')}).`,
      });
      setSelected(new Set());
      setBulkStatus('');
      setBulkLivraisonEstimee('');
      setBulkLivraisonReelle('');
    });
  }

  // ─── Demander validation groupée sur le batch qui vient d'être créé ──
  function requestBatchApproval() {
    if (!lastBatch) return;
    // Compte payeur OBLIGATOIRE (CEO 2026-07-08)
    if (!batchPayerAccount) {
      setBatchPayerError(true);
      return;
    }
    startRequest(async () => {
      const r = await requestBatchApprovalAction({
        payment_batch_id: lastBatch.id,
        urgency: 'normal',
        request_notes: null,
        payer_account: batchPayerAccount,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!r?.ok) {
        setMsg({ kind: 'err', text: r?.error ?? 'Échec de la demande de validation.' });
        return;
      }
      setLastBatch({ ...lastBatch, requested: true });
      setMsg({
        kind: 'ok',
        text: `✓ Demande de validation envoyée au CEO et à la finance pour ${(r as any).count} acompte${(r as any).count > 1 ? 's' : ''} (${(r as any).amount?.toLocaleString('fr-FR')} MAD).`,
      });
    });
  }

  // En mode "plan" on n'autorise que les lots avec un acompte libre (1-6).
  // En mode "update" on autorise tous les lots (même 6/6 si l'utilisateur
  // veut juste corriger leur statut/livraison).
  const selectableLots = actionMode === 'plan'
    ? lotsOfSupplier.filter((l) => l.nextNum != null)
    : lotsOfSupplier;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarPlus className="w-4 h-4 text-orange-700" />
          Actions groupées par fournisseur
        </CardTitle>
        <p className="text-xs text-stoniz-gray-500 mt-1">
          Pour un fournisseur, sélectionne plusieurs lots et applique en un coup :
          un acompte planifié (avec date d&apos;échéance commune) <strong>ou</strong> une
          mise à jour de statut commande / date livraison.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Toggle d'action */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => changeMode('plan')}
            className={`flex-1 px-3 py-2 rounded-md border text-sm flex items-center justify-center gap-2 ${actionMode === 'plan' ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white text-stoniz-gray-700'}`}
          >
            <CalendarPlus className="w-4 h-4" />
            Planifier des acomptes
          </button>
          <button
            type="button"
            onClick={() => changeMode('update')}
            className={`flex-1 px-3 py-2 rounded-md border text-sm flex items-center justify-center gap-2 ${actionMode === 'update' ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white text-stoniz-gray-700'}`}
          >
            <Truck className="w-4 h-4" />
            Mettre à jour la commande
          </button>
        </div>

        <div>
          <Label>Fournisseur</Label>
          <select
            value={supplierKey}
            onChange={(e) => changeSupplier(e.target.value)}
            className="w-full h-10 rounded-md border bg-white px-3 text-sm"
          >
            <option value="">— Choisir un fournisseur du projet —</option>
            {suppliers.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label} ({s.lotCount} lot{s.lotCount > 1 ? 's' : ''})
              </option>
            ))}
          </select>
        </div>

        {supplierKey && lotsOfSupplier.length > 0 && (
          <>
            <div className="border rounded-lg overflow-hidden">
              <div className="bg-stoniz-gray-50 border-b px-3 py-2 flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={
                      selected.size > 0 &&
                      selected.size === selectableLots.length
                    }
                    onChange={toggleAll}
                  />
                  Tout cocher · {selected.size}/{selectableLots.length} sélectionné{selected.size > 1 ? 's' : ''}
                </label>
              </div>
              <ul className="divide-y text-sm">
                {lotsOfSupplier.map((l) => {
                  const isFull = l.nextNum == null;
                  // En mode "update" un lot full reste sélectionnable
                  // (on ne crée pas d'acompte, on met juste à jour statut/livraison).
                  const isDisabled = actionMode === 'plan' && isFull;
                  return (
                    <li
                      key={l.id}
                      className={`px-3 py-2 flex items-center justify-between gap-3 ${isDisabled ? 'bg-stoniz-gray-50/50 opacity-60' : ''}`}
                    >
                      <label className={`flex items-center gap-2 flex-1 cursor-pointer ${isDisabled ? 'cursor-not-allowed' : ''}`}>
                        <input
                          type="checkbox"
                          checked={selected.has(l.id)}
                          onChange={() => !isDisabled && toggleLot(l.id)}
                          disabled={isDisabled}
                        />
                        <span className="font-mono text-xs text-stoniz-gray-500">Lot {l.numero}</span>
                        <span className="text-stoniz-gray-700 flex-1 truncate">
                          {l.description ?? <em className="text-stoniz-gray-400">(sans description)</em>}
                        </span>
                      </label>
                      <span className="text-xs text-stoniz-gray-600">
                        Devis : {formatMad(l.devis_fournisseur_mad)}
                      </span>
                      {/* Badge "acomptes" uniquement en mode plan, sinon pas pertinent */}
                      {actionMode === 'plan' && (
                        <span className={`text-xs uppercase tracking-wide px-1.5 py-0.5 rounded ${isFull ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                          {isFull ? '✓ 6/6 acomptes' : `Prochain : acompte ${l.nextNum}`}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>

            {actionMode === 'plan' && (
              <div className="space-y-3">
                {/* Templates pré-définis (chantier C1) */}
                <div>
                  <Label>Modèles de jalons</Label>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <button type="button" onClick={() => applyTemplate('p30_40_30')}
                      className="px-3 py-1.5 text-xs rounded-full border bg-white hover:bg-stoniz-gray-50">
                      30 / 40 / 30 · J+0 / J+30 / J+60
                    </button>
                    <button type="button" onClick={() => applyTemplate('p50_50')}
                      className="px-3 py-1.5 text-xs rounded-full border bg-white hover:bg-stoniz-gray-50">
                      50 / 50 · J+0 / J+45
                    </button>
                    <button type="button" onClick={() => applyTemplate('p25_x4')}
                      className="px-3 py-1.5 text-xs rounded-full border bg-white hover:bg-stoniz-gray-50">
                      4 × 25 · J+0 à J+90
                    </button>
                    <button type="button" onClick={() => applyTemplate('p100')}
                      className="px-3 py-1.5 text-xs rounded-full border bg-white hover:bg-stoniz-gray-50">
                      100% en 1 fois
                    </button>
                  </div>
                  <p className="text-[11px] text-stoniz-gray-500 mt-1">
                    Cliquer sur un modèle remplit l&apos;échéancier ci-dessous. Tu peux l&apos;ajuster ensuite.
                  </p>
                </div>

                {/* Éditeur de jalons : 1 ligne par acompte */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label>Échéancier ({installments.length} jalon{installments.length > 1 ? 's' : ''})</Label>
                    <button type="button" onClick={addInstallment}
                      className="text-xs px-2 py-1 rounded-md border bg-white hover:bg-stoniz-gray-50">
                      + Ajouter un jalon
                    </button>
                  </div>
                  <div className="border rounded-md divide-y">
                    {installments.map((inst, idx) => (
                      <div key={idx} className="p-2 grid grid-cols-1 md:grid-cols-[40px_1fr_120px_1fr_40px] gap-2 items-center">
                        <span className="font-mono text-xs text-stoniz-gray-500 text-center">#{idx + 1}</span>
                        <div className="flex gap-1">
                          <button type="button" onClick={() => updateInstallment(idx, { amount_mode: 'pct' })}
                            className={`flex-1 px-2 py-1.5 rounded-md border text-xs ${inst.amount_mode === 'pct' ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white'}`}>
                            % du devis
                          </button>
                          <button type="button" onClick={() => updateInstallment(idx, { amount_mode: 'fixed' })}
                            className={`flex-1 px-2 py-1.5 rounded-md border text-xs ${inst.amount_mode === 'fixed' ? 'bg-stoniz-black text-white border-stoniz-black' : 'bg-white'}`}>
                            MAD fixe
                          </button>
                        </div>
                        <Input
                          type="number"
                          step="0.01"
                          value={inst.amount_value}
                          onChange={(e) => updateInstallment(idx, { amount_value: e.target.value })}
                          placeholder={inst.amount_mode === 'pct' ? '30' : '10000'}
                        />
                        <Input
                          type="date"
                          value={inst.scheduled_date}
                          onChange={(e) => updateInstallment(idx, { scheduled_date: e.target.value })}
                        />
                        {installments.length > 1 ? (
                          <button type="button" onClick={() => removeInstallment(idx)}
                            className="text-stoniz-gray-400 hover:text-red-600 text-lg"
                            title="Supprimer ce jalon">
                            ×
                          </button>
                        ) : <span />}
                      </div>
                    ))}
                  </div>
                  {flatDatesWarning && (
                    <div className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded-md px-2 py-1.5">
                      ⚠ Plusieurs jalons ont la même date — la projection cashflow montrera un pic. Tu pourras
                      confirmer à la validation.
                    </div>
                  )}
                </div>

                <div>
                  <Label>Notes (optionnel — appliquées à tous les acomptes du batch)</Label>
                  <Input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Ex : Accord verbal Driss du 08/06"
                  />
                </div>
              </div>
            )}

            {actionMode === 'update' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Statut commande</Label>
                  <select
                    value={bulkStatus}
                    onChange={(e) => setBulkStatus(e.target.value)}
                    className="w-full h-10 rounded-md border bg-white px-3 text-sm"
                  >
                    <option value="">— Inchangé —</option>
                    {ACHAT_LOT_STATUSES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label>Livraison estimée</Label>
                  <Input
                    type="date"
                    value={bulkLivraisonEstimee}
                    onChange={(e) => setBulkLivraisonEstimee(e.target.value)}
                  />
                  <p className="text-[11px] text-stoniz-gray-500 mt-1">Laisser vide pour ne pas y toucher.</p>
                </div>
                <div>
                  <Label>Livraison réelle</Label>
                  <Input
                    type="date"
                    value={bulkLivraisonReelle}
                    onChange={(e) => setBulkLivraisonReelle(e.target.value)}
                  />
                  <p className="text-[11px] text-stoniz-gray-500 mt-1">À renseigner une fois la marchandise reçue.</p>
                </div>
              </div>
            )}

            {msg && (
              <div className={`text-sm rounded-md px-3 py-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
                {msg.text}
              </div>
            )}

            <div className="flex justify-end">
              {actionMode === 'plan' ? (
                <Button onClick={submit} disabled={pending || selected.size === 0}>
                  {pending
                    ? 'Création…'
                    : `+ Créer ${selected.size * installments.length} acompte${selected.size * installments.length > 1 ? 's' : ''} (${selected.size} lot${selected.size > 1 ? 's' : ''} × ${installments.length} jalon${installments.length > 1 ? 's' : ''})`}
                </Button>
              ) : (
                <Button onClick={submitUpdate} disabled={pending || selected.size === 0}>
                  {pending
                    ? 'Mise à jour…'
                    : `Mettre à jour ${selected.size} lot${selected.size > 1 ? 's' : ''}`}
                </Button>
              )}
            </div>

            {/* Panneau "Demander validation groupée" : visible après création réussie d'un batch (mode plan uniquement) */}
            {actionMode === 'plan' && lastBatch && (
              <div className="mt-2 border border-blue-200 bg-blue-50/60 rounded-md p-3 space-y-3">
                <div className="flex items-start gap-3">
                  <ShieldCheck className="w-5 h-5 text-blue-700 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-blue-900">
                      Soumettre ces {lastBatch.count} acompte{lastBatch.count > 1 ? 's' : ''} de <strong>{lastBatch.supplierLabel}</strong> en validation groupée ?
                    </div>
                    <p className="text-xs text-blue-800/80 mt-0.5">
                      1 seul mail envoyé au CEO et à la finance avec le récap complet du batch (au lieu de {lastBatch.count} mails séparés).
                    </p>
                  </div>
                </div>
                {!lastBatch.requested && (
                  <PayerAccountField
                    value={batchPayerAccount}
                    onChange={(v) => { setBatchPayerAccount(v); setBatchPayerError(false); }}
                    name="batch-payer-account"
                    showError={batchPayerError}
                  />
                )}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={requestBatchApproval}
                    disabled={requestPending || lastBatch.requested}
                    className="flex-shrink-0"
                  >
                    {requestPending
                      ? 'Envoi…'
                      : lastBatch.requested
                        ? '✓ Demande envoyée'
                        : 'Demander validation groupée'}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        {supplierKey && lotsOfSupplier.length === 0 && (
          <p className="text-sm text-stoniz-gray-500 italic">
            Aucun lot trouvé pour ce fournisseur sur ce projet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
