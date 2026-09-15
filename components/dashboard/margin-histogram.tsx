type Bucket = {
  label: string;
  range_min: number;
  range_max: number | null;
  count: number;
  total_mad: number;
};

function fmtMadShort(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (Math.abs(n) >= 1_000) return `${Math.round(n / 1_000)} k`;
  return `${Math.round(n)}`;
}

export function MarginHistogram({ buckets }: { buckets: Bucket[] }) {
  const maxCount = Math.max(1, ...buckets.map((b) => b.count));
  const totalCount = buckets.reduce((s, b) => s + b.count, 0);
  const totalMad = buckets.reduce((s, b) => s + b.total_mad, 0);

  if (totalCount === 0) {
    return <p className="text-xs text-stoniz-gray-500 italic">Pas encore assez de projets pour distribution.</p>;
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-6 gap-1.5 items-end h-32">
        {buckets.map((b) => {
          const heightPct = (b.count / maxCount) * 100;
          const color = b.range_min < 0
            ? 'bg-red-400'
            : b.range_min < 25_000
              ? 'bg-amber-400'
              : 'bg-emerald-400';
          return (
            <div key={b.label} className="flex flex-col items-center justify-end h-full" title={`${b.count} projet${b.count > 1 ? 's' : ''} · ${fmtMadShort(b.total_mad)} MAD au total`}>
              <div className={`w-full ${color} rounded-t transition-all`} style={{ height: `${heightPct}%`, minHeight: b.count > 0 ? '4px' : '0' }} />
              <div className="text-[10px] mt-1 text-stoniz-gray-700 font-medium">{b.count}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-6 gap-1.5 text-[10px] text-stoniz-gray-500 text-center">
        {buckets.map((b) => (
          <div key={b.label}>{b.label}</div>
        ))}
      </div>
      <div className="text-[10px] text-stoniz-gray-500 mt-2">
        Total : {totalCount} projets · {fmtMadShort(totalMad)} MAD de marge cumulée
      </div>
    </div>
  );
}
