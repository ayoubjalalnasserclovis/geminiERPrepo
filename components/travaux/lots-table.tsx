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
  LOT_CATEGORIES, ARTISAN_TYPES, LOT_STATUSES,
  formatLotCategory, formatArtisanType, formatLotStatus,
} from '@/lib/finance/travaux-calc';
import {
  createLotAction, updateLotAction, deleteLotAction,
  saveAcompteAction, markAcomptePaidAction, deleteAcompteAction,
} from '@/app/(team)/projects/[id]/travaux/actions';
import { LotDocuments } from '@/components/travaux/lot-documents';
import { RequestApprovalButton } from '@/components/validations/request-approval-button';
import { ArtisanCombobox } from '@/components/artisans/artisan-combobox';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';
import { PaymentInstallmentsTimeline } from '@/components/finance/payment-installments-timeline';

type Lot = {
  id: string;
  numero: number;
  category: string;
  description: string | null;
  artisan_name: string;
  artisan_id: string | null;
  artisan_type: string | null;
  devis_number: string | null;
  budget_estimate_mad: number | null;
  devis_artisan_mad: number | null;
  facture_client_mad: number | null;
  status: string;
  date_debut_estime: string | null;
  date_fin_estimee: string | null;
  date_fin_reelle: string | null;
  notes: string | null;
};

type LotDoc = {
  id: string;
  name: string;
  type: 'devis_artisan' | 'facture_artisan';
  amount_mad: number | null;
  document_number: string | null;
  document_date: string | null;
  created_at: string;
  lot_id: string | null;
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

const STATUS_COLORS: Record<string, 'default'|'success'|'warning'|'error'> = {
  a_planifier: 'default',
  devis_recu: 'info' as any,
  demarre: 'warning',
  en_cours: 'warning',
  en_attente: 'default',
  termine: 'success',
  annule: 'error',
};

type Artisan = { id: string; name: string };

type BankLink = { txId: string; bankLabel: string | null; opDate: string | null };

export function LotsTable({
  projectId, lots, payments, lotDocuments = [], artisans = [], bankLinks = {},
}: {
  projectId: string;
  lots: Lot[];
  payments: Acompte[];
  lotDocuments?: LotDoc[];
  artisans?: Artisan[];
  /** Map payment_id → transaction bancaire rapprochée (CEO 2026-06-16) */
  bankLinks?: Record<string, BankLink>;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const acomptesByLot = new Map<string, Acompte[]>();
  payments.forEach(p => {
    if (!p.lot_id) return;
    const arr = acomptesByLot.get(p.lot_id) ?? [];
    arr.push(p);
    acomptesByLot.set(p.lot_id, arr);
  });
  acomptesByLot.forEach(arr => arr.sort((a, b) => (a.acompte_number ?? 0) - (b.acompte_number ?? 0)));

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Lots de travaux ({lots.length})</CardTitle>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="w-4 h-4" /> Ajouter un lot
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {lots.length === 0 ? (
          <p className="text-sm text-stoniz-gray-500">
            Aucun lot pour le moment. Cliquez sur "Ajouter un lot" pour commencer.
          </p>
        ) : (
          <div className="space-y-1">
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs uppercase text-stoniz-gray-500 border-b font-medium">
              <div className="col-span-1">N°</div>
              <div className="col-span-3">Lot / Artisan</div>
              <div className="col-span-2 text-right">Devis</div>
              <div className="col-span-2 text-right">Facturé</div>
              <div className="col-span-2 text-right">Payé / Reste</div>
              <div className="col-span-2 text-right">Statut</div>
            </div>
            {lots.map(lot => {
              const lotAcomptes = acomptesByLot.get(lot.id) ?? [];
              const totalPaye = lotAcomptes.reduce((s, a) => s + Number(a.amount_paid), 0);
              const restePayer = Number(lot.devis_artisan_mad ?? 0) - totalPaye;
              const isOpen = expanded === lot.id;

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
                      <div className="font-medium">{formatLotCategory(lot.category)}</div>
                      <div className="text-xs text-stoniz-gray-500">{lot.artisan_name}</div>
                    </div>
                    <div className="col-span-2 text-right">{formatMad(lot.devis_artisan_mad)}</div>
                    <div className="col-span-2 text-right">{formatMad(lot.facture_client_mad)}</div>
                    <div className="col-span-2 text-right">
                      <div>{formatMad(totalPaye)}</div>
                      <div className="text-xs text-stoniz-gray-500">/ {formatMad(restePayer)} reste</div>
                    </div>
                    <div className="col-span-2 text-right">
                      <Badge variant={STATUS_COLORS[lot.status] as any}>{formatLotStatus(lot.status)}</Badge>
                    </div>
                  </button>

                  {isOpen && (
                    <LotDetail
                      projectId={projectId}
                      lot={lot}
                      acomptes={lotAcomptes}
                      documents={lotDocuments.filter(d => d.lot_id === lot.id)}
                      artisans={artisans}
                      bankLinks={bankLinks}
                      onClose={() => setExpanded(null)}
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
          artisans={artisans}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Card>
  );
}

// ─── Lot Detail (expand) ─────────────────────────────────────────────────

function LotDetail({
  projectId, lot, acomptes, documents, artisans, bankLinks = {}, onClose,
}: {
  projectId: string;
  lot: Lot;
  acomptes: Acompte[];
  documents: LotDoc[];
  artisans: Artisan[];
  bankLinks?: Record<string, BankLink>;
  onClose: () => void;
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
    if (!confirm('Supprimer ce lot ? Les acomptes liés ne seront plus rattachés.')) return;
    start(async () => {
      const r = await deleteLotAction(lot.id);
      if (!r.ok) setError(r.error ?? 'Erreur');
      else onClose();
    });
  }

  return (
    <div className="bg-stoniz-gray-50 border-t p-4 space-y-4">
      {editing ? (
        <LotEditForm lot={lot} artisans={artisans} onDone={() => setEditing(false)} />
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-3 text-sm">
            <DetailRow label="Description" value={lot.description ?? '—'} />
            <DetailRow label="Type d'artisan" value={lot.artisan_type ? formatArtisanType(lot.artisan_type) : '—'} />
            <DetailRow label="N° devis" value={lot.devis_number ?? '—'} />
            <DetailRow label="Budget estimé" value={formatMad(lot.budget_estimate_mad)} />
            <DetailRow label="Devis artisan" value={formatMad(lot.devis_artisan_mad)} />
            <DetailRow label="Facturé client" value={formatMad(lot.facture_client_mad)} />
            <DetailRow label="Début estimé" value={formatDate(lot.date_debut_estime)} />
            <DetailRow label="Fin estimée"  value={formatDate(lot.date_fin_estimee)} />
            <DetailRow label="Fin réelle"   value={formatDate(lot.date_fin_reelle)} />
          </div>
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

      {/* Acomptes */}
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
              <AcompteRow key={a.id} acompte={a} devisArtisan={lot.devis_artisan_mad ?? 0}
                projectId={projectId} artisanName={lot.artisan_name}
                bankLink={bankLinks[a.id]} />
            ))}
          </ul>
        )}
      </div>

      {/* Devis & factures artisan */}
      <LotDocuments
        projectId={projectId}
        lotId={lot.id}
        artisanId={lot.artisan_id}
        documents={documents}
      />

      {acompteOpen !== null && (
        <AcompteFormModal
          lotId={lot.id}
          acompteNumber={acompteOpen}
          devisArtisan={lot.devis_artisan_mad ?? 0}
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
  acompte: a, devisArtisan, projectId, artisanName, bankLink,
}: {
  acompte: Acompte;
  devisArtisan: number;
  projectId: string;
  artisanName: string;
  bankLink?: { txId: string; bankLabel: string | null; opDate: string | null };
}) {
  const [pending, start] = useTransition();
  const isPaid = a.status === 'paid';
  const pct = a.acompte_pct ?? (devisArtisan > 0 ? Math.round((Number(a.amount_total) / devisArtisan) * 100) : 0);

  function markPaid() {
    if (!confirm('Marquer cet acompte comme payé sans passer par la validation ? Pour un workflow formel, utilisez "Demander validation".')) return;
    start(async () => { await markAcomptePaidAction(a.id, new Date().toISOString().slice(0,10)); });
  }
  function remove() {
    if (!confirm('Supprimer cet acompte ?')) return;
    start(async () => { await deleteAcompteAction(a.id); });
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
          <AcompteEditButton acompte={a} />
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
              source="travaux_payment"
              sourceId={a.id}
              projectId={projectId}
              defaultAmount={Number(a.amount_total)}
              defaultCurrency="MAD"
              defaultBeneficiary={artisanName}
              defaultDescription={`Acompte ${a.acompte_number} - ${artisanName}`}
              small
            />
            <Button size="sm" variant="ghost" onClick={markPaid} disabled={pending}>Marquer payé</Button>
          </>
        )}
        <FinanceAuditButton table="travaux_payments" recordId={a.id} />
        <button onClick={remove} disabled={pending} className="text-red-600 hover:text-red-800" title="Supprimer">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </li>
  );
}

// Mini-modale d'édition d'un acompte (montant + échéance + notes).
// Réutilise saveAcompteAction qui fait un upsert par (lot_id, acompte_number).
function AcompteEditButton({ acompte }: { acompte: Acompte }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      const payload = {
        lot_id: acompte.lot_id,
        // P0 fix (2026-06-19) : si l'acompte est orphelin (créé par une route
        // d'insert qui n'a pas posé acompte_number), on passe null et le serveur
        // calcule le prochain numéro libre du lot. Évite Zod min(1) sur null.
        acompte_number: acompte.acompte_number ?? null,
        acompte_pct: fd.get('acompte_pct') || null,
        amount_total: fd.get('amount_total'),
        scheduled_date: fd.get('scheduled_date') || null,
        notes: fd.get('notes') || null,
      };
      const r = await saveAcompteAction(payload);
      if (!r.ok) { setErr(r.error ?? 'Erreur'); return; }
      setOpen(false);
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
            <h2 className="font-display text-xl">Acompte {acompte.acompte_number ?? '?'}</h2>
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

// ─── Forms ───────────────────────────────────────────────────────────────

function LotFormModal({ projectId, artisans, onClose }: { projectId: string; artisans: Artisan[]; onClose: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());
    data.project_id = projectId;
    start(async () => {
      const r = await createLotAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-3 max-h-[90vh] overflow-auto"
        onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-xl">Nouveau lot de travaux</h2>
        <LotFormFields artisans={artisans} />
        {error && <div className="text-sm text-red-600">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>Annuler</Button>
          <Button type="submit" disabled={pending}>{pending ? '…' : 'Créer'}</Button>
        </div>
      </form>
    </div>
  );
}

function LotEditForm({ lot, artisans, onDone }: { lot: Lot; artisans: Artisan[]; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());
    start(async () => {
      const r = await updateLotAction(lot.id, data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 bg-white rounded-md p-4 border">
      <LotFormFields lot={lot} artisans={artisans} />
      {error && <div className="text-sm text-red-600">{error}</div>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>Annuler</Button>
        <Button type="submit" disabled={pending}>{pending ? '…' : 'Enregistrer'}</Button>
      </div>
    </form>
  );
}

function LotFormFields({ lot, artisans }: { lot?: Lot; artisans: Artisan[] }) {
  return (
    <>
      <div className="grid md:grid-cols-2 gap-3">
        <div>
          <Label>Catégorie *</Label>
          <select name="category" defaultValue={lot?.category ?? ''} required
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">— Choisir —</option>
            {LOT_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </div>
        <div>
          <Label>Statut</Label>
          <select name="status" defaultValue={lot?.status ?? 'a_planifier'}
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            {LOT_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        <div className="md:col-span-2">
          <Label>Description</Label>
          <Input name="description" defaultValue={lot?.description ?? ''} placeholder="Ex: refonte plomberie + pose sanitaires" />
        </div>
        <div className="md:col-span-2">
          <Label>Artisan *</Label>
          <ArtisanCombobox
            artisans={artisans}
            defaultArtisanId={lot?.artisan_id ?? null}
            defaultArtisanName={lot?.artisan_name ?? ''}
          />
        </div>
        <div>
          <Label>Type</Label>
          <select name="artisan_type" defaultValue={lot?.artisan_type ?? ''}
            className="w-full h-10 rounded-md border bg-white px-3 text-sm">
            <option value="">—</option>
            {ARTISAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
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
          <Label>Devis artisan (MAD)</Label>
          <Input name="devis_artisan_mad" type="number" defaultValue={lot?.devis_artisan_mad ?? ''} />
        </div>
        <div>
          <Label>Facturé client (MAD)</Label>
          <Input name="facture_client_mad" type="number" defaultValue={lot?.facture_client_mad ?? ''} />
        </div>
        <div></div>
        <div>
          <Label>Début estimé</Label>
          <Input name="date_debut_estime" type="date" defaultValue={lot?.date_debut_estime ?? ''} />
        </div>
        <div>
          <Label>Fin estimée</Label>
          <Input name="date_fin_estimee" type="date" defaultValue={lot?.date_fin_estimee ?? ''} />
        </div>
        <div>
          <Label>Fin réelle</Label>
          <Input name="date_fin_reelle" type="date" defaultValue={lot?.date_fin_reelle ?? ''} />
        </div>
        <div className="md:col-span-2">
          <Label>Notes</Label>
          <Textarea name="notes" rows={2} defaultValue={lot?.notes ?? ''} />
        </div>
      </div>
    </>
  );
}

function AcompteFormModal({
  lotId, acompteNumber, devisArtisan, onClose,
}: {
  lotId: string;
  acompteNumber: number;
  devisArtisan: number;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [pct, setPct] = useState<number | ''>('');
  const [amount, setAmount] = useState<number | ''>('');

  function updatePct(v: number | '') {
    setPct(v);
    if (typeof v === 'number' && devisArtisan > 0) {
      setAmount(Math.round((devisArtisan * v) / 100));
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
      const r = await saveAcompteAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3"
        onClick={e => e.stopPropagation()}>
        <h2 className="font-display text-xl">Acompte {acompteNumber}</h2>
        {devisArtisan > 0 && (
          <p className="text-xs text-stoniz-gray-500">Devis artisan : {formatMad(devisArtisan)}</p>
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
