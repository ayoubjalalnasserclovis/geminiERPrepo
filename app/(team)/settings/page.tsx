import { requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { Badge } from '@/components/ui/badge';
import { getEurMadRate } from '@/lib/fx/exchange-rate';
import { STONIZ_FEE_SCHEDULE, STONIZ_FEES_TOTAL } from '@/lib/finance/stoniz-fees';

// Déclencheurs RÉELS (event-driven), pas par phase.
// Source : migration 20260527006000_payments_event_driven.sql
const TRIGGER_BY_TYPE: Record<string, { title: string; detail: string; phase: string }> = {
  acompte_stoniz: {
    title: 'À la création du projet',
    detail: 'Dès que le contrat est signé et que le projet est créé dans Stoniz.',
    phase: 'Onboarding',
  },
  honoraires_compromis: {
    title: 'Date du compromis renseignée',
    detail: 'Dès que le champ "Date compromis" est saisi sur le projet (signature du compromis chez le notaire).',
    phase: 'Sourcing',
  },
  honoraires_3d: {
    title: 'Upload des plans 3D visibles client',
    detail: 'Dès qu\'un document de type "Plans 3D" est uploadé avec la visibilité client activée.',
    phase: 'Design',
  },
  honoraires_chantier: {
    title: 'J-7 du démarrage chantier',
    detail: 'Date d\'échéance = (travaux_start_date − 7 jours). Créé dès que la date de démarrage chantier est renseignée.',
    phase: 'Travaux',
  },
  honoraires_livraison: {
    title: 'Date de livraison renseignée',
    detail: 'Dès que le champ "Date de livraison" est saisi sur le projet.',
    phase: 'Livraison',
  },
};

export default async function SettingsPage() {
  await requireRole(['ceo','chef_projet','developer']);
  const { rate, at, source } = await getEurMadRate();

  return (
    <div className="space-y-6">
      <PageHeader title="Paramètres" />

      <Card>
        <CardHeader><CardTitle>Devise & taux de change</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm">Taux EUR → MAD : <strong>1 EUR = {rate} MAD</strong></p>
          <p className="text-xs text-stoniz-gray-500 mt-1">Source : {source}</p>
          <p className="text-sm text-stoniz-gray-600 mt-3">
            Taux <strong>fixe et obligatoire</strong> pour toutes les conversions EUR ↔ MAD côté Stoniz.
            Tous les paiements artisans saisis en MAD sont convertis en EUR avec ce taux pour les KPI consolidés.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Honoraires Stoniz</CardTitle>
            <Badge variant="default">Forfait fixe {STONIZ_FEES_TOTAL.toLocaleString('fr-FR')} €</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-stoniz-gray-600 mb-4">
            Échéancier en 5 jalons fixes, déclenchés automatiquement par les <strong>événements métier réels</strong>
            (et non par simple changement de phase).
          </p>
          <ul className="space-y-3">
            {STONIZ_FEE_SCHEDULE.map((m, i) => {
              const trigger = TRIGGER_BY_TYPE[m.type];
              return (
                <li key={m.type} className="flex items-start justify-between py-3 border-b last:border-0 gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <span className="font-mono text-xs text-stoniz-gray-500 w-6 mt-0.5">{i + 1}.</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-medium">{m.label}</div>
                        <Badge variant="default">{trigger?.phase ?? '—'}</Badge>
                      </div>
                      <div className="text-xs text-stoniz-gray-700 mt-1 font-medium">
                        ⏱ {trigger?.title ?? '—'}
                      </div>
                      <div className="text-[11px] text-stoniz-gray-500 mt-0.5">
                        {trigger?.detail ?? ''}
                      </div>
                    </div>
                  </div>
                  <Money amount={m.amount} className="font-display text-lg whitespace-nowrap" />
                </li>
              );
            })}
            <li className="flex items-center justify-between py-3 mt-2 bg-stoniz-gray-100 px-3 rounded-md font-medium">
              <span>Total honoraires Stoniz</span>
              <Money amount={STONIZ_FEES_TOTAL} className="font-display text-xl" />
            </li>
          </ul>
          <p className="text-xs text-stoniz-gray-500 mt-4">
            Logique <strong>event-driven</strong> (migration <code>20260527006000_payments_event_driven</code>) :
            chaque paiement est créé automatiquement dès que l'événement déclencheur est constaté
            (date saisie, document uploadé…), peu importe la phase courante du projet. Ils apparaissent sur la
            fiche projet (carte "Honoraires Stoniz") et la page paiements.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
