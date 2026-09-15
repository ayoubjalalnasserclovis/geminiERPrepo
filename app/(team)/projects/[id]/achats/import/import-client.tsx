'use client';

import { useState, useTransition } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { importAchatsCsvAction, type DryRunSummary } from './actions';

function formatMad(n: number) {
  return new Intl.NumberFormat('fr-FR').format(Math.round(n)) + ' MAD';
}

export function AchatsImportClient({ projectId }: { projectId: string }) {
  const [csvText, setCsvText] = useState<string>('');
  const [csvName, setCsvName] = useState<string>('');
  const [summary, setSummary] = useState<DryRunSummary | null>(null);
  const [createSuppliers, setCreateSuppliers] = useState(true);
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
      const r = await importAchatsCsvAction({
        project_id: projectId,
        csv_text: csvText,
        dry_run: true,
      }).catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' } as const));
      if (!r.ok) { setError(r.error); setSummary(null); return; }
      setSummary(r.summary);
    });
  }

  function confirmImport() {
    const toCreate = summary?.suppliers.filter(s => s.will_create).length ?? 0;
    const confirmMsg = createSuppliers && toCreate > 0
      ? `Confirmer l'import ?\n\n• ${summary?.lots_count} lots achats à créer\n• ${toCreate} fournisseurs à créer en base\n• Action tracée, ré-import bloqué.`
      : `Confirmer l'import sans créer les fournisseurs ?\n\n• ${summary?.lots_count} lots achats à créer\n• Les noms fournisseurs resteront en texte libre (pas rattachés à la table artisans)`;
    if (!confirm(confirmMsg)) return;

    setError(null); setSuccess(null);
    start(async () => {
      const r = await importAchatsCsvAction({
        project_id: projectId,
        csv_text: csvText,
        dry_run: false,
        create_missing_suppliers: createSuppliers,
      }).catch((e: any) => ({ ok: false, error: e?.message ?? 'Erreur' } as const));
      if (!r.ok) { setError(r.error); return; }
      const sup = r.summary.suppliers.filter(s => s.will_create).length;
      setSuccess(`✅ Import réussi : ${r.summary.lots_count} lots, ${r.summary.acomptes_count} acomptes${createSuppliers ? `, ${sup} fournisseurs créés` : ''}`);
      setSummary(null);
      setCsvText(''); setCsvName('');
    });
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4">
        <div>
          <Label>Feuille suivi achats (CSV)</Label>
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={pending}
            className="w-full text-sm"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setCsvName(f.name);
              setCsvText(await readFile(f));
              setSummary(null);
            }}
          />
          {csvName && <p className="text-xs text-stoniz-gray-500 mt-1">📄 {csvName}</p>}
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={preview} disabled={pending || !csvText}>
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
        <>
          {summary.warnings.length > 0 && (
            <Card className="bg-orange-50 border-orange-200">
              <div className="text-sm text-orange-800 space-y-1">
                {summary.warnings.map((w, i) => <div key={i}>⚠️ {w}</div>)}
              </div>
            </Card>
          )}

          {/* Totaux */}
          <Card>
            <p className="font-display text-lg mb-3">Récap chiffré</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <Stat label="Lots à créer" value={String(summary.lots_count)} />
              <Stat label="Acomptes" value={String(summary.acomptes_count)} />
              <Stat label="Budget total" value={formatMad(summary.total_budget_estime)} />
              <Stat label="Devis fournisseurs" value={formatMad(summary.total_devis_fournisseur)} />
            </div>
          </Card>

          {/* Fournisseurs */}
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="font-display text-lg">Fournisseurs détectés ({summary.suppliers.length})</p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={createSuppliers}
                  onChange={(e) => setCreateSuppliers(e.target.checked)}
                />
                Créer automatiquement les nouveaux fournisseurs en base
              </label>
            </div>

            {summary.suppliers.filter(s => s.will_create).length > 0 && (
              <div className="mb-4">
                <p className="text-sm font-semibold text-blue-700 mb-2">
                  🆕 Nouveaux à créer ({summary.suppliers.filter(s => s.will_create).length})
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-sm">
                  {summary.suppliers.filter(s => s.will_create).map(s => (
                    <div key={s.csv_name} className="bg-blue-50 px-2 py-1 rounded">{s.csv_name}</div>
                  ))}
                </div>
              </div>
            )}

            {summary.suppliers.filter(s => !s.will_create).length > 0 && (
              <div>
                <p className="text-sm font-semibold text-green-700 mb-2">
                  🔗 Déjà existants — rattachement auto ({summary.suppliers.filter(s => !s.will_create).length})
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1 text-sm">
                  {summary.suppliers.filter(s => !s.will_create).map(s => (
                    <div key={s.csv_name} className="bg-green-50 px-2 py-1 rounded">
                      {s.csv_name} → <strong>{s.matched_name}</strong>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* Suites */}
          {summary.suites.length > 0 && (
            <Card>
              <p className="font-display text-lg mb-3">Rattachement par suite</p>
              <table className="text-sm w-full">
                <thead className="text-xs uppercase text-stoniz-gray-500">
                  <tr><th className="text-left p-1">Section CSV</th><th className="text-left p-1">Suite Propria</th><th className="text-right p-1">Lots</th></tr>
                </thead>
                <tbody>
                  {summary.suites.map(s => (
                    <tr key={s.suite_label} className="border-t">
                      <td className="p-1">{s.suite_label}</td>
                      <td className="p-1">{s.matched_unit_name ?? <span className="text-orange-700">⚠ Non rattaché (sera mis sur bien global)</span>}</td>
                      <td className="text-right p-1">{s.lots_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Collaborateurs */}
          {summary.collaborators.length > 0 && (
            <Card>
              <p className="font-display text-lg mb-3">Collaborateurs détectés</p>
              <table className="text-sm w-full">
                <tbody>
                  {summary.collaborators.map(c => (
                    <tr key={c.csv_name} className="border-t">
                      <td className="p-1">{c.csv_name}</td>
                      <td className="p-1 text-right">
                        {c.matched_id
                          ? <span className="text-green-700">→ {c.matched_full_name}</span>
                          : <span className="text-stoniz-gray-500">Pas de match — restera en note</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* Détail lots */}
          <Card>
            <p className="font-display text-lg mb-3">Détail des lots ({summary.lots_preview.length})</p>
            <div className="overflow-x-auto">
              <table className="text-xs w-full">
                <thead className="bg-stoniz-gray-100">
                  <tr>
                    <th className="text-left p-1">REF</th>
                    <th className="text-left p-1">Suite</th>
                    <th className="text-left p-1">Cat.</th>
                    <th className="text-left p-1">Produit</th>
                    <th className="text-left p-1">Fournisseur</th>
                    <th className="text-right p-1">Qté</th>
                    <th className="text-right p-1">PU</th>
                    <th className="text-right p-1">Budget</th>
                    <th className="text-right p-1">Devis fourn.</th>
                    <th className="text-center p-1">Acomptes</th>
                    <th className="text-left p-1">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.lots_preview.map((l, i) => (
                    <tr key={i} className="border-t">
                      <td className="p-1">{l.original_ref || '—'}</td>
                      <td className="p-1">{l.suite_label ?? '—'}</td>
                      <td className="p-1">{l.category}</td>
                      <td className="p-1">{l.description}</td>
                      <td className="p-1">{l.supplier_name}</td>
                      <td className="p-1 text-right">{l.quantity ?? '—'}</td>
                      <td className="p-1 text-right">{l.unit_price_mad ? formatMad(l.unit_price_mad) : '—'}</td>
                      <td className="p-1 text-right">{l.budget_estimate_mad ? formatMad(l.budget_estimate_mad) : '—'}</td>
                      <td className="p-1 text-right">{l.devis_fournisseur_mad ? formatMad(l.devis_fournisseur_mad) : '—'}</td>
                      <td className="p-1 text-center">{l.acomptes.length}</td>
                      <td className="p-1">{l.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
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
