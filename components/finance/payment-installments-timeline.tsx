import { formatMad } from '@/lib/utils/format';

/**
 * Mini-timeline horizontale des jalons d'un lot (CEO 2026-06-18 — C4).
 *
 * Affiche tous les acomptes prévus + payés positionnés sur l'échelle des
 * 90 prochains jours. Remplace l'ancien affichage "prochain paiement le X"
 * qui ne montrait qu'une date.
 *
 * Server-component compatible (pas de useState/effect).
 */

export type InstallmentDot = {
  id: string;
  scheduled_date: string | null;
  paid_at: string | null;
  amount_total: number;
  status: string;
};

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86_400_000);
}

function fmtShort(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

export function PaymentInstallmentsTimeline({
  installments,
  windowDays = 90,
  emptyLabel = 'Aucun jalon planifié',
}: {
  installments: InstallmentDot[];
  /** Largeur temporelle de la timeline (par défaut 90 jours). */
  windowDays?: number;
  emptyLabel?: string;
}) {
  const today = isoToday();
  const overdueWindowStart = -windowDays; // 90 j passés inclus pour montrer overdues
  // On garde tous les acomptes : payés (paid_at), planifiés (scheduled_date),
  // ou en retard (scheduled_date < today, paid_at null).
  const dots = installments
    .map((i) => {
      const date = i.paid_at ?? i.scheduled_date;
      if (!date) return null;
      const offset = daysBetween(today, date);
      // On garde uniquement les dots dans la fenêtre [today-windowDays, today+windowDays]
      if (offset < overdueWindowStart || offset > windowDays) return null;
      return { ...i, date, offset };
    })
    .filter(Boolean) as Array<InstallmentDot & { date: string; offset: number }>;

  if (dots.length === 0) {
    return (
      <div className="text-xs text-stoniz-gray-400 italic px-2 py-1">{emptyLabel}</div>
    );
  }

  // Position en % sur la barre : 0% = today-windowDays, 50% = today, 100% = today+windowDays
  function pctPos(offset: number): number {
    const totalSpan = windowDays * 2;
    return ((offset - overdueWindowStart) / totalSpan) * 100;
  }

  const todayPct = pctPos(0);

  return (
    <div className="py-2">
      {/* Barre + marqueur today */}
      <div className="relative h-2 bg-stoniz-gray-100 rounded-full">
        <span
          className="absolute top-0 bottom-0 w-0.5 bg-stoniz-black"
          style={{ left: `${todayPct}%` }}
          title="Aujourd'hui"
        />
        {dots.map((dot) => {
          const isPaid = !!dot.paid_at || dot.status === 'paid';
          const isOverdue = !isPaid && dot.date < today;
          const color = isPaid ? 'bg-emerald-500'
            : isOverdue ? 'bg-red-500'
            : 'bg-amber-500';
          const pos = pctPos(dot.offset);
          return (
            <span
              key={dot.id}
              className={`absolute -top-1 w-4 h-4 rounded-full border-2 border-white ${color} shadow`}
              style={{ left: `calc(${pos}% - 8px)` }}
              title={`${fmtShort(dot.date)} · ${formatMad(dot.amount_total)} · ${isPaid ? 'payé' : isOverdue ? 'en retard' : 'prévu'}`}
            />
          );
        })}
      </div>

      {/* Légende dates extrêmes + today */}
      <div className="relative mt-1 text-[10px] text-stoniz-gray-500 h-4">
        <span className="absolute left-0">J−{windowDays}</span>
        <span className="absolute" style={{ left: `${todayPct}%`, transform: 'translateX(-50%)' }}>
          Aujourd&apos;hui
        </span>
        <span className="absolute right-0">J+{windowDays}</span>
      </div>

      {/* Liste textuelle des jalons (pour clarté + accessibilité) */}
      <ul className="mt-2 space-y-0.5 text-[11px]">
        {dots
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((dot) => {
            const isPaid = !!dot.paid_at || dot.status === 'paid';
            const isOverdue = !isPaid && dot.date < today;
            return (
              <li key={dot.id} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${
                    isPaid ? 'bg-emerald-500' : isOverdue ? 'bg-red-500' : 'bg-amber-500'
                  }`} />
                  <span className={isPaid ? 'text-emerald-700' : isOverdue ? 'text-red-700' : 'text-amber-700'}>
                    {fmtShort(dot.date)}
                  </span>
                  {isPaid && <span className="text-stoniz-gray-400">payé</span>}
                  {isOverdue && <span className="text-red-600 font-medium">en retard</span>}
                </span>
                <span className="text-stoniz-gray-700 tabular-nums">{formatMad(dot.amount_total)}</span>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
