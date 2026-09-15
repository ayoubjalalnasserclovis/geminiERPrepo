import Link from 'next/link';
import { Euro, UserPlus, MapPin, Hammer, ArrowRight, AlertOctagon } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/auth/require';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import { Money } from '@/components/ui/money';
import { formatPhase } from '@/lib/utils/format';
import { collectAlerts } from '@/lib/alerts/collect';
import { LifecycleKpiSection } from '@/components/dashboard/lifecycle-kpi-section';
import { excludeLostByProject, LOST_STATUS } from '@/lib/projects/lost';

export default async function DashboardPage() {
  const user = await getSessionUser();
  // CEO 2026-06-10 : le rôle 'menage' n'a accès qu'à /propria/menage
  if (user?.role === 'menage') {
    const { redirect } = await import('next/navigation');
    redirect('/propria/menage');
  }
  const supabase = createClient();

  // Exclusion projets perdus : règle métier permanente (voir lib/projects/lost.ts)
  const [projectsRes, paymentsRes, propertiesRes, tasksRes, alerts] = await Promise.all([
    supabase.from('projects').select('id, current_phase, status').is('deleted_at', null).neq('status', LOST_STATUS),
    supabase.from('payments')
      .select('amount_paid, amount_expected, status, project:projects(status, deleted_at)')
      .is('deleted_at', null),
    supabase.from('properties').select('id, status').is('deleted_at', null),
    supabase.from('tasks').select('id, status').neq('status', 'done'),
    user ? collectAlerts({ userId: user.id, role: user.role as any }) : Promise.resolve([]),
  ]);

  const alertsCount = {
    total: alerts.length,
    critique: alerts.filter(a => a.severity === 'critique').length,
    importante: alerts.filter(a => a.severity === 'importante').length,
    info: alerts.filter(a => a.severity === 'info').length,
  };

  const projects = projectsRes.data ?? [];
  // Filtre côté JS : on retire les paiements liés à un projet perdu
  // (la query Supabase ne permet pas un filtre direct sur la relation jointe)
  const payments = excludeLostByProject(paymentsRes.data, (p: any) => p.project);
  const properties = propertiesRes.data ?? [];
  const tasks = tasksRes.data ?? [];

  const totalEncaisse = payments.reduce((s, p) => s + Number(p.amount_paid), 0);
  const totalAttendu = payments.reduce((s, p) => s + Number(p.amount_expected), 0);
  // QA-BUG-021 — définition alignée sur le cockpit financier
  // (app/(team)/dashboard/financier/page.tsx) : « en production » =
  // non perdu (déjà exclu par la query) ET non livré. Les projets en PAUSE
  // sont comptés : ils sont toujours au portefeuille.
  const projetsEnProduction = projects.filter(p => p.status !== 'termine');
  const projetsActifs = projetsEnProduction.length;
  const biensDispo = properties.filter(p => ['disponible','propose'].includes(p.status)).length;

  const byPhase: Record<string, number> = {};
  projetsEnProduction.forEach(p => {
    byPhase[p.current_phase] = (byPhase[p.current_phase] ?? 0) + 1;
  });

  const role = user?.role;
  // Le rôle developer voit toutes les tuiles : il a besoin d'accéder à tous
  // les écrans pour debugger / vérifier ses changements de bout en bout.
  const isDev = role === 'developer';
  const subDashboards = [
    { href: '/dashboard/financier', label: 'Financier',   icon: Euro,    desc: 'CA, trésorerie, marge, échéancier',
      visible: role === 'ceo' || isDev },
    { href: '/dashboard/clients',   label: 'Clients',     icon: UserPlus, desc: 'Pipeline, propositions, engagement',
      visible: role === 'ceo' || role === 'chef_projet' || role === 'commercial' || isDev },
    { href: '/dashboard/sourcing',  label: 'Sourcing',    icon: MapPin,  desc: 'Biens, partenaires, performance',
      visible: role === 'ceo' || role === 'chef_projet' || role === 'sourcing' || isDev },
    { href: '/dashboard/travaux',   label: 'Travaux',     icon: Hammer,  desc: 'Lots, cashflow, marge chantiers',
      visible: role === 'ceo' || role === 'chef_projet' || role === 'finance' || isDev },
  ].filter(s => s.visible);

  return (
    <div>
      <PageHeader title="Tableau de bord" description="Vue d'ensemble Stoniz" />

      {alertsCount.total > 0 && (
        <Link href="/dashboard/alertes" className="block mb-8">
          <Card className={`border-2 transition-colors cursor-pointer ${
            alertsCount.critique > 0
              ? 'border-red-300 bg-red-50 hover:bg-red-100'
              : alertsCount.importante > 0
                ? 'border-orange-300 bg-orange-50 hover:bg-orange-100'
                : 'border-grey-line bg-cream-soft hover:bg-cream'
          }`}>
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <AlertOctagon className={`w-5 h-5 flex-shrink-0 ${
                  alertsCount.critique > 0 ? 'text-red-700'
                    : alertsCount.importante > 0 ? 'text-orange-700'
                    : 'text-stoniz-gray-600'
                }`} />
                <div>
                  <div className="font-display text-lg">
                    {alertsCount.total} alerte{alertsCount.total > 1 ? 's' : ''} en cours
                  </div>
                  <div className="text-sm text-stoniz-gray-700 flex gap-3 flex-wrap mt-0.5">
                    {alertsCount.critique > 0 && (
                      <span className="text-red-800">🚨 {alertsCount.critique} critique{alertsCount.critique > 1 ? 's' : ''}</span>
                    )}
                    {alertsCount.importante > 0 && (
                      <span className="text-orange-800">⚠️ {alertsCount.importante} importante{alertsCount.importante > 1 ? 's' : ''}</span>
                    )}
                    {alertsCount.info > 0 && (
                      <span className="text-stoniz-gray-700">ℹ️ {alertsCount.info} info</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold">
                Voir le détail <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          </Card>
        </Link>
      )}

      {subDashboards.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {subDashboards.map(s => {
            const Icon = s.icon;
            return (
              <Link key={s.href} href={s.href}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <div className="flex items-center justify-between mb-2">
                    <Icon className="w-6 h-6 text-stoniz-gray-600" />
                    <ArrowRight className="w-4 h-4 text-stoniz-gray-400" />
                  </div>
                  <div className="font-display text-xl">{s.label}</div>
                  <div className="text-xs text-stoniz-gray-500 mt-1">{s.desc}</div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <Card>
          <CardHeader>
            <CardDescription>Projets en production</CardDescription>
            <CardTitle>{projetsActifs}</CardTitle>
            <p className="text-xs text-stoniz-gray-500">Hors perdus et livrés</p>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>CA encaissé total</CardDescription>
            <CardTitle><Money amount={totalEncaisse} /></CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>CA en attente</CardDescription>
            <CardTitle><Money amount={Math.max(totalAttendu - totalEncaisse, 0)} /></CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Tâches ouvertes</CardDescription>
            <CardTitle>{tasks.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Projets en production par phase</CardTitle>
          <CardDescription>Hors perdus et livrés</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-7 gap-3">
            {['onboarding','sourcing','design','travaux','livraison','mise_en_location','termine'].map(phase => (
              <div key={phase} className="text-center">
                <div className="text-3xl font-display">{byPhase[phase] ?? 0}</div>
                <div className="text-xs text-stoniz-gray-500 mt-1">{formatPhase(phase)}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardDescription>Biens disponibles</CardDescription>
            <CardTitle>{biensDispo}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Total biens en base</CardDescription>
            <CardTitle>{properties.length}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Section KPI lifecycle — visible si au moins 1 pause/perdu ou leçon */}
      {user?.role === 'ceo' && (
        <LifecycleKpiSection />
      )}
    </div>
  );
}
