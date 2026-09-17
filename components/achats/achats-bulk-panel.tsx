'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckSquare, Square, Receipt, FileText, User2, Trash2, X, Filter, Search, Wallet, CalendarClock, Banknote, Copy } from 'lucide-react';
import {
  bulkAttachAchatDocAction,
  bulkAssignAchatSupplierAction,
  bulkSoftDeleteAchatLotsAction,
  bulkUpdateAchatPricesAction,
  bulkDuplicateAchatLotsAction,
} from '@/app/(team)/projects/[id]/achats/actions';
import { VendorDocPicker } from '@/components/vendor-documents/vendor-doc-picker';
import { RequestPaymentDrawer, type Acompte as BulkRequestAcompte } from '@/components/validations/request-payment-drawer';
import { BulkAcomptesManager } from '@/components/finance/bulk-acomptes-manager';

type Lot = {
  id: string;
  numero: number;
  description: string | null;
  category: string;
  supplier_name: string;
  supplier_id: string | null;
  invoice_doc_id: string | null;
  quote_doc_id: string | null;
  purchase_order_doc_id: string | null;
  status: string;
  /** CEO 2026-07-08 : devis du lot — pour l'aperçu "Gérer les acomptes" (mode %). */
  devis_fournisseur_mad?: number | null;
  /** CEO 2026-08-19 (session A) : montants pour l'aperçu "Modifier le prix"
   *  + suite source pour la duplication. */
  budget_estimate_mad?: number | null;
  facture_client_mad?: number | null;
  unit_price_mad?: number | null;
  quantity?: number | null;
  propria_unit_id?: string | null;
};

type Unit = { id: string; code: string | null };

type Payment = {
  id: string;
  lot_id: string | null;
  acompte_number: number | null;
  status: string;
  /** CEO 2026-07-08 : pour l'aperçu "Gérer les acomptes". */
  amount_total?: number;
  scheduled_date?: string | null;
};

type VendorDoc = {
  id: string;
  doc_type: 'facture' | 'devis';
  reference: string | null;
  document_date: string | null;
  total_amount: number | null;
  currency: string | null;
  partner_id: string | null;
  artisan_id: string | null;
  vendor_label: string | null;
  file_path: string | null;
};

type Supplier = { id: string; agency_name: string | null };

type Action = 'attach_invoice' | 'attach_quote' | 'attach_po' | 'assign_supplier' | 'delete' | 'manage_acomptes' | 'edit_price' | 'duplicate' | null;

// CEO 2026-08-19 (session A) : champs modifiables par "Modifier le prix".
// Les 4 sont des champs SOURCES du canon (jamais un dérivé).
const PRICE_FIELDS = [
  { value: 'budget_estimate_mad', label: 'Devis prévisionnel' },
  { value: 'devis_fournisseur_mad', label: 'Devis fournisseur' },
  { value: 'facture_client_mad', label: 'Facture client' },
  { value: 'unit_price_mad', label: 'Prix unitaire' },
] as const;
type PriceField = typeof PRICE_FIELDS[number]['value'];
type PriceMode = 'set' | 'pct' | 'delta';

export function AchatsBulkPanel({
  lots,
  payments,
  suppliers,
  recentDocs,
  projectId,
  bulkRequestAcomptes,
  units,
}: {
  lots: Lot[];
  payments?: Payment[]; // CEO 2026-06-18 B2 : pour filtre par n° acompte
  suppliers: Supplier[];
  recentDocs: VendorDoc[];
  /** CEO 2026-06-25 (Phase B6) : pour le bouton "Demander paiement" intégré. */
  projectId?: string;
  /** CEO 2026-06-25 (Phase B6) : acomptes éligibles passés en prop par la page,
   *  même liste que celle du bouton header — pas de double-fetch. */
  bulkRequestAcomptes?: BulkRequestAcompte[];
  /** CEO 2026-08-19 (session A) : suites du bien — cibles de duplication. */
  units?: Unit[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // CEO 2026-06-25 (Phase B6) : drawer "Demander paiement" intégré au panel.
  const [requestPaymentOpen, setRequestPaymentOpen] = useState(false);

  // State spécifique à chaque action
  const [selectedSupplierId, setSelectedSupplierId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  // CEO 2026-08-19 (session A) : "Modifier le prix" en bulk
  const [priceField, setPriceField] = useState<PriceField>('devis_fournisseur_mad');
  const [priceMode, setPriceMode] = useState<PriceMode>('set');
  const [priceValue, setPriceValue] = useState<string>('');

  // CEO 2026-08-19 (session A) : "Dupliquer" en bulk
  const [dupMode, setDupMode] = useState<'copies' | 'suites'>('copies');
  const [dupCopies, setDupCopies] = useState<string>('1');
  const [dupUnitIds, setDupUnitIds] = useState<Set<string>>(new Set());
  const [dupCopyAcomptes, setDupCopyAcomptes] = useState(false);

  // CEO 2026-06-16 : filtres dans le tableau pour pouvoir cibler 1 fournisseur
  // (ex : "Maison Azar") et lui affecter une facture en 1 clic sans risquer
  // d'oublier un lot. + filtre par statut devis/facture pour repérer les
  // manquants rapidement.
  const [filterText, setFilterText] = useState('');
  const [filterSupplierId, setFilterSupplierId] = useState<string>('');
  const [filterQuote, setFilterQuote] = useState<'all' | 'with' | 'without'>('all');
  const [filterInvoice, setFilterInvoice] = useState<'all' | 'with' | 'without'>('all');
  const [filterPo, setFilterPo] = useState<'all' | 'with' | 'without'>('all');
  // CEO 2026-06-18 B2 (sens c) : 2 filtres acompte distincts
  //   - filterAcompteHas      = lots AYANT déjà l'acompte N créé
  //   - filterAcompteNext     = lots dont le PROCHAIN acompte libre est N
  const [filterAcompteHas, setFilterAcompteHas] = useState<string>(''); // '' | '1'..'6'
  const [filterAcompteNext, setFilterAcompteNext] = useState<string>('');

  // Indexes acomptes par lot pour les 2 filtres
  const takenByLot = useMemo(() => {
    const m = new Map<string, Set<number>>();
    for (const p of payments ?? []) {
      if (!p.lot_id || p.acompte_number == null) continue;
      if (!m.has(p.lot_id)) m.set(p.lot_id, new Set());
      m.get(p.lot_id)!.add(p.acompte_number);
    }
    return m;
  }, [payments]);
  function nextFreeAcompte(lotId: string): number | null {
    const taken = takenByLot.get(lotId) ?? new Set<number>();
    for (let i = 1; i <= 6; i++) if (!taken.has(i)) return i;
    return null;
  }

  const visibleLots = useMemo(() => {
    let out = lots;
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      out = out.filter((l) =>
        (l.description ?? '').toLowerCase().includes(q) ||
        (l.category ?? '').toLowerCase().includes(q) ||
        (l.supplier_name ?? '').toLowerCase().includes(q) ||
        String(l.numero).includes(q),
      );
    }
    if (filterSupplierId) out = out.filter((l) => l.supplier_id === filterSupplierId);
    if (filterQuote === 'with') out = out.filter((l) => !!l.quote_doc_id);
    if (filterQuote === 'without') out = out.filter((l) => !l.quote_doc_id);
    if (filterInvoice === 'with') out = out.filter((l) => !!l.invoice_doc_id);
    if (filterInvoice === 'without') out = out.filter((l) => !l.invoice_doc_id);
    if (filterPo === 'with') out = out.filter((l) => !!l.purchase_order_doc_id);
    if (filterPo === 'without') out = out.filter((l) => !l.purchase_order_doc_id);
    if (filterAcompteHas) {
      const n = Number(filterAcompteHas);
      out = out.filter((l) => takenByLot.get(l.id)?.has(n) ?? false);
    }
    if (filterAcompteNext) {
      const n = Number(filterAcompteNext);
      out = out.filter((l) => nextFreeAcompte(l.id) === n);
    }
    return out;
  }, [lots, filterText, filterSupplierId, filterQuote, filterInvoice, filterPo, filterAcompteHas, filterAcompteNext, takenByLot]);

  const hasFilter = !!filterText || !!filterSupplierId
    || filterQuote !== 'all' || filterInvoice !== 'all' || filterPo !== 'all'
    || !!filterAcompteHas || !!filterAcompteNext;

  const selectedLots = useMemo(() => lots.filter((l) => selected.has(l.id)), [lots, selected]);

  // CEO 2026-06-25 (Phase B6) : compteur d'acomptes éligibles parmi les lots
  // sélectionnés (= éligibles ET pas déjà en demande active). Sert au label
  // du bouton "Demander paiement (N)".
  const eligibleAcomptesForSelection = useMemo(() => {
    if (!bulkRequestAcomptes || bulkRequestAcomptes.length === 0) return [];
    if (selected.size === 0) return [];
    return bulkRequestAcomptes.filter(
      (a) => selected.has(a.lot_id) && !a.has_active_request,
    );
  }, [bulkRequestAcomptes, selected]);
  const requestPaymentEnabled =
    !!projectId
    && Array.isArray(bulkRequestAcomptes)
    && selected.size > 0
    && eligibleAcomptesForSelection.length > 0;

  // Pour attacher un doc, on veut un seul fournisseur dans la sélection
  const uniqueSuppliers = useMemo(() => {
    const set = new Set<string>();
    for (const l of selectedLots) if (l.supplier_id) set.add(l.supplier_id);
    return Array.from(set);
  }, [selectedLots]);
  const sharedSupplierId = uniqueSuppliers.length === 1 ? uniqueSuppliers[0] : null;
  const sharedSupplierName = sharedSupplierId
    ? suppliers.find((s) => s.id === sharedSupplierId)?.agency_name
    : null;

  const docsForSharedSupplier = useMemo(() => {
    if (!sharedSupplierId) return [];
    // CEO 2026-06-18 : depuis B1, supplier_id pointe artisans → on filtre
    // sur artisan_id (avant : partner_id ne matchait jamais après B1).
    return recentDocs.filter((d) => d.artisan_id === sharedSupplierId);
  }, [recentDocs, sharedSupplierId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    // CEO 2026-06-16 : "tout cocher" sélectionne uniquement les lots VISIBLES
    // (après filtres). Évite de cocher accidentellement des lots cachés.
    const visibleIds = new Set(visibleLots.map((l) => l.id));
    const allVisibleSelected = visibleLots.length > 0
      && visibleLots.every((l) => selected.has(l.id));
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of visibleIds) next.add(id);
        return next;
      });
    }
  }

  function clearFilters() {
    setFilterText('');
    setFilterSupplierId('');
    setFilterQuote('all');
    setFilterInvoice('all');
    setFilterPo('all');
    setFilterAcompteHas('');
    setFilterAcompteNext('');
  }

  function reset() {
    setAction(null);
    setSelectedSupplierId('');
    setSelectedDocId(null);
    setMsg(null);
    setPriceMode('set');
    setPriceValue('');
    setDupMode('copies');
    setDupCopies('1');
    setDupUnitIds(new Set());
    setDupCopyAcomptes(false);
  }

  // ─── Aperçu "Modifier le prix" (même règle que le serveur) ──────────────
  // Miroir client de bulkUpdateAchatPricesAction : le serveur reste
  // l'autorité, l'aperçu sert à confirmer AVANT d'appliquer (récap demandé
  // par le cahier des charges).
  const pricePreview = useMemo(() => {
    const v = Number(priceValue);
    if (priceValue.trim() === '' || Number.isNaN(v)) return null;
    return selectedLots.map((l) => {
      const current = (l as any)[priceField] == null ? null : Number((l as any)[priceField]);
      let next: number | null = null;
      let skip: string | null = null;
      if (priceMode === 'set') {
        next = v;
        if (v < 0) skip = 'Prix négatif';
      } else if (current == null) {
        skip = 'Champ non renseigné';
      } else {
        next = priceMode === 'pct'
          ? Math.round(current * (1 + v / 100) * 100) / 100
          : Math.round((current + v) * 100) / 100;
        if (next < 0) skip = 'Résultat négatif';
        else if (next === current) skip = 'Inchangé';
      }
      return { lot: l, current, next, skip };
    });
  }, [selectedLots, priceField, priceMode, priceValue]);
  const priceApplicableCount = pricePreview?.filter((p) => !p.skip).length ?? 0;

  function runEditPrice() {
    if (!projectId || selectedLots.length === 0 || priceApplicableCount === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkUpdateAchatPricesAction({
        project_id: projectId,
        lot_ids: ids,
        field: priceField,
        mode: priceMode,
        value: Number(priceValue),
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) {
        setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' });
        return;
      }
      const skippedCount = ((r as any).skipped ?? []).length;
      setMsg({
        kind: 'ok',
        text: `✓ Prix modifié sur ${(r as any).updatedCount} lot(s)${skippedCount > 0 ? ` · ${skippedCount} ignoré(s)` : ''}`,
      });
      setSelected(new Set());
      reset();
      router.refresh();
    });
  }

  // ─── Duplication ────────────────────────────────────────────────────────
  const dupTotal = dupMode === 'copies'
    ? selectedLots.length * (Number(dupCopies) || 0)
    : selectedLots.length * dupUnitIds.size;

  function toggleDupUnit(id: string) {
    setDupUnitIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function runDuplicate() {
    if (!projectId || selectedLots.length === 0 || dupTotal === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkDuplicateAchatLotsAction({
        project_id: projectId,
        lot_ids: ids,
        mode: dupMode,
        copies: dupMode === 'copies' ? Number(dupCopies) : undefined,
        target_unit_ids: dupMode === 'suites' ? Array.from(dupUnitIds) : undefined,
        copy_acomptes: dupCopyAcomptes,
      }).catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) {
        setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' });
        return;
      }
      const ac = (r as any).acomptesCopied ?? 0;
      setMsg({
        kind: 'ok',
        text: `✓ ${(r as any).createdCount} lot(s) créé(s) par duplication${ac > 0 ? ` · ${ac} acompte(s) copié(s)` : ''}`,
      });
      setSelected(new Set());
      reset();
      router.refresh();
    });
  }

  function runAttachDoc(docRole: 'invoice' | 'quote' | 'purchase_order') {
    if (!selectedDocId || selectedLots.length === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkAttachAchatDocAction({ lot_ids: ids, doc_id: selectedDocId, doc_role: docRole })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) {
        setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' });
        return;
      }
      setMsg({ kind: 'ok', text: `✓ Document attaché à ${ids.length} lot(s)` });
      setSelected(new Set());
      reset();
      router.refresh();
    });
  }

  function runAssignSupplier() {
    if (!selectedSupplierId || selectedLots.length === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkAssignAchatSupplierAction({ lot_ids: ids, supplier_id: selectedSupplierId })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) {
        setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' });
        return;
      }
      setMsg({ kind: 'ok', text: `✓ Fournisseur affecté à ${ids.length} lot(s)` });
      setSelected(new Set());
      reset();
      router.refresh();
    });
  }

  function runDelete() {
    if (selectedLots.length === 0) return;
    if (!confirm(`Soft-delete ${selectedLots.length} lot(s) ? La suppression définitive sera validée par le CEO dans /propria/suppressions.`)) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkSoftDeleteAchatLotsAction({ lot_ids: ids })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) {
        setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' });
        return;
      }
      setMsg({ kind: 'ok', text: `✓ ${ids.length} lot(s) supprimé(s) — en attente de validation CEO` });
      setSelected(new Set());
      reset();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border border-stoniz-gray-300 px-3 py-1.5 rounded-md text-xs hover:bg-stoniz-gray-50 inline-flex items-center gap-1.5"
      >
        <CheckSquare className="w-3.5 h-3.5" />
        Actions en bulk
      </button>
    );
  }

  return (
    <div className="bg-white border-2 border-blue-300 rounded-xl p-4 mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium inline-flex items-center gap-2">
          <CheckSquare className="w-4 h-4 text-blue-600" />
          Sélection multiple ({selected.size}/{lots.length}
          {hasFilter && <span className="text-stoniz-gray-500"> · {visibleLots.length} affichés</span>})
        </div>
        <button
          type="button"
          onClick={() => { setOpen(false); setSelected(new Set()); reset(); }}
          className="text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1 text-xs"
        >
          <X className="w-3 h-3" /> Fermer
        </button>
      </div>

      {/* Filtres pour cibler 1 fournisseur / les lots sans doc (CEO 2026-06-16) */}
      <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-2 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 text-xs text-stoniz-gray-500">
          <Filter className="w-3 h-3" /> Filtres :
        </div>
        <div className="relative">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
          <input
            type="text"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder="Recherche n°, description, fournisseur…"
            className="pl-7 pr-2 py-1 text-xs border border-stoniz-gray-300 rounded w-56"
          />
        </div>
        <select
          value={filterSupplierId}
          onChange={(e) => setFilterSupplierId(e.target.value)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
        >
          <option value="">Tous fournisseurs</option>
          {suppliers
            .filter((s) => lots.some((l) => l.supplier_id === s.id))
            .sort((a, b) => (a.agency_name ?? '').localeCompare(b.agency_name ?? ''))
            .map((s) => (
              <option key={s.id} value={s.id}>{s.agency_name ?? '?'}</option>
            ))}
        </select>
        <select
          value={filterQuote}
          onChange={(e) => setFilterQuote(e.target.value as any)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
          title="Devis"
        >
          <option value="all">Devis : tous</option>
          <option value="with">Avec devis</option>
          <option value="without">Sans devis</option>
        </select>
        <select
          value={filterInvoice}
          onChange={(e) => setFilterInvoice(e.target.value as any)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
          title="Facture"
        >
          <option value="all">Facture : toutes</option>
          <option value="with">Avec facture</option>
          <option value="without">Sans facture</option>
        </select>
        <select
          value={filterPo}
          onChange={(e) => setFilterPo(e.target.value as any)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
          title="Bon de commande"
        >
          <option value="all">BC : tous</option>
          <option value="with">Avec BC</option>
          <option value="without">Sans BC</option>
        </select>
        {payments && (
          <>
            <select
              value={filterAcompteHas}
              onChange={(e) => setFilterAcompteHas(e.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
              title="Lots ayant déjà l'acompte n°"
            >
              <option value="">A déjà acompte n°…</option>
              {[1,2,3,4,5,6].map(n => <option key={n} value={String(n)}>{n}{n===1?'er':'ème'}</option>)}
            </select>
            <select
              value={filterAcompteNext}
              onChange={(e) => setFilterAcompteNext(e.target.value)}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
              title="Lots dont le prochain acompte libre est n°"
            >
              <option value="">Prochain acompte = n°…</option>
              {[1,2,3,4,5,6].map(n => <option key={n} value={String(n)}>{n}{n===1?'er':'ème'}</option>)}
            </select>
          </>
        )}
        {hasFilter && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Réinitialiser
          </button>
        )}
      </div>

      {/* Tableau cochable */}
      <div className="border border-stoniz-gray-200 rounded max-h-72 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-stoniz-gray-50 sticky top-0">
            <tr>
              <th className="px-2 py-1.5 w-8">
                <button
                  type="button"
                  onClick={toggleAll}
                  title={hasFilter ? `Cocher/décocher les ${visibleLots.length} lots affichés` : 'Tout cocher / décocher'}
                >
                  {visibleLots.length > 0 && visibleLots.every((l) => selected.has(l.id))
                    ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                    : <Square className="w-3.5 h-3.5 text-stoniz-gray-400" />}
                </button>
              </th>
              <th className="px-2 py-1.5 text-left w-12">N°</th>
              <th className="px-2 py-1.5 text-left">Description</th>
              <th className="px-2 py-1.5 text-left">Fournisseur</th>
              <th className="px-2 py-1.5 text-center w-16">Devis</th>
              <th className="px-2 py-1.5 text-center w-16">BC</th>
              <th className="px-2 py-1.5 text-center w-16">Facture</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visibleLots.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-4 text-center text-stoniz-gray-400 text-xs">
                  Aucun lot ne correspond aux filtres.{' '}
                  <button type="button" onClick={clearFilters} className="text-blue-600 hover:underline">
                    Réinitialiser
                  </button>
                </td>
              </tr>
            )}
            {visibleLots.map((l) => (
              <tr key={l.id} className={selected.has(l.id) ? 'bg-blue-50' : 'hover:bg-stoniz-gray-50'}>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => toggle(l.id)}>
                    {selected.has(l.id)
                      ? <CheckSquare className="w-3.5 h-3.5 text-blue-600" />
                      : <Square className="w-3.5 h-3.5 text-stoniz-gray-400" />}
                  </button>
                </td>
                <td className="px-2 py-1.5 font-mono">{l.numero}</td>
                <td className="px-2 py-1.5 truncate max-w-[200px]">{l.description ?? l.category}</td>
                <td className="px-2 py-1.5 truncate max-w-[120px]">{l.supplier_name}</td>
                <td className="px-2 py-1.5 text-center">{l.quote_doc_id ? '✓' : <span className="text-orange-500">—</span>}</td>
                <td className="px-2 py-1.5 text-center">{l.purchase_order_doc_id ? '✓' : <span className="text-orange-500">—</span>}</td>
                <td className="px-2 py-1.5 text-center">{l.invoice_doc_id ? '✓' : <span className="text-orange-500">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="border-t border-stoniz-gray-200 pt-3">
          {/* Choix de l'action */}
          {!action && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAction('attach_invoice')}
                className="bg-blue-50 text-blue-700 border border-blue-200 px-3 py-1.5 rounded text-xs hover:bg-blue-100 inline-flex items-center gap-1">
                <Receipt className="w-3 h-3" /> Attacher une facture
              </button>
              <button type="button" onClick={() => setAction('attach_quote')}
                className="bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1.5 rounded text-xs hover:bg-purple-100 inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Attacher un devis
              </button>
              <button type="button" onClick={() => setAction('attach_po')}
                className="bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1.5 rounded text-xs hover:bg-amber-100 inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Attacher un bon de commande
              </button>
              <button type="button" onClick={() => setAction('assign_supplier')}
                className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded text-xs hover:bg-emerald-100 inline-flex items-center gap-1">
                <User2 className="w-3 h-3" /> Affecter un fournisseur
              </button>
              {/* CEO 2026-08-19 (session A) : prix en masse + duplication */}
              {projectId && (
                <button type="button" onClick={() => setAction('edit_price')}
                  className="bg-teal-50 text-teal-700 border border-teal-200 px-3 py-1.5 rounded text-xs hover:bg-teal-100 inline-flex items-center gap-1">
                  <Banknote className="w-3 h-3" /> Modifier le prix
                </button>
              )}
              {projectId && (
                <button type="button" onClick={() => setAction('duplicate')}
                  className="bg-sky-50 text-sky-700 border border-sky-200 px-3 py-1.5 rounded text-xs hover:bg-sky-100 inline-flex items-center gap-1">
                  <Copy className="w-3 h-3" /> Dupliquer
                </button>
              )}
              <button type="button" onClick={() => setAction('delete')}
                className="bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded text-xs hover:bg-red-100 inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Supprimer la sélection
              </button>
              {/* CEO 2026-07-08 : gestion bulk des acomptes existants
                  (supprimer / date / montant) des lots cochés. */}
              {payments && projectId && (
                <button type="button" onClick={() => setAction('manage_acomptes')}
                  className="bg-orange-50 text-orange-800 border border-orange-200 px-3 py-1.5 rounded text-xs hover:bg-orange-100 inline-flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" /> Gérer les acomptes
                </button>
              )}
              {/* CEO 2026-06-25 (Phase B6) : 2e porte d'entrée vers le drawer
                  "Demander paiement" — préfiltré sur les lots cochés ici.
                  Le bouton header reste actif en parallèle. */}
              {projectId && Array.isArray(bulkRequestAcomptes) && (
                <button
                  type="button"
                  onClick={() => setRequestPaymentOpen(true)}
                  disabled={!requestPaymentEnabled}
                  title={
                    !requestPaymentEnabled
                      ? 'Aucun acompte éligible pour les lots sélectionnés.'
                      : `Ouvrir le drawer préfiltré sur ${selected.size} lot(s)`
                  }
                  className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded text-xs hover:bg-indigo-100 inline-flex items-center gap-1 disabled:opacity-50 disabled:hover:bg-indigo-50"
                >
                  <Wallet className="w-3 h-3" /> Demander paiement ({eligibleAcomptesForSelection.length})
                </button>
              )}
            </div>
          )}

          {/* Attacher doc (facture / devis / bon de commande) */}
          {(action === 'attach_invoice' || action === 'attach_quote' || action === 'attach_po') && (() => {
            const docKind = action === 'attach_invoice' ? 'facture'
              : action === 'attach_quote' ? 'devis'
              : 'bon_commande';
            const label = action === 'attach_invoice' ? 'une facture'
              : action === 'attach_quote' ? 'un devis'
              : 'un bon de commande';
            const role = action === 'attach_invoice' ? 'invoice'
              : action === 'attach_quote' ? 'quote'
              : 'purchase_order';
            return (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium">
                    Attacher {label} à {selected.size} lot(s)
                  </div>
                  <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">Annuler</button>
                </div>
                {!sharedSupplierId ? (
                  <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
                    Les lots sélectionnés ont des fournisseurs différents.
                    Sélectionne uniquement des lots du <strong>même fournisseur</strong> pour
                    attacher un document partagé.
                  </div>
                ) : (
                  <>
                    <div className="text-xs text-stoniz-gray-600">
                      Fournisseur : <strong>{sharedSupplierName}</strong>
                    </div>
                    {/* Fix Chadi 2026-06-18 :
                        - vendor_kind='artisan' (B1)
                        - filtre doc_type (bug bonus : facture / devis / BC ne doivent
                          pas être mélangés dans la liste proposée) */}
                    <VendorDocPicker
                      vendorKind="artisan"
                      artisanId={sharedSupplierId}
                      docType={docKind}
                      onPicked={setSelectedDocId}
                      recentDocs={docsForSharedSupplier.filter((d: any) => d.doc_type === docKind)}
                    />
                    {selectedDocId && (
                      <button
                        type="button"
                        onClick={() => runAttachDoc(role as any)}
                        disabled={pending}
                        className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50"
                      >
                        {pending ? '…' : `✓ Attacher à ${selected.size} lot(s)`}
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })()}

          {/* Assigner fournisseur */}
          {action === 'assign_supplier' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Affecter un fournisseur à {selected.size} lot(s)</div>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">Annuler</button>
              </div>
              <select
                value={selectedSupplierId}
                onChange={(e) => setSelectedSupplierId(e.target.value)}
                className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs"
              >
                <option value="">— Choisir un fournisseur —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.agency_name ?? '?'}</option>
                ))}
              </select>
              {selectedSupplierId && (
                <button
                  type="button"
                  onClick={runAssignSupplier}
                  disabled={pending}
                  className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50"
                >
                  {pending ? '…' : `✓ Affecter à ${selected.size} lot(s)`}
                </button>
              )}
            </div>
          )}

          {/* Modifier le prix en masse (CEO 2026-08-19, session A) */}
          {action === 'edit_price' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Modifier le prix de {selected.size} lot(s)</div>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">Annuler</button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={priceField}
                  onChange={(e) => setPriceField(e.target.value as PriceField)}
                  className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
                >
                  {PRICE_FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <select
                  value={priceMode}
                  onChange={(e) => setPriceMode(e.target.value as PriceMode)}
                  className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
                >
                  <option value="set">Valeur unique (MAD)</option>
                  <option value="pct">Ajustement en % (ex : 5 ou −10)</option>
                  <option value="delta">Ajustement en MAD (ex : 150 ou −200)</option>
                </select>
                <input
                  type="number"
                  step="0.01"
                  value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  placeholder={priceMode === 'set' ? 'Nouveau prix MAD' : priceMode === 'pct' ? '% (±)' : 'MAD (±)'}
                  className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 w-36"
                />
              </div>
              {priceMode !== 'set' && (
                <p className="text-[11px] text-stoniz-gray-500">
                  L'ajustement s'applique à la valeur actuelle de chaque lot. Les lots sans valeur sur ce champ seront ignorés.
                </p>
              )}
              {priceField === 'unit_price_mad' && (
                <p className="text-[11px] text-stoniz-gray-500">
                  Le devis prévisionnel n'est pas recalculé automatiquement (quantité × prix unitaire est un pré-remplissage de saisie, pas une règle).
                </p>
              )}
              {pricePreview && (
                <div className="border border-stoniz-gray-200 rounded max-h-48 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-stoniz-gray-50 sticky top-0">
                      <tr>
                        <th className="px-2 py-1 text-left w-12">N°</th>
                        <th className="px-2 py-1 text-left">Lot</th>
                        <th className="px-2 py-1 text-right">Actuel</th>
                        <th className="px-2 py-1 text-right">Nouveau</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stoniz-gray-100">
                      {pricePreview.map(({ lot, current, next, skip }) => (
                        <tr key={lot.id} className={skip ? 'text-stoniz-gray-400' : ''}>
                          <td className="px-2 py-1 font-mono">{lot.numero}</td>
                          <td className="px-2 py-1 truncate max-w-[180px]">{lot.description ?? lot.category}</td>
                          <td className="px-2 py-1 text-right font-mono">{current == null ? '—' : current.toLocaleString('fr-FR')}</td>
                          <td className="px-2 py-1 text-right font-mono">
                            {skip
                              ? <span className="text-orange-600" title={skip}>ignoré · {skip}</span>
                              : next?.toLocaleString('fr-FR')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button
                type="button"
                onClick={runEditPrice}
                disabled={pending || priceApplicableCount === 0}
                className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50"
              >
                {pending ? '…' : `✓ Appliquer à ${priceApplicableCount} lot(s)`}
              </button>
            </div>
          )}

          {/* Dupliquer en masse (CEO 2026-08-19, session A) */}
          {action === 'duplicate' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Dupliquer {selected.size} lot(s)</div>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black">Annuler</button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs">
                  <input type="radio" checked={dupMode === 'copies'} onChange={() => setDupMode('copies')} />
                  Nombre de copies
                </label>
                {dupMode === 'copies' && (
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={dupCopies}
                    onChange={(e) => setDupCopies(e.target.value)}
                    className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 w-16"
                  />
                )}
                {(units?.length ?? 0) > 0 && (
                  <label className="inline-flex items-center gap-1.5 text-xs">
                    <input type="radio" checked={dupMode === 'suites'} onChange={() => setDupMode('suites')} />
                    Vers des suites cibles
                  </label>
                )}
              </div>
              {dupMode === 'suites' && (
                <div className="flex flex-wrap gap-2">
                  {(units ?? []).map((u) => (
                    <label key={u.id} className={`inline-flex items-center gap-1.5 text-xs border rounded px-2 py-1 cursor-pointer ${dupUnitIds.has(u.id) ? 'bg-sky-50 border-sky-300 text-sky-800' : 'border-stoniz-gray-300'}`}>
                      <input type="checkbox" checked={dupUnitIds.has(u.id)} onChange={() => toggleDupUnit(u.id)} />
                      {u.code ?? 'Suite ?'}
                    </label>
                  ))}
                </div>
              )}
              <label className="inline-flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={dupCopyAcomptes} onChange={(e) => setDupCopyAcomptes(e.target.checked)} />
                Copier l'échéancier d'acomptes (non payés uniquement)
              </label>
              <div className="text-xs bg-sky-50 border border-sky-200 rounded p-2 text-sky-900">
                {dupTotal === 0
                  ? 'Choisis le nombre de copies ou au moins une suite cible.'
                  : <>Récap : <strong>{dupTotal} nouveau(x) lot(s)</strong> seront créés
                      ({selected.size} lot(s) × {dupMode === 'copies' ? `${Number(dupCopies) || 0} copie(s)` : `${dupUnitIds.size} suite(s)`}).
                      Copies au statut « À commander », sans dates ni documents.</>}
              </div>
              <button
                type="button"
                onClick={runDuplicate}
                disabled={pending || dupTotal === 0}
                className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50"
              >
                {pending ? '…' : `✓ Créer ${dupTotal} lot(s)`}
              </button>
            </div>
          )}

          {/* Gérer les acomptes existants (CEO 2026-07-08) */}
          {action === 'manage_acomptes' && payments && projectId && (
            <BulkAcomptesManager
              projectId={projectId}
              source="achats"
              lots={selectedLots.map((l) => ({
                id: l.id,
                label: `Lot ${l.numero} · ${l.description ?? l.category} (${l.supplier_name})`,
                devis: l.devis_fournisseur_mad ?? null,
              }))}
              payments={payments.map((p) => ({
                id: p.id,
                lot_id: p.lot_id,
                acompte_number: p.acompte_number,
                status: p.status,
                amount_total: Number(p.amount_total ?? 0),
                scheduled_date: p.scheduled_date ?? null,
              }))}
              onClose={reset}
            />
          )}

          {/* Supprimer */}
          {action === 'delete' && (
            <div className="space-y-2">
              <div className="text-xs">
                Supprimer <strong>{selected.size} lot(s)</strong> ? La suppression définitive sera validée
                par le CEO dans <code>/propria/suppressions</code>.
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={runDelete} disabled={pending}
                  className="bg-red-600 text-white px-3 py-1.5 rounded text-xs hover:bg-red-700 disabled:opacity-50">
                  {pending ? '…' : `Confirmer la suppression`}
                </button>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500 hover:text-stoniz-black px-3 py-1.5">Annuler</button>
              </div>
            </div>
          )}
        </div>
      )}

      {msg && (
        <div className={`text-xs rounded px-2 py-1.5 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {/* CEO 2026-06-25 (Phase B6) : drawer "Demander paiement" hébergé par le
          panel, préfiltré sur les lots cochés. Lazy-mount : seul `open` change. */}
      {projectId && Array.isArray(bulkRequestAcomptes) && (
        <RequestPaymentDrawer
          open={requestPaymentOpen}
          onClose={() => setRequestPaymentOpen(false)}
          projectId={projectId}
          source="achats"
          acomptes={bulkRequestAcomptes}
          preselectedLotIds={Array.from(selected)}
        />
      )}
    </div>
  );
}
