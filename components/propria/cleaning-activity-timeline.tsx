import { History } from 'lucide-react';

export type CleaningActivityEvent = {
  id: string;
  cleaning_id: string;
  actor_id: string | null;
  action: string;
  payload: any;
  created_at: string;
  actor_name: string | null;
};

const ACTION_META: Record<string, { icon: string; label: string; color: string }> = {
  created:        { icon: '➕', label: 'a créé le ménage',         color: 'text-stoniz-gray-700' },
  edited:         { icon: '✏️', label: 'a modifié',                color: 'text-blue-700' },
  status_changed: { icon: '🔄', label: 'a changé le statut',       color: 'text-stoniz-gray-700' },
  assigned:       { icon: '👤', label: 'a assigné',                color: 'text-purple-700' },
  unassigned:     { icon: '👤', label: 'a retiré l’assignation',   color: 'text-stoniz-gray-700' },
  submitted:      { icon: '📤', label: 'a fini & soumis',          color: 'text-amber-700' },
  validated:      { icon: '✅', label: 'a validé',                 color: 'text-emerald-700' },
  refused:        { icon: '↩️', label: 'a refusé',                 color: 'text-red-700' },
  cancelled:      { icon: '✕',  label: 'a annulé',                 color: 'text-stoniz-gray-700' },
  reopened:       { icon: '🔁', label: 'a rouvert',                color: 'text-blue-700' },
};

const STATUS_LABEL: Record<string, string> = {
  a_traiter: 'À faire',
  en_cours: 'En cours',
  a_valider: 'À valider',
  cloture: 'Validé',
  refusee: 'Refusé',
  annule: 'Annulé',
};

const FIELD_LABEL: Record<string, string> = {
  cleaning_type_id: 'Type de ménage',
  description: 'Description / consignes',
  urgency: 'Urgence',
  due_date: 'Échéance',
  occurred_at: 'Date prévue',
  property_id: 'Bien',
  propria_unit_id: 'Lot',
  assigned_to_id: 'Assignée à',
  responsable_id: 'Suivie par',
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

export function CleaningActivityTimeline({ events }: { events: CleaningActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="mt-6 bg-white border border-stoniz-gray-200 rounded-xl p-5">
        <h2 className="font-display text-lg mb-3 flex items-center gap-2">
          <History className="w-4 h-4 text-stoniz-gray-500" />
          Historique
        </h2>
        <p className="text-sm text-stoniz-gray-500 italic">
          Aucune activité enregistrée pour ce ménage.
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
