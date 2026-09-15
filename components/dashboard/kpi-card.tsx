import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils/cn';

export function KpiCard({
  label,
  value,
  hint,
  trend,
  variant = 'default',
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { value: number; positive?: boolean };
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const variantClass = {
    default: '',
    success: 'border-l-4 border-l-green-600',
    warning: 'border-l-4 border-l-orange-500',
    danger:  'border-l-4 border-l-red-600',
    accent:  'border-l-4 border-l-accent',
  }[variant];

  return (
    <Card className={cn('flex flex-col gap-1', variantClass)}>
      <div className="text-xs uppercase text-stoniz-gray-500 tracking-wide">{label}</div>
      <div className="font-display text-3xl">{value}</div>
      {hint && <div className="text-xs text-stoniz-gray-500">{hint}</div>}
      {trend && (
        <div className={cn('text-xs font-medium', trend.positive === false ? 'text-red-600' : 'text-green-700')}>
          {trend.positive === false ? '↘' : '↗'} {trend.value > 0 ? '+' : ''}{trend.value}%
        </div>
      )}
    </Card>
  );
}

export function KpiGrid({ children, cols = 4 }: { children: React.ReactNode; cols?: 2 | 3 | 4 }) {
  const c = { 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-2 lg:grid-cols-4' }[cols];
  return <div className={`grid grid-cols-1 ${c} gap-4`}>{children}</div>;
}

export function DashboardSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-2xl">{title}</h2>
        {description && <p className="text-sm text-stoniz-gray-500">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/**
 * Barre horizontale simple (CSS pur, pas de lib externe).
 */
export function HorizontalBar({
  label,
  value,
  max,
  color = 'var(--color-stoniz-black)',
}: {
  label: React.ReactNode;
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="w-32 truncate text-stoniz-gray-600">{label}</div>
      <div className="flex-1 h-3 bg-stoniz-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <div className="w-16 text-right font-medium">{value}</div>
    </div>
  );
}
