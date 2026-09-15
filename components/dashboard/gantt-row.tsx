import Link from 'next/link';

type Project = {
  id: string;
  reference: string;
  client: string;
  status: string;
  start_date: string | null;
  end_date: string | null;
  pct_avancement: number;
  is_overdue: boolean;
  chef_name: string | null;
};

function dayPct(date: string, minIso: string, maxIso: string): number {
  const min = new Date(minIso).getTime();
  const max = new Date(maxIso).getTime();
  const d = new Date(date).getTime();
  if (max === min) return 0;
  return Math.max(0, Math.min(100, ((d - min) / (max - min)) * 100));
}

export function GanttRow({
  project: p, minDate, maxDate, todayIso,
}: {
  project: Project;
  minDate: string;
  maxDate: string;
  todayIso: string;
}) {
  const startPct = p.start_date ? dayPct(p.start_date, minDate, maxDate) : 0;
  const endPct = p.end_date ? dayPct(p.end_date, minDate, maxDate) : 100;
  const todayPct = dayPct(todayIso, minDate, maxDate);
  const widthPct = Math.max(2, endPct - startPct);

  const barColor = p.is_overdue
    ? 'bg-red-400'
    : p.pct_avancement >= 100
      ? 'bg-emerald-400'
      : p.pct_avancement >= 50
        ? 'bg-amber-400'
        : 'bg-indigo-400';

  return (
    <Link
      href={`/projects/${p.id}/travaux`}
      className="block hover:bg-stoniz-gray-50 rounded px-2 py-1.5"
    >
      <div className="flex items-center gap-3 mb-1">
        <div className="w-48 shrink-0">
          <div className="text-xs font-medium truncate">{p.client}</div>
          <div className="text-[10px] text-stoniz-gray-500 font-mono truncate">
            {p.reference} {p.chef_name && `· ${p.chef_name}`}
          </div>
        </div>
        <div className="flex-1 relative h-5 bg-stoniz-gray-100 rounded">
          <div
            className={`absolute top-0 h-full ${barColor} rounded`}
            style={{ left: `${startPct}%`, width: `${widthPct}%` }}
            title={`${p.start_date ?? '?'} → ${p.end_date ?? '?'} · ${p.pct_avancement}%`}
          />
          <div
            className="absolute top-0 bottom-0 w-px bg-stoniz-black"
            style={{ left: `${todayPct}%` }}
            title="Aujourd'hui"
          />
        </div>
        <div className="w-16 shrink-0 text-right text-[10px]">
          {p.is_overdue && <span className="text-red-700">🔴 Retard</span>}
          {!p.is_overdue && <span className="text-stoniz-gray-500">{p.pct_avancement}%</span>}
        </div>
      </div>
    </Link>
  );
}
