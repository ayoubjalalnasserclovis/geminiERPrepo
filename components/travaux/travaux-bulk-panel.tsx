'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckSquare, Square, FileText, User2, Trash2, X, ArrowRightCircle, Filter, Search, Wallet, CalendarClock } from 'lucide-react';
import {
  bulkAttachTravauxQuoteAction,
  bulkAssignTravauxArtisanAction,
  bulkChangeTravauxStatusAction,
  bulkSoftDeleteTravauxLotsAction,
} from '@/app/(team)/projects/[id]/travaux/actions';
import { VendorDocPicker } from '@/components/vendor-documents/vendor-doc-picker';
import { RequestPaymentDrawer, type Acompte as BulkRequestAcompte } from '@/components/validations/request-payment-drawer';
import { BulkAcomptesManager } from '@/components/finance/bulk-acomptes-manager';
// Source de vérité : LOT_STATUSES de travaux-calc (enum BDD).
// Avant 2026-06-19 ce panneau avait des statuts hardcodés inexistants
// ('a_faire', 'cloture') → UPDATE échouait silencieusement avec CHECK violation.
import { LOT_STATUSES as STATUS_OPTIONS } from '@/lib/finance/travaux-calc';

type Lot = {
  id: string;
  numero: number;
  description: string | null;
  category: string;
  artisan_name: string | null;
  artisan_id: string | null;
  quote_doc_id: string | null;
  status: string;
  /** CEO 2026-07-08 : devis du lot — pour l'aperçu "Gérer les acomptes" (mode %). */
  devis_artisan_mad?: number | null;
};

/** CEO 2026-07-08 : acomptes du projet pour "Gérer les acomptes". */
type Payment = {
  id: string;
  lot_id: string | null;
  acompte_number: number | null;
  status: string;
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

type Artisan = { id: string; name: string };

type Action = 'attach_quote' | 'assign_artisan' | 'change_status' | 'delete' | 'manage_acomptes' | null;

export function TravauxBulkPanel({
  lots,
  artisans,
  recentDocs,
  projectId,
  bulkRequestAcomptes,
  payments,
}: {
  lots: Lot[];
  artisans: Artisan[];
  recentDocs: VendorDoc[];
  /** CEO 2026-06-25 (Phase B6) : pour le bouton "Demander paiement" intégré. */
  projectId?: string;
  /** CEO 2026-06-25 (Phase B6) : acomptes éligibles passés en prop par la page. */
  bulkRequestAcomptes?: BulkRequestAcompte[];
  /** CEO 2026-07-08 : acomptes du projet — active "Gérer les acomptes". */
  payments?: Payment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<Action>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // CEO 2026-06-25 (Phase B6) : drawer "Demander paiement" intégré au panel.
  const [requestPaymentOpen, setRequestPaymentOpen] = useState(false);

  const [selectedArtisanId, setSelectedArtisanId] = useState<string>('');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<string>('');

  // CEO 2026-06-16 : filtres pour cibler 1 artisan + lots sans devis
  const [filterText, setFilterText] = useState('');
  const [filterArtisanId, setFilterArtisanId] = useState<string>('');
  const [filterQuote, setFilterQuote] = useState<'all' | 'with' | 'without'>('all');
  const [filterStatus, setFilterStatus] = useState<string>('');

  const visibleLots = useMemo(() => {
    let out = lots;
    if (filterText.trim()) {
      const q = filterText.trim().toLowerCase();
      out = out.filter((l) =>
        (l.description ?? '').toLowerCase().includes(q) ||
        (l.category ?? '').toLowerCase().includes(q) ||
        (l.artisan_name ?? '').toLowerCase().includes(q) ||
        String(l.numero).includes(q),
      );
    }
    if (filterArtisanId) out = out.filter((l) => l.artisan_id === filterArtisanId);
    if (filterQuote === 'with') out = out.filter((l) => !!l.quote_doc_id);
    if (filterQuote === 'without') out = out.filter((l) => !l.quote_doc_id);
    if (filterStatus) out = out.filter((l) => l.status === filterStatus);
    return out;
  }, [lots, filterText, filterArtisanId, filterQuote, filterStatus]);

  const hasFilter = !!filterText || !!filterArtisanId || filterQuote !== 'all' || !!filterStatus;

  function clearFilters() {
    setFilterText('');
    setFilterArtisanId('');
    setFilterQuote('all');
    setFilterStatus('');
  }

  const selectedLots = useMemo(() => lots.filter((l) => selected.has(l.id)), [lots, selected]);

  // CEO 2026-06-25 (Phase B6) : compteur d'acomptes éligibles parmi la sélection.
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

  const uniqueArtisans = useMemo(() => {
    const set = new Set<string>();
    for (const l of selectedLots) if (l.artisan_id) set.add(l.artisan_id);
    return Array.from(set);
  }, [selectedLots]);
  const sharedArtisanId = uniqueArtisans.length === 1 ? uniqueArtisans[0] : null;
  const sharedArtisanName = sharedArtisanId
    ? artisans.find((a) => a.id === sharedArtisanId)?.name
    : null;
  const docsForSharedArtisan = useMemo(() => {
    if (!sharedArtisanId) return [];
    return recentDocs.filter((d) => d.artisan_id === sharedArtisanId);
  }, [recentDocs, sharedArtisanId]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    // CEO 2026-06-16 : sélectionne uniquement les lots VISIBLES (filtres actifs)
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
  function reset() {
    setAction(null);
    setSelectedArtisanId('');
    setSelectedDocId(null);
    setSelectedStatus('');
    setMsg(null);
  }

  function runAttachQuote() {
    if (!selectedDocId || selectedLots.length === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkAttachTravauxQuoteAction({ lot_ids: ids, doc_id: selectedDocId })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: `✓ Devis attaché à ${ids.length} lot(s)` });
      setSelected(new Set()); reset(); router.refresh();
    });
  }

  function runAssignArtisan() {
    if (!selectedArtisanId || selectedLots.length === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkAssignTravauxArtisanAction({ lot_ids: ids, artisan_id: selectedArtisanId })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: `✓ Artisan affecté à ${ids.length} lot(s)` });
      setSelected(new Set()); reset(); router.refresh();
    });
  }

  function runChangeStatus() {
    if (!selectedStatus || selectedLots.length === 0) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkChangeTravauxStatusAction({ lot_ids: ids, status: selectedStatus })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: `✓ Statut changé pour ${ids.length} lot(s)` });
      setSelected(new Set()); reset(); router.refresh();
    });
  }

  function runDelete() {
    if (selectedLots.length === 0) return;
    if (!confirm(`Soft-delete ${selectedLots.length} lot(s) ? Validation CEO via /propria/suppressions.`)) return;
    const ids = selectedLots.map((l) => l.id);
    start(async () => {
      const r = await bulkSoftDeleteTravauxLotsAction({ lot_ids: ids })
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!(r as any).ok) { setMsg({ kind: 'err', text: (r as any).error ?? 'Échec' }); return; }
      setMsg({ kind: 'ok', text: `✓ ${ids.length} lot(s) supprimé(s) — en attente de validation CEO` });
      setSelected(new Set()); reset(); router.refresh();
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="border border-stoniz-gray-300 px-3 py-1.5 rounded-md text-xs hover:bg-stoniz-gray-50 inline-flex items-center gap-1.5">
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
        <button type="button" onClick={() => { setOpen(false); setSelected(new Set()); reset(); }}
          className="text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1 text-xs">
          <X className="w-3 h-3" /> Fermer
        </button>
      </div>

      {/* Filtres pour cibler 1 artisan / les lots sans devis (CEO 2026-06-16) */}
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
            placeholder="Recherche n°, description, artisan…"
            className="pl-7 pr-2 py-1 text-xs border border-stoniz-gray-300 rounded w-56"
          />
        </div>
        <select
          value={filterArtisanId}
          onChange={(e) => setFilterArtisanId(e.target.value)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
        >
          <option value="">Tous artisans</option>
          {artisans
            .filter((a) => lots.some((l) => l.artisan_id === a.id))
            .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
            .map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
        </select>
        <select
          value={filterQuote}
          onChange={(e) => setFilterQuote(e.target.value as any)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
        >
          <option value="all">Devis : tous</option>
          <option value="with">Avec devis</option>
          <option value="without">Sans devis</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
        >
          <option value="">Statut : tous</option>
          {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
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
              <th className="px-2 py-1.5 text-left">Artisan</th>
              <th className="px-2 py-1.5 text-center w-16">Devis</th>
              <th className="px-2 py-1.5 text-left w-20">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {visibleLots.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-stoniz-gray-400 text-xs">
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
                <td className="px-2 py-1.5 truncate max-w-[120px]">{l.artisan_name ?? '—'}</td>
                <td className="px-2 py-1.5 text-center">{l.quote_doc_id ? '✓' : <span className="text-orange-500">—</span>}</td>
                <td className="px-2 py-1.5 text-stoniz-gray-600">{l.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected.size > 0 && (
        <div className="border-t border-stoniz-gray-200 pt-3">
          {!action && (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAction('attach_quote')}
                className="bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1.5 rounded text-xs hover:bg-purple-100 inline-flex items-center gap-1">
                <FileText className="w-3 h-3" /> Attacher un devis
              </button>
              <button type="button" onClick={() => setAction('assign_artisan')}
                className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1.5 rounded text-xs hover:bg-emerald-100 inline-flex items-center gap-1">
                <User2 className="w-3 h-3" /> Affecter un artisan
              </button>
              <button type="button" onClick={() => setAction('change_status')}
                className="bg-amber-50 text-amber-700 border border-amber-200 px-3 py-1.5 rounded text-xs hover:bg-amber-100 inline-flex items-center gap-1">
                <ArrowRightCircle className="w-3 h-3" /> Changer le statut
              </button>
              <button type="button" onClick={() => setAction('delete')}
                className="bg-red-50 text-red-700 border border-red-200 px-3 py-1.5 rounded text-xs hover:bg-red-100 inline-flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Supprimer la sélection
              </button>
              {/* CEO 2026-07-08 : gestion bulk des acomptes existants. */}
              {payments && projectId && (
                <button type="button" onClick={() => setAction('manage_acomptes')}
                  className="bg-orange-50 text-orange-800 border border-orange-200 px-3 py-1.5 rounded text-xs hover:bg-orange-100 inline-flex items-center gap-1">
                  <CalendarClock className="w-3 h-3" /> Gérer les acomptes
                </button>
              )}
              {/* CEO 2026-06-25 (Phase B6) : 2e porte d'entrée vers le drawer
                  "Demander paiement" — préfiltré sur les lots cochés. */}
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

          {action === 'attach_quote' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Attacher un devis à {selected.size} lot(s)</div>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500">Annuler</button>
              </div>
              {!sharedArtisanId ? (
                <div className="text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
                  Les lots sélectionnés ont des artisans différents.
                  Sélectionne uniquement des lots du <strong>même artisan</strong>.
                </div>
              ) : (
                <>
                  <div className="text-xs text-stoniz-gray-600">Artisan : <strong>{sharedArtisanName}</strong></div>
                  <VendorDocPicker
                    vendorKind="artisan"
                    artisanId={sharedArtisanId}
                    docType="devis"
                    onPicked={setSelectedDocId}
                    recentDocs={docsForSharedArtisan}
                  />
                  {selectedDocId && (
                    <button type="button" onClick={runAttachQuote} disabled={pending}
                      className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50">
                      {pending ? '…' : `✓ Attacher à ${selected.size} lot(s)`}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {action === 'assign_artisan' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Affecter un artisan à {selected.size} lot(s)</div>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500">Annuler</button>
              </div>
              <select value={selectedArtisanId} onChange={(e) => setSelectedArtisanId(e.target.value)}
                className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs">
                <option value="">— Choisir un artisan —</option>
                {artisans.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              {selectedArtisanId && (
                <button type="button" onClick={runAssignArtisan} disabled={pending}
                  className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50">
                  {pending ? '…' : `✓ Affecter à ${selected.size} lot(s)`}
                </button>
              )}
            </div>
          )}

          {action === 'change_status' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs font-medium">Changer le statut de {selected.size} lot(s)</div>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500">Annuler</button>
              </div>
              <select value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full border border-stoniz-gray-300 rounded px-2 py-1 text-xs">
                <option value="">— Choisir un statut —</option>
                {STATUS_OPTIONS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              {selectedStatus && (
                <button type="button" onClick={runChangeStatus} disabled={pending}
                  className="bg-stoniz-black text-white px-3 py-1.5 rounded text-xs disabled:opacity-50">
                  {pending ? '…' : `✓ Appliquer à ${selected.size} lot(s)`}
                </button>
              )}
            </div>
          )}

          {/* Gérer les acomptes existants (CEO 2026-07-08) */}
          {action === 'manage_acomptes' && payments && projectId && (
            <BulkAcomptesManager
              projectId={projectId}
              source="travaux"
              lots={selectedLots.map((l) => ({
                id: l.id,
                label: `Lot ${l.numero} · ${l.description ?? l.category} (${l.artisan_name ?? '?'})`,
                devis: l.devis_artisan_mad ?? null,
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

          {action === 'delete' && (
            <div className="space-y-2">
              <div className="text-xs">
                Supprimer <strong>{selected.size} lot(s)</strong> ? Validation CEO requise.
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={runDelete} disabled={pending}
                  className="bg-red-600 text-white px-3 py-1.5 rounded text-xs hover:bg-red-700 disabled:opacity-50">
                  {pending ? '…' : `Confirmer`}
                </button>
                <button type="button" onClick={reset} className="text-xs text-stoniz-gray-500 px-3 py-1.5">Annuler</button>
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
          panel travaux, préfiltré sur les lots cochés. */}
      {projectId && Array.isArray(bulkRequestAcomptes) && (
        <RequestPaymentDrawer
          open={requestPaymentOpen}
          onClose={() => setRequestPaymentOpen(false)}
          projectId={projectId}
          source="travaux"
          acomptes={bulkRequestAcomptes}
          preselectedLotIds={Array.from(selected)}
        />
      )}
    </div>
  );
}
