'use client';

import { useMemo, useState, useTransition } from 'react';
import { AlertTriangle, X, Loader2, Check, Search, CalendarPlus } from 'lucide-react';
import { createScheduledPaymentFromLotAction, updateScheduledDateAction } from './actions';

export type UnscheduledLot = {
  source: 'travaux_lot' | 'achats_lot';
  lot_id: string;
  project_ref: string;
  client_name: string | null;
  partner: string;
  category: string | null;
  description: string | null;
  devis_mad: number;
  paid_mad: number;
  remaining_mad: number;
};

export type UnscheduledPayment = {
  source: 'travaux_payment' | 'achats_payment';
  payment_id: string;
  project_ref: string;
  client_name: string | null;
  partner: string;
  description: string | null;
  amount_mad: number;
};

function fmtMad(n: number): string {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

export function MissingDatesBanner({
  items,
  payments = [],
  totalRemaining,
  canEdit,
}: {
  items: UnscheduledLot[];
  payments?: UnscheduledPayment[];
  totalRemaining: number;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const hay = `${it.partner} ${it.project_ref} ${it.client_name ?? ''} ${it.description ?? ''} ${it.category ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, search]);

  const filteredPayments = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return payments;
    return payments.filter((p) => {
      const hay = `${p.partner} ${p.project_ref} ${p.client_name ?? ''} ${p.description ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [payments, search]);

  const grouped = useMemo(() => {
    const byProject = new Map<string, { ref: string; client: string | null; items: UnscheduledLot[] }>();
    for (const it of filtered) {
      if (!byProject.has(it.project_ref)) {
        byProject.set(it.project_ref, { ref: it.project_ref, client: it.client_name, items: [] });
      }
      byProject.get(it.project_ref)!.items.push(it);
    }
    return Array.from(byProject.values());
  }, [filtered]);

  const groupedPayments = useMemo(() => {
    const byProject = new Map<string, { ref: string; client: string | null; items: UnscheduledPayment[] }>();
    for (const it of filteredPayments) {
      if (!byProject.has(it.project_ref)) {
        byProject.set(it.project_ref, { ref: it.project_ref, client: it.client_name, items: [] });
      }
      byProject.get(it.project_ref)!.items.push(it);
    }
    return Array.from(byProject.values());
  }, [filteredPayments]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left bg-amber-50 border border-amber-200 hover:bg-amber-100 transition rounded-md p-4 text-sm text-amber-900"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-medium mb-1">
              {items.length > 0 && <>{items.length} lot{items.length > 1 ? 's' : ''} avec reste à payer</>}
              {items.length > 0 && payments.length > 0 && ' · '}
              {payments.length > 0 && <>{payments.length} acompte{payments.length > 1 ? 's' : ''} créé{payments.length > 1 ? 's' : ''} sans date</>}
              {' · '}<span className="font-mono">{fmtMad(totalRemaining)}</span> à programmer
            </div>
            <div className="text-xs text-amber-800">
              Ces engagements ne sont pas visibles dans la projection tant qu'ils n'ont pas de date prévue.
              {canEdit && <> <strong>Clique pour programmer les dates →</strong></>}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-stretch justify-end"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-white w-full max-w-3xl h-full overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white z-10 border-b px-6 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-display">Programmer les acomptes restants</h2>
                  <p className="text-xs text-stoniz-gray-500 mt-1">
                    Pour chaque lot, saisis le montant et la date du prochain acompte. Un nouveau paiement scheduled est créé sur la fiche projet.
                    Tu peux répéter l'opération pour planifier plusieurs acomptes par lot.
                  </p>
                </div>
                <button onClick={() => setOpen(false)} className="text-stoniz-gray-400 hover:text-stoniz-black">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="mt-3 relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filtrer par client, artisan, fournisseur, catégorie…"
                  className="w-full border border-stoniz-gray-300 rounded pl-9 pr-3 py-2 text-sm"
                />
              </div>

              <div className="mt-3 text-xs text-stoniz-gray-500">
                {filtered.length + filteredPayments.length} affichés sur {items.length + payments.length} · {savedIds.size} programmé{savedIds.size > 1 ? 's' : ''} dans cette session
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Section 1 : Acomptes déjà créés sans date — juste à dater */}
              {groupedPayments.length > 0 && (
                <div>
                  <h3 className="text-sm font-display mb-2 text-stoniz-gray-700">
                    📅 Acomptes existants à dater
                    <span className="text-xs font-normal text-stoniz-gray-500 ml-2">
                      ({filteredPayments.length} acompte{filteredPayments.length > 1 ? 's' : ''} déjà saisi{filteredPayments.length > 1 ? 's' : ''} mais sans date prévue)
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {groupedPayments.map((g) => (
                      <div key={`pay-${g.ref}`} className="border border-stoniz-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-stoniz-gray-50 px-3 py-2 text-xs uppercase text-stoniz-gray-600 border-b">
                          {g.client ?? 'Sans client'} · {g.ref}
                        </div>
                        <div className="divide-y">
                          {g.items.map((it) => (
                            <PaymentDateRow
                              key={`${it.source}-${it.payment_id}`}
                              item={it}
                              canEdit={canEdit}
                              onSaved={() => setSavedIds((prev) => new Set(prev).add(it.payment_id))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Section 2 : Lots avec reste à payer — créer un nouvel acompte */}
              {grouped.length > 0 && (
                <div>
                  <h3 className="text-sm font-display mb-2 text-stoniz-gray-700">
                    ➕ Lots à programmer
                    <span className="text-xs font-normal text-stoniz-gray-500 ml-2">
                      ({filtered.length} lot{filtered.length > 1 ? 's' : ''} avec reste à payer mais aucun acompte futur)
                    </span>
                  </h3>
                  <div className="space-y-3">
                    {grouped.map((g) => (
                      <div key={g.ref} className="border border-stoniz-gray-200 rounded-lg overflow-hidden">
                        <div className="bg-stoniz-gray-50 px-3 py-2 text-xs uppercase text-stoniz-gray-600 border-b">
                          {g.client ?? 'Sans client'} · {g.ref}
                        </div>
                        <div className="divide-y">
                          {g.items.map((it) => (
                            <LotScheduleRow
                              key={`${it.source}-${it.lot_id}`}
                              item={it}
                              canEdit={canEdit}
                              onSaved={() => setSavedIds((prev) => new Set(prev).add(it.lot_id))}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {grouped.length === 0 && groupedPayments.length === 0 && (
                <div className="text-center py-12 text-sm text-stoniz-gray-500">
                  Aucun élément ne correspond à la recherche.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PaymentDateRow({
  item,
  canEdit,
  onSaved,
}: {
  item: UnscheduledPayment;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [date, setDate] = useState<string>('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function handleSave() {
    if (!date) {
      setError('Choisis une date prévue');
      return;
    }
    setError(null);
    start(async () => {
      const r = await updateScheduledDateAction({
        source: item.source,
        id: item.payment_id,
        new_date: date,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(true);
      onSaved();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{item.partner}</div>
        {item.description && (
          <div className="text-xs text-stoniz-gray-500 truncate">{item.description}</div>
        )}
        <div className="text-[10px] uppercase text-stoniz-gray-400 mt-0.5">
          {item.source === 'travaux_payment' ? 'Travaux · acompte artisan' : 'Achats · acompte fournisseur'}
        </div>
      </div>
      <div className="font-mono text-red-700 text-sm">
        − {fmtMad(item.amount_mad)}
      </div>
      {saved ? (
        <div className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium">
          <Check className="w-3.5 h-3.5" /> Daté
        </div>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={!canEdit || pending}
            className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!canEdit || pending || !date}
            className="bg-stoniz-black hover:bg-stoniz-gray-800 disabled:opacity-40 text-white text-xs px-3 py-1 rounded"
          >
            {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : 'OK'}
          </button>
          {error && <div className="text-[10px] text-red-600 max-w-[160px]">{error}</div>}
        </div>
      )}
    </div>
  );
}

function LotScheduleRow({
  item,
  canEdit,
  onSaved,
}: {
  item: UnscheduledLot;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState<string>(item.remaining_mad.toFixed(0));
  const [date, setDate] = useState<string>('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function handleSave() {
    if (!date) {
      setError('Choisis une date prévue');
      return;
    }
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      setError('Montant invalide');
      return;
    }
    if (amt > item.remaining_mad + 1) {
      setError(`Le montant ne peut pas dépasser le reste à payer (${fmtMad(item.remaining_mad)})`);
      return;
    }
    setError(null);
    start(async () => {
      const r = await createScheduledPaymentFromLotAction({
        source: item.source,
        lot_id: item.lot_id,
        amount_mad: amount,
        scheduled_date: date,
        description: `Acompte programmé · ${item.partner}`,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setSaved(true);
      onSaved();
    });
  }

  return (
    <div className="px-3 py-3 text-sm">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{item.partner}</div>
          {item.description && (
            <div className="text-xs text-stoniz-gray-500 truncate">{item.description}</div>
          )}
          <div className="text-[10px] uppercase text-stoniz-gray-400 mt-0.5">
            {item.source === 'travaux_lot' ? 'Travaux' : 'Achats'}
            {item.category ? ` · ${item.category}` : ''}
          </div>
        </div>
        <div className="text-right text-xs">
          <div className="text-stoniz-gray-500">Devis : {fmtMad(item.devis_mad)}</div>
          <div className="text-stoniz-gray-500">Payé : {fmtMad(item.paid_mad)}</div>
          <div className="text-red-700 font-mono font-medium">Reste : {fmtMad(item.remaining_mad)}</div>
        </div>
      </div>

      {saved ? (
        <div className="inline-flex items-center gap-1 text-xs text-emerald-700 font-medium bg-emerald-50 border border-emerald-200 rounded px-2 py-1">
          <Check className="w-3.5 h-3.5" /> Acompte programmé · refresh pour voir l'effet sur la projection
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-2 bg-stoniz-gray-50 border border-stoniz-gray-200 rounded p-2">
          <div>
            <label className="text-[10px] text-stoniz-gray-600 block">Montant (MAD)</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={!canEdit || pending}
              className="w-32 text-xs border border-stoniz-gray-300 rounded px-2 py-1 font-mono"
            />
          </div>
          <div>
            <label className="text-[10px] text-stoniz-gray-600 block">Date prévue</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={!canEdit || pending}
              className="text-xs border border-stoniz-gray-300 rounded px-2 py-1"
            />
          </div>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canEdit || pending || !date}
            className="bg-stoniz-black hover:bg-stoniz-gray-800 disabled:opacity-40 text-white text-xs px-3 py-1.5 rounded inline-flex items-center gap-1"
          >
            {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : <><CalendarPlus className="w-3 h-3" /> Programmer</>}
          </button>
          {error && <div className="text-[10px] text-red-600 w-full">{error}</div>}
        </div>
      )}
    </div>
  );
}
