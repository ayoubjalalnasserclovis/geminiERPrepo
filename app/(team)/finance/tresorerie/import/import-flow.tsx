'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileUp, CheckCircle, AlertTriangle, AlertCircle, Loader2, RotateCcw, Info } from 'lucide-react';
import { dryRunImport, confirmImport, type DryRunPreview } from './actions';

type Account = {
  id: string;
  account_label: string;
  bank_label: string;
  bank_code: string;
  currency: string;
  company: { name: string; business_unit: string } | null;
};

function fmtMad(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' MAD';
}

function fmtDate(d: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR');
}

export function ImportFlow({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [step, setStep] = useState<'upload' | 'preview' | 'done'>('upload');
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ inserted: number; skipped: number; internal: number } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData(e.currentTarget);
      const result = await dryRunImport(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.data);
      setStep('preview');
    } catch (err: any) {
      // Ne devrait plus jamais arriver — l'action retourne {ok,error} — mais
      // on garde un filet de sécurité pour les erreurs réseau.
      setError(err?.message ?? 'Erreur réseau lors de l\'analyse du fichier.');
    } finally {
      setSubmitting(false);
    }
  }

  async function onConfirm(opts: { recordBalance: boolean; balanceDate?: string; balanceAmount?: string }) {
    if (!preview) return;
    setError(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('account_id', preview.account_id);
      // Ne pas envoyer les doublons, le serveur les ré-vérifie de toute façon
      const rowsToImport = preview.rows
        .filter(r => !r.is_duplicate)
        .map(r => ({
          operation_date: r.operation_date,
          value_date: r.value_date,
          label: r.label,
          reference: r.reference,
          debit_mad: r.debit_mad,
          credit_mad: r.credit_mad,
          is_pending: r.is_pending,
          dedup_hash: r.dedup_hash,
          category_code: r.categorization.category_code,
          allocation_type: r.categorization.allocation_type,
          beneficiary: r.categorization.beneficiary,
        }));
      fd.append('rows_json', JSON.stringify(rowsToImport));
      fd.append('record_balance', opts.recordBalance ? 'yes' : 'no');
      if (opts.recordBalance && opts.balanceDate && opts.balanceAmount) {
        fd.append('balance_date', opts.balanceDate);
        fd.append('balance_amount', opts.balanceAmount);
      }
      const res = await confirmImport(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConfirmed({
        inserted: res.inserted,
        skipped: res.skipped_duplicates,
        internal: res.skipped_internal_duplicates,
      });
      setStep('done');
    } catch (err: any) {
      setError(err?.message ?? 'Erreur réseau lors de la confirmation');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setStep('upload');
    setPreview(null);
    setConfirmed(null);
    setError(null);
  }

  // ─── Étape 1 : Upload ───────────────────────────────────────────────────
  if (step === 'upload') {
    return (
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-6">
        <form onSubmit={onUpload} className="space-y-4">
          <div>
            <label className="text-sm font-medium text-stoniz-gray-900 block mb-1">Compte cible *</label>
            <select
              name="account_id"
              required
              defaultValue=""
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            >
              <option value="" disabled>— Choisir le compte —</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.company?.name} · {a.bank_label} · {a.account_label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-stoniz-gray-900 block mb-1">Fichier relevé (XLSX ou CSV) *</label>
            <input
              type="file"
              name="file"
              accept=".xlsx,.xls,.csv"
              required
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
            />
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Max 10 Mo. XLSX recommandé (encoding propre). CSV accepté (Latin-1 ou UTF-8 auto-détecté).
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-stoniz-gray-900 block mb-1">Solde de référence (optionnel)</label>
            <input
              type="text"
              name="initial_balance"
              placeholder="Ex : 333521.39 (solde au début de la période)"
              className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
            />
            <p className="text-xs text-stoniz-gray-500 mt-1">
              Si tu connais le solde au début de la période du relevé, on calculera le solde théorique attendu et tu pourras vérifier la cohérence.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="bg-stoniz-black text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Analyse en cours…</> : <><FileUp className="w-4 h-4" /> Analyser le fichier</>}
          </button>
        </form>
      </div>
    );
  }

  // ─── Étape 2 : Preview / dry-run ────────────────────────────────────────
  if (step === 'preview' && preview) {
    const importable = preview.rows.filter(r => !r.is_duplicate).length;

    return (
      <div className="space-y-6">
        {/* Résumé global */}
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-lg font-display">Aperçu de l'import</h2>
              <p className="text-xs text-stoniz-gray-500 mt-1">
                Compte cible : <strong>{preview.account_label}</strong> · Période :{' '}
                {fmtDate(preview.date_min)} → {fmtDate(preview.date_max)}
              </p>
            </div>
            <button onClick={reset} className="text-sm text-stoniz-gray-500 hover:text-stoniz-black inline-flex items-center gap-1">
              <RotateCcw className="w-3.5 h-3.5" /> Recommencer
            </button>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-center">
            <div className="bg-stoniz-gray-50 rounded p-3">
              <div className="text-2xl font-display">{preview.total_lines}</div>
              <div className="text-xs text-stoniz-gray-600 mt-1">Lignes total</div>
            </div>
            <div className="bg-emerald-50 rounded p-3">
              <div className="text-2xl font-display text-emerald-700">{fmtMad(preview.total_credits_mad)}</div>
              <div className="text-xs text-stoniz-gray-600 mt-1">Crédits</div>
            </div>
            <div className="bg-red-50 rounded p-3">
              <div className="text-2xl font-display text-red-700">{fmtMad(preview.total_debits_mad)}</div>
              <div className="text-xs text-stoniz-gray-600 mt-1">Débits</div>
            </div>
            <div className={`rounded p-3 ${preview.net_mad >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <div className={`text-2xl font-display ${preview.net_mad >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                {fmtMad(preview.net_mad)}
              </div>
              <div className="text-xs text-stoniz-gray-600 mt-1">Solde net</div>
            </div>
            <div className="bg-blue-50 rounded p-3">
              <div className="text-2xl font-display text-blue-700">{importable}</div>
              <div className="text-xs text-stoniz-gray-600 mt-1">À importer</div>
            </div>
          </div>

          {preview.expected_balance_after != null && (
            <div className="mt-4 bg-stoniz-gray-50 rounded p-3 text-sm">
              <strong>Solde théorique attendu après import :</strong> {fmtMad(preview.expected_balance_after)}
              <p className="text-xs text-stoniz-gray-500 mt-1">
                = Solde initial saisi + crédits − débits. À comparer avec le solde final indiqué sur ton relevé.
              </p>
            </div>
          )}
        </div>

        {/* Alertes */}
        {(preview.duplicates_count > 0 || preview.unknowns_count > 0 || preview.errors.length > 0) && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {preview.duplicates_count > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-amber-900">
                  <AlertTriangle className="w-4 h-4" />
                  {preview.duplicates_count} doublon{preview.duplicates_count > 1 ? 's' : ''}
                </div>
                <p className="text-xs text-amber-700 mt-1">
                  Déjà importé{preview.duplicates_count > 1 ? 'es' : 'e'} précédemment, ignoré{preview.duplicates_count > 1 ? 'es' : 'e'} à la confirmation.
                </p>
              </div>
            )}
            {preview.unknowns_count > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-blue-900">
                  <Info className="w-4 h-4" />
                  {preview.unknowns_count} libellé{preview.unknowns_count > 1 ? 's' : ''} à qualifier
                </div>
                <p className="text-xs text-blue-700 mt-1">
                  Catégorie auto = "Autre". Tu pourras qualifier après import depuis la page Trésorerie.
                </p>
              </div>
            )}
            {preview.errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded p-3 text-sm">
                <div className="flex items-center gap-2 font-medium text-red-900">
                  <AlertCircle className="w-4 h-4" />
                  {preview.errors.length} erreur{preview.errors.length > 1 ? 's' : ''} de parsing
                </div>
                <p className="text-xs text-red-700 mt-1 max-h-20 overflow-y-auto">
                  {preview.errors.slice(0, 3).join(' · ')}
                  {preview.errors.length > 3 && ` (+${preview.errors.length - 3})`}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Répartition par catégorie */}
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-6">
          <h3 className="text-base font-medium mb-3">Répartition par catégorie</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <th className="text-left py-2 px-2">Catégorie</th>
                  <th className="text-right py-2 px-2">Nb lignes</th>
                  <th className="text-right py-2 px-2">Total (cumul absolu)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.by_category.map((c, i) => (
                  <tr key={i} className="hover:bg-stoniz-gray-50">
                    <td className="py-2 px-2 font-medium">{c.category}</td>
                    <td className="text-right py-2 px-2">{c.count}</td>
                    <td className="text-right py-2 px-2">{fmtMad(c.total_mad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Détail des lignes */}
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-6">
          <h3 className="text-base font-medium mb-3">Détail des lignes ({preview.rows.length})</h3>
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase text-stoniz-gray-500 border-b sticky top-0 bg-white">
                <tr>
                  <th className="text-left py-2 px-2">Date</th>
                  <th className="text-left py-2 px-2">Libellé</th>
                  <th className="text-left py-2 px-2">Catégorie</th>
                  <th className="text-right py-2 px-2">Débit</th>
                  <th className="text-right py-2 px-2">Crédit</th>
                  <th className="text-left py-2 px-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {preview.rows.map((r, i) => (
                  <tr key={i} className={`${r.is_duplicate ? 'opacity-40 bg-amber-50' : 'hover:bg-stoniz-gray-50'}`}>
                    <td className="py-1.5 px-2 whitespace-nowrap">{fmtDate(r.operation_date)}</td>
                    <td className="py-1.5 px-2 max-w-xs truncate" title={r.label}>{r.label}</td>
                    <td className="py-1.5 px-2">
                      <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${
                        r.categorization.confidence === 'unknown' ? 'bg-blue-100 text-blue-700' :
                        r.categorization.confidence === 'mapped' ? 'bg-purple-100 text-purple-700' :
                        'bg-stoniz-gray-100 text-stoniz-gray-700'
                      }`}>
                        {r.categorization.category_code}
                      </span>
                    </td>
                    <td className="text-right py-1.5 px-2 text-red-700 font-mono">
                      {r.debit_mad ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(r.debit_mad) : ''}
                    </td>
                    <td className="text-right py-1.5 px-2 text-emerald-700 font-mono">
                      {r.credit_mad ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(r.credit_mad) : ''}
                    </td>
                    <td className="py-1.5 px-2 text-[10px]">
                      {r.is_duplicate && <span className="text-amber-700">Doublon</span>}
                      {r.is_pending && !r.is_duplicate && <span className="text-stoniz-gray-500">En attente</span>}
                      {!r.is_duplicate && !r.is_pending && <span className="text-stoniz-gray-400">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Confirmation */}
        <ConfirmBox
          preview={preview}
          submitting={submitting}
          error={error}
          onConfirm={onConfirm}
          onCancel={reset}
        />
      </div>
    );
  }

  // ─── Étape 3 : Terminé ──────────────────────────────────────────────────
  if (step === 'done' && confirmed) {
    return (
      <div className="bg-white border border-stoniz-gray-200 rounded-xl p-12 text-center">
        <CheckCircle className="w-16 h-16 mx-auto text-emerald-600 mb-4" />
        <h2 className="text-xl font-display mb-2">Import terminé</h2>
        <p className="text-sm text-stoniz-gray-600 mb-6">
          <strong className="text-emerald-700">{confirmed.inserted}</strong> ligne{confirmed.inserted > 1 ? 's' : ''} insérée{confirmed.inserted > 1 ? 's' : ''}
          {confirmed.skipped > 0 && <> · <strong>{confirmed.skipped}</strong> doublon{confirmed.skipped > 1 ? 's' : ''} déjà connu{confirmed.skipped > 1 ? 's' : ''}</>}
          {confirmed.internal > 0 && <> · <strong>{confirmed.internal}</strong> doublon{confirmed.internal > 1 ? 's' : ''} interne{confirmed.internal > 1 ? 's' : ''} au fichier</>}
        </p>
        <div className="flex items-center justify-center gap-3">
          <button onClick={reset} className="border border-stoniz-gray-300 px-4 py-2 rounded-md text-sm">
            Importer un autre fichier
          </button>
          <button onClick={() => router.push('/finance/tresorerie')} className="bg-stoniz-black text-white px-5 py-2 rounded-md text-sm font-medium">
            Retour à la trésorerie
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Boîte de confirmation ────────────────────────────────────────────────

function ConfirmBox({
  preview,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  preview: DryRunPreview;
  submitting: boolean;
  error: string | null;
  onConfirm: (opts: { recordBalance: boolean; balanceDate?: string; balanceAmount?: string }) => void;
  onCancel: () => void;
}) {
  const [recordBalance, setRecordBalance] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [balanceDate, setBalanceDate] = useState(preview.date_max ?? today);
  const [balanceAmount, setBalanceAmount] = useState('');

  const importable = preview.rows.filter(r => !r.is_duplicate).length;

  return (
    <div className="bg-white border border-stoniz-gray-200 rounded-xl p-6">
      <h3 className="text-base font-medium mb-3">Confirmation</h3>
      <p className="text-sm text-stoniz-gray-600 mb-4">
        {importable} ligne{importable > 1 ? 's' : ''} prête{importable > 1 ? 's' : ''} à être importée{importable > 1 ? 's' : ''}.
        Les doublons seront automatiquement ignorés. L'import est idempotent : tu peux re-uploader le même fichier sans risque.
      </p>

      <div className="bg-stoniz-gray-50 rounded p-4 mb-4">
        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={recordBalance}
            onChange={(e) => setRecordBalance(e.target.checked)}
            className="rounded"
          />
          Enregistrer un nouveau solde après import
        </label>
        {recordBalance && (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-stoniz-gray-600 block">Date du solde</label>
              <input
                type="date"
                value={balanceDate}
                onChange={(e) => setBalanceDate(e.target.value)}
                max={today}
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-stoniz-gray-600 block">Solde réel à cette date (MAD)</label>
              <input
                type="text"
                value={balanceAmount}
                onChange={(e) => setBalanceAmount(e.target.value)}
                placeholder="223689.73"
                pattern="^-?\d+(\.\d{1,2})?$"
                className="mt-1 w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm font-mono"
              />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded p-3 text-sm text-red-700 mb-3">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <button onClick={onCancel} className="text-sm text-stoniz-gray-600 hover:text-stoniz-black">
          Annuler
        </button>
        <button
          onClick={() => onConfirm({ recordBalance, balanceDate, balanceAmount })}
          disabled={submitting || importable === 0}
          className="bg-stoniz-black text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
        >
          {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Import en cours…</> : `Confirmer l'import (${importable} lignes)`}
        </button>
      </div>
    </div>
  );
}

