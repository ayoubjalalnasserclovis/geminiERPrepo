// ─── Chantier 4 marathon — Daily Dashboard enrichi (U17 + U19) ──────────────
// Composants présentation purs : les données sont préparées par la page daily.
// Couleurs : rouge = blocage RÉEL (pas nettoyé / occupé / litige), orange =
// en cours, vert = prêt. Jamais de rouge décoratif.

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

// ─── Types des données préparées ─────────────────────────────────────────────

export type ArrivalContext = {
  reservationId: string;
  guestName: string | null;
  checkInTime: string | null;
  unitLabel: string;
  unitId: string | null;
  propertyId: string | null;
  lastDeparture: string | null;          // date dernier départ
  lastCleaningDate: string | null;       // date dernier ménage clôturé/validé
  todayCleaningStatus: 'valide' | 'en_cours' | 'non_commence' | 'aucun';
  lastSentiment: string | null;          // sentiment du séjour précédent
  openLitigesCount: number;
  openTasksCount: number;
  openInterventionsCount: number;
};

export type DepartureContext = {
  reservationId: string;
  guestName: string | null;
  checkOutTime: string | null;
  unitLabel: string;
  unitId: string | null;
  todayCleaningStatus: 'valide' | 'en_cours' | 'non_commence' | 'aucun';
  sameDayArrival: boolean;
  openLitigeOnResa: boolean;
  openInterventionsCount: number;
  lastSentiment: string | null;
};

export type RealtimeUnit = {
  unitId: string;
  unitLabel: string;
  propertyId: string | null;
  state: 'vert' | 'orange' | 'rouge';
  // VERT
  nextArrival: string | null;
  nextGuest: string | null;
  // ORANGE
  cleanerName: string | null;
  startedAt: string | null;
  // ROUGE
  lastDeparture: string | null;
  blockReason: string | null;
};

// ─── Helpers visuels ─────────────────────────────────────────────────────────

const CLEANING_BADGE: Record<string, { label: string; cls: string }> = {
  valide:        { label: '🟢 Ménage validé',   cls: 'bg-emerald-50 text-emerald-700' },
  en_cours:      { label: '🟠 Ménage en cours', cls: 'bg-amber-50 text-amber-700' },
  non_commence:  { label: '🔴 Non commencé',    cls: 'bg-red-50 text-red-700' },
  aucun:         { label: '— Pas de ménage prévu', cls: 'bg-stoniz-gray-100 text-stoniz-gray-600' },
};

function SentimentBadge({ sentiment }: { sentiment: string | null }) {
  if (!sentiment) return null;
  const neg = ['negatif', 'négatif', 'risque', 'mauvais'].includes(sentiment.toLowerCase());
  const pos = ['positif', 'bon', 'excellent'].includes(sentiment.toLowerCase());
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
      neg ? 'bg-red-50 text-red-700' : pos ? 'bg-emerald-50 text-emerald-700' : 'bg-stoniz-gray-100 text-stoniz-gray-600'
    }`}>
      {neg ? '😟' : pos ? '😊' : '😐'} séjour préc. : {sentiment}
    </span>
  );
}

function fmtDay(d: string | null) {
  return d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : '—';
}

// ─── Arrivées du jour (U17) ──────────────────────────────────────────────────

export function DailyArrivalsSection({ arrivals }: { arrivals: ArrivalContext[] }) {
  return (
    <section className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg">🛬 Arrivées du jour ({arrivals.length})</h2>
        <Link href="/propria/reservations" className="text-xs text-stoniz-gray-500 hover:underline inline-flex items-center">
          Voir tout <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      {arrivals.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500">Aucune arrivée aujourd&apos;hui.</p>
      ) : (
        <ul className="divide-y divide-stoniz-gray-100">
          {arrivals.map((a) => {
            const badge = CLEANING_BADGE[a.todayCleaningStatus];
            const ready = a.todayCleaningStatus === 'valide';
            return (
              <li key={a.reservationId} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{a.unitLabel}</span>
                  <span className="text-sm text-stoniz-gray-700">{a.guestName ?? 'Voyageur'}</span>
                  {a.checkInTime && <span className="text-xs text-stoniz-gray-500">check-in {a.checkInTime}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  {!ready && a.todayCleaningStatus !== 'aucun' && (
                    <span className="text-[10px] text-red-700 font-medium">⚠ arrivée non prête</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-stoniz-gray-600">
                  <span>Dernier départ : {fmtDay(a.lastDeparture)}</span>
                  <span>· Dernier ménage : {fmtDay(a.lastCleaningDate)}</span>
                  <SentimentBadge sentiment={a.lastSentiment} />
                  {a.openLitigesCount > 0 && (
                    <Link href="/propria/litiges" className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 hover:underline">
                      ⚖ {a.openLitigesCount} litige{a.openLitigesCount > 1 ? 's' : ''} en cours
                    </Link>
                  )}
                  {a.openTasksCount > 0 && (
                    <Link href={`/propria/interventions?property=${a.propertyId ?? ''}`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:underline">
                      📋 {a.openTasksCount} tâche{a.openTasksCount > 1 ? 's' : ''} ouverte{a.openTasksCount > 1 ? 's' : ''}
                    </Link>
                  )}
                  {a.openInterventionsCount > 0 && (
                    <Link href={`/propria/interventions?property=${a.propertyId ?? ''}`} className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 hover:underline">
                      🔧 {a.openInterventionsCount} intervention{a.openInterventionsCount > 1 ? 's' : ''}
                    </Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Départs du jour (U17) ───────────────────────────────────────────────────

export function DailyDeparturesSection({ departures }: { departures: DepartureContext[] }) {
  return (
    <section className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg">🛫 Départs du jour ({departures.length})</h2>
        <Link href="/propria/menage?fenetre=today" className="text-xs text-stoniz-gray-500 hover:underline inline-flex items-center">
          Ménages du jour <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
      {departures.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500">Aucun départ aujourd&apos;hui.</p>
      ) : (
        <ul className="divide-y divide-stoniz-gray-100">
          {departures.map((d) => {
            const badge = CLEANING_BADGE[d.todayCleaningStatus];
            return (
              <li key={d.reservationId} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-sm">{d.unitLabel}</span>
                  <span className="text-sm text-stoniz-gray-700">{d.guestName ?? 'Voyageur'}</span>
                  {d.checkOutTime && <span className="text-xs text-stoniz-gray-500">check-out {d.checkOutTime}</span>}
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                  {d.sameDayArrival && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-50 text-purple-700 font-medium">
                      🛏 arrivée le même jour
                    </span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-stoniz-gray-600">
                  <SentimentBadge sentiment={d.lastSentiment} />
                  {d.openLitigeOnResa && (
                    <Link href="/propria/litiges" className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-700 hover:underline">
                      ⚖ litige ouvert sur cette résa
                    </Link>
                  )}
                  {d.openInterventionsCount > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
                      🔧 {d.openInterventionsCount} intervention{d.openInterventionsCount > 1 ? 's' : ''} ouverte{d.openInterventionsCount > 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// ─── Panel Ménage Temps Réel (U19) ───────────────────────────────────────────
// Objectif consultant : état du parc lisible en < 10 secondes.

const STATE_STYLE: Record<RealtimeUnit['state'], string> = {
  vert:   'bg-emerald-50 border-emerald-300',
  orange: 'bg-amber-50 border-amber-300',
  rouge:  'bg-red-50 border-red-300',
};

export function DailyRealtimePanel({ units }: { units: RealtimeUnit[] }) {
  const counts = {
    vert: units.filter((u) => u.state === 'vert').length,
    orange: units.filter((u) => u.state === 'orange').length,
    rouge: units.filter((u) => u.state === 'rouge').length,
  };
  return (
    <section className="bg-white border border-stoniz-gray-200 rounded-xl p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-display text-lg">🗺 Panel Ménage Temps Réel</h2>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-emerald-700">🟢 {counts.vert} prêt{counts.vert > 1 ? 's' : ''}</span>
          <span className="text-amber-700">🟠 {counts.orange} en cours</span>
          <span className="text-red-700">🔴 {counts.rouge} bloqué{counts.rouge > 1 ? 's' : ''}</span>
        </div>
      </div>
      {units.length === 0 ? (
        <p className="text-sm text-stoniz-gray-500">Aucun lot actif.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
          {units.map((u) => (
            <Link
              key={u.unitId}
              href={u.propertyId ? `/propria/biens/${u.propertyId}` : '/propria/biens'}
              className={`border rounded-lg p-2.5 hover:shadow-sm transition-shadow ${STATE_STYLE[u.state]}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium truncate">{u.unitLabel}</span>
                <span>{u.state === 'vert' ? '🟢' : u.state === 'orange' ? '🟠' : '🔴'}</span>
              </div>
              <div className="text-[10px] text-stoniz-gray-600 mt-1 leading-snug">
                {u.state === 'vert' && (
                  u.nextArrival
                    ? <>Prochaine arrivée : {fmtDay(u.nextArrival)}{u.nextGuest ? ` · ${u.nextGuest}` : ''}</>
                    : <>Libre — aucune résa à venir</>
                )}
                {u.state === 'orange' && (
                  <>
                    {u.cleanerName ?? 'Ménage en cours'}
                    {u.startedAt && <> · depuis {new Date(u.startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
                  </>
                )}
                {u.state === 'rouge' && (
                  <>
                    {u.blockReason ?? 'Bloqué'}
                    {u.lastDeparture && <> · dernier départ {fmtDay(u.lastDeparture)}</>}
                  </>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
