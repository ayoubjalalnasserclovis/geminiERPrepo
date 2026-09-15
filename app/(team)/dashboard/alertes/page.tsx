import Link from 'next/link';
import { AlertTriangle, AlertOctagon, Info, ArrowRight } from 'lucide-react';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { collectAlerts, type Alert, type AlertSeverity, type AlertCategory } from '@/lib/alerts/collect';

const SEVERITY_META: Record<AlertSeverity, { label: string; icon: any; color: string; bg: string; border: string }> = {
  critique: {
    label: '🚨 Critique', icon: AlertOctagon,
    color: 'text-red-900', bg: 'bg-red-50', border: 'border-red-300',
  },
  importante: {
    label: '⚠️ Importante', icon: AlertTriangle,
    color: 'text-orange-900', bg: 'bg-orange-50', border: 'border-orange-300',
  },
  info: {
    label: 'ℹ️ Info', icon: Info,
    color: 'text-stoniz-black', bg: 'bg-cream-soft', border: 'border-grey-line',
  },
};

const CATEGORY_LABELS: Record<AlertCategory, string> = {
  paiements: '💶 Paiements',
  operations: '⚙️ Opérations',
  clients: '👤 Clients',
  sourcing: '🔍 Sourcing',
  propria: '🏡 Propria',
};

export default async function AlertesPage({ searchParams }: { searchParams: { cat?: string } }) {
  await requireRole(['ceo', 'chef_projet', 'developer', 'finance', 'commercial']);
  const user = await getSessionUser();
  if (!user) return null;

  const alerts = await collectAlerts({ userId: user.id, role: user.role as any });

  // Filtre par catégorie si demandé
  const filter = searchParams.cat as AlertCategory | undefined;
  const filtered = filter ? alerts.filter(a => a.category === filter) : alerts;

  // Compteurs
  const counts = {
    critique: alerts.filter(a => a.severity === 'critique').length,
    importante: alerts.filter(a => a.severity === 'importante').length,
    info: alerts.filter(a => a.severity === 'info').length,
  };

  const byCategory: Record<string, number> = {};
  alerts.forEach(a => {
    byCategory[a.category] = (byCategory[a.category] ?? 0) + 1;
  });

  // Groupement par sévérité
  const bySeverity: Record<AlertSeverity, Alert[]> = {
    critique: filtered.filter(a => a.severity === 'critique'),
    importante: filtered.filter(a => a.severity === 'importante'),
    info: filtered.filter(a => a.severity === 'info'),
  };
  // Tri : retards les plus longs en premier
  for (const sev of Object.keys(bySeverity) as AlertSeverity[]) {
    bySeverity[sev].sort((a, b) => (b.days_overdue ?? 0) - (a.days_overdue ?? 0));
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="🚨 Alertes Stoniz"
        description={`${counts.critique} critique${counts.critique > 1 ? 's' : ''} · ${counts.importante} importante${counts.importante > 1 ? 's' : ''} · ${counts.info} info`}
      />

      {/* Filtres par catégorie */}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/dashboard/alertes"
          className={`text-sm px-3 py-1.5 rounded-full border bg-white hover:bg-cream-soft transition-colors ${
            !filter ? 'border-stoniz-black font-semibold' : 'border-grey-line'
          }`}
        >
          Toutes ({alerts.length})
        </Link>
        {(Object.keys(CATEGORY_LABELS) as AlertCategory[]).map(cat => (
          byCategory[cat] > 0 && (
            <Link
              key={cat}
              href={`/dashboard/alertes?cat=${cat}`}
              className={`text-sm px-3 py-1.5 rounded-full border bg-white hover:bg-cream-soft transition-colors ${
                filter === cat ? 'border-stoniz-black font-semibold' : 'border-grey-line'
              }`}
            >
              {CATEGORY_LABELS[cat]} ({byCategory[cat]})
            </Link>
          )
        ))}
      </div>

      {alerts.length === 0 ? (
        <Card>
          <EmptyState
            title="🎉 Aucune alerte"
            description="Toutes les opérations sont à jour. Beau travail !"
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {(['critique', 'importante', 'info'] as AlertSeverity[]).map(sev => {
            const items = bySeverity[sev];
            if (items.length === 0) return null;
            const meta = SEVERITY_META[sev];
            const Icon = meta.icon;
            return (
              <section key={sev}>
                <div className="flex items-center gap-2 mb-3">
                  <Icon className={`w-5 h-5 ${meta.color}`} />
                  <h2 className="font-display text-xl">
                    {meta.label} <span className="text-grey-text text-base font-normal">({items.length})</span>
                  </h2>
                </div>
                <div className="space-y-2">
                  {items.map(a => (
                    <Link key={a.id} href={a.href}>
                      <Card className={`${meta.bg} ${meta.border} border-l-4 hover:opacity-95 transition-opacity cursor-pointer`}>
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className={`font-semibold ${meta.color}`}>{a.title}</p>
                              <Badge variant="default" className="text-[10px]">
                                {CATEGORY_LABELS[a.category]}
                              </Badge>
                            </div>
                            <p className={`text-sm ${meta.color} opacity-80 mt-1`}>{a.description}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            {a.meta && (
                              <span className={`text-sm font-semibold ${meta.color}`}>{a.meta}</span>
                            )}
                            <ArrowRight className={`w-4 h-4 ${meta.color} opacity-60`} />
                          </div>
                        </div>
                      </Card>
                    </Link>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
