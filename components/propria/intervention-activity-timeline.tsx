import { History } from 'lucide-react';

export type ActivityEvent = {
  id: string;
  intervention_id: string;
  actor_id: string | null;
  action: string;
  payload: any;
  created_at: string;
  actor_name: string | null;
};

// Libellés humanisés pour chaque type d'action.
const ACTION_META: Record<string, { icon: string; label: string; color: string }> = {
  created:        { icon: '➕', label: 'a créé',                   color: 'text-stoniz-gray-700' },
  edited:         { icon: '✏️', label: 'a modifié',                color: 'text-blue-700' },
  status_changed: { icon: '🔄', label: 'a changé le statut',       color: 'text-stoniz-gray-700' },
  assigned:       { icon: '👤', label: 'a assigné',                color: 'text-purple-700' },
  unassigned:     { icon: '👤', label: 'a retiré l’assignation',   color: 'text-stoniz-gray-700' },
  submitted:      { icon: '📤', label: 'a soumis pour validation', color: 'text-amber-700' },
  validated:      { icon: '✅', label: 'a validé',                 color: 'text-emerald-700' },
  refused:        { icon: '↩️', label: 'a refusé',                 color: 'text-red-700' },
  cancelled:      { icon: '✕',  label: 'a annulé',                 color: 'text-stoniz-gray-700' },
  reopened:       { icon: '🔁', label: 'a rouvert',                color: 'text-blue-700' },
};

// Libellés des statuts pour humaniser status_changed.
const STATUS_LABEL: Record<string, string> = {
  a_traiter: 'À faire',
  en_cours: 'En cours',
  a_valider: 'À valider',
  cloture: 'Validée',
  refusee: 'Refusée',
  annule: 'Annulée',
};

// Libellés des champs édités pour le diff (le payload de `edited` contient
// les noms techniques de colonnes — on les rend lisibles).
const FIELD_LABEL: Record<string, string> = {
  kind: 'Type (intervention/tâche)',
  description: 'Description',
  urgency: 'Urgence',
  due_date: 'Échéance',
  occurred_at: 'Date',
  property_id: 'Bien',
  propria_unit_id: 'Lot',
  intervention_type_id: 'Catégorie',
  type_label: 'Catégorie (libre)',
  assigned_to_id: 'Assignée à',
  responsable_id: 'Suivie par',
  provider_id: 'Prestataire',
  cost_propria_mad: 'Coût Propria',
  client_billing_mad: 'Refacturation client',
  charge_to: 'À la charge',
  paid_from_wallet_id: 'Caisse de paiement',
  hostaway_ref: 'Réf. Hostaway',
  hostaway_integrated: 'Intégré Hostaway',
  observations: 'Observations',
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function renderPayloadSummary(action: string, payload: any): React.ReactNode {
  if (!payload) return null;
  if (action === 'status_changed') {
    const from = STATUS_LABEL[payload.from] ?? payload.from ?? '—';
    const to = STATUS_LABEL[payload.to] ?? payload.to ?? '—';
    return <> : <strong>{from}</strong> → <strong>{to}</strong></>;
  }
  if (action === 'assigned') {
    const name = payload.assigned_to_name ?? '—';
    return <> à <strong>{name}</strong>{payload.via === 'bulk' ? <span className="text-stoniz-gray-500"> (assignation groupée)</span> : null}</>;
  }
  if (action === 'refused' && payload.reason) {
    return <> · <em className="text-red-700">« {payload.reason} »</em></>;
  }
  if (action === 'created' && payload.kind) {
    return <> une <strong>{payload.kind === 'tache' ? 'tâche' : 'intervention'}</strong></>;
  }
  if (action === 'edited' && payload.diff && typeof payload.diff === 'object') {
    const fields = Object.keys(payload.diff);
    if (fields.length === 0) return null;
    return (
      <>
        {' '}
        <span className="text-stoniz-gray-500">
          ({fields.length} champ{fields.length > 1 ? 's' : ''} :{' '}
          {fields.slice(0, 4).map((f) => FIELD_LABEL[f] ?? f).join(', ')}
          {fields.length > 4 ? `, +${fields.length - 4}` : ''})
        </span>
      </>
    );
  }
  return null;
}

/**
 * Timeline de l'activité d'une intervention/tâche : qui a fait quoi et quand.
 * Affichée en bas de la fiche détail. Lisible par tout staff Propria.
 */
export function InterventionActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="mt-6 bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <h2 className="font-display text-lg mb-3 flex items-center gap-2">
          <History className="w-4 h-4 text-stoniz-gray-500" />
          Historique
        </h2>
        <p className="text-sm text-stoniz-gray-500 italic">
          Aucune activité enregistrée pour cette fiche.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-6 bg-white border border-stoniz-gray-200 rounded-xl p-5">
      <h2 className="font-display text-lg mb-3 flex items-center gap-2">
        <History className="w-4 h-4 text-stoniz-gray-500" />
        Historique <span className="text-sm text-stoniz-gray-500">({events.length} événement{events.length > 1 ? 's' : ''})</span>
      </h2>
      <ol className="space-y-2">
        {events.map((e) => {
          const meta = ACTION_META[e.action] ?? { icon: '•', label: e.action, color: 'text-stoniz-gray-700' };
          return (
            <li key={e.id} className="flex items-start gap-3 text-sm">
              <span className="flex-shrink-0 mt-0.5" aria-hidden>{meta.icon}</span>
              <div className="flex-1 min-w-0">
                <div className={meta.color}>
                  <strong>{e.actor_name ?? '(utilisateur supprimé)'}</strong>{' '}
                  <span className="text-stoniz-gray-700">{meta.label}</span>
                  {renderPayloadSummary(e.action, e.payload)}
                </div>
                <div className="text-[11px] text-stoniz-gray-500">{formatDateTime(e.created_at)}</div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
