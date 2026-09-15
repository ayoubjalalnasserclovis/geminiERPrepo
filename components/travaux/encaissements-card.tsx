'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Plus, Trash2, Landmark, PencilLine, Pencil, CalendarClock, CalendarPlus, BanknoteIcon } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { formatMad, formatDate } from '@/lib/utils/format';
import {
  addEncaissementAction,
  updateEncaissementAction,
  deleteEncaissementAction,
} from '@/app/(team)/projects/[id]/travaux/actions';
import { FinanceAuditButton } from '@/components/finance/finance-audit-timeline';

type Encaissement = {
  id: string;
  amount_mad: number;
  received_at: string | null;
  scheduled_date: string | null;
  status: 'recu' | 'planifie' | string;
  payment_method: string | null;
  notes: string | null;
};

export type BankLink = {
  txId: string;
  bankLabel: string | null;
  opDate: string | null;
};

export function EncaissementsCard({
  projectId,
  encaissements,
  bankLinks = {},
}: {
  projectId: string;
  encaissements: Encaissement[];
  bankLinks?: Record<string, BankLink>;
}) {
  // openMode contrôle la modale de création : null = fermée, 'planifie' ou 'recu' = ouverte
  const [openMode, setOpenMode] = useState<null | 'planifie' | 'recu'>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!openMode) return;
    setError(null);
    const fd = new FormData(e.currentTarget);
    const data: any = Object.fromEntries(fd.entries());
    data.project_id = projectId;
    if (openMode === 'recu') data.scheduled_date = '';
    else data.received_at = '';
    start(async () => {
      const r = await addEncaissementAction(data);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setOpenMode(null);
    });
  }

  function remove(id: string) {
    if (!confirm('Supprimer cet encaissement ?')) return;
    start(async () => { await deleteEncaissementAction(id); });
  }

  // 2 listes triées par date la plus proche en premier.
  const planifies = encaissements
    .filter((e) => e.status === 'planifie')
    .sort((a, b) => (a.scheduled_date ?? '').localeCompare(b.scheduled_date ?? ''));
  const recus = encaissements
    .filter((e) => e.status !== 'planifie')
    .sort((a, b) => (b.received_at ?? '').localeCompare(a.received_at ?? ''));

  const totalRecu = recus.reduce((s, e) => s + Number(e.amount_mad), 0);
  const totalPlanifie = planifies.reduce((s, e) => s + Number(e.amount_mad), 0);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle>Encaissements client (travaux)</CardTitle>
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Saisis ce qui doit rentrer pour piloter la trésorerie, et ce qui est déjà arrivé pour le suivi.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => { setError(null); setOpenMode('planifie'); }}
              className="bg-stoniz-black text-white"
              title="Planifier une rentrée d'argent attendue — apparaîtra dans la projection cashflow"
            >
              <CalendarPlus className="w-4 h-4" /> Planifier un encaissement
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { setError(null); setOpenMode('recu'); }}
              title="Saisir un encaissement déjà reçu"
            >
              <BanknoteIcon className="w-4 h-4" /> Saisir un encaissement reçu
            </Button>
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-8 text-sm">
          <div>
            <span className="text-xs text-stoniz-gray-500 mr-2">Déjà reçu</span>
            <span className="font-display text-lg">{formatMad(totalRecu)}</span>
          </div>
          <div>
            <span className="text-xs text-orange-700 mr-2">À encaisser</span>
            <span className="font-display text-lg text-orange-700">{formatMad(totalPlanifie)}</span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* ─── Section 1 : À encaisser (prioritaire pour la tréso) ─── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <CalendarClock className="w-4 h-4 text-orange-700" />
            <h3 className="text-sm font-medium text-orange-700">À encaisser</h3>
            <span className="text-xs text-stoniz-gray-500">
              ({planifies.length} {planifies.length > 1 ? 'rentrées prévues' : 'rentrée prévue'})
            </span>
          </div>
          {planifies.length === 0 ? (
            <button
              type="button"
              onClick={() => { setError(null); setOpenMode('planifie'); }}
              className="w-full text-sm text-stoniz-gray-500 italic border border-dashed border-stoniz-gray-300 rounded-lg py-4 hover:bg-stoniz-gray-50 hover:border-stoniz-gray-400 transition-colors"
            >
              + Aucun encaissement planifié — clique pour ajouter une échéance
            </button>
          ) : (
            <ul className="divide-y border rounded-lg bg-orange-50/30 text-sm">
              {planifies.map((e) => (
                <li key={e.id} className="px-3 py-2 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-medium">{formatMad(e.amount_mad)}</span>
                    <span className="inline-flex items-center gap-1 text-xs text-orange-700">
                      <CalendarClock className="w-3 h-3" /> {formatDate(e.scheduled_date)}
                    </span>
                    {e.payment_method && (
                      <span className="text-xs text-stoniz-gray-500">{e.payment_method}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {e.notes && (
                      <span className="text-xs text-stoniz-gray-500 truncate max-w-xs">{e.notes}</span>
                    )}
                    <FinanceAuditButton table="travaux_encaissements" recordId={e.id} />
                    <EncaissementEditButton encaissement={e} projectId={projectId} />
                    <button
                      onClick={() => remove(e.id)}
                      disabled={pending}
                      className="text-red-600 hover:text-red-800"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── Section 2 : Déjà reçus (historique) ─── */}
        <section>
          <div className="flex items-center gap-2 mb-2">
            <BanknoteIcon className="w-4 h-4 text-emerald-700" />
            <h3 className="text-sm font-medium text-emerald-700">Reçus</h3>
            <span className="text-xs text-stoniz-gray-500">
              ({recus.length} {recus.length > 1 ? 'paiements' : 'paiement'})
            </span>
          </div>
          {recus.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500 italic px-3 py-2">
              Aucun encaissement reçu enregistré.
            </p>
          ) : (
            <ul className="divide-y border rounded-lg text-sm">
              {recus.map((e) => {
                const bank = bankLinks[e.id];
                return (
                  <li key={e.id} className="px-3 py-2 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-medium">{formatMad(e.amount_mad)}</span>
                      <span className="text-xs text-stoniz-gray-500">{formatDate(e.received_at)}</span>
                      {e.payment_method && (
                        <span className="text-xs text-stoniz-gray-500">{e.payment_method}</span>
                      )}
                      {bank ? (
                        <Link
                          href={`/finance/tresorerie/transactions/${bank.txId}`}
                          className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                          title={bank.bankLabel ?? ''}
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
                    </div>
                    <div className="flex items-center gap-3">
                      {e.notes && (
                        <span className="text-xs text-stoniz-gray-500 truncate max-w-xs">{e.notes}</span>
                      )}
                      <EncaissementEditButton encaissement={e} projectId={projectId} />
                      <button
                        onClick={() => remove(e.id)}
                        disabled={pending}
                        className="text-red-600 hover:text-red-800"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </CardContent>

      {/* ─── Modale création (1 mode déterminé par openMode) ─── */}
      {openMode && (
        <div
          className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
          onClick={() => setOpenMode(null)}
        >
          <form onSubmit={submit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={(ev) => ev.stopPropagation()}>
            <div>
              <h2 className="font-display text-xl flex items-center gap-2">
                {openMode === 'planifie' ? (
                  <><CalendarPlus className="w-5 h-5 text-orange-700" /> Planifier un encaissement</>
                ) : (
                  <><BanknoteIcon className="w-5 h-5 text-emerald-700" /> Encaissement reçu</>
                )}
              </h2>
              <p className="text-xs text-stoniz-gray-500 mt-1">
                {openMode === 'planifie'
                  ? 'Une rentrée d’argent attendue du client. Apparaîtra dans la projection cashflow 30/60/90j.'
                  : 'Un versement déjà reçu sur le compte. Renseigne la date à laquelle il est arrivé.'}
              </p>
            </div>

            <div>
              <Label>Montant (MAD) *</Label>
              <Input name="amount_mad" type="number" step="0.01" required autoFocus />
            </div>

            {openMode === 'planifie' ? (
              <div>
                <Label>Échéance prévue *</Label>
                <Input
                  name="scheduled_date"
                  type="date"
                  required
                  defaultValue={(() => {
                    const d = new Date();
                    d.setDate(d.getDate() + 30);
                    return d.toISOString().slice(0, 10);
                  })()}
                />
                <p className="text-[11px] text-stoniz-gray-500 mt-1">
                  Quand attends-tu cette rentrée d&apos;argent ?
                </p>
              </div>
            ) : (
              <div>
                <Label>Date de réception *</Label>
                <Input
                  name="received_at"
                  type="date"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                />
              </div>
            )}

            <div>
              <Label>Mode de paiement</Label>
              <Input name="payment_method" placeholder="Virement, espèces, chèque..." />
            </div>
            <div>
              <Label>Notes</Label>
              <Input name="notes" />
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpenMode(null)}>Annuler</Button>
              <Button type="submit" disabled={pending}>
                {pending ? '…' : openMode === 'planifie' ? 'Planifier' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </div>
      )}
    </Card>
  );
}

// ─── Mini-modale d'édition d'un encaissement (garde le switch pour conversion) ─
function EncaissementEditButton({
  encaissement,
  projectId,
}: {
  encaissement: Encaissement;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mode, setMode] = useState<'recu' | 'planifie'>(
    encaissement.status === 'planifie' ? 'planifie' : 'recu',
  );

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const fd = new FormData(e.currentTarget);
      const payload: any = {
        encaissement_id: encaissement.id,
        project_id: projectId,
        amount_mad: fd.get('amount_mad'),
        payment_method: (fd.get('payment_method') as string) || null,
        notes: (fd.get('notes') as string) || null,
      };
      if (mode === 'recu') {
        payload.received_at = (fd.get('received_at') as string) || null;
        payload.scheduled_date = null;
      } else {
        payload.received_at = null;
        payload.scheduled_date = (fd.get('scheduled_date') as string) || null;
      }
      const r = await updateEncaissementAction(payload);
      if (!r.ok) { setErr(r.error ?? 'Erreur'); return; }
      setOpen(false);
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
        title="Éditer cet encaissement"
      >
        <Pencil className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <form onSubmit={onSubmit} className="bg-white rounded-2xl max-w-md w-full p-6 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-display text-xl">Éditer l&apos;encaissement</h2>

            <div className="flex items-center gap-2 text-xs">
              <span className="text-stoniz-gray-600">État :</span>
              <button
                type="button"
                onClick={() => setMode('planifie')}
                className={`px-3 py-1 rounded-md border text-xs inline-flex items-center gap-1 ${
                  mode === 'planifie'
                    ? 'bg-orange-100 text-orange-800 border-orange-300'
                    : 'bg-white text-stoniz-gray-700'
                }`}
              >
                <CalendarClock className="w-3 h-3" /> À encaisser
              </button>
              <button
                type="button"
                onClick={() => setMode('recu')}
                className={`px-3 py-1 rounded-md border text-xs inline-flex items-center gap-1 ${
                  mode === 'recu'
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : 'bg-white text-stoniz-gray-700'
                }`}
              >
                <BanknoteIcon className="w-3 h-3" /> Reçu
              </button>
            </div>

            <div>
              <Label>Montant (MAD)</Label>
              <Input
                name="amount_mad"
                type="number"
                step="0.01"
                defaultValue={Number(encaissement.amount_mad)}
                required
              />
            </div>

            {mode === 'recu' ? (
              <div>
                <Label>Date de réception *</Label>
                <Input
                  name="received_at"
                  type="date"
                  required
                  defaultValue={encaissement.received_at ?? new Date().toISOString().slice(0, 10)}
                />
              </div>
            ) : (
              <div>
                <Label>Échéance prévue *</Label>
                <Input
                  name="scheduled_date"
                  type="date"
                  required
                  defaultValue={encaissement.scheduled_date ?? ''}
                />
              </div>
            )}

            <div>
              <Label>Mode de paiement</Label>
              <Input name="payment_method" defaultValue={encaissement.payment_method ?? ''} />
            </div>
            <div>
              <Label>Notes</Label>
              <Input name="notes" defaultValue={encaissement.notes ?? ''} />
            </div>
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Annuler</Button>
              <Button type="submit" disabled={busy}>{busy ? '…' : 'Enregistrer'}</Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
