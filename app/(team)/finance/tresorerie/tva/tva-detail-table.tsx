'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Brain, Sparkles } from 'lucide-react';
import { Money } from '@/components/ui/money';
import { Button } from '@/components/ui/button';
import { formatDate } from '@/lib/utils/format';
import { updateTvaTreatmentAction } from './actions';
import { TVA_RATE_OPTIONS, DEFAULT_TVA_RATE } from '@/lib/finance/tva-constants';
import type { TvaTreatment, TvaResolved } from '@/lib/finance/tva-constants';
import type { TvaTransactionRow } from '@/lib/finance/tva';

const TREATMENT_OPTIONS: { value: TvaTreatment; label: string }[] = [
  { value: 'auto', label: 'Auto (règles par catégorie)' },
  { value: 'collectee', label: 'Collectée' },
  { value: 'deductible', label: 'Déductible' },
  { value: 'exoneree', label: 'Exonérée' },
  { value: 'a_qualifier', label: 'À qualifier' },
];

const RESOLVED_BADGE: Record<TvaResolved, { label: string; className: string }> = {
  collectee: { label: 'Collectée', className: 'bg-green-100 text-green-800' },
  deductible: { label: 'Déductible', className: 'bg-blue-100 text-blue-800' },
  exoneree: { label: 'Exonérée', className: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  a_qualifier: { label: 'À qualifier', className: 'bg-orange-100 text-orange-800' },
};

const SOURCE_ICON: Record<'manual' | 'vendor' | 'person' | 'category', { icon: string; title: string }> = {
  manual: { icon: '✏️', title: 'Override manuel sur cette transaction' },
  vendor: { icon: '🧠', title: 'Règle apprise depuis un précédent override sur ce bénéficiaire' },
  person: { icon: '👤', title: 'Bénéficiaire présumé personne physique (salaire / remboursement) — exonéré par défaut' },
  category: { icon: '⚙️', title: 'Règle par défaut basée sur la catégorie du relevé' },
};

export function TvaDetailTable({
  transactions,
  canWrite,
}: {
  transactions: TvaTransactionRow[];
  canWrite: boolean;
}) {
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<TvaTransactionRow | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return transactions;
    return transactions.filter(t =>
      (t.label ?? '').toLowerCase().includes(q)
      || (t.beneficiary ?? '').toLowerCase().includes(q)
      || (t.reference ?? '').toLowerCase().includes(q)
      || (t.category_code ?? '').toLowerCase().includes(q)
      || t.company_label.toLowerCase().includes(q)
    );
  }, [transactions, search]);

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-display">Détail des transactions</h2>
          <div className="text-xs text-stoniz-gray-500">
            {filtered.length} / {transactions.length} transactions
          </div>
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stoniz-gray-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher par libellé, bénéficiaire, référence…"
            className="w-full pl-9 pr-3 py-2 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-stoniz-black"
          />
        </div>
      </div>

      <div className="overflow-x-auto -mx-6 px-6">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b text-xs uppercase text-stoniz-gray-500 tracking-wider">
              <th className="text-left py-2 pr-3">Date</th>
              <th className="text-left py-2 pr-3">Libellé / Bénéficiaire</th>
              <th className="text-left py-2 pr-3">Société</th>
              <th className="text-right py-2 pr-3">Crédit</th>
              <th className="text-right py-2 pr-3">Débit</th>
              <th className="text-right py-2 pr-3">Base HT</th>
              <th className="text-right py-2 pr-3">Taux</th>
              <th className="text-right py-2 pr-3">TVA</th>
              <th className="text-left py-2">Traitement</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="py-6 text-center text-sm text-stoniz-gray-500">
                  Aucune transaction ne correspond à « {search} »
                </td>
              </tr>
            )}
            {filtered.map(t => {
              const badge = RESOLVED_BADGE[t.resolved];
              const src = SOURCE_ICON[t.source];
              return (
                <tr key={t.id} className="border-b hover:bg-stoniz-gray-50/50">
                  <td className="py-2 pr-3 whitespace-nowrap text-xs">
                    {formatDate(t.operation_date)}
                  </td>
                  <td className="py-2 pr-3 max-w-xs">
                    <div className="truncate" title={t.label}>{t.label}</div>
                    <div className="text-xs text-stoniz-gray-500">
                      {t.category_code ?? '—'}
                      {t.beneficiary && ` · ${t.beneficiary}`}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-xs text-stoniz-gray-600">
                    {t.company_label}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {t.credit_mad ? <Money amount={Number(t.credit_mad)} currency="MAD" /> : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap">
                    {t.debit_mad ? <Money amount={Number(t.debit_mad)} currency="MAD" /> : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap text-xs">
                    {t.resolved === 'collectee' || t.resolved === 'deductible'
                      ? <Money amount={t.base_ht} currency="MAD" />
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap text-xs">
                    {t.resolved === 'collectee' || t.resolved === 'deductible'
                      ? `${t.applied_rate}%`
                      : '—'}
                  </td>
                  <td className="py-2 pr-3 text-right whitespace-nowrap font-medium">
                    {t.resolved === 'collectee' && (
                      <span className="text-green-700"><Money amount={t.tva} currency="MAD" /></span>
                    )}
                    {t.resolved === 'deductible' && (
                      <span className="text-blue-700"><Money amount={t.tva} currency="MAD" /></span>
                    )}
                    {t.resolved !== 'collectee' && t.resolved !== 'deductible' && '—'}
                  </td>
                  <td className="py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded ${badge.className}`}>
                        {badge.label}
                      </span>
                      <span className="text-xs" title={src.title}>{src.icon}</span>
                      {canWrite && (
                        <button
                          type="button"
                          onClick={() => setEditing(t)}
                          className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline"
                        >
                          Modifier
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditTvaModal
          tx={editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function EditTvaModal({ tx, onClose }: { tx: TvaTransactionRow; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [treatment, setTreatment] = useState<TvaTreatment>(tx.tva_treatment);
  const [rate, setRate] = useState<number>(tx.tva_rate ?? tx.applied_rate ?? DEFAULT_TVA_RATE);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const showRate = treatment === 'collectee' || treatment === 'deductible';

  function save() {
    setError(null); setFeedback(null);
    start(async () => {
      const r = await updateTvaTreatmentAction({
        transaction_id: tx.id,
        treatment,
        tva_rate: showRate ? rate : null,
        remember_for_beneficiary: remember && !!tx.beneficiary,
      });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      if ((r as any).remembered) {
        setFeedback(`✓ Règle mémorisée pour « ${tx.beneficiary} »`);
        setTimeout(() => { router.refresh(); onClose(); }, 900);
      } else {
        router.refresh();
        onClose();
      }
    });
  }

  const ttc = Number(tx.credit_mad ?? 0) + Number(tx.debit_mad ?? 0);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={() => !pending && onClose()}
    >
      <div
        className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-lg font-semibold">Modifier le traitement TVA</h3>
          <div className="text-sm text-stoniz-gray-600 mt-1 space-y-0.5">
            <div><strong>{tx.label}</strong></div>
            {tx.beneficiary && (
              <div className="text-xs">Bénéficiaire : {tx.beneficiary}</div>
            )}
            <div className="text-xs">
              {formatDate(tx.operation_date)} · Montant TTC :{' '}
              <Money amount={ttc} currency="MAD" />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">Traitement</label>
          <select
            value={treatment}
            onChange={(e) => setTreatment(e.target.value as TvaTreatment)}
            disabled={pending}
            className="w-full border rounded-md px-3 py-2 text-sm"
          >
            {TREATMENT_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {showRate && (
          <div>
            <label className="block text-sm font-medium mb-1">Taux TVA (%)</label>
            <div className="flex gap-2 flex-wrap">
              {TVA_RATE_OPTIONS.map(r => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRate(r)}
                  disabled={pending}
                  className={`px-3 py-1.5 rounded-md text-sm border ${
                    rate === r
                      ? 'bg-stoniz-black text-white border-stoniz-black'
                      : 'bg-white hover:bg-stoniz-gray-50 border-stoniz-gray-300'
                  }`}
                >
                  {r}%
                </button>
              ))}
              <input
                type="number"
                min={0} max={30} step={0.5}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                disabled={pending}
                className="w-20 border rounded-md px-2 py-1.5 text-sm"
                title="Taux personnalisé"
              />
            </div>
            <div className="text-xs text-stoniz-gray-500 mt-1">
              Base HT : <Money amount={rate > 0 ? +(ttc / (1 + rate / 100)).toFixed(2) : ttc} currency="MAD" />
              {' · '}
              TVA : <Money amount={rate > 0 ? +(ttc - ttc / (1 + rate / 100)).toFixed(2) : 0} currency="MAD" />
            </div>
          </div>
        )}

        {tx.beneficiary && treatment !== 'auto' && (
          <label className="flex items-start gap-2 text-sm bg-stoniz-beige/40 border border-stoniz-black/20 rounded-md p-3 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              disabled={pending}
              className="mt-0.5"
            />
            <div>
              <div className="font-medium flex items-center gap-1">
                <Brain className="w-4 h-4" />
                Mémoriser pour <strong>{tx.beneficiary}</strong>
              </div>
              <div className="text-xs text-stoniz-gray-600 mt-0.5">
                Les prochaines transactions bancaires de ce bénéficiaire seront
                automatiquement traitées avec ce paramétrage
                {showRate && ` (${rate}%)`}. Tu pourras toujours override au cas
                par cas.
              </div>
            </div>
          </label>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}
        {feedback && (
          <div className="text-sm text-green-700 flex items-center gap-1">
            <Sparkles className="w-4 h-4" /> {feedback}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="px-4 py-2 text-sm rounded-md border hover:bg-stoniz-gray-50"
          >
            Annuler
          </button>
          <Button size="sm" onClick={save} disabled={pending}>
            {pending ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </div>
      </div>
    </div>
  );
}
