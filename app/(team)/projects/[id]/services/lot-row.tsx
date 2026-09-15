'use client';

import { useState } from 'react';
import { Trash2, Pencil, ChevronDown, ChevronRight, AlertTriangle, CalendarClock } from 'lucide-react';
import { formatServiceCategory, formatServiceLotStatus } from '@/lib/finance/services-calc';
import {
  deleteServiceLotAction,
  deleteServicePaymentAction,
  updateServicePaymentAction,
} from './actions';

type Lot = {
  id: string;
  service_category: string;
  status: string;
  description: string | null;
  budget_estimate_mad: number | string | null;
  devis_prestataire_mad: number | string | null;
  facture_prestataire_mad: number | string | null;
  provider: { id: string; name: string; service_category: string | null } | null;
};

type Payment = {
  id: string;
  lot_id: string;
  amount_paid: number | string;
  amount_total?: number | string | null;
  paid_at: string | null;
  scheduled_date?: string | null;
  acompte_index: number | null;
  description: string | null;
  status: string;
  notes?: string | null;
};

function fmtMad(n: number | string | null | undefined): string {
  if (n == null || n === '') return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(n)) + ' MAD';
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

export function LotRow({
  lot,
  payments,
  projectId,
}: {
  lot: Lot;
  payments: Payment[];
  projectId: string;
}) {
  const [open, setOpen] = useState(payments.length > 0);
  const [deleting, setDeleting] = useState(false);

  const devis = Number(lot.devis_prestataire_mad ?? 0);
  const paye = payments.reduce((s, p) => s + Number(p.amount_paid), 0);
  const reste = Math.max(0, devis - paye);
  const isSurpaiement = paye > devis + 0.01;

  async function onDeleteLot() {
    if (!confirm(`Supprimer le lot "${formatServiceCategory(lot.service_category)}" ?`)) return;
    setDeleting(true);
    try {
      const r = await deleteServiceLotAction(lot.id, projectId);
      if (!r.ok) alert(r.error);
    } catch (err: any) {
      alert(err?.message ?? 'Erreur');
    } finally {
      setDeleting(false);
    }
  }

  async function onDeletePayment(paymentId: string) {
    if (!confirm('Supprimer ce paiement ?')) return;
    try {
      const r = await deleteServicePaymentAction(paymentId, projectId);
      if (!r.ok) alert(r.error);
    } catch (err: any) {
      alert(err?.message ?? 'Erreur');
    }
  }

  return (
    <div className="border border-stoniz-gray-200 rounded-lg overflow-hidden">
      <div className="bg-stoniz-gray-50 px-4 py-3 flex items-start gap-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-stoniz-gray-400 hover:text-stoniz-black mt-1"
          title={open ? 'Replier' : 'Déplier'}
        >
          {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="md:col-span-2">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase px-2 py-0.5 rounded bg-white border text-stoniz-gray-700">
                {formatServiceCategory(lot.service_category)}
              </span>
              <span className="text-[10px] uppercase text-stoniz-gray-500">
                {formatServiceLotStatus(lot.status)}
              </span>
            </div>
            <div className="font-medium">{lot.provider?.name ?? <span className="text-stoniz-gray-400 italic">Prestataire à renseigner</span>}</div>
            {lot.description && (
              <div className="text-xs text-stoniz-gray-500 mt-0.5">{lot.description}</div>
            )}
          </div>

          <div>
            <div className="text-[10px] uppercase text-stoniz-gray-500">Devis signé</div>
            <div className="text-sm font-medium font-mono">{fmtMad(lot.devis_prestataire_mad)}</div>
          </div>

          <div>
            <div className="text-[10px] uppercase text-stoniz-gray-500">Payé</div>
            <div className={`text-sm font-medium font-mono ${isSurpaiement ? 'text-red-700' : 'text-emerald-700'}`}>
              {fmtMad(paye)}
              {isSurpaiement && <AlertTriangle className="w-3 h-3 inline ml-1" />}
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase text-stoniz-gray-500">Reste</div>
            <div className={`text-sm font-medium font-mono ${reste > 0 ? 'text-orange-700' : ''}`}>
              {fmtMad(reste)}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={onDeleteLot}
          disabled={deleting}
          className="text-stoniz-gray-400 hover:text-red-600 disabled:opacity-50"
          title="Supprimer ce lot (CEO uniquement)"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {open && (
        <div className="p-4 bg-white">
          <h4 className="text-xs uppercase text-stoniz-gray-500 mb-2">
            Paiements ({payments.length})
          </h4>
          {payments.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500 italic">
              Aucun paiement encore. Utilise le formulaire en bas de page ou alloue une transaction bancaire à ce projet.
            </p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <th className="text-left py-1.5">Date</th>
                  <th className="text-left py-1.5">Acompte</th>
                  <th className="text-left py-1.5">Description</th>
                  <th className="text-right py-1.5">Montant</th>
                  <th className="text-center py-1.5">Statut</th>
                  <th className="text-center py-1.5"></th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {payments.map((p) => {
                  const isPlanned = p.status === 'planifie' || (!p.paid_at && !!p.scheduled_date);
                  const displayDate = p.paid_at ?? p.scheduled_date ?? null;
                  return (
                    <tr key={p.id} className="hover:bg-stoniz-gray-50">
                      <td className="py-1.5">
                        <div className="flex items-center gap-1">
                          {isPlanned && <CalendarClock className="w-3 h-3 text-orange-600" />}
                          {fmtDate(displayDate)}
                        </div>
                      </td>
                      <td className="py-1.5">{p.acompte_index ? `#${p.acompte_index}` : '—'}</td>
                      <td className="py-1.5">{p.description ?? '—'}</td>
                      <td className="text-right py-1.5 font-mono">
                        {fmtMad(isPlanned ? (p.amount_total ?? p.amount_paid) : p.amount_paid)}
                      </td>
                      <td className="text-center py-1.5 text-[10px] uppercase">
                        {p.status === 'paye' ? '✓ Payé' : isPlanned ? 'Planifié' : p.status}
                      </td>
                      <td className="text-center py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <ServicePaymentEditButton payment={p} projectId={projectId} />
                          <button
                            type="button"
                            onClick={() => onDeletePayment(p.id)}
                            className="text-stoniz-gray-400 hover:text-red-600"
                            title="Supprimer ce paiement"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Mini-modale d'édition d'un paiement service ──────────────────────────
function ServicePaymentEditButton({
  payment,
  projectId,
}: {
  payment: Payment;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'planifie' | 'paye'>(
    payment.status === 'paye' ? 'paye' : 'planifie',
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const fd = new FormData(e.currentTarget);
      const payload: any = {
        payment_id: payment.id,
        project_id: projectId,
        amount_paid: String(fd.get('amount_paid') ?? ''),
        description: (fd.get('description') as string) || null,
        notes: (fd.get('notes') as string) || null,
      };
      if (mode === 'paye') {
        payload.paid_at = (fd.get('paid_at') as string) || null;
        payload.scheduled_date = (fd.get('scheduled_date') as string) || null;
      } else {
        payload.paid_at = null;
        payload.scheduled_date = (fd.get('scheduled_date') as string) || null;
      }
      await updateServicePaymentAction(payload);
      setOpen(false);
    } catch (e: any) {
      setErr(e?.message ?? 'Erreur');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-stoniz-gray-400 hover:text-stoniz-black"
        title="Éditer ce paiement"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
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
            <h2 className="font-display text-xl">Éditer le paiement</h2>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-stoniz-gray-600">État :</span>
              <button
                type="button"
                onClick={() => setMode('planifie')}
                className={`px-3 py-1 rounded-md border text-xs ${
                  mode === 'planifie'
                    ? 'bg-stoniz-black text-white border-stoniz-black'
                    : 'bg-white text-stoniz-gray-700'
                }`}
              >
                À décaisser
              </button>
              <button
                type="button"
                onClick={() => setMode('paye')}
                className={`px-3 py-1 rounded-md border text-xs ${
                  mode === 'paye'
                    ? 'bg-stoniz-black text-white border-stoniz-black'
                    : 'bg-white text-stoniz-gray-700'
                }`}
              >
                Payé
              </button>
            </div>

            <div>
              <label className="text-xs text-stoniz-gray-600 block mb-1">Montant (MAD)</label>
              <input
                name="amount_paid"
                type="text"
                pattern="^-?\d+(\.\d{1,2})?$"
                defaultValue={String(payment.amount_total ?? payment.amount_paid ?? '')}
                required
                className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-stoniz-gray-600 block mb-1">
                  Échéance prévue {mode === 'planifie' ? '*' : '(optionnel)'}
                </label>
                <input
                  name="scheduled_date"
                  type="date"
                  required={mode === 'planifie'}
                  defaultValue={payment.scheduled_date ?? ''}
                  className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              {mode === 'paye' && (
                <div>
                  <label className="text-xs text-stoniz-gray-600 block mb-1">Date du paiement *</label>
                  <input
                    name="paid_at"
                    type="date"
                    required
                    defaultValue={payment.paid_at ?? new Date().toISOString().slice(0, 10)}
                    className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
                  />
                </div>
              )}
            </div>

            <div>
              <label className="text-xs text-stoniz-gray-600 block mb-1">Description</label>
              <input
                name="description"
                defaultValue={payment.description ?? ''}
                className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-stoniz-gray-600 block mb-1">Notes</label>
              <input
                name="notes"
                defaultValue={payment.notes ?? ''}
                className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>

            {err && <div className="text-sm text-red-600">{err}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="px-3 py-1.5 rounded-md border text-sm"
              >
                Annuler
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-4 py-1.5 rounded-md bg-stoniz-black text-white text-sm disabled:opacity-50"
              >
                {busy ? '…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
