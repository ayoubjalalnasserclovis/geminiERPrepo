// ─── Chantier 12 marathon — intelligence opérationnelle des tâches (U6) ─────
// Composants LECTURE SEULE, 100 % dérivés (aucune donnée stockée) :
//   • UnitContextCard           : encart « Contexte du logement » (fiches)
//   • ArrivalAlertBanner        : ⚠ à réaliser avant l'arrivée du <date>
//   • OccupancyBlockBanner      : logement occupé → intervention impossible
//   • CleaningMutualisationHint : 💡 ménage planifié → mutualiser ?
//   • OpenTasksForCleaningCard  : symétrique côté fiche ménage
// Source : lib/propria/unit-context.ts (calcul server-side, requêtes groupées).

import Link from 'next/link';
import type {
  ArrivalAlert,
  OccupancyBlock,
  UnitCleaningRef,
  UnitOperationalContext,
} from '@/lib/propria/unit-context';

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

/** Encart « Contexte du logement » : occupation, arrivée, sortie, ménage. */
export function UnitContextCard({ ctx }: { ctx: UnitOperationalContext }) {
  const hasAnything = ctx.currentStay || ctx.nextArrival || ctx.nextDeparture || ctx.nextCleaning;
  return (
    <div className="mb-5 bg-white border border-stoniz-gray-200 rounded-xl p-4">
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-3">
        🏠 Contexte du logement
      </div>
      {!hasAnything ? (
        <p className="text-sm text-stoniz-gray-500">
          Aucune réservation à venir ni ménage planifié sur ce logement.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <div className="text-[11px] uppercase text-stoniz-gray-500">Occupation</div>
            {ctx.currentStay ? (
              <div className="text-sm font-medium text-orange-700">
                Occupé · départ le {fmtDate(ctx.currentStay.departure_date)}
                {ctx.currentStay.guest_name && (
                  <span className="block text-xs font-normal text-stoniz-gray-600">
                    {ctx.currentStay.guest_name}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-sm font-medium text-emerald-700">Libre aujourd&apos;hui</div>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase text-stoniz-gray-500">Prochaine arrivée</div>
            {ctx.nextArrival ? (
              <div className="text-sm font-medium">
                {fmtDate(ctx.nextArrival.arrival_date)}
                {ctx.nextArrival.guest_name && (
                  <span className="block text-xs font-normal text-stoniz-gray-600">
                    {ctx.nextArrival.guest_name}
                  </span>
                )}
              </div>
            ) : (
              <div className="text-sm text-stoniz-gray-400">—</div>
            )}
          </div>
          <div>
            <div className="text-[11px] uppercase text-stoniz-gray-500">Prochaine sortie</div>
            <div className="text-sm font-medium">
              {ctx.nextDeparture ? fmtDate(ctx.nextDeparture.departure_date) : <span className="text-stoniz-gray-400">—</span>}
            </div>
          </div>
          <div>
            <div className="text-[11px] uppercase text-stoniz-gray-500">Prochain ménage</div>
            {ctx.nextCleaning ? (
              <Link
                href={`/propria/menage/${ctx.nextCleaning.id}`}
                className="text-sm font-medium hover:underline"
                title="Voir le ménage"
              >
                🧹 {fmtDate(ctx.nextCleaning.due_date)}
                {ctx.nextCleaning.assigned_to_name && (
                  <span className="block text-xs font-normal text-stoniz-gray-600">
                    {ctx.nextCleaning.assigned_to_name}
                  </span>
                )}
              </Link>
            ) : (
              <div className="text-sm text-stoniz-gray-400">—</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Bandeau ⚠ arrivée avant l'échéance — rouge si imminent et pas commencé. */
export function ArrivalAlertBanner({ alert }: { alert: ArrivalAlert }) {
  const red = alert.level === 'red';
  return (
    <div className={`mb-5 rounded-xl border p-4 ${red ? 'bg-red-50 border-red-300' : 'bg-amber-50 border-amber-300'}`}>
      <p className={`text-sm font-medium ${red ? 'text-red-900' : 'text-amber-900'}`}>
        ⚠ À réaliser avant le {fmtDate(alert.arrival_date)}
        {alert.guest_name ? ` — arrivée de ${alert.guest_name}` : ' — arrivée voyageur'}
      </p>
    </div>
  );
}

/** Bandeau orange informatif : logement occupé, intervention sur place impossible. */
export function OccupancyBlockBanner({ block }: { block: OccupancyBlock }) {
  return (
    <div className="mb-5 rounded-xl border border-orange-300 bg-orange-50 p-4">
      <p className="text-sm font-medium text-orange-900">
        🚪 Logement occupé jusqu&apos;au {fmtDate(block.departure_date)} — intervention sur
        place impossible aujourd&apos;hui
        {block.departsToday && (
          <span className="block text-xs font-normal text-orange-800 mt-0.5">
            Départ aujourd&apos;hui : possible après le check-out.
          </span>
        )}
      </p>
    </div>
  );
}

/** Encart 💡 mutualisation : un ménage est planifié sur le même lot. */
export function CleaningMutualisationHint({ cleaning }: { cleaning: UnitCleaningRef }) {
  return (
    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm text-blue-900">
        💡 Ménage prévu le <strong>{fmtDate(cleaning.due_date)}</strong>
        {cleaning.assigned_to_name && <> ({cleaning.assigned_to_name})</>} sur ce logement —
        mutualiser le déplacement ?{' '}
        <Link href={`/propria/menage/${cleaning.id}`} className="underline font-medium">
          Voir le ménage →
        </Link>
      </p>
    </div>
  );
}

// ─── Symétrique côté fiche ménage ────────────────────────────────────────────

export type OpenTaskRef = {
  id: string;
  description: string | null;
  kind: string | null;
  status: string;
  due_date: string | null;
  urgency: string | null;
};

const TASK_STATUS_LABELS: Record<string, string> = {
  a_traiter: 'À faire',
  en_cours: 'En cours',
  refusee: 'Refusée',
};

/** Encart fiche ménage : tâches/interventions ouvertes sur le même lot. */
export function OpenTasksForCleaningCard({ tasks }: { tasks: OpenTaskRef[] }) {
  if (tasks.length === 0) return null;
  return (
    <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
      <p className="text-sm font-medium text-blue-900 mb-2">
        💡 {tasks.length} tâche{tasks.length > 1 ? 's' : ''} ouverte{tasks.length > 1 ? 's' : ''} sur
        ce logement — à confier à l&apos;équipe ménage ?
      </p>
      <ul className="space-y-1.5">
        {tasks.map((t) => (
          <li key={t.id} className="text-sm text-blue-900">
            <Link href={`/propria/interventions/${t.id}`} className="hover:underline">
              {t.kind === 'tache' ? '📋' : '🔧'}{' '}
              {t.description ?? '(sans description)'}
              <span className="text-xs text-blue-700">
                {' '}· {TASK_STATUS_LABELS[t.status] ?? t.status}
                {t.due_date && <> · échéance {fmtDate(t.due_date)}</>}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
