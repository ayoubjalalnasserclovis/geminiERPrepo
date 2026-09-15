'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { importTravauxCsvAction, type DryRunSummary } from './actions';

function formatMad(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' MAD';
}

export function TravauxImportClient({ projectId }: { projectId: string }) {
  const [suiviText, setSuiviText] = useState<string>('');
  const [cashflowText, setCashflowText] = useState<string>('');
  const [suiviName, setSuiviName] = useState<string>('');
  const [cashflowName, setCashflowName] = useState<string>('');
  const [summary, setSummary] = useState<DryRunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function readFile(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ''));
      r.onerror = () => reject(new Error('Lecture fichier impossible'));
      r.readAsText(f, 'utf-8');
    });
  }

  function preview() {
    setError(null); setSuccess(null);
    start(async () => {
      const r = await importTravauxCsvAction({
        project_id: projectId,
        suivi_csv: suiviText || undefined,
        cashflow_csv: cashflowText || undefined,
        dry_run: true,
      }).catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' } as const));
      if (!r.ok) { setError(r.error); setSummary(null); return; }
      setSummary(r.summary);
    });
  }

  function confirmImport() {
    if (!confirm('Confirmer l\'import dans la base ? Action tracée, ré-import bloqué pour ce projet.')) return;
    setError(null); setSuccess(null);
    start(async () => {
      const r = await importTravauxCsvAction({
        project_id: projectId,
        suivi_csv: suiviText || undefined,
        cashflow_csv: cashflowText || undefined,
        dry_run: false,
      }).catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' } as const));
      if (!r.ok) { setError(r.error); return; }
      setSuccess(`✅ Import réussi : ${r.summary.lots_count} lots, ${r.summary.acomptes_count} acomptes, ${r.summary.encaissements_count} encaissements`);
      setSummary(null);
      setSuiviText(''); setCashflowText('');
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <Label>1. Feuille principale — Suivi travaux (CSV)</Label>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            className="w-full text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setSuiviName(f.name);
              setSuiviText(await readFile(f));
              setSummary(null);
            }}
          />
          {suiviName && <p className="text-xs text-stoniz-gray-500 mt-1">📄 {suiviName}</p>}
        </div>

        <div>
          <Label>2. Feuille cashflow — Encaissements client (CSV, optionnel)</Label>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            className="w-full text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setCashflowName(f.name);
              setCashflowText(await readFile(f));
              setSummary(null);
            }}
          />
          {cashflowName && <p className="text-xs text-stoniz-gray-500 mt-1">📄 {cashflowName}</p>}
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={preview} disabled={pending || (!suiviText && !cashflowText)}>
            {pending && !summary ? 'Analyse…' : 'Prévisualiser'}
          </Button>
          {summary && (
            <Button variant="primary" onClick={confirmImport} disabled={pending}>
              {pending ? 'Import…' : '✅ Confirmer l\'import'}
            </Button>
          )}
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded">{error}</div>}
        {success && <div className="text-sm text-green-700 bg-green-50 p-3 rounded">{success}</div>}
      </Card>

      {summary && (
        <Card className="space-y-4">
          <div>
            <p className="font-display text-lg mb-2">Prévisualisation</p>
            <p className="text-sm text-stoniz-gray-600">Voici exactement ce qui sera créé si tu confirmes :</p>
          </div>

          {summary.warnings.length > 0 && (
            <div className="text-sm text-orange-700 bg-orange-50 p-3 rounded space-y-1">
              {summary.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
            </div>
          )}

          {/* Métadonnées projet */}
          <div>
            <p className="font-semibold text-sm mb-2">Métadonnées projet (mises à jour)</p>
            <table className="text-sm w-full">
              <tbody>
                <Tr label="Client (CSV)" value={summary.meta.client_label ?? '—'} />
                <Tr label="Adresse chantier" value={summary.meta.adresse_chantier ?? '—'} />
                <Tr label="Budget global" value={summary.meta.budget_global_mad ? formatMad(summary.meta.budget_global_mad) : '—'} />
                <Tr label="Marge cible (%)" value={summary.meta.marge_cible_pct != null ? `${summary.meta.marge_cible_pct}%` : '—'} />
                <Tr label="Date début chantier" value={summary.meta.date_debut_chantier ?? '—'} />
                <Tr label="Date fin estimée" value={summary.meta.date_fin_estimee ?? '—'} />
              </tbody>
            </table>
          </div>

          {/* Totaux */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            <Stat label="Lots à créer" value={String(summary.lots_count)} />
            <Stat label="Acomptes à créer" value={String(summary.acomptes_count)} />
            <Stat label="Encaissements à créer" value={String(summary.encaissements_count)} />
            <Stat label="Total facturé client" value={formatMad(summary.total_facture_client_mad)} />
            <Stat label="Total payé artisans" value={formatMad(summary.total_payé_artisans_mad)} />
            <Stat label="Total encaissé client" value={formatMad(summary.total_encaissé_client_mad)} />
          </div>

          {/* Détail lots */}
          {summary.lots_preview.length > 0 && (
            <div>
              <p className="font-semibold text-sm mb-2">Détail des lots ({summary.lots_preview.length})</p>
              <div className="overflow-x-auto">
                <table className="text-xs w-full border">
                  <thead className="bg-stoniz-gray-100">
                    <tr>
                      <th className="text-left p-2">N°</th>
                      <th className="text-left p-2">Catégorie</th>
                      <th className="text-left p-2">Artisan</th>
                      <th className="text-right p-2">Budget</th>
                      <th className="text-right p-2">Devis</th>
                      <th className="text-right p-2">Facturé</th>
                      <th className="text-center p-2">Acomptes</th>
                      <th className="text-left p-2">Statut</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.lots_preview.map((l, i) => (
                      <tr key={i} className="border-t">
                        <td className="p-2">{l.numero}</td>
                        <td className="p-2">{l.category}</td>
                        <td className="p-2">{l.artisan_name}</td>
                        <td className="p-2 text-right">{l.budget_estimate_mad ? formatMad(l.budget_estimate_mad) : '—'}</td>
                        <td className="p-2 text-right">{l.devis_artisan_mad ? formatMad(l.devis_artisan_mad) : '—'}</td>
                        <td className="p-2 text-right">{l.facture_client_mad ? formatMad(l.facture_client_mad) : '—'}</td>
                        <td className="p-2 text-center">{l.acomptes.length}</td>
                        <td className="p-2">{l.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Détail encaissements */}
          {summary.encaissements_preview.length > 0 && (
            <div>
              <p className="font-semibold text-sm mb-2">Détail des encaissements ({summary.encaissements_preview.length})</p>
              <table className="text-xs w-full border">
                <thead className="bg-stoniz-gray-100">
                  <tr>
                    <th className="text-left p-2">Date</th>
                    <th className="text-right p-2">Montant</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.encaissements_preview.map((e, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-2">{e.received_at}</td>
                      <td className="p-2 text-right">{formatMad(e.amount_mad)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function Tr({ label, value }: { label: string; value: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-1 text-stoniz-gray-600">{label}</td>
      <td className="py-1 text-right">{value}</td>
    </tr>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-stoniz-gray-50 rounded p-3">
      <div className="text-xs text-stoniz-gray-500">{label}</div>
      <div className="font-semibold text-base">{value}</div>
    </div>
  );
}
