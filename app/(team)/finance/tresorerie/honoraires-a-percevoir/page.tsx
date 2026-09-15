import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { Download, TrendingUp, Layers, Building2, Handshake, PauseCircle, CheckCircle2 } from 'lucide-react';
import { collectFeesAVenir, type ProjectFeesAVenir, type FeesBucketTotals } from '@/lib/finance/stoniz-fees-a-venir';
import { formatPhase } from '@/lib/utils/format';
import { HonorairesConfirmedToggle } from '@/components/finance/honoraires-confirmed-toggle';
import { MilestoneForecastMonthInput } from '@/components/finance/milestone-forecast-month-input';
import { ForecastMonthTable } from '@/components/finance/forecast-month-table';

/**
 * Page "Honoraires à percevoir" (CEO 2026-08-17).
 *
 * Pipeline honoraires Stoniz FUTUR : pour chaque projet non-perdu et non-livré,
 * on montre le reste à encaisser (forfait_reel − déjà encaissé), ligne par
 * milestone. La BDD (amount_expected + amount_paid) est source de vérité ;
 * le barème n'intervient que pour les milestones jamais déclenchés.
 *
 * CEO 2026-08-17b : 2 buckets séparés pour ne pas gonfler le pipeline —
 *   1. ACTIF  : chantiers en cours, pilotage principal
 *   2. PAUSE  : projets gelés, section repliée en bas avec ses propres totaux
 *
 * Accès : CEO + finance.
 */

function fmtEur(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' €';
}

const MILESTONE_STATUS_LABEL: Record<string, { label: string; className: string }> = {
  futur_pur: { label: 'Futur', className: 'bg-stoniz-gray-100 text-stoniz-gray-700' },
  planifie:  { label: 'Planifié', className: 'bg-blue-100 text-blue-700' },
  partiel:   { label: 'Partiel', className: 'bg-amber-100 text-amber-800' },
};

export default async function HonorairesAPercevoirPage() {
  await requireRole(['ceo', 'finance']);
  const data = await collectFeesAVenir();

  return (
    <div className="max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/finance/tresorerie" className="hover:text-stoniz-black">Trésorerie</Link> · Honoraires à percevoir
          </div>
          <h1 className="text-2xl md:text-3xl font-display">Honoraires à percevoir</h1>
          <p className="text-sm text-stoniz-gray-600 mt-1 max-w-3xl">
            Pipeline honoraires Stoniz : reste à encaisser par projet, calculé ligne par ligne
            depuis la BDD. Les projets en pause sont séparés en bas pour ne pas gonfler le
            pipeline actif.
          </p>
        </div>
        <a
          href="/api/finance/tresorerie/honoraires-a-percevoir/export"
          className="inline-flex items-center gap-1.5 border border-stoniz-gray-300 bg-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50 self-start"
          title="Télécharger le pipeline complet (actifs + pause) en CSV"
        >
          <Download className="w-4 h-4" />
          Exporter CSV
        </a>
      </div>

      {/* Rappel coaching exclus */}
      {data.nb_coaching_excluded > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <Handshake className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div>
            <strong>{data.nb_coaching_excluded} projet{data.nb_coaching_excluded > 1 ? 's' : ''} coaching</strong>{' '}
            {data.nb_coaching_excluded > 1 ? 'sont exclus' : 'est exclu'} de cette vue (forfait 5 000 € hors canon 21 000 €).
            Change le type sur la fiche projet si besoin (badge en haut de la fiche).
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECTION ACTIFS — coeur du pipeline                                   */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      <FeesBucketSection
        title="Pipeline actif"
        subtitle="Projets en cours (status = actif)"
        totals={data.active.totals}
        projects={data.active.projects}
        highlight
      />

      {/* ═══════════════════════════════════════════════════════════════════ */}
      {/* SECTION PAUSE — chantiers gelés, à côté                             */}
      {/* ═══════════════════════════════════════════════════════════════════ */}
      {data.paused.projects.length > 0 && (
        <details className="mt-10 group" open>
          <summary className="cursor-pointer flex items-center gap-2 text-sm text-stoniz-gray-600 hover:text-stoniz-black mb-3">
            <PauseCircle className="w-4 h-4" />
            <span className="font-medium">
              {data.paused.projects.length} projet{data.paused.projects.length > 1 ? 's' : ''} en pause
              {' · '}
              <span className="text-stoniz-gray-500">
                {fmtEur(data.paused.totals.total_reste_global)} en attente
              </span>
            </span>
            <span className="text-[10px] text-stoniz-gray-400 group-open:hidden">(cliquer pour déplier)</span>
          </summary>
          <div className="mt-4">
            <FeesBucketSection
              title="Projets en pause"
              subtitle="Chantiers gelés — pas d'encaissement attendu à court terme"
              totals={data.paused.totals}
              projects={data.paused.projects}
            />
          </div>
        </details>
      )}

      <p className="text-[11px] text-stoniz-gray-500 mt-6">
        💡 <strong>Comment on calcule :</strong> pour chaque milestone, le montant à percevoir vient
        de la BDD (<code>amount_expected − amount_paid</code>) si la ligne existe, sinon du barème
        (avec réduction éventuelle au prorata sur les milestones manquants). Les projets
        <code> status = pause</code> vont dans leur section dédiée. Les <code>status = perdu</code>
        et phase <code>terminé</code> sont exclus. Coaching aussi (5 000 € forfaitaire hors canon).
      </p>
    </div>
  );
}

// ─── Composant section réutilisable pour actif et pause ────────────────────

function FeesBucketSection({
  title, subtitle, totals, projects, highlight,
}: {
  title: string;
  subtitle: string;
  totals: FeesBucketTotals;
  projects: ProjectFeesAVenir[];
  highlight?: boolean;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="font-display text-lg">{title}</h2>
        <p className="text-xs text-stoniz-gray-500">{subtitle}</p>
      </div>

      {/* KPIs — pipeline complet + pipeline confirmé côte à côte.
          Note : .font-display en global force color:var(--black) — on override
          explicitement text-white sur les KPI à fond sombre pour être lisibles. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className={highlight ? 'bg-stoniz-black rounded-lg p-4' : 'bg-white border border-stoniz-gray-200 rounded-lg p-4'}>
          <TrendingUp className={`w-4 h-4 mb-2 ${highlight ? 'text-white/80' : 'text-stoniz-gray-500'}`} />
          <div className={`text-2xl font-display ${highlight ? '!text-white' : ''}`}>{fmtEur(totals.total_reste_global)}</div>
          <div className={`text-xs ${highlight ? 'text-white/80' : 'text-stoniz-gray-600'}`}>
            Pipeline complet ({totals.nb_projects})
          </div>
        </div>
        <div className="bg-emerald-900 rounded-lg p-4">
          <CheckCircle2 className="w-4 h-4 text-white/80 mb-2" />
          <div className="text-2xl font-display !text-white">{fmtEur(totals.confirmed.total_reste_global)}</div>
          <div className="text-xs text-white/80">
            CA confirmé ({totals.confirmed.nb_projects})
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Building2 className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-2xl font-display">{totals.nb_projects}</div>
          <div className="text-xs text-stoniz-gray-600">Projets</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Layers className="w-4 h-4 text-stoniz-gray-500 mb-2" />
          <div className="text-2xl font-display">{fmtEur(totals.total_forfait_reel)}</div>
          <div className="text-xs text-stoniz-gray-600">Forfait cumulé</div>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
          <TrendingUp className="w-4 h-4 text-emerald-600 mb-2" />
          <div className="text-2xl font-display !text-emerald-900">{fmtEur(totals.total_deja_encaisse)}</div>
          <div className="text-xs text-emerald-700">Déjà encaissé</div>
        </div>
      </div>

      {/* Prévisions par mois (si au moins un forecast saisi dans ce bucket) —
          tableau cliquable : chaque mois déplie le détail de ses milestones. */}
      {totals.by_forecast_month.length > 0 && (
        <ForecastMonthTable months={totals.by_forecast_month} />
      )}

      {/* Répartitions par milestone / phase */}
      {projects.length > 0 && (
        <div className="grid md:grid-cols-2 gap-6 mb-6">
          <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
            <h3 className="font-display text-base mb-3">Par milestone</h3>
            {totals.by_milestone.length === 0 ? (
              <p className="text-sm text-stoniz-gray-500">Aucun milestone à venir.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2">Milestone</th>
                    <th className="text-right py-2">Projets</th>
                    <th className="text-right py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {totals.by_milestone.map(m => (
                    <tr key={m.type}>
                      <td className="py-2">{m.label}</td>
                      <td className="text-right py-2 text-stoniz-gray-600">{m.count_projects}</td>
                      <td className="text-right py-2 font-medium">{fmtEur(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="bg-white border border-stoniz-gray-200 rounded-xl p-5">
            <h3 className="font-display text-base mb-3">Par phase courante</h3>
            {totals.by_phase.length === 0 ? (
              <p className="text-sm text-stoniz-gray-500">Aucune phase renseignée.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                  <tr>
                    <th className="text-left py-2">Phase</th>
                    <th className="text-right py-2">Projets</th>
                    <th className="text-right py-2">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {totals.by_phase.map(p => (
                    <tr key={p.phase}>
                      <td className="py-2">{formatPhase(p.phase)}</td>
                      <td className="text-right py-2 text-stoniz-gray-600">{p.count_projects}</td>
                      <td className="text-right py-2 font-medium">{fmtEur(p.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Tableau détail */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-stoniz-gray-200 flex items-center justify-between">
          <h3 className="font-display text-base">Détail par projet ({projects.length})</h3>
          <div className="text-[11px] text-stoniz-gray-500 flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-stoniz-gray-300"></span> Futur
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-400"></span> Planifié
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span> Partiel
            </span>
          </div>
        </div>
        {projects.length === 0 ? (
          <div className="px-5 py-10 text-center text-sm text-stoniz-gray-500">
            {highlight ? 'Aucun projet actif avec des honoraires à percevoir.' : 'Aucun projet dans ce bucket.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
                <tr>
                  <th className="text-left px-3 py-2">Projet</th>
                  <th className="text-left px-3 py-2">Client</th>
                  <th className="text-left px-3 py-2">Phase</th>
                  <th className="text-center px-3 py-2">Confiance</th>
                  <th className="text-right px-3 py-2">Forfait</th>
                  <th className="text-right px-3 py-2">Encaissé</th>
                  <th className="text-right px-3 py-2">Reste</th>
                  <th className="text-left px-3 py-2">Milestones à venir</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stoniz-gray-100">
                {projects.map(p => (
                  <tr key={p.project_id} className={`hover:bg-stoniz-gray-50 ${p.honoraires_confirmed ? 'bg-emerald-50/40' : ''}`}>
                    <td className="px-3 py-2 text-xs whitespace-nowrap">
                      <Link href={`/projects/${p.project_id}/payments`} className="text-blue-600 hover:underline">
                        {p.reference}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-xs">{p.client_name}</td>
                    <td className="px-3 py-2 text-xs">{formatPhase(p.current_phase ?? '')}</td>
                    <td className="px-3 py-2 text-center">
                      <HonorairesConfirmedToggle
                        projectId={p.project_id}
                        initialConfirmed={p.honoraires_confirmed}
                      />
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {fmtEur(p.forfait_reel)}
                      {p.reduction > 0 && (
                        <div className="text-[10px] text-orange-700">(réduc. {fmtEur(p.reduction)})</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-emerald-700">{fmtEur(p.deja_encaisse)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtEur(p.reste_global)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        {p.milestones_a_venir.map(m => {
                          const s = MILESTONE_STATUS_LABEL[m.status];
                          return (
                            <div
                              key={m.type}
                              className={`inline-flex flex-col gap-1 text-[10px] px-2 py-1 rounded ${s.className}`}
                              title={`${m.label} · ${s.label} · barème ${fmtEur(m.bareme_amount)}${m.due_date ? ` · échéance ${m.due_date}` : ''}`}
                            >
                              <span className="font-medium">{m.label.split(' ')[0]}</span>
                              <span className="font-mono">{fmtEur(m.amount_a_percevoir)}</span>
                              <MilestoneForecastMonthInput
                                projectId={p.project_id}
                                milestoneType={m.type}
                                initialMonth={m.forecast_month}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
