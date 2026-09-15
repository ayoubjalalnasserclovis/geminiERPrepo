import Link from 'next/link';
import { AlertTriangle, ArrowRight, BarChart3 } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Money } from '@/components/ui/money';
import { KpiGrid, DashboardSection, HorizontalBar } from '@/components/dashboard/kpi-card';
import { KpiDrawerCard, type KpiDrawerRow } from '@/components/dashboard/kpi-drawer';
import { formatDate, formatStatus, formatMoney } from '@/lib/utils/format';

const STATUS_COLORS: Record<string, string> = {
  sourcing: '#9E9890',
  disponible: '#4A6B8A',
  propose: '#C4956A',
  offre: '#A67A52',
  vendu: '#4A7C59',
  perdu: '#B85450',
  a_verifier: '#9B8EA8',
};

export default async function SourcingDashboardPage() {
  const user = await requireRole(['ceo', 'chef_projet', 'developer', 'sourcing']);
  const supabase = createClient();
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86_400_000).toISOString();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000).toISOString().slice(0, 10);

  const [propertiesRes, partnersRes, projectsRes, incompletsRes] = await Promise.all([
    supabase.from('properties_enriched').select('*'),
    supabase.from('partners').select('id, agency_name, status, last_contact_at, assigned_to, evaluation, created_at')
      .is('deleted_at', null),
    supabase.from('projects').select('id, property_id, compromis_date')
      .not('property_id', 'is', null).not('compromis_date', 'is', null).is('deleted_at', null),
    supabase.from('properties_publication_status').select('id, is_published, step2_sourcing_done, step3_media_done'),
  ]);

  const publicationStatuses = incompletsRes.data ?? [];
  const incompletsCount = publicationStatuses.filter((p: any) => !p.is_published).length;
  const readyToPublishCount = publicationStatuses.filter((p: any) =>
    !p.is_published && p.step2_sourcing_done && p.step3_media_done
  ).length;

  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const properties = propertiesRes.data ?? [];
  const partners = partnersRes.data ?? [];
  const projects = projectsRes.data ?? [];

  // ─── Pipeline par statut ─────────────────────────────────────────────
  const byStatus: Record<string, number> = {};
  properties.forEach(p => {
    byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
  });
  const maxStatus = Math.max(...Object.values(byStatus), 1);

  const sourced30 = properties.filter(p => p.created_at >= thirtyDaysAgo).length;
  const sourced90 = properties.filter(p => p.created_at >= ninetyDaysAgo).length;
  const sourcedYTD = properties.filter(p => p.created_at >= startOfYear).length;

  // ─── Performance commerciale ────────────────────────────────────────
  const vendus = properties.filter(p => p.status === 'vendu');
  const total = properties.length;
  const conversionRate = total > 0 ? Math.round((vendus.length / total) * 100) : 0;

  // Délai moyen sourcing → compromis (via projects.compromis_date)
  const propertyCreatedAt = new Map(properties.map(p => [p.id, p.created_at]));
  const delays: number[] = [];
  projects.forEach(pr => {
    const created = propertyCreatedAt.get(pr.property_id);
    if (created && pr.compromis_date) {
      const d1 = new Date(created).getTime();
      const d2 = new Date(pr.compromis_date).getTime();
      delays.push((d2 - d1) / 86_400_000);
    }
  });
  const avgDelay = delays.length > 0 ? Math.round(delays.reduce((a, b) => a + b, 0) / delays.length) : null;

  const yields = properties
    .filter(p => p.gross_yield != null)
    .map(p => Number(p.gross_yield));
  const avgYield = yields.length > 0 ? Math.round((yields.reduce((a, b) => a + b, 0) / yields.length) * 10) / 10 : null;

  const pricesM2 = vendus
    .filter(p => p.price && p.superficie)
    .map(p => Number(p.price) / Number(p.superficie));
  const avgPriceM2 = pricesM2.length > 0 ? Math.round(pricesM2.reduce((a, b) => a + b, 0) / pricesM2.length) : null;

  // ─── Biens stagnants ────────────────────────────────────────────────
  const stagnating = avgDelay
    ? properties.filter(p =>
        !['vendu','perdu'].includes(p.status) &&
        (now.getTime() - new Date(p.created_at).getTime()) / 86_400_000 > avgDelay
      )
    : [];

  // ─── Partenaires ────────────────────────────────────────────────────
  const partnerStats = new Map<string, { sold: number; total: number }>();
  properties.forEach(p => {
    if (!p.partner_id) return;
    const s = partnerStats.get(p.partner_id) ?? { sold: 0, total: 0 };
    s.total++;
    if (p.status === 'vendu') s.sold++;
    partnerStats.set(p.partner_id, s);
  });
  const topPartners = partners
    .map(p => ({ ...p, ...partnerStats.get(p.id) ?? { sold: 0, total: 0 } }))
    .sort((a, b) => b.sold - a.sold)
    .slice(0, 5);

  const inactivePartners = partners.filter(p =>
    p.status === 'actif' && (!p.last_contact_at || p.last_contact_at < sixtyDaysAgo)
  );

  // ─── KPI partenaires supplémentaires ────────────────────────────────
  const totalPartners = partners.length;
  const activePartners = partners.filter(p => p.status === 'actif').length;
  const newPartnersMonth = partners.filter(p => p.created_at >= startOfMonth).length;

  // Tableau complet des ventes par partenaire
  const partnersWithSales = partners
    .map(p => ({ ...p, ...partnerStats.get(p.id) ?? { sold: 0, total: 0 } }))
    .sort((a, b) => b.sold - a.sold || b.total - a.total);

  // ─── Vue "mes biens" (si user est sourcing simple) ───────────────────
  const showMyView = user.role === 'sourcing';
  const myProperties = showMyView ? properties.filter(p => p.sourced_by === user.id) : [];
  const myConversion = (() => {
    if (myProperties.length === 0) return 0;
    const sold = myProperties.filter(p => p.status === 'vendu').length;
    return Math.round((sold / myProperties.length) * 100);
  })();

  // ─── Lignes de détail pour le drill-down (drawer) ──────────────────────
  // Réutilise les mêmes données déjà chargées. Aucun recalcul.
  type PropItem = (typeof properties)[number];
  const recentFirst = (list: PropItem[]) =>
    [...list].sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
  const propertyRows = (list: PropItem[], amount?: (p: any) => string | undefined): KpiDrawerRow[] =>
    list.map((p: any) => ({
      id: p.id,
      label: p.name ?? 'Bien',
      sublabel: formatStatus(p.status),
      date: p.created_at ? formatDate(p.created_at) : undefined,
      amount: amount ? amount(p) : undefined,
      href: `/properties/${p.id}`,
    }));

  const partnerDrawerRows = (list: any[]): KpiDrawerRow[] =>
    list.map((p: any) => ({
      id: p.id,
      label: p.agency_name,
      sublabel: p.status === 'actif' ? 'Actif' : formatStatus(p.status),
      date: p.last_contact_at ? `Contact ${formatDate(p.last_contact_at)}` : 'Jamais contacté',
      href: `/partners/${p.id}`,
    }));

  const propById = new Map(properties.map((p: any) => [p.id, p]));
  const delaiVenteRows: KpiDrawerRow[] = projects
    .filter((pr: any) => propertyCreatedAt.get(pr.property_id) && pr.compromis_date)
    .map((pr: any) => {
      const created = propertyCreatedAt.get(pr.property_id)!;
      const days = Math.round((new Date(pr.compromis_date).getTime() - new Date(created).getTime()) / 86_400_000);
      return { pr, days, prop: propById.get(pr.property_id) as any };
    })
    .sort((a, b) => b.days - a.days)
    .map(({ pr, days, prop }) => ({
      id: pr.id,
      label: prop?.name ?? 'Bien',
      sublabel: prop ? formatStatus(prop.status) : undefined,
      amount: `${days} j`,
      href: prop ? `/properties/${prop.id}` : undefined,
    }));

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard chasseur immobilier"
        description="Pipeline biens, performance et partenaires"
        action={
          <Link
            href="/dashboard/sourcing/performance"
            className="inline-flex items-center gap-2 px-3 py-2 rounded bg-stoniz-blue text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            <BarChart3 className="w-4 h-4" />
            Performance avancée
          </Link>
        }
      />

      <Link href="/dashboard/sourcing/performance" className="block">
        <Card className="border-2 border-stoniz-blue/30 bg-gradient-to-r from-blue-50 to-emerald-50 hover:from-blue-100 hover:to-emerald-100 transition-colors cursor-pointer">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <BarChart3 className="w-8 h-8 text-stoniz-blue flex-shrink-0" />
              <div>
                <div className="font-display text-lg text-stoniz-gray-900">
                  Voir la Performance avancée
                </div>
                <div className="text-sm text-stoniz-gray-600">
                  Évolution hebdo, entonnoir de conversion, hit rate par partenaire, biens dormants, performance par segment
                </div>
              </div>
            </div>
            <ArrowRight className="w-5 h-5 text-stoniz-blue flex-shrink-0" />
          </div>
        </Card>
      </Link>

      {incompletsCount > 0 && (
        <Link href="/properties/incomplets" className="block">
          <Card className="border-orange-300 border-2 bg-orange-50 hover:bg-orange-100 transition-colors cursor-pointer">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-orange-700 flex-shrink-0" />
                <div>
                  <div className="font-display text-lg text-orange-900">
                    {incompletsCount} bien{incompletsCount > 1 ? 's' : ''} en cours d'import
                    {readyToPublishCount > 0 && (
                      <span className="ml-2 text-sm font-normal text-green-700">
                        · dont {readyToPublishCount} prêt{readyToPublishCount > 1 ? 's' : ''} à publier
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-orange-800">
                    Ces biens ne sont pas encore visibles par les équipes projet. Complétez sourcing + médias avant publication.
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 text-sm text-orange-900 font-semibold">
                Voir la liste <ArrowRight className="w-4 h-4" />
              </div>
            </div>
          </Card>
        </Link>
      )}

      <DashboardSection title="Pipeline biens">
        <KpiGrid>
          <KpiDrawerCard label="Total biens" value={total}
            detail={{
              title: 'Total biens',
              subtitle: 'Tous les biens du pipeline',
              rows: propertyRows(recentFirst(properties)),
              emptyLabel: 'Aucun bien.',
            }} />
          <KpiDrawerCard label="Sourcés 30j" value={sourced30}
            detail={{
              title: 'Biens sourcés (30 derniers jours)',
              rows: propertyRows(recentFirst(properties.filter(p => p.created_at >= thirtyDaysAgo))),
              emptyLabel: 'Aucun bien sourcé sur 30 jours.',
            }} />
          <KpiDrawerCard label="Sourcés 90j" value={sourced90}
            detail={{
              title: 'Biens sourcés (90 derniers jours)',
              rows: propertyRows(recentFirst(properties.filter(p => p.created_at >= ninetyDaysAgo))),
              emptyLabel: 'Aucun bien sourcé sur 90 jours.',
            }} />
          <KpiDrawerCard label="Sourcés YTD" value={sourcedYTD}
            detail={{
              title: 'Biens sourcés (depuis le 1er janvier)',
              rows: propertyRows(recentFirst(properties.filter(p => p.created_at >= startOfYear))),
              emptyLabel: 'Aucun bien sourcé cette année.',
            }} />
        </KpiGrid>

        <Card className="mt-4">
          <CardHeader><CardTitle>Répartition par statut</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.keys(STATUS_COLORS).map(status => (
                <HorizontalBar
                  key={status}
                  label={formatStatus(status)}
                  value={byStatus[status] ?? 0}
                  max={maxStatus}
                  color={STATUS_COLORS[status]}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </DashboardSection>

      <DashboardSection title="Performance commerciale">
        <KpiGrid>
          <KpiDrawerCard label="Taux conversion" value={`${conversionRate}%`}
            hint={`${vendus.length} vendus / ${total} biens`}
            variant={conversionRate >= 20 ? 'success' : 'warning'}
            detail={{
              title: 'Biens vendus',
              subtitle: 'Biens convertis en vente',
              headline: `${conversionRate}%`,
              rows: propertyRows(recentFirst(vendus)),
              emptyLabel: 'Aucun bien vendu.',
              note: `${vendus.length} vendus sur ${total} biens au total.`,
            }} />
          <KpiDrawerCard label="Délai moyen vente"
            value={avgDelay != null ? `${avgDelay} j` : '—'}
            hint="sourcing → compromis"
            detail={{
              title: 'Délai sourcing → compromis',
              subtitle: 'Par bien (du plus long au plus court)',
              headline: avgDelay != null ? `${avgDelay} j en moyenne` : '—',
              rows: delaiVenteRows,
              emptyLabel: 'Aucun bien avec compromis daté.',
            }} />
          <KpiDrawerCard label="Rendement moyen"
            value={avgYield != null ? `${avgYield}%` : '—'}
            hint="brut, biens sourcés"
            detail={{
              title: 'Rendement brut par bien',
              subtitle: 'Biens dont le rendement est renseigné',
              headline: avgYield != null ? `${avgYield}%` : '—',
              rows: propertyRows(
                [...properties].filter(p => p.gross_yield != null).sort((a: any, b: any) => Number(b.gross_yield) - Number(a.gross_yield)),
                p => `${Number(p.gross_yield)}%`,
              ),
              emptyLabel: 'Aucun rendement renseigné.',
            }} />
          <KpiDrawerCard label="Prix m² livraison"
            value={avgPriceM2 != null ? <Money amount={avgPriceM2} /> : '—'}
            hint="biens vendus"
            detail={{
              title: 'Prix au m² (biens vendus)',
              subtitle: 'Prix ÷ superficie, par bien',
              headline: avgPriceM2 != null ? `${formatMoney(avgPriceM2)} / m² en moyenne` : '—',
              rows: propertyRows(
                vendus.filter(p => p.price && p.superficie),
                p => `${formatMoney(Math.round(Number(p.price) / Number(p.superficie)))} / m²`,
              ),
              emptyLabel: 'Aucun bien vendu avec prix et superficie.',
            }} />
        </KpiGrid>
      </DashboardSection>

      {showMyView && (
        <DashboardSection title="Mes biens" description="Vos biens sourcés">
          <KpiGrid cols={3}>
            <KpiDrawerCard label="Mes biens en pipeline" value={myProperties.length}
              detail={{
                title: 'Mes biens en pipeline',
                subtitle: 'Les biens que vous avez sourcés',
                rows: propertyRows(recentFirst(myProperties)),
                emptyLabel: 'Aucun bien sourcé.',
              }} />
            <KpiDrawerCard label="Mon taux conversion" value={`${myConversion}%`}
              detail={{
                title: 'Mes biens vendus',
                subtitle: 'Part de mes biens convertis en vente',
                headline: `${myConversion}%`,
                rows: propertyRows(recentFirst(myProperties.filter(p => p.status === 'vendu'))),
                emptyLabel: 'Aucun bien vendu.',
              }} />
            <KpiDrawerCard label="Mes biens vendus"
              value={myProperties.filter(p => p.status === 'vendu').length}
              detail={{
                title: 'Mes biens vendus',
                rows: propertyRows(recentFirst(myProperties.filter(p => p.status === 'vendu'))),
                emptyLabel: 'Aucun bien vendu.',
              }} />
          </KpiGrid>
        </DashboardSection>
      )}

      <DashboardSection title="Réseau partenaires">
        <KpiGrid>
          <KpiDrawerCard label="Partenaires agences" value={totalPartners}
            hint={`${activePartners} actifs`}
            detail={{
              title: 'Partenaires agences',
              subtitle: 'Tout le réseau partenaires',
              rows: partnerDrawerRows(partners),
              emptyLabel: 'Aucun partenaire.',
              note: `${activePartners} partenaires actifs sur ${totalPartners}.`,
            }} />
          <KpiDrawerCard label="Nouveaux ce mois" value={newPartnersMonth}
            variant={newPartnersMonth > 0 ? 'success' : 'default'}
            detail={{
              title: 'Nouveaux partenaires ce mois',
              subtitle: 'Depuis le 1er du mois',
              rows: partnerDrawerRows(partners.filter(p => p.created_at >= startOfMonth)),
              emptyLabel: 'Aucun nouveau partenaire ce mois.',
            }} />
          <KpiDrawerCard label="À relancer" value={inactivePartners.length}
            hint=">60j sans contact"
            variant={inactivePartners.length > 0 ? 'warning' : 'success'}
            detail={{
              title: 'Partenaires à relancer',
              subtitle: 'Actifs sans contact depuis plus de 60 jours',
              rows: partnerDrawerRows(inactivePartners),
              emptyLabel: 'Aucun partenaire à relancer.',
            }} />
          <KpiDrawerCard label="Biens sourcés ce mois"
            value={properties.filter(p => p.created_at >= startOfMonth).length}
            detail={{
              title: 'Biens sourcés ce mois',
              subtitle: 'Depuis le 1er du mois',
              rows: propertyRows(recentFirst(properties.filter(p => p.created_at >= startOfMonth))),
              emptyLabel: 'Aucun bien sourcé ce mois.',
            }} />
        </KpiGrid>
      </DashboardSection>

      <DashboardSection title="Ventes par partenaire" description="Classement complet">
        <Card>
          {partnersWithSales.length === 0 ? (
            <p className="text-sm text-stoniz-gray-500">Aucun partenaire</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <th className="text-left py-2">Agence</th>
                  <th className="text-right py-2">Sourcés</th>
                  <th className="text-right py-2">Vendus</th>
                  <th className="text-right py-2">Taux</th>
                  <th className="text-right py-2">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {partnersWithSales.map((p: any) => (
                  <tr key={p.id}>
                    <td className="py-2">
                      <Link href={`/partners/${p.id}`} className="hover:underline font-medium">{p.agency_name}</Link>
                    </td>
                    <td className="text-right py-2">{p.total}</td>
                    <td className="text-right py-2">
                      {p.sold > 0 ? <Badge variant="success">{p.sold}</Badge> : <span className="text-stoniz-gray-400">0</span>}
                    </td>
                    <td className="text-right py-2 font-medium">
                      {p.total > 0 ? `${Math.round((p.sold / p.total) * 100)}%` : '—'}
                    </td>
                    <td className="text-right py-2">
                      <Badge variant={p.status === 'actif' ? 'success' : 'default'}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </DashboardSection>

      {inactivePartners.length > 0 && (
        <DashboardSection title="⚠️ Partenaires à relancer" description="Pas de contact depuis >60 jours">
          <Card className="border-orange-200">
            <ul className="divide-y text-sm">
              {inactivePartners.slice(0, 10).map(p => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <Link href={`/partners/${p.id}`} className="hover:underline">{p.agency_name}</Link>
                  <span className="text-xs text-stoniz-gray-500">
                    {p.last_contact_at ? `Dernier contact ${formatDate(p.last_contact_at)}` : 'Jamais contacté'}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </DashboardSection>
      )}

      {stagnating.length > 0 && (
        <DashboardSection title="🐢 Biens stagnants" description={`En pipeline depuis plus de ${avgDelay} jours`}>
          <Card>
            <ul className="divide-y text-sm">
              {stagnating.slice(0, 10).map((p: any) => (
                <li key={p.id} className="py-2 flex items-center justify-between">
                  <Link href={`/properties/${p.id}`} className="hover:underline font-medium">{p.name}</Link>
                  <div className="flex items-center gap-3 text-xs text-stoniz-gray-500">
                    <Badge>{p.status}</Badge>
                    <span>
                      {Math.round((now.getTime() - new Date(p.created_at).getTime()) / 86_400_000)} jours
                    </span>
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
