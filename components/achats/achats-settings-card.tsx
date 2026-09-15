'use client';

import { useState, useTransition } from 'react';
import { Pencil, Save } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatMad } from '@/lib/utils/format';
import { updateProjectAchatsSettingsAction } from '@/app/(team)/projects/[id]/achats/actions';

export function AchatsSettingsCard({
  projectId,
  budget,
  margeCiblePct,
  adresseLivraison,
}: {
  projectId: string;
  budget: number;
  margeCiblePct: number;
  adresseLivraison: string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [vals, setVals] = useState({
    achats_budget_mad: budget,
    achats_marge_cible_pct: margeCiblePct,
    achats_adresse_livraison: adresseLivraison ?? '',
  });

  function save() {
    setError(null);
    start(async () => {
      const r = await updateProjectAchatsSettingsAction(projectId, {
        achats_budget_mad: Number(vals.achats_budget_mad),
        achats_marge_cible_pct: Number(vals.achats_marge_cible_pct),
        achats_adresse_livraison: vals.achats_adresse_livraison,
      });
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setEditing(false);
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Paramètres achats</CardTitle>
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Annuler</Button>
              <Button size="sm" onClick={save} disabled={pending}>
                <Save className="w-4 h-4" /> {pending ? '…' : 'Enregistrer'}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              <Pencil className="w-4 h-4" /> Modifier
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {error && <div className="text-sm text-red-600 mb-3">{error}</div>}
        <dl className="grid md:grid-cols-2 gap-x-8 gap-y-3 text-sm">
          <Row label="Budget vendu client">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input type="number" value={vals.achats_budget_mad}
                  onChange={e => setVals(v => ({ ...v, achats_budget_mad: Number(e.target.value) }))}
                  className="w-40" />
                <span className="text-xs text-stoniz-gray-500">MAD</span>
              </div>
            ) : (
              <span className="font-medium">{formatMad(budget)}</span>
            )}
          </Row>
          <Row label="Marge cible">
            {editing ? (
              <div className="flex items-center gap-2">
                <Input type="number" step="0.1" value={vals.achats_marge_cible_pct}
                  onChange={e => setVals(v => ({ ...v, achats_marge_cible_pct: Number(e.target.value) }))}
                  className="w-24" />
                <span className="text-xs text-stoniz-gray-500">%</span>
                <span className="text-xs text-stoniz-gray-500">
                  ≈ {formatMad(Math.round((Number(vals.achats_budget_mad) || 0) * (Number(vals.achats_marge_cible_pct) || 0) / 100))}
                </span>
              </div>
            ) : (
              <span className="font-medium">
                {margeCiblePct}%
                <span className="ml-2 text-xs text-stoniz-gray-500 font-normal">
                  ≈ {formatMad(Math.round(budget * margeCiblePct / 100))}
                </span>
              </span>
            )}
          </Row>
          <Row label="Adresse livraison">
            {editing ? (
              <Input value={vals.achats_adresse_livraison}
                onChange={e => setVals(v => ({ ...v, achats_adresse_livraison: e.target.value }))}
                placeholder="Adresse de livraison" />
            ) : (
              <span className="font-medium">{adresseLivraison ?? <span className="text-stoniz-gray-400 text-xs">Non renseignée</span>}</span>
            )}
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase text-stoniz-gray-500 mb-1">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
