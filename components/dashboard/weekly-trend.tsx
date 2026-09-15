type WeeklyPoint = {
  week: string;
  count: number;
  weekStart: string;
};

/**
 * Courbe d'évolution hebdomadaire (12 semaines) en CSS pur.
 * Affiche un mini bar chart avec valeurs + delta dernière semaine vs avant-dernière.
 */
export function WeeklyTrendChart({ points, color = 'bg-stoniz-blue' }: { points: WeeklyPoint[]; color?: string }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const last = points[points.length - 1]?.count ?? 0;
  const prev = points[points.length - 2]?.count ?? 0;
  const delta = last - prev;
  const deltaColor = delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-600' : 'text-stoniz-gray-500';
  const total = points.reduce((s, p) => s + p.count, 0);
  const avg = points.length > 0 ? (total / points.length).toFixed(1) : '0';

  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between text-xs">
        <div>
          <span className="text-stoniz-gray-500">12 dernières semaines</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-stoniz-gray-500">Moy. {avg}/sem</span>
          <span className={`font-medium ${deltaColor}`}>
            {delta > 0 ? '+' : ''}{delta} vs sem. -1
          </span>
        </div>
      </div>
      <div className="grid grid-cols-12 gap-1 items-end h-24">
        {points.map((p) => {
          const heightPct = (p.count / max) * 100;
          const isLast = p === points[points.length - 1];
          return (
            <div
              key={p.weekStart}
              className="flex flex-col items-center justify-end h-full"
              title={`Semaine du ${p.week} : ${p.count}`}
            >
              <div className="text-[10px] text-stoniz-gray-700 font-medium leading-none">
                {p.count > 0 ? p.count : ''}
              </div>
              <div
                className={`w-full ${color} ${isLast ? 'opacity-100' : 'opacity-70'} rounded-t mt-1 transition-all`}
                style={{ height: `${heightPct}%`, minHeight: p.count > 0 ? '3px' : '0' }}
              />
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-12 gap-1 text-[9px] text-stoniz-gray-500 text-center">
        {points.map((p) => (
          <div key={p.weekStart}>{p.week}</div>
        ))}
      </div>
    </div>
  );
}
