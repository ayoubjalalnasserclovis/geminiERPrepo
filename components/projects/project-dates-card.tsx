'use client';

import { useState, useTransition } from 'react';
import { Calendar, Save, Pencil } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/lib/utils/format';
import { updateProjectDatesAction } from '@/app/(team)/projects/actions';

type ProjectDates = {
  onboarding_date: string | null;
  compromis_date: string | null;
  acte_authentique_date: string | null;
  travaux_start_date: string | null;
  travaux_end_date: string | null;
  livraison_date: string | null;
};

type DateRow = {
  field: keyof ProjectDates;
  label: string;
  required_for_next?: string;
};

const DATES: DateRow[] = [
  { field: 'onboarding_date',       label: 'Onboarding' },
  { field: 'compromis_date',        label: 'Signature compromis',  required_for_next: 'Design' },
  { field: 'acte_authentique_date', label: 'Acte authentique',     required_for_next: 'Travaux' },
  { field: 'travaux_start_date',    label: 'Lancement de chantier', required_for_next: 'Livraison' },
  { field: 'travaux_end_date',      label: 'Livraison du chantier', required_for_next: 'Livraison' },
  { field: 'livraison_date',        label: 'Remise des clés au client' },
];

export function ProjectDatesCard({
  projectId,
  dates,
  currentPhase,
}: {
  projectId: string;
  dates: ProjectDates;
  currentPhase: string;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<ProjectDates>(dates);

  function save() {
    setError(null);
    start(async () => {
      const r = await updateProjectDatesAction(projectId, values);
      if (!r.ok) { setError(r.error ?? 'Erreur'); return; }
      setEditing(false);
    });
  }

  function cancel() {
    setValues(dates);
    setEditing(false);
    setError(null);
  }

  // Marqueur "manquant" : la date est requise pour la phase suivante
  // OU pour une phase passée (= dette à rattraper).
  const phaseOrder = ['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'];
  const currentIdx = phaseOrder.indexOf(currentPhase);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            <Calendar className="inline w-5 h-5 mr-2 -mt-1" />
            Dates clés
          </CardTitle>
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={cancel} disabled={pending}>Annuler</Button>
              <Button size="sm" onClick={save} disabled={pending}>
                <Save className="w-4 h-4" />
                {pending ? 'Enregistrement…' : 'Enregistrer'}
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
        <dl className="space-y-2 text-sm">
          {DATES.map(row => {
            const value = values[row.field];
            // Une date est "manquante de manière critique" si :
            // - la phase qui en a besoin (required_for_next) est ≤ phase courante + 1
            //   = on doit la combler pour avancer OU on aurait dû la combler avant
            const requiredAtIdx = row.required_for_next
              ? phaseOrder.indexOf(row.required_for_next.toLowerCase())
              : -1;
            const isOverdue = !value && requiredAtIdx >= 0 && requiredAtIdx <= currentIdx;
            const blocksNext = !value && requiredAtIdx >= 0 && requiredAtIdx === currentIdx + 1;
            return (
              <div key={row.field} className="flex justify-between items-center gap-4 py-1">
                <dt className="flex items-center gap-2 flex-wrap">
                  <span className="text-stoniz-gray-600">{row.label}</span>
                  {isOverdue && (
                    <Badge variant="error">⚠ Date manquante — à rattraper</Badge>
                  )}
                  {blocksNext && (
                    <Badge variant="warning">requis pour passer en {row.required_for_next}</Badge>
                  )}
                </dt>
                <dd className="flex-shrink-0">
                  {editing ? (
                    <Input
                      type="date"
                      value={value ?? ''}
                      onChange={e => setValues(v => ({ ...v, [row.field]: e.target.value || null }))}
                      className="w-40 text-sm"
                    />
                  ) : (
                    <span className={value ? 'font-medium' : 'text-stoniz-gray-400 text-xs'}>
                      {value ? formatDate(value) : 'Non renseignée'}
                    </span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      </CardContent>
    </Card>
  );
}
