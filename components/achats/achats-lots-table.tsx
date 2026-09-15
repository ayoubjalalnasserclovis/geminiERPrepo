'use client';

import { useState, useTransition } from 'react';
import { Plus, ChevronDown, ChevronRight, Trash2, Landmark, PencilLine } from 'lucide-react';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatMad, formatDate } from '@/lib/utils/format';
import {
  ACHAT_CATEGORIES, ACHAT_LOT_STATUSES,
  formatAchatCategory, formatAchatLotStatus,
} from '@/lib/finance/achats-calc';
import {
  createAchatLotAction, updateAchatLotAction, deleteAchatLotAction,
  saveAchatAcompteAction, markAchatAcomptePaidAction, deleteAchatAcompteAction,
  setAchatAcompteSchedulingAction,
} from '@/app/(team)/projects/[id]/achats/actions';
import { RequestApprovalButton } from '@/components/validations/request-approval-button';
import { ArtisanCombobox } from '@/components/artisans/artisan-combobox';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';
import { PaymentInstallmentsTimeline } from '@/components/finance/payment-installments-timeline';
import { AchatLotDocuments } from '@/components/achats/achat-lot-documents';

type Lot = {
  id: string;
  numero: number;
  category: string;
  description: string | null;
  supplier_name: string;
  supplier_id: string | null;
  devis_number: string | null;
  budget_estimate_mad: number | null;
  devis_fournisseur_mad: number | null;
  facture_client_mad: number | null;
  /** Quantité commandée (champ indicatif, info commerciale). */
  quantity: number | null;
  /** Prix unitaire fournisseur en MAD (champ indicatif, info commerciale). */
  unit_price_mad: number | null;
  status: string;
  date_commande: string | null;
  date_livraison_estimee: string | null;
  date_livraison_reelle: string | null;
  notes: string | null;
  propria_unit_id: string | null;
  // FK documents fournisseur (CEO 2026-06-18 B5)
  quote_doc_id?: string | null;
  purchase_order_doc_id?: string | null;
  invoice_doc_id?: string | null;
};

export type ProjectUnit = {
  id: string;
  code: string;
  order_index: number | null;
};

type Acompte = {
  id: string;
  lot_id: string | null;
  acompte_number: number | null;
  acompte_pct: number | null;
  amount_total: number;
  amount_paid: number;
  status: string;
  scheduled_date: string | null;
  paid_at: string | null;
  notes: string | null;
};

type Supplier = { id: string; name: string };

const STATUS_COLORS: Record<string, any> = {
  a_commander:   'default',
  devis_recu:    'default',
  commande:      'warning',
  en_livraison:  'warning',
  livre:         'success',
  installe:      'success',
  annule:        'error',
};

type BankLink = { txId: string; bankLabel: string | null; opDate: string | null };

export function AchatsLotsTable({
  projectId, lots, payments, suppliers = [], units = [], bankLinks = {}, recentDocs = [],
}: {
  projectId: string;
  lots: Lot[];
  payments: Acompte[];
  suppliers?: Supplier[];
  units?: ProjectUnit[];
  /** payment_id → transaction bancaire rapprochée (CEO 2026-06-16) */
  bankLinks?: Record<string, BankLink>;
  recentDocs?: Array<{ id: string; reference: string | null; document_date: string | null; file_path: string | null; partner_id: string | null; doc_type?: string }>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [filterUnit, setFilterUnit] = useState<string>('');
  const [filterSupplier, setFilterSupplier] = useState<string>('');

  const unitsById = new Map(units.map((u) => [u.id, u]));
  function unitLabel(id: string | null): string {
    if (!id) return '';
    const u = unitsById.get(id);
    return u ? u.code : id.slice(0, 6);
  }

  // Catégories réellement présentes dans les lots (évite de proposer des options vides)
  const presentCategories = Array.from(new Set(lots.map((l) => l.category).filter(Boolean))).sort();

  // Fournisseurs réellement présents dans les lots du projet.
  // Clé = supplier_id (uuid) si rattaché à un artisan, sinon « name:Libellé » comme repli.
  // Cette clé matche la convention utilisée par BulkPlanAcomptes pour cohérence.
  const presentSuppliers = (() => {
    const seen = new Map<string, { key: string; label: string; count: number }>();
    lots.forEach((l) => {
      const key = l.supplier_id ?? `name:${l.supplier_name}`;
      const existing = seen.get(key);
      if (existing) existing.count++;
      else seen.set(key, { key, label: l.supplier_name, count: 1 });
    });
    return Array.from(seen.values()).sort((a, b) => a.label.localeCompare(b.label));
  })();

  const filteredLots = lots.filter((l) => {
    if (filterCategory && l.category !== filterCategory) return false;
    if (filterUnit === '_none' && l.propria_unit_id) return false;
    if (filterUnit && filterUnit !== '_none' && l.propria_unit_id !== filterUnit) return false;
    if (filterSupplier) {
      const lotKey = l.supplier_id ?? `name:${l.supplier_name}`;
      if (lotKey !== filterSupplier) return false;
    }
    return true;
  });

  const acomptesByLot = new Map<string, Acompte[]>();
  payments.forEach(p => {
    if (!p.lot_id) return;
    const arr = acomptesByLot.get(p.lot_id) ?? [];
    arr.push(p);
    acomptesByLot.set(p.lot_id, arr);
  });
  acomptesByLot.forEach(arr => arr.sort((a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0)));

  // ─── Siblings par fournisseur ───────────────────────────────────────────
  // Pour la modale d'édition : combien d'autres acomptes pending y a-t-il
  // pour le même fournisseur sur ce projet ? Si > 0, on propose la checkbox
  // « Appliquer aussi à ces N autres ».
  const lotById = new Map(lots.map((l) => [l.id, l]));
  const pendingBySupplierKey = new Map<string, string[]>();
  payments.forEach((p) => {
    if (p.status !== 'pending' || !p.lot_id) return;
    const lot = lotById.get(p.lot_id);
    if (!lot) return;
    const key = lot.supplier_id ?? (lot.supplier_name ? `name:${lot.supplier_name}` : null);
    if (!key) return;
    const arr = pendingBySupplierKey.get(key) ?? [];
    arr.push(p.id);
    pendingBySupplierKey.set(key, arr);
  });
  const siblingsByAcompteId = new Map<string, number>();
  pendingBySupplierKey.forEach((ids) => {
    ids.forEach((id) => siblingsByAcompteId.set(id, ids.length - 1));
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Lots d'achats ({lots.length})</CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Ajouter un lot
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {lots.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500">
            Aucun lot d'achat pour le moment. Cliquez sur "Ajouter un lot" pour commencer.
          </p>
        ) : (
          <div className="space-y-1">
            {/* Filtres : catégorie + suite */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 bg-white"
              >
                <option value="">Toutes catégories</option>
                {presentCategories.map((cat) => {
                  const opt = ACHAT_CATEGORIES.find((c) => c.value === cat);
                  return <option key={cat} value={cat}>{opt?.label ?? cat}</option>;
                })}
              </select>
              {units.length > 0 && (
                <select
                  value={filterUnit}
                  onChange={(e) => setFilterUnit(e.target.value)}
                  className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 bg-white"
                >
                  <option value="">Toutes suites</option>
                  <option value="_none">— Sans suite —</option>
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>{u.code}</option>
                  ))}
                </select>
              )}
              {presentSuppliers.length > 1 && (
                <select
                  value={filterSupplier}
                  onChange={(e) => setFilterSupplier(e.target.value)}
                  className="text-xs border border-stoniz-gray-300 rounded px-2 py-1 bg-white max-w-[220px]"
                  title="Filtrer les lots par fournisseur"
                >
                  <option value="">Tous fournisseurs</option>
                  {presentSuppliers.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.label} ({s.count})
                    </option>
                  ))}
                </select>
              )}
              {(filterCategory || filterUnit || filterSupplier) && (
                <button
                  type="button"
                  onClick={() => { setFilterCategory(''); setFilterUnit(''); setFilterSupplier(''); }}
                  className="text-xs text-stoniz-gray-500 hover:text-stoniz-black underline"
                >
                  Réinitialiser
                </button>
              )}
              <span className="text-xs text-stoniz-gray-500 ml-auto">
                {filteredLots.length} / {lots.length} lot{lots.length > 1 ? 's' : ''}
              </span>
            </div>

            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase text-stoniz-gray-500 border-b font-medium">
              <div className="col-span-1">N°</div>
              <div className="col-span-3">Description / Fournisseur</div>
              <div className="col-span-2">Catégorie</div>
              <div className="col-span-2 text-right">Devis</div>
              <div className="col-span-1 text-right">Facturé</div>
              <div className="col-span-1 text-right">Payé / Reste</div>
              <div className="col-span-2 text-right">Statut</div>
            </div>
            {filteredLots.map(lot => {
              const lotAcomptes = acomptesByLot.get(lot.id) ?? [];
              const totalPaye = lotAcomptes.reduce((s, a) => s + Number(a.amount_paid), 0);
              const restePayer = Number(lot.devis_fournisseur_mad ?? 0) - totalPaye;
              const isOpen = expanded === lot.id;
              const unitTag = unitLabel(lot.propria_unit_id);

              return (
                <div key={lot.id} className="border rounded-md overflow-hidden">
                  <button
                    onClick={() => setExpanded(isOpen ? null : lot.id)}
                    className="w-full grid grid-cols-12 gap-2 px-3 py-2 hover:bg-stoniz-gray-50 items-center text-left text-sm"
                  >
                    <div className="col-span-1 flex items-center gap-2">
                      {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                      <span className="font-mono">{lot.numero}</span>
                    </div>
                    <div className="col-span-3">
                      <div className="font-medium truncate flex items-center gap-2">
                        {lot.description ?? <span className="text-stoniz-gray-400">— sans description —</span>}
                        {unitTag && (
                          <span className="text-[10px] uppercase bg-stoniz-gray-100 text-stoniz-gray-700 border border-stoniz-gray-200 rounded px-1.5 py-0.5 font-normal">
                            {unitTag}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-stoniz-gray-500 truncate">
                        {lot.supplier_name}
                        {(lot.quantity != null && lot.unit_price_mad != null) && (
                          <span className="ml-2 text-stoniz-gray-400">
                            · {lot.quantity} × {formatMad(lot.unit_price_mad)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="col-span-2 text-xs text-stoniz-gray-700">
                      {formatAchatCategory(lot.category)}
                    </div>
                    <div className="col-span-2 text-right">{formatMad(lot.devis_fournisseur_mad)}</div>
                    <div className="col-span-1 text-right">{formatMad(lot.facture_client_mad)}</div>
                    <div className="col-span-1 text-right">
                      <div>{formatMad(totalPaye)}</div>
                      <div className="text-[10px] text-stoniz-gray-500">/ {formatMad(restePayer)}</div>
                    </div>
                    <div className="col-span-2 text-right">
                      <Badge variant={STATUS_COLORS[lot.status]}>{formatAchatLotStatus(lot.status)}</Badge>
                      {/* Mini-badges acomptes par lot (CEO 2026-06-22).
                          Couleurs : vert payé · rouge échu non payé · jaune sinon. */}
                      <LotAcomptesBadges
                        lotPayments={lotAcomptes}
                        devisFournisseurMad={Number(lot.devis_fournisseur_mad ?? 0)}
                      />
                    </div>
                  </button>

                  {isOpen && (
                    <LotDetail
                      lot={lot}
                      acomptes={lotAcomptes}
                      suppliers={suppliers}
                      units={units}
                      projectId={projectId}
                      onClose={() => setExpanded(null)}
                      siblingsByAcompteId={siblingsByAcompteId}
                      bankLinks={bankLinks}
                      recentDocs={recentDocs}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {addOpen && (
        <LotFormModal
          projectId={projectId}
          suppliers={suppliers}
          units={units}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Card>
  );
}

/**
 * Mini-badges acomptes affichés sous le badge statut d'une ligne lot.
 * Couleurs (canon CEO 2026-06-19) :
 *   - vert  = acompte payé (status='paid' ou amount_paid ≥ amount_total)
 *   - rouge = acompte échu (scheduled_date < today) ET pas payé
 *   - jaune = à venir / prévu (cas par défaut)
 * Format : `Ac.N - X%` (X% = `acompte_pct` ou auto-calc montant/devis fournisseur).
 */
function LotAcomptesBadges({
  lotPayments, devisFournisseurMad,
}: {
  lotPayments: Acompte[];
  devisFournisseurMad: number;
}) {
  if (lotPayments.length === 0) return null;
  const today = new Date().toISOString().slice(0, 10);
  const numbered = lotPayments
    .filter((p) => p.acompte_number != null)
    .sort((a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0));
  if (numbered.length === 0) return null;

  return (
    <div className="flex flex-wrap justify-end gap-0.5 mt-1">
      {numbered.map((p) => {
        const num = p.acompte_number;
        const pct = p.acompte_pct ?? (devisFournisseurMad > 0
          ? Math.round((Number(p.amount_total) / devisFournisseurMad) * 100)
          : null);
        const isPaid = p.status === 'paid' || Number(p.amount_paid ?? 0) >= Number(p.amount_total ?? 0);
        const isOverdue = !isPaid && p.scheduled_date != null && p.scheduled_date < today;
        const color = isPaid
          ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
          : isOverdue
            ? 'text-red-700 bg-red-50 border-red-200'
            : 'text-amber-700 bg-amber-50 border-amber-200';
        const titleParts = [
          `Acompte ${num}`,
          pct != null ? `(${pct}%)` : null,
          p.scheduled_date ? `— prévu ${p.scheduled_date}` : null,
          isPaid ? '— payé' : isOverdue ? '— EN RETARD' : '— à venir',
        ].filter(Boolean);
        return (
          <span
            key={p.id}
            className={`text-[10px] leading-tight px-1.5 py-0.5 rounded border ${color}`}
            title={titleParts.join(' ')}
          >
            Ac.{num}{pct != null ? ` - ${pct}%` : ''}
          </span>
        );
      })}
    </div>
  );
}

function LotDetail({
  lot, acomptes, suppliers, units = [], projectId, onClose, siblingsByAcompteId, bankLinks = {}, recentDocs = [],
}: {
  lot: Lot;
  acomptes: Acompte[];
  suppliers: Supplier[];
  units?: ProjectUnit[];
  projectId: string;
  onClose: () => void;
  /** Map acompte.id → nb autres pending du même fournisseur (passée depuis le parent). */
  siblingsByAcompteId: Map<string, number>;
  bankLinks?: Record<string, BankLink>;
  /** Docs vendor récents pour résoudre quote/po/invoice (CEO 2026-06-18 B5). */
  recentDocs?: Array<{ id: string; reference: string | null; document_date: string | null; file_path: string | null; partner_id: string | null; doc_type?: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [acompteOpen, setAcompteOpen] = useState<number | null>(null);

  const nextAcompteNum = (() => {
    for (let i = 1; i <= 6; i++) {
      if (!acomptes.find(a => a.acompte_number === i)) return i;
    }
    return null;
  })();

  function remove() {
    if (!confirm('Supprimer ce lot ?')) return;
    start(async () => {
      const r = await deleteAchatLotAction(lot.id);
      if (!r.ok) setError(r.error ?? 'Erreur');
      else onClose();
    });
  }

  return (
    <div className="bg-stoniz-gray-50 border-t p-4 space-y-4">
      {editing ? (
        <LotEditForm lot={lot} suppliers={suppliers} units={units} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <DetailRow label="Description" value={lot.description ?? '—'} />
            <DetailRow label="N° devis" value={lot.devis_number ?? '—'} />
            <DetailRow label="Budget estimé" value={formatMad(lot.budget_estimate_mad)} />
            <DetailRow label="Quantité commandée" value={lot.quantity != null ? lot.quantity : '—'} />
            <DetailRow label="Prix unitaire" value={formatMad(lot.unit_price_mad)} />
            <DetailRow label="Devis fournisseur" value={formatMad(lot.devis_fournisseur_mad)} />
            <DetailRow label="Facturé client" value={formatMad(lot.facture_client_mad)} />
            <DetailRow label="Date commande" value={formatDate(lot.date_commande)} />
            <DetailRow label="Livraison estimée" value={formatDate(lot.date_livraison_estimee)} />
            <DetailRow label="Livraison réelle" value={formatDate(lot.date_livraison_reelle)} />
          </div>

          {/* Synthèse acomptes vs devis fournisseur — double-check visuel CEO */}
          {(() => {
            const totalAcomptes = acomptes.reduce((s, a) => s + Number(a.amount_total ?? 0), 0);
            const totalPaye = acomptes.reduce((s, a) => s + Number(a.amount_paid ?? 0), 0);
            const devis = Number(lot.devis_fournisseur_mad ?? 0);
            const ecart = devis - totalAcomptes;
            const ecartAbs = Math.abs(ecart);
            const ecartPct = devis > 0 ? (ecartAbs / devis) * 100 : 0;
            const isWarning = devis > 0 && ecartPct > 0.5; // > 0.5 % d'écart
            const showPaye = totalPaye !== totalAcomptes;
            return (
              <div className="bg-white rounded-md border p-3 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-stoniz-gray-500">Total acomptes :</span>
                  <strong>{formatMad(totalAcomptes)}</strong>
                  {devis > 0 && (
                    <span className="text-xs text-stoniz-gray-500">
                      ({Math.round((totalAcomptes / devis) * 100)}% du devis)
                    </span>
                  )}
                  {isWarning && (
                    <span
                      className="inline-flex items-center gap-1 text-xs text-amber-700"
                      title={`Écart de ${formatMad(ecartAbs)} entre devis (${formatMad(devis)}) et somme acomptes (${formatMad(totalAcomptes)})`}
                    >
                      ⚠ écart {formatMad(ecartAbs)}
                    </span>
                  )}
                </div>
                {showPaye && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-stoniz-gray-500">Déjà payé :</span>
                    <strong>{formatMad(totalPaye)}</strong>
                    {devis > 0 && (
                      <span className="text-xs text-stoniz-gray-500">
                        ({Math.round((totalPaye / devis) * 100)}% du devis)
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

          {lot.notes && (
            <div className="text-sm bg-white rounded-md p-3 border">
              <div className="text-xs uppercase text-stoniz-gray-500 mb-1">Notes</div>
              {lot.notes}
            </div>
          )}
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Modifier le lot</Button>
            <Button size="sm" variant="ghost" onClick={remove} disabled={pending}>
              <Trash2 className="w-4 h-4" /> Supprimer
            </Button>
          </div>
          {error && <div className="text-sm text-red-600">{error}</div>}
        </>
      )}

      {/* Acomptes fournisseur */}
      <div className="border-t pt-4">
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-sm">Acomptes ({acomptes.length} / 6)</h4>
          {nextAcompteNum !== null && (
            <Button size="sm" variant="ghost" onClick={() => setAcompteOpen(nextAcompteNum)}>
              <Plus className="w-3 h-3" /> Acompte {nextAcompteNum}
            </Button>
          )}
        </div>

        {/* Mini-timeline jalons (chantier C4 — CEO 2026-06-18) */}
        {acomptes.length > 0 && (
          <div className="mb-3 bg-white rounded-md border px-3">
            <PaymentInstallmentsTimeline
              installments={acomptes.map((a) => ({
                id: a.id,
                scheduled_date: a.scheduled_date,
                paid_at: a.paid_at,
                amount_total: Number(a.amount_total ?? 0),
                status: a.status,
              }))}
            />
          </div>
        )}

        {acomptes.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500">Aucun acompte enregistré.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {acomptes.map(a => (
              <AcompteRow key={a.id} acompte={a} devisFournisseur={lot.devis_fournisseur_mad ?? 0}
                projectId={projectId} supplierName={lot.supplier_name}
                siblingsCount={siblingsByAcompteId.get(a.id) ?? 0}
                bankLink={bankLinks[a.id]} />
            ))}
          </ul>
        )}
      </div>

      {/* Documents fournisseur par lot (CEO 2026-06-18 B5) :
          devis + bon de commande + facture, attachables ligne par ligne. */}
      <AchatLotDocuments
        lotId={lot.id}
        supplierId={lot.supplier_id}
        quote={lot.quote_doc_id ? (recentDocs.find((d) => d.id === lot.quote_doc_id) ?? { id: lot.quote_doc_id, reference: '(charger)', document_date: null, file_path: null }) : null}
        purchaseOrder={lot.purchase_order_doc_id ? (recentDocs.find((d) => d.id === lot.purchase_order_doc_id) ?? { id: lot.purchase_order_doc_id, reference: '(charger)', document_date: null, file_path: null }) : null}
        invoice={lot.invoice_doc_id ? (recentDocs.find((d) => d.id === lot.invoice_doc_id) ?? { id: lot.invoice_doc_id, reference: '(charger)', document_date: null, file_path: null }) : null}
        recentDocs={recentDocs}
      />

      {acompteOpen !== null && (
        <AcompteFormModal
          lotId={lot.id}
          acompteNumber={acompteOpen}
          devisFournisseur={lot.devis_fournisseur_mad ?? 0}
          onClose={() => setAcompteOpen(null)}
        />
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase text-stoniz-gray-500">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function AcompteRow({
  acompte: a, devisFournisseur, projectId, supplierName, siblingsCount, bankLink,
}: {
  acompte: Acompte;
  devisFournisseur: number;
  projectId: string;
  supplierName: string;
  /** Nombre d'autres acomptes pending du même fournisseur sur ce projet. */
  siblingsCount: number;
  bankLink?: { txId: string; bankLabel: string | null; opDate: string | null };
}) {
  const [pending, start] = useTransition();
  const isPaid = a.status === 'paid';
  const pct = a.acompte_pct ?? (devisFournisseur > 0 ? Math.round((Number(a.amount_total) / devisFournisseur) * 100) : 0);

  function markPaid() {
    if (!confirm('Marquer cet acompte comme payé sans validation formelle ? Pour un workflow d\'approbation, utilisez "Demander validation".')) return;
    start(async () => { await markAchatAcomptePaidAction(a.id, new Date().toISOString().slice(0,10)); });
  }
  function remove() {
    if (!confirm('Supprimer cet acompte ?')) return;
    start(async () => { await deleteAchatAcompteAction(a.id); });
  }

  return (
    <li className="flex items-center justify-between bg-white p-2 rounded border text-sm flex-wrap gap-2">
      <div className="flex items-center gap-3">
        <span className="text-xs text-stoniz-gray-500">Acompte {a.acompte_number}</span>
        <Badge>{pct}%</Badge>
        <span className="font-medium">{formatMad(a.amount_total)}</span>
        {a.scheduled_date && <span className="text-xs text-stoniz-gray-500">prévu {formatDate(a.scheduled_date)}</span>}
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {!isPaid && (
          <AchatAcompteEditButton
            acompte={a}
            supplierName={supplierName}
            siblingsCount={siblingsCount}
          />
        )}
        {isPaid ? (
          <>
            <Badge variant="success">✓ Payé {formatDate(a.paid_at)}</Badge>
            {bankLink ? (
              <Link
                href={`/finance/tresorerie/transactions/${bankLink.txId}`}
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                title={bankLink.bankLabel ?? ''}
              >
                <Landmark className="w-3 h-3" /> Rapproché banque
              </Link>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-600 border border-stoniz-gray-200"
                title="Saisie manuelle — pas encore rattaché à une transaction bancaire"
              >
                <PencilLine className="w-3 h-3" /> Saisie manuelle
              </span>
            )}
          </>
        ) : (
          <>
            <RequestApprovalButton
              source="achats_payment"
              sourceId={a.id}
              projectId={projectId}
              defaultAmount={Number(a.amount_total)}
              defaultCurrency="MAD"
              defaultBeneficiary={supplierName}
              defaultDescription={`Acompte ${a.acompte_number} - ${supplierName}`}
              small
            />
            <Button size="sm" variant="ghost" onClick={markPaid} disabled={pending}>Marquer payé</Button>
          </>
        )}
        <FinanceAuditButton table="achats_payments" recordId={a.id} />
        <button onClick={remove} disabled={pending} className="text-red-600 hover:text-red-800" title="Supprimer">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

// Mini-modale d'édition d'un acompte achats. Réutilise saveAchatAcompteAction
// qui fait un upsert par (lot_id, acompte_number). Si une checkbox
// « Appliquer aussi aux autres en attente du même fournisseur » est cochée,
// on appelle EN PLUS setAchatAcompteSchedulingAction pour propager la date
// d'échéance aux autres acomptes pending du même fournisseur sur ce projet.
function AchatAcompteEditButton({
  acompte,
  supplierName,
  siblingsCount,
}: {
  acompte: Acompte;
  supplierName: string;
  siblingsCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [alsoApply, setAlsoApply] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      const scheduledRaw = fd.get('scheduled_date');
      const scheduled = scheduledRaw && String(scheduledRaw).length > 0 ? String(scheduledRaw) : null;

      // 1) Upsert standard : montant + % + date + notes sur cet acompte
      const payload = {
        lot_id: acompte.lot_id,
        acompte_number: acompte.acompte_number,
        acompte_pct: fd.get('acompte_pct') || null,
        amount_total: fd.get('amount_total'),
        scheduled_date: scheduled,
        notes: fd.get('notes') || null,
      };
      const r = await saveAchatAcompteAction(payload);
      if (!r.ok) { setErr(r.error ?? 'Erreur'); return; }

      // 2) Si demandé, propager l'échéance aux autres acomptes pending
      //    du même fournisseur sur ce projet.
      if (alsoApply && siblingsCount > 0) {
        const r2 = await setAchatAcompteSchedulingAction({
          acompte_id: acompte.id,
          scheduled_date: scheduled,
          also_apply_to_supplier: true,
        });
        if (!r2.ok) { setErr(r2.error ?? 'Échec de la propagation'); return; }
      }
      setOpen(false);
      setAlsoApply(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} title="Modifier cet acompte">
        ✏️
      </Button>
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <form
            onSubmit={onSubmit}
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3"
          >
            <h2 className="font-display text-xl">Acompte {acompte.acompte_number}</h2>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Montant (MAD)</Label>
                <Input
                  name="amount_total"
                  type="number"
                  step="0.01"
                  defaultValue={Number(acompte.amount_total)}
                  required
                />
              </div>
              <div>
                <Label>%</Label>
                <Input
                  name="acompte_pct"
                  type="number"
                  step="0.01"
                  defaultValue={acompte.acompte_pct ?? ''}
                  placeholder="auto"
                />
              </div>
            </div>
            <div>
              <Label>Date d&apos;échéance prévue</Label>
              <Input
                name="scheduled_date"
                type="date"
                defaultValue={acompte.scheduled_date ?? ''}
              />
            </div>

            {siblingsCount > 0 && (
              <label className="flex items-start gap-2 text-sm bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={alsoApply}
                  onChange={(e) => setAlsoApply(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-stoniz-gray-700">
                  Appliquer aussi aux <strong>{siblingsCount}</strong> autre{siblingsCount > 1 ? 's' : ''} acompte{siblingsCount > 1 ? 's' : ''} en attente
                  de <strong>{supplierName}</strong> sur ce projet
                  <span className="block text-xs text-stoniz-gray-500 mt-0.5">
                    Pratique pour une commande chez un même fournisseur réglée en une seule échéance.
                  </span>
                </span>
              </label>
            )}

            <div>
              <Label>Notes</Label>
              <Input name="notes" defaultValue={acompte.notes ?? ''} />
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? '…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}

function LotFormModal({
  projectId, suppliers, units = [], onClose,
}: {
  projectId: string;
  suppliers: Supplier[];
  units?: ProjectUnit[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());
    data.project_id = projectId;
    start(async () => {
      const r = await createAchatLotAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-3 max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-xl">Nouveau lot d'achat</h2>
        <LotFormFields suppliers={suppliers} units={units} />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={pending}>{pending ? '…' : 'Créer'}</Button>
        </div>
      </form>
    </div>
  );
}

function LotEditForm({
  lot, suppliers, units = [], onDone,
}: {
  lot: Lot;
  suppliers: Supplier[];
  units?: ProjectUnit[];
  onDone: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());
    start(async () => {
      const r = await updateAchatLotAction(lot.id, data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 bg-white rounded-md p-4 border">
      <LotFormFields lot={lot} suppliers={suppliers} units={units} />
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Annuler</Button>
        <Button type="submit" disabled={pending}>{pending ? '…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

function LotFormFields({ lot, suppliers, units = [] }: { lot?: Lot; suppliers: Supplier[]; units?: ProjectUnit[] }) {
  return (
    <div className="grid md:grid-cols-2 gap-3">
      <div>
        <Label>Catégorie *</Label>
        <select name="category" defaultValue={lot?.category ?? ''} required
          className="w-full h-10 rounded-md border bg-white px-3 text-sm">
          <option value="">— Choisir —</option>
          {ACHAT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      <div>
        <Label>Statut</Label>
        <select name="status" defaultValue={lot?.status ?? 'a_commander'}
          className="w-full h-10 rounded-md border bg-white px-3 text-sm">
          {ACHAT_LOT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      {units.length > 0 && (
        <div className="md:col-span-2">
          <Label>Suite concernée</Label>
          <select name="propria_unit_id" defaultValue={lot?.propria_unit_id ?? ''}
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">— Bien entier / non spécifié —</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>{u.code}</option>
            ))}
          </select>
          <p className="text-[11px] text-stoniz-gray-500 mt-1">
            Optionnel : permet d'isoler le mobilier/équipement par suite (utile pour les biens multi-lots).
          </p>
        </div>
      )}
      <div className="md:col-span-2">
        <Label>Description</Label>
        <Input name="description" defaultValue={lot?.description ?? ''}
          placeholder="Ex: salon complet, mobilier 2 chambres, électroménager cuisine…" />
      </div>
      <div className="md:col-span-2">
        <Label>Fournisseur *</Label>
        <ArtisanCombobox
          artisans={suppliers}
          defaultArtisanId={lot?.supplier_id ?? null}
          defaultArtisanName={lot?.supplier_name ?? ''}
          idFieldName="supplier_id"
          nameFieldName="supplier_name"
          placeholder="Rechercher ou créer un fournisseur (Mobilia, IKEA, Marjane…)"
          createLabel="fournisseur"
        />
      </div>
      <div>
        <Label>N° devis</Label>
        <Input name="devis_number" defaultValue={lot?.devis_number ?? ''} placeholder="DEV-2026-001" />
      </div>
      <div></div>
      <div>
        <Label>Budget estimé (MAD)</Label>
        <Input name="budget_estimate_mad" type="number" defaultValue={lot?.budget_estimate_mad ?? ''} />
      </div>
      <div>
        <Label>Devis fournisseur (MAD) *</Label>
        <Input name="devis_fournisseur_mad" type="number" defaultValue={lot?.devis_fournisseur_mad ?? ''} />
        <p className="text-[11px] text-stoniz-gray-500 mt-1">
          Source de vérité du calcul de marge. Renseigne-le même si tu as déjà la quantité × prix unitaire ci-dessous.
        </p>
      </div>
      <div>
        <Label>Facturé client (MAD)</Label>
        <Input name="facture_client_mad" type="number" defaultValue={lot?.facture_client_mad ?? ''} />
      </div>
      <div></div>
      <div>
        <Label>Quantité commandée</Label>
        <Input name="quantity" type="number" step="0.01" defaultValue={lot?.quantity ?? ''} placeholder="Ex: 12" />
        <p className="text-[11px] text-stoniz-gray-500 mt-1">Optionnel · pour info commerciale.</p>
      </div>
      <div>
        <Label>Prix unitaire (MAD)</Label>
        <Input name="unit_price_mad" type="number" step="0.01" defaultValue={lot?.unit_price_mad ?? ''} placeholder="Ex: 500" />
        <p className="text-[11px] text-stoniz-gray-500 mt-1">Optionnel · n&apos;écrase pas le devis fournisseur.</p>
      </div>
      <div>
        <Label>Date commande</Label>
        <Input name="date_commande" type="date" defaultValue={lot?.date_commande ?? ''} />
      </div>
      <div>
        <Label>Livraison estimée</Label>
        <Input name="date_livraison_estimee" type="date" defaultValue={lot?.date_livraison_estimee ?? ''} />
      </div>
      <div>
        <Label>Livraison réelle</Label>
        <Input name="date_livraison_reelle" type="date" defaultValue={lot?.date_livraison_reelle ?? ''} />
      </div>
      <div className="md:col-span-2">
        <Label>Notes</Label>
        <Textarea name="notes" rows={2} defaultValue={lot?.notes ?? ''} />
      </div>
    </div>
  );
}

function AcompteFormModal({
  lotId, acompteNumber, devisFournisseur, onClose,
}: {
  lotId: string;
  acompteNumber: number;
  devisFournisseur: number;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | ''>('');
  const [amount, setAmount] = useState<number | ''>('');

  function updatePct(v: number | '') {
    setPct(v);
    if (typeof v === 'number' && devisFournisseur > 0) {
      setAmount(Math.round((devisFournisseur * v) / 100));
    }
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());
    data.lot_id = lotId;
    data.acompte_number = acompteNumber;
    start(async () => {
      const r = await saveAchatAcompteAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3"
        onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-xl">Acompte {acompteNumber}</h2>
        {devisFournisseur > 0 && (
          <p className="text-xs text-stoniz-gray-500">Devis fournisseur : {formatMad(devisFournisseur)}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>% acompte</Label>
            <Input name="acompte_pct" type="number" step="0.01" min="0" max="100"
              value={pct} onChange={e => updatePct(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="30" />
          </div>
          <div>
            <Label>Montant (MAD)</Label>
            <Input name="amount_total" type="number" required
              value={amount} onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))} />
          </div>
        </div>
        <div>
          <Label>Date prévue</Label>
          <Input name="scheduled_date" type="date" />
        </div>
        <div>
          <Label>Notes</Label>
          <Input name="notes" />
        </div>
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={pending}>{pending ? '…' : 'Enregistrer'}</Button>
        </div>
      </form>
    </div>
  );
}
