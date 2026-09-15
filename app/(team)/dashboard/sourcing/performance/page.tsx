import Link from 'next/link';
import { ArrowLeft, TrendingUp, Users, AlertTriangle, ArrowRight } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { KpiCard, KpiGrid, DashboardSection } from '@/components/dashboard/kpi-card';
import { WeeklyTrendChart } from '@/components/dashboard/weekly-trend';
import { ConversionFunnel } from '@/components/dashboard/conversion-funnel';
import { collectSourcingPerformance } from '@/lib/dashboard/sourcing-performance';
import { formatStatus } from '@/lib/utils/format';

export const dynamic = 'force-dynamic';

export default async function SourcingPerformancePage() {
  await requireRole(['ceo', 'chef_projet', 'developer', 'sourcing']);
  const perf = await collectSourcingPerformance();

  return (
    <div className="space-y-8">
      <PageHeader
        title="Performance sourcing"
        description="KPIs avancés : rythme, conversion, partenaires, segments, vieillissement"
        action={
          <Link
            href="/dashboard/sourcing"
            className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-gray-900"
          >
            <ArrowLeft className="w-4 h-4" /> Retour au dashboard sourcing
          </Link>
        }
      />

      {/* ─── Bandeau : biens à compléter (CEO 2026-06-17) ───────────────── */}
      {perf.incompletes.length > 0 && (
        <Card className="border-amber-300 border-2 bg-amber-50">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-700 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-display text-lg text-amber-900">
                {perf.incompletes.length} bien{perf.incompletes.length > 1 ? 's' : ''} à compléter
              </div>
              <div className="text-sm text-amber-800 mt-1">
                Ces biens manquent de métadonnées (type, quartier, canal de sourcing) — ils sortent regroupés sous "non renseigné" dans les segments ci-dessous.
              </div>
              <ul className="mt-3 space-y-1 text-sm max-h-48 overflow-y-auto">
                {perf.incompletes.slice(0, 10).map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 border-b border-amber-200 pb-1">
                    <Link href={`/properties/${p.id}`} className="hover:underline font-medium truncate">
                      {p.name}
                    </Link>
                    <span className="text-xs text-amber-700 flex-shrink-0">
                      manque : {p.missingFields.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
              {perf.incompletes.length > 10 && (
                <p className="text-xs text-amber-700 mt-2">
                  …et {perf.incompletes.length - 10} autre{perf.incompletes.length - 10 > 1 ? 's' : ''}.
                </p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* ─── Vue d'ensemble ──────────────────────────────────────────── */}
      <DashboardSection title="Vue d'ensemble">
        <KpiGrid>
          <KpiCard
            label="Biens dans le pipeline"
            value={perf.totals.activePipeline}
            hint={`${perf.totals.totalProperties} biens au total (historique)`}
          />
          <KpiCard
            label="Âge moyen pipeline"
            value={perf.totals.avgPipelineAgeDays != null ? `${perf.totals.avgPipelineAgeDays} j` : '—'}
            hint="depuis dernière activité"
            variant={
              perf.totals.avgPipelineAgeDays != null && perf.totals.avgPipelineAgeDays > 60
                ? 'warning'
                : 'default'
            }
          />
          <KpiCard
            label="Délai médian total"
            value={perf.totals.medianTotalDelayDays != null ? `${perf.totals.medianTotalDelayDays} j` : '—'}
            hint="sourcing → acte (biens vendus)"
          />
          <KpiCard
            label="Biens dormants"
            value={perf.dormants.length}
            hint=">60j sans activité"
            variant={perf.dormants.length > 0 ? 'warning' : 'success'}
          />
        </KpiGrid>
      </DashboardSection>

      {/* ─── Évolution hebdomadaire ──────────────────────────────────── */}
      <DashboardSection title="Évolution hebdomadaire" description="12 dernières semaines">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-stoniz-blue" />
                Biens sourcés
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WeeklyTrendChart points={perf.weeklySourced} color="bg-stoniz-blue" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-4 h-4 text-emerald-600" />
                Nouveaux partenaires
              </CardTitle>
            </CardHeader>
            <CardContent>
              <WeeklyTrendChart points={perf.weeklyNewPartners} color="bg-emerald-500" />
            </CardContent>
          </Card>
        </div>
      </DashboardSection>

      {/* ─── Entonnoir conversion ────────────────────────────────────── */}
      <DashboardSection
        title="Entonnoir de conversion"
        description="Du sourcing à la vente — taux de passage entre chaque étape"
      >
        <Card>
          <CardContent>
            <ConversionFunnel steps={perf.funnel} />
          </CardContent>
        </Card>
      </DashboardSection>

      {/* ─── Délais médians par étape ────────────────────────────────── */}
      <DashboardSection
        title="Délais médians par étape"
        description="Temps écoulé entre 2 étapes (médiane, n = nombre d'observations)"
      >
        <Card>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
              <tr>
                <th className="text-left py-2">Étape</th>
                <th className="text-right py-2">Médiane</th>
                <th className="text-right py-2">n</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {perf.delays.map((d) => (
                <tr key={d.label}>
                  <td className="py-2">{d.label}</td>
                  <td className="text-right py-2 font-medium">
                    {d.medianDays != null ? `${d.medianDays} j` : '—'}
                  </td>
                  <td className="text-right py-2 text-stoniz-gray-500">{d.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </DashboardSection>

      {/* ─── Top partenaires ─────────────────────────────────────────── */}
      <DashboardSection
        title="Top partenaires"
        description="Classement par biens vendus — hit rate = ventes / offres envoyées"
      >
        <Card>
          {perf.topPartners.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun partenaire avec activité.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2">Agence</th>
                    <th className="text-right py-2">Sourcés</th>
                    <th className="text-right py-2">Visités</th>
                    <th className="text-right py-2">Offres</th>
                    <th className="text-right py-2">Compromis</th>
                    <th className="text-right py-2">Vendus</th>
                    <th className="text-right py-2">Hit rate</th>
                    <th className="text-right py-2">Délai moy.</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {perf.topPartners.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2">
                        <Link href={`/partners/${p.id}`} className="hover:underline font-medium">
                          {p.agency_name}
                        </Link>
                      </td>
                      <td className="text-right py-2">{p.sourced}</td>
                      <td className="text-right py-2 text-stoniz-gray-600">{p.visited}</td>
                      <td className="text-right py-2 text-stoniz-gray-600">{p.offered}</td>
                      <td className="text-right py-2 text-stoniz-gray-600">{p.compromised}</td>
                      <td className="text-right py-2">
                        {p.sold > 0 ? (
                          <Badge variant="success">{p.sold}</Badge>
                        ) : (
                          <span className="text-stoniz-gray-400">0</span>
                        )}
                      </td>
                      <td className="text-right py-2 font-medium">
                        {p.hitRatePct != null ? `${p.hitRatePct}%` : '—'}
                      </td>
                      <td className="text-right py-2 text-stoniz-gray-600">
                        {p.avgDelayDays != null ? `${p.avgDelayDays} j` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </DashboardSection>

      {/* ─── Performance par segment ─────────────────────────────────── */}
      <DashboardSection
        title="Performance par segment"
        description="Conversion par type de bien, quartier et canal de sourcing"
      >
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <SegmentTable title="Par type de bien" rows={perf.byType} />
          <SegmentTable title="Par quartier" rows={perf.byQuartier} />
          <SegmentTable title="Par canal de sourcing" rows={perf.bySourcingType} />
        </div>
      </DashboardSection>

      {/* ─── Biens dormants ─────────────────────────────────────────── */}
      {perf.dormants.length > 0 && (
        <DashboardSection
          title="🐢 Biens dormants"
          description="Pas d'activité enregistrée depuis plus de 60 jours — à relancer ou archiver"
        >
          <Card>
            <ul className="divide-y text-sm">
              {perf.dormants.map((d) => (
                <li key={d.id} className="py-2 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/properties/${d.id}`}
                      className="hover:underline font-medium block truncate"
                    >
                      {d.name}
                    </Link>
                    {d.partner_name && (
                      <div className="text-xs text-stoniz-gray-500 truncate">
                        via {d.partner_name}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-stoniz-gray-500 flex-shrink-0">
                    <Badge>{formatStatus(d.status)}</Badge>
                    <span className="font-medium">{d.daysSinceLastEvent} j</span>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </DashboardSection>
      )}
    </div>
  );
}

function SegmentTable({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; total: number; visited: number; offered: number; sold: number; conversionPct: number }>;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-xs text-stoniz-gray-500 italic">Pas encore de données.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-stoniz-gray-500 border-b">
              <tr>
                <th className="text-left py-1.5">Segment</th>
                <th className="text-right py-1.5">Total</th>
                <th className="text-right py-1.5">Vendus</th>
                <th className="text-right py-1.5">Conv.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="py-1.5 truncate max-w-[140px]" title={r.key}>
                    {r.key}
                  </td>
                  <td className="text-right py-1.5">{r.total}</td>
                  <td className="text-right py-1.5">{r.sold}</td>
                  <td className="text-right py-1.5 font-medium">{r.conversionPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  );
}
