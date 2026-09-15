import Link from 'next/link';
import { BarChart3, Sliders, Users2, AlertTriangle, Info } from 'lucide-react';
import { requireRole } from '@/lib/auth/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  getPhaseWeights,
  getTargetPayrolls,
  getProjectOverrides,
} from '@/lib/finance/pl-settings';
import { getActualPayrollByMonth } from '@/lib/finance/salary-allocation';
import { PhaseWeightRow } from './phase-weight-row';
import { TargetPayrollRow } from './target-payroll-row';
import {
  ProjectOverridesPanel,
  type ProjectOption,
  type OverrideRow,
} from './project-overrides-panel';

/**
 * Page de configuration P&L (CEO 2026-06-30 Phase B2).
 *
 * 3 sections :
 *   1. Coefficients de phase (pl_phase_weights)
 *   2. Masse salariale cible mensuelle (pl_target_payroll_monthly)
 *   3. Overrides par projet (project_pl_overrides)
 *
 * Permissions :
 *   - CEO + finance : écriture
 *   - developer : lecture seule
 */

export const dynamic = 'force-dynamic';

// ─── Métadonnées des phases (libellés + tooltips) ───────────────────────────

const PHASE_META: Record<string, { label: string; description: string }> = {
  onboarding: {
    label: 'Onboarding',
    description:
      'Démarrage projet : signature contrat, acompte Stoniz, ouverture dossier. Faible charge équipe.',
  },
  sourcing: {
    label: 'Sourcing',
    description:
      'Recherche du bien, négociation, attente banque/notaire — équipe peu impliquée.',
  },
  design: {
    label: 'Design',
    description:
      'Plans 3D, validation client, sélection matériaux — phase intermédiaire.',
  },
  travaux: {
    label: 'Travaux',
    description:
      'Chantier intense, visites quotidiennes, validation devis, gestion artisans — phase la plus dévoreuse.',
  },
  livraison: {
    label: 'Livraison',
    description:
      'Réception client, photos pro, mise en location.',
  },
  mise_en_location: {
    label: 'Mise en location',
    description: 'SAV initial, réglages Airbnb.',
  },
  termine: {
    label: 'Terminé',
    description:
      "Projet livré, plus d'activité équipe (Propria prend le relais).",
  },
};

// Ordre canonique d'affichage (cohérent avec le cycle de vie projet).
const PHASE_ORDER = [
  'onboarding',
  'sourcing',
  'design',
  'travaux',
  'livraison',
  'mise_en_location',
  'termine',
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmtEur(v: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(v);
}

function monthLabel(month: string): string {
  // month = YYYY-MM
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, (m ?? 1) - 1, 1));
  return d.toLocaleDateString('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function lastNMonths(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 0; i < n; i++) {
    const y = cur.getUTCFullYear();
    const m = (cur.getUTCMonth() + 1).toString().padStart(2, '0');
    out.unshift(`${y}-${m}`);
    cur.setUTCMonth(cur.getUTCMonth() - 1);
  }
  return out;
}

function nextMonth(): string {
  const now = new Date();
  const cur = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  const y = cur.getUTCFullYear();
  const m = (cur.getUTCMonth() + 1).toString().padStart(2, '0');
  return `${y}-${m}`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default async function PLConfigPage() {
  const me = await requireRole(['ceo', 'finance', 'developer']);
  const readOnly = me.role === 'developer';
  const admin = createAdminClient();

  // ─── Charge les données ─────────────────────────────────────────────────
  const months12 = lastNMonths(12);
  const fromMonth = months12[0];
  const toMonth = months12[months12.length - 1];

  const [phaseWeights, targets, overrides, actualPayrolls] = await Promise.all([
    getPhaseWeights(),
    getTargetPayrolls(fromMonth, toMonth),
    getProjectOverrides(),
    getActualPayrollByMonth({ fromMonth, toMonth }),
  ]);

  // Indexer pour fusion en O(1)
  const weightByPhase = new Map(phaseWeights.map((w) => [w.phase, w.weight]));
  const targetByMonth = new Map(targets.map((t) => [t.month, t.amount_eur]));
  const actualByMonth = new Map(actualPayrolls.map((a) => [a.month, a.amount_eur]));

  // ─── Projets pour la combobox + hydratation des overrides ───────────────
  // Projets actifs (status != perdu/termine + hors préparation).
  const { data: projectsRaw } = await admin
    .from('projects')
    .select('id, reference, current_phase, status, is_preparation, client:clients(first_name, last_name)')
    .is('deleted_at', null)
    .or('is_preparation.is.null,is_preparation.eq.false')
    .order('reference');

  const projectsAll: Array<{
    id: string;
    reference: string;
    current_phase: string | null;
    status: string | null;
    client_name: string | null;
  }> = ((projectsRaw as any[]) ?? []).map((p) => ({
    id: p.id,
    reference: p.reference ?? '',
    current_phase: p.current_phase ?? null,
    status: p.status ?? null,
    client_name: p.client
      ? `${p.client.first_name ?? ''} ${p.client.last_name ?? ''}`.trim() || null
      : null,
  }));

  const projectsById = new Map(projectsAll.map((p) => [p.id, p]));

  // Projets "actifs" (pour la combobox) : exclure perdu/termine.
  const allActiveProjects: ProjectOption[] = projectsAll
    .filter((p) => p.status !== 'perdu' && p.status !== 'termine')
    .map((p) => ({
      id: p.id,
      reference: p.reference,
      client_name: p.client_name,
      current_phase: p.current_phase,
    }));

  const overrideRows: OverrideRow[] = overrides.map((o) => {
    const proj = projectsById.get(o.project_id);
    return {
      project_id: o.project_id,
      multiplier: o.weight_multiplier,
      notes: o.notes,
      reference: proj?.reference ?? '(projet supprimé)',
      client_name: proj?.client_name ?? null,
      current_phase: proj?.current_phase ?? null,
    };
  });

  // ─── Exemple live : projets actifs du mois courant ──────────────────────
  // On reconstruit un mini-calcul pour la phrase d'exemple.
  // Phase travaux vs sourcing — coût/mois pour le mois courant.
  const nowMonth = months12[months12.length - 1];
  const lastActualMonth = actualPayrolls.length > 0
    ? actualPayrolls[actualPayrolls.length - 1]
    : null;

  // Compteurs par phase parmi projets actifs (pour l'exemple)
  const phaseCounts = new Map<string, number>();
  let nbActive = 0;
  for (const p of projectsAll) {
    if (p.status === 'perdu' || p.status === 'termine') continue;
    nbActive++;
    const ph = p.current_phase ?? 'sourcing';
    phaseCounts.set(ph, (phaseCounts.get(ph) ?? 0) + 1);
  }

  // Somme des poids actifs
  let sumWeights = 0;
  for (const [ph, n] of phaseCounts) {
    sumWeights += (weightByPhase.get(ph) ?? 1) * n;
  }
  const exampleMonthPayroll = lastActualMonth?.amount_eur ?? 0;
  const wTravaux = weightByPhase.get('travaux') ?? 1;
  const wSourcing = weightByPhase.get('sourcing') ?? 1;
  const costTravaux =
    sumWeights > 0 ? (wTravaux / sumWeights) * exampleMonthPayroll : 0;
  const costSourcing =
    sumWeights > 0 ? (wSourcing / sumWeights) * exampleMonthPayroll : 0;

  // ─── Stats masse salariale ──────────────────────────────────────────────
  const last6 = months12.slice(-6);
  const last6Actuals = last6
    .map((m) => actualByMonth.get(m) ?? 0)
    .filter((v) => v > 0);
  const avg6 =
    last6Actuals.length > 0
      ? last6Actuals.reduce((s, v) => s + v, 0) / last6Actuals.length
      : 0;
  const totalAnnual = months12.reduce(
    (s, m) => s + (actualByMonth.get(m) ?? 0),
    0,
  );

  const next = nextMonth();
  const hasNextTarget = targetByMonth.has(next);

  // ─── Rendu ──────────────────────────────────────────────────────────────
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="P&L — Configuration"
        description={
          <span>
            Coefficients d'allocation salaires, cibles de masse salariale et
            overrides projet. Modifications appliquées immédiatement à tous
            les calculs P&L (<Link href="/dashboard/financier" className="underline">dashboard financier</Link>).
          </span>
        }
      />

      {readOnly && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3 text-sm flex items-start gap-2">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div>
            <strong>Mode lecture seule</strong> — ton rôle (developer) peut
            consulter mais pas modifier ces réglages.
          </div>
        </div>
      )}

      {/* ─── Section 1 : Coefficients de phase ─────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Sliders className="w-5 h-5 text-stoniz-gray-600" />
            1. Coefficients de phase
          </CardTitle>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            Pondère l'allocation de la masse salariale selon la phase d'un
            projet. Plus le coefficient est élevé, plus le projet "consomme"
            de masse salariale ce mois-là.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-stoniz-gray-500 border-b border-stoniz-gray-200">
                  <th className="py-2 pr-4 font-medium">Phase</th>
                  <th className="py-2 pr-4 font-medium">Coefficient actuel</th>
                  <th className="py-2 pr-4 font-medium">Modifier</th>
                </tr>
              </thead>
              <tbody>
                {PHASE_ORDER.map((phase) => {
                  const meta = PHASE_META[phase] ?? {
                    label: phase,
                    description: '—',
                  };
                  const w = weightByPhase.get(phase) ?? 1.0;
                  return (
                    <PhaseWeightRow
                      key={phase}
                      phase={phase}
                      label={meta.label}
                      description={meta.description}
                      currentWeight={w}
                      readOnly={readOnly}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-3 mt-4 text-sm">
            <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-1">
              Exemple — {monthLabel(nowMonth)}
            </div>
            {nbActive === 0 || exampleMonthPayroll <= 0 ? (
              <p className="text-stoniz-gray-500 italic">
                Aucun projet actif ou aucune masse salariale enregistrée ce
                mois-ci — l'exemple sera disponible dès qu'il y aura de la
                donnée.
              </p>
            ) : (
              <p className="text-stoniz-gray-700">
                Avec ces coefficients, sur {nbActive} projet
                {nbActive > 1 ? 's' : ''} actif{nbActive > 1 ? 's' : ''} et une
                masse salariale réelle de{' '}
                <strong>{fmtEur(exampleMonthPayroll)}</strong> :
              </p>
            )}
            {nbActive > 0 && exampleMonthPayroll > 0 && (
              <ul className="mt-2 space-y-1 text-stoniz-gray-700 text-sm">
                <li>
                  → Un projet en <strong>travaux</strong> coûterait{' '}
                  <strong className="font-mono">{fmtEur(costTravaux)}/mois</strong>
                </li>
                <li>
                  → Un projet en <strong>sourcing</strong> coûterait{' '}
                  <strong className="font-mono">{fmtEur(costSourcing)}/mois</strong>
                </li>
              </ul>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ─── Section 2 : Masse salariale cible ──────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-stoniz-gray-600" />
            2. Masse salariale cible mensuelle
          </CardTitle>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            Comparaison du réalisé (catégorisations bancaires{' '}
            <code className="text-xs">cabinet_charge</code>,{' '}
            <code className="text-xs">cabinet_fiscal</code>,{' '}
            <code className="text-xs">cabinet_social</code>) avec la cible
            saisie. Sert à piloter le P&L à 5 % près.
          </p>
        </CardHeader>
        <CardContent>
          {/* KPIs agrégés */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
            <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500">
                Moyenne 6 mois (réel)
              </div>
              <div className="text-xl font-display mt-0.5">
                {avg6 > 0 ? fmtEur(avg6) : '—'}
              </div>
            </div>
            <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500">
                Total 12 mois (réel)
              </div>
              <div className="text-xl font-display mt-0.5">
                {totalAnnual > 0 ? fmtEur(totalAnnual) : '—'}
              </div>
            </div>
            <div className="bg-stoniz-gray-50 border border-stoniz-gray-200 rounded-md p-3">
              <div className="text-[11px] uppercase tracking-wider text-stoniz-gray-500">
                Mois prochain
              </div>
              <div className="text-sm mt-0.5">
                {hasNextTarget ? (
                  <span className="text-emerald-700">
                    {monthLabel(next)} :{' '}
                    <strong>{fmtEur(targetByMonth.get(next) ?? 0)}</strong>
                  </span>
                ) : (
                  <span className="text-orange-600 inline-flex items-center gap-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Cible non saisie ({monthLabel(next)})
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-stoniz-gray-500 border-b border-stoniz-gray-200">
                  <th className="py-2 pr-4 font-medium">Mois</th>
                  <th className="py-2 pr-4 font-medium">Réalisé</th>
                  <th className="py-2 pr-4 font-medium">Cible (EUR)</th>
                  <th className="py-2 pr-4 font-medium">Écart</th>
                </tr>
              </thead>
              <tbody>
                {/* Affiche les 12 derniers mois + le mois prochain pour saisie. */}
                {[...months12, next].map((m) => (
                  <TargetPayrollRow
                    key={m}
                    month={m}
                    monthLabel={monthLabel(m)}
                    actualEur={actualByMonth.get(m) ?? 0}
                    targetEur={targetByMonth.get(m) ?? null}
                    readOnly={readOnly}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-stoniz-gray-500 italic mt-3">
            Écart = Réalisé − Cible. Orange si tu dépasses la cible (dérapage
            à expliquer), vert si tu es sous la cible.
          </p>
        </CardContent>
      </Card>

      {/* ─── Section 3 : Overrides projet ────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-2">
            <Users2 className="w-5 h-5 text-stoniz-gray-600" />
            3. Overrides par projet
          </CardTitle>
          <p className="text-sm text-stoniz-gray-600 mt-1">
            Ajustement individuel pour un projet où l'allocation par phase
            ne reflète pas la réalité (projet chronophage ou très léger).
            Ex : un projet où vous avez consommé 1,8× le temps moyen →
            multiplicateur <strong>1,8</strong>. Multiplicateur appliqué{' '}
            <em>en plus</em> du coefficient de phase.
          </p>
        </CardHeader>
        <CardContent>
          <ProjectOverridesPanel
            overrides={overrideRows}
            allActiveProjects={allActiveProjects}
            readOnly={readOnly}
          />
        </CardContent>
      </Card>
    </div>
  );
}
