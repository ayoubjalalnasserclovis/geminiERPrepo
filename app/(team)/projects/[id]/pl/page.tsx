import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Settings, Info } from 'lucide-react';
import { requireRole, getSessionUser } from '@/lib/auth/require';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  DashboardSection,
  KpiCard,
  KpiGrid,
} from '@/components/dashboard/kpi-card';
import { formatMoney, formatMad, formatPhase } from '@/lib/utils/format';
import { getPLProject } from '@/lib/finance/pl-project';
import { getProjectOverride } from '@/lib/finance/pl-settings';
import { PLModeToggle } from '@/components/projects/pl/pl-mode-toggle';
import { PLOverrideForm } from '@/components/projects/pl/pl-override-form';

/**
 * Tab P&L sur la fiche projet (CEO 2026-06-30 Phase B3).
 *
 * 4 sections :
 *   1. Synthèse marge totale (selon le mode actif)
 *   2. P&L Honoraires (cabinet Stoniz) — revenus, services, salaires alloués,
 *      marge — avec affichage parallèle des deux modes.
 *   3. P&L Travaux — MAD (forfait/devis/marge/trésorerie)
 *   4. P&L Achats — MAD (forfait/devis/marge)
 *
 * Permissions : CEO + finance + chef_projet + developer.
 * Édition de l'override : CEO + finance uniquement.
 *
 * Sentinelle d'erreur reprise du pattern travaux (loggue sur app_error_logs).
 */

type Search = { mode?: string };

function variantForMargin(value: number, ref: number): 'success' | 'warning' | 'danger' | 'default' {
  if (value < 0) return 'danger';
  if (ref > 0) {
    const ratio = value / ref;
    if (ratio < 0.05) return 'warning';
  } else if (value === 0) {
    return 'warning';
  }
  return 'success';
}

export default async function ProjectPLPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams: Search;
}) {
  const me = await requireRole(['ceo', 'finance', 'chef_projet', 'developer']);

  const mode: 'weighted' | 'flat' =
    searchParams?.mode === 'flat' ? 'flat' : 'weighted';

  const summary = await getPLProject(params.id);
  if (!summary) notFound();

  const override = await getProjectOverride(params.id);
  const canEditOverride = me.role === 'ceo' || me.role === 'finance';

  const honoraires = summary.honoraires;
  const revenus = honoraires.revenus_eur;
  const charges_services = honoraires.charges_services_eur;
  const charges_salaires_weighted = honoraires.charges_salaires_weighted_eur;
  const charges_salaires_flat = honoraires.charges_salaires_flat_eur;

  const isWeighted = mode === 'weighted';
  const margeHonoraires = isWeighted
    ? honoraires.marge_weighted_eur
    : honoraires.marge_flat_eur;
  const margeHonorairesPct = isWeighted
    ? honoraires.marge_weighted_pct
    : honoraires.marge_flat_pct;
  const chargesSalairesActives = isWeighted
    ? charges_salaires_weighted
    : charges_salaires_flat;
  const margeTotale = isWeighted
    ? summary.marge_totale_weighted_eur
    : summary.marge_totale_flat_eur;

  const margeTravauxEur = summary.travaux.marge_eur;
  const margeAchatsEur = summary.achats.marge_eur;

  // Variantes couleurs (canon : vert > 0, orange ~0, rouge < 0)
  const variantHonoraires = variantForMargin(margeHonoraires, Math.max(revenus, 1));
  const variantTravaux = variantForMargin(
    summary.travaux.marge_mad,
    Math.max(summary.travaux.forfait_vendu_mad, 1),
  );
  const variantAchats = variantForMargin(
    summary.achats.marge_mad,
    Math.max(summary.achats.forfait_vendu_mad, 1),
  );
  const variantTotal = variantForMargin(
    margeTotale,
    Math.max(revenus + margeTravauxEur + margeAchatsEur, 1),
  );

  return (
    <div className="space-y-6 max-w-7xl">
      <Link
        href={`/projects/${params.id}`}
        className="inline-flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black"
      >
        <ArrowLeft className="w-4 h-4" />
        Retour au projet {summary.project_reference}
      </Link>

      <PageHeader
        title="P&L projet"
        description={`${summary.project_reference} · ${summary.client_name ?? ''} — Consolidation honoraires + travaux + achats.`}
        action={
          <div className="flex items-center gap-3">
            <PLModeToggle mode={mode} />
            {canEditOverride && (
              <Link
                href="/settings/pl-config"
                className="inline-flex items-center gap-1 text-xs text-stoniz-gray-500 hover:text-stoniz-black"
                title="Configurer les coefficients globaux"
              >
                <Settings className="w-3.5 h-3.5" />
                Réglages P&L
              </Link>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="info">{formatPhase(summary.current_phase ?? '—')}</Badge>
        <Badge
          variant={
            summary.status === 'perdu'
              ? 'error'
              : summary.status === 'termine'
              ? 'success'
              : 'default'
          }
        >
          {summary.status ?? '—'}
        </Badge>
        <span className="text-stoniz-gray-500">
          Mode actif : <strong>{isWeighted ? 'Pondéré' : 'Plat'}</strong>{' '}
          {isWeighted
            ? '(prorata coefficients de phase)'
            : '(répartition uniforme par projet/mois)'}
        </span>
      </div>

      {/* ─── Section A — Synthèse marge totale ─────────────────────────── */}
      <DashboardSection
        title="Synthèse marge totale"
        description="Honoraires + Travaux (converti EUR @10) + Achats (converti EUR @10)"
      >
        <Card className={`border-l-4 ${
          variantTotal === 'success'
            ? 'border-l-green-600'
            : variantTotal === 'warning'
            ? 'border-l-orange-500'
            : variantTotal === 'danger'
            ? 'border-l-red-600'
            : 'border-l-stoniz-gray-300'
        }`}>
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
            <div>
              <div className="text-xs uppercase text-stoniz-gray-500 tracking-wide">
                Marge totale ({isWeighted ? 'pondéré' : 'plat'})
              </div>
              <div
                className={
                  'font-display text-4xl ' +
                  (margeTotale < 0
                    ? 'text-red-700'
                    : variantTotal === 'warning'
                    ? 'text-orange-600'
                    : 'text-stoniz-black')
                }
              >
                {formatMoney(margeTotale, 'EUR')}
              </div>
              <div className="text-xs text-stoniz-gray-500 mt-1">
                Mode alternatif :{' '}
                {formatMoney(
                  isWeighted
                    ? summary.marge_totale_flat_eur
                    : summary.marge_totale_weighted_eur,
                  'EUR',
                )}{' '}
                ({isWeighted ? 'plat' : 'pondéré'})
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs text-stoniz-gray-500">Honoraires</div>
                <div
                  className={
                    'font-display text-xl ' +
                    (margeHonoraires < 0 ? 'text-red-700' : 'text-stoniz-black')
                  }
                >
                  {formatMoney(margeHonoraires, 'EUR')}
                </div>
              </div>
              <div>
                <div className="text-xs text-stoniz-gray-500">Travaux (EUR)</div>
                <div
                  className={
                    'font-display text-xl ' +
                    (margeTravauxEur < 0 ? 'text-red-700' : 'text-stoniz-black')
                  }
                  title={`${formatMad(summary.travaux.marge_mad)}`}
                >
                  {formatMoney(margeTravauxEur, 'EUR')}
                </div>
                <div className="text-[11px] text-stoniz-gray-500">
                  {formatMad(summary.travaux.marge_mad)}
                </div>
              </div>
              <div>
                <div className="text-xs text-stoniz-gray-500">Achats (EUR)</div>
                <div
                  className={
                    'font-display text-xl ' +
                    (margeAchatsEur < 0 ? 'text-red-700' : 'text-stoniz-black')
                  }
                  title={`${formatMad(summary.achats.marge_mad)}`}
                >
                  {formatMoney(margeAchatsEur, 'EUR')}
                </div>
                <div className="text-[11px] text-stoniz-gray-500">
                  {formatMad(summary.achats.marge_mad)}
                </div>
              </div>
            </div>
          </div>
        </Card>
      </DashboardSection>

      {/* ─── Section B — P&L Honoraires (cabinet) ──────────────────────── */}
      <DashboardSection
        title="P&L Honoraires (cabinet Stoniz)"
        description="Revenus = acomptes encaissés. Charges directes = services (architecte, géomètre…). Charges indirectes = salaires équipe alloués."
      >
        <KpiGrid cols={4}>
          <KpiCard
            label="Revenus (5 acomptes)"
            value={formatMoney(revenus, 'EUR')}
            hint="Status paid + partial"
          />
          <KpiCard
            label="Charges services"
            value={formatMoney(charges_services, 'EUR')}
            hint="Architecte, géomètre, juridique…"
            variant={charges_services > 0 ? 'default' : 'default'}
          />
          <KpiCard
            label={`Charges salaires (${isWeighted ? 'pondéré' : 'plat'})`}
            value={formatMoney(chargesSalairesActives, 'EUR')}
            hint={`vs ${formatMoney(
              isWeighted ? charges_salaires_flat : charges_salaires_weighted,
              'EUR',
            )} en mode ${isWeighted ? 'plat' : 'pondéré'}`}
            variant="default"
          />
          <KpiCard
            label="Marge cabinet"
            value={formatMoney(margeHonoraires, 'EUR')}
            hint={`${margeHonorairesPct.toFixed(1)}% du revenu`}
            variant={variantHonoraires}
          />
        </KpiGrid>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-4 h-4 text-stoniz-gray-500" />
              Comment c'est calculé ?
            </CardTitle>
            <CardDescription>
              <strong>Pondéré</strong> — la masse salariale du mois est
              répartie entre les projets actifs au prorata du coefficient de
              leur phase (un projet en sourcing pèse moins qu'un projet en
              travaux). <strong>Plat</strong> — répartition uniforme entre
              tous les projets actifs ce mois-là, indépendamment de la phase.{' '}
              <Link
                href="/settings/pl-config"
                className="underline hover:text-stoniz-black"
              >
                Voir / modifier les coefficients →
              </Link>
            </CardDescription>
          </CardHeader>

          <CardContent className="pt-4 border-t border-grey-line">
            <h4 className="text-sm font-medium mb-1">
              Override projet — multiplicateur
            </h4>
            <p className="text-xs text-stoniz-gray-500 mb-3">
              Si ce projet a consommé plus (ou moins) de temps équipe que la
              moyenne, ajuste le multiplicateur. 1.0 = moyenne (pas
              d'override). Appliqué aux deux modes.
            </p>
            <PLOverrideForm
              projectId={summary.project_id}
              initialMultiplier={override?.weight_multiplier ?? null}
              initialNotes={override?.notes ?? null}
              canEdit={canEditOverride}
            />
          </CardContent>
        </Card>
      </DashboardSection>

      {/* ─── Section C — P&L Travaux ───────────────────────────────────── */}
      <DashboardSection
        title="P&L Travaux"
        description="Lots artisans — devise MAD."
      >
        <KpiGrid cols={4}>
          <KpiCard
            label="Forfait vendu"
            value={formatMad(summary.travaux.forfait_vendu_mad)}
            hint="Référence client (canon)"
          />
          <KpiCard
            label="Devis artisans"
            value={formatMad(summary.travaux.devis_artisans_mad)}
          />
          <KpiCard
            label="Marge travaux"
            value={formatMad(summary.travaux.marge_mad)}
            hint={`${summary.travaux.marge_pct.toFixed(1)}% (cible projet)`}
            variant={variantTravaux}
          />
          <KpiCard
            label="Trésorerie travaux"
            value={formatMad(summary.travaux.tresorerie_mad)}
            hint="Encaissé − Payé artisans"
            variant={summary.travaux.tresorerie_mad < 0 ? 'warning' : 'default'}
          />
        </KpiGrid>
        <div className="mt-2 text-right">
          <Link
            href={`/projects/${summary.project_id}/travaux`}
            className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline"
          >
            Voir le détail lots & paiements →
          </Link>
        </div>
      </DashboardSection>

      {/* ─── Section D — P&L Achats ────────────────────────────────────── */}
      <DashboardSection
        title="P&L Achats"
        description="Lots fournisseurs — devise MAD."
      >
        <KpiGrid cols={4}>
          <KpiCard
            label="Forfait vendu"
            value={formatMad(summary.achats.forfait_vendu_mad)}
            hint="Référence client (canon)"
          />
          <KpiCard
            label="Devis fournisseurs"
            value={formatMad(summary.achats.devis_fournisseurs_mad)}
          />
          <KpiCard
            label="Marge achats"
            value={formatMad(summary.achats.marge_mad)}
            hint={`${summary.achats.marge_pct.toFixed(1)}%`}
            variant={variantAchats}
          />
          <KpiCard
            label="Marge en EUR"
            value={formatMoney(summary.achats.marge_eur, 'EUR')}
            hint="MAD ÷ 10 (taux fixe)"
          />
        </KpiGrid>
        <div className="mt-2 text-right">
          <Link
            href={`/projects/${summary.project_id}/achats`}
            className="text-xs text-stoniz-gray-600 hover:text-stoniz-black underline"
          >
            Voir le détail lots fournisseurs →
          </Link>
        </div>
      </DashboardSection>
    </div>
  );
}
