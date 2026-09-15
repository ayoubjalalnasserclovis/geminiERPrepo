import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { getPLAllProjects, type PLProjectSummary } from '@/lib/finance/pl-project';
import { PageHeader } from '@/components/ui/page-header';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { SortableHeader } from '@/components/ui/sortable-header';
import {
  multi,
  single,
  search as parseSearch,
  sort as parseSort,
  escapeIlike,
  type SP,
} from '@/lib/list-filters/parse';
import { formatMoney, formatMad, formatPhase } from '@/lib/utils/format';
import { TrendingUp } from 'lucide-react';

/**
 * Dashboard P&L par projet — Phase B4 (CEO 2026-06-30).
 *
 * Vue transverse marges par projet. Réutilise getPLAllProjects (B1) qui
 * agrège honoraires (EUR) + travaux (MAD→EUR) + achats (MAD→EUR) + salaires
 * alloués (weighted ou flat).
 *
 * Filtres (URL state) :
 *   - mode = weighted | flat                 (toggle pondéré/plat)
 *   - phase = sourcing,design,travaux,…      (multi)
 *   - status = actif | termine | perdu | all (single ; défaut: tous sauf perdu)
 *   - client = <client_id>                   (single, dropdown)
 *   - q = recherche libre                    (référence + nom client)
 *   - sort = field, dir = asc|desc
 *
 * Permissions : ceo + finance + developer (lecture).
 *
 * Devise totaux : EUR (canon B1).
 */

export const dynamic = 'force-dynamic';

const PHASE_OPTIONS = [
  { v: 'sourcing',         label: 'Sourcing' },
  { v: 'design',           label: 'Design' },
  { v: 'travaux',          label: 'Travaux' },
  { v: 'livraison',        label: 'Livraison' },
  { v: 'mise_en_location', label: 'Mise en location' },
  { v: 'termine',          label: 'Terminé' },
];

const STATUS_OPTIONS = [
  { v: 'all',     label: 'Tous (sauf perdus)' },
  { v: 'actif',   label: 'Actifs' },
  { v: 'termine', label: 'Terminés' },
  { v: 'pause',   label: 'En pause' },
  { v: 'perdu',   label: 'Perdus uniquement' },
];

// ─── Helpers tri / filtres en mémoire ─────────────────────────────────────

type SortField =
  | 'client_name'
  | 'reference'
  | 'phase'
  | 'honoraires_revenus'
  | 'honoraires_marge'
  | 'travaux_marge'
  | 'achats_marge'
  | 'marge_totale'
  | 'marge_pct';

function pickMargeTotale(r: PLProjectSummary, mode: 'weighted' | 'flat'): number {
  return mode === 'weighted' ? r.marge_totale_weighted_eur : r.marge_totale_flat_eur;
}

function pickMargeHonoraires(r: PLProjectSummary, mode: 'weighted' | 'flat'): number {
  return mode === 'weighted'
    ? r.honoraires.marge_weighted_eur
    : r.honoraires.marge_flat_eur;
}

function pickMargePct(r: PLProjectSummary, mode: 'weighted' | 'flat'): number {
  const revenus = r.honoraires.revenus_eur;
  if (revenus <= 0) return 0;
  return Math.round((pickMargeTotale(r, mode) / revenus) * 1000) / 10;
}

function compareBy(
  a: PLProjectSummary,
  b: PLProjectSummary,
  field: SortField,
  mode: 'weighted' | 'flat',
): number {
  switch (field) {
    case 'client_name':         return (a.client_name ?? '').localeCompare(b.client_name ?? '');
    case 'reference':           return a.project_reference.localeCompare(b.project_reference);
    case 'phase':               return (a.current_phase ?? '').localeCompare(b.current_phase ?? '');
    case 'honoraires_revenus':  return a.honoraires.revenus_eur - b.honoraires.revenus_eur;
    case 'honoraires_marge':    return pickMargeHonoraires(a, mode) - pickMargeHonoraires(b, mode);
    case 'travaux_marge':       return a.travaux.marge_eur - b.travaux.marge_eur;
    case 'achats_marge':        return a.achats.marge_eur - b.achats.marge_eur;
    case 'marge_pct':           return pickMargePct(a, mode) - pickMargePct(b, mode);
    case 'marge_totale':
    default:                    return pickMargeTotale(a, mode) - pickMargeTotale(b, mode);
  }
}

function marginTone(value: number, pct: number): string {
  if (value < 0) return 'text-red-600 font-medium';
  if (pct < 10) return 'text-orange-600';
  return 'text-emerald-700';
}

// Pagination
const PAGE_SIZE = 50;

// ─── Page ──────────────────────────────────────────────────────────────────

export default async function PLProjectsDashboardPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(['ceo', 'finance', 'developer']);

  // ─── Parse URL state ─────────────────────────────────────────────────
  const modeRaw = single(searchParams, 'mode');
  const mode: 'weighted' | 'flat' = modeRaw === 'flat' ? 'flat' : 'weighted';

  const selectedPhases = multi(searchParams, 'phase');
  const statusRaw      = single(searchParams, 'status') ?? 'all';
  const clientId       = single(searchParams, 'client') ?? null;
  const q              = parseSearch(searchParams).toLowerCase();
  const { field: sortField, dir: sortDir } = parseSort(searchParams, 'marge_totale', 'desc');
  const pageRaw        = single(searchParams, 'page');
  const page           = Math.max(1, Number(pageRaw) || 1);

  // ─── Fetch ───────────────────────────────────────────────────────────
  // Tout filtré en mémoire : on récupère le set complet (helper B1 ne prend
  // qu'un seul statut/phase et notre filtre client utilise le nom). Volume
  // attendu (~150 projets) parfaitement OK pour cet usage.
  let allRows: PLProjectSummary[] = [];
  try {
    allRows = await getPLAllProjects({});
  } catch (e) {
    console.warn('[pl-projets] getPLAllProjects exception', e);
    allRows = [];
  }

  // ─── Application filtres en mémoire ───────────────────────────────────
  const totalUnfiltered = allRows.length;

  // Règle canon (mémoire stoniz_projects_perdu_exclusion) :
  // status='perdu' exclu par défaut. Affiché uniquement si statusRaw='perdu'.
  let filtered = allRows.filter((r) => {
    if (statusRaw === 'all') return !r.is_lost;
    if (statusRaw === 'perdu') return r.is_lost;
    return r.status === statusRaw;
  });

  // Phase (multi)
  if (selectedPhases.length > 0) {
    filtered = filtered.filter((r) =>
      r.current_phase ? selectedPhases.includes(r.current_phase) : false,
    );
  }

  // Client (filtre dropdown — clé = nom client)
  if (clientId) {
    filtered = filtered.filter((r) => r.client_name === clientId);
  }

  // Recherche full text
  if (q) {
    filtered = filtered.filter((r) => {
      const ref = (r.project_reference ?? '').toLowerCase();
      const cli = (r.client_name ?? '').toLowerCase();
      return ref.includes(q) || cli.includes(q);
    });
  }

  // Tri
  filtered.sort((a, b) => {
    const cmp = compareBy(a, b, sortField as SortField, mode);
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const totalAfterFilters = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalAfterFilters / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const startIdx = (currentPage - 1) * PAGE_SIZE;
  const pageRows = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  // ─── KPIs en-tête (sur l'ensemble filtré, pas la page) ────────────────
  const margeTotaleSum   = filtered.reduce((s, r) => s + pickMargeTotale(r, mode), 0);
  const revenusSum       = filtered.reduce((s, r) => s + r.honoraires.revenus_eur, 0);
  // Charges = revenus − marge totale → exprime services + salaires + (devis travaux+achats convertis)
  const chargesSum       = revenusSum - margeTotaleSum
                          + filtered.reduce(
                              (s, r) =>
                                s
                                + (r.travaux.forfait_vendu_mad / 10)
                                + (r.achats.forfait_vendu_mad / 10),
                              0,
                            );
  const profitableCount  = filtered.filter((r) => pickMargeTotale(r, mode) > 0).length;
  const deficitCount     = filtered.filter((r) => pickMargeTotale(r, mode) < 0).length;
  const margePctMoyenne  = revenusSum > 0
    ? Math.round((margeTotaleSum / revenusSum) * 1000) / 10
    : 0;

  // ─── Liste clients pour le filtre dropdown (depuis le set non filtré) ─
  const clientOptionsRaw: Array<{ v: string; label: string }> = [];
  const clientSeen = new Set<string>();
  for (const r of allRows) {
    if (!r.client_name) continue;
    const key = r.client_name;
    if (clientSeen.has(key)) continue;
    clientSeen.add(key);
    // On indexe par client_name faute d'id direct dans le summary.
    // Mais pour le filtre côté helper il nous faut un client_id : on bascule
    // donc en filtre mémoire-only sur client_name (cohérent avec recherche).
    clientOptionsRaw.push({ v: key, label: key });
  }
  clientOptionsRaw.sort((a, b) => a.label.localeCompare(b.label));

  // ─── Filtres déclaratifs ──────────────────────────────────────────────
  const filters: FilterDef[] = [
    { kind: 'multi', key: 'phase', label: 'Phase', options: PHASE_OPTIONS },
    { kind: 'single', key: 'status', label: 'Statut', options: STATUS_OPTIONS },
    { kind: 'single', key: 'client', label: 'Client', options: clientOptionsRaw },
  ];

  // ─── Rendu ────────────────────────────────────────────────────────────
  const otherMode = mode === 'weighted' ? 'flat' : 'weighted';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams ?? {})) {
    if (v == null) continue;
    sp.set(k, Array.isArray(v) ? v[0] ?? '' : String(v));
  }
  sp.set('mode', otherMode);
  const toggleHref = `/dashboard/pl-projets?${sp.toString()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="P&L par projet"
        description="Consolidation marges par projet — honoraires, travaux, achats, charges salariales allouées."
        action={
          <div className="inline-flex items-center gap-2">
            <Link
              href={toggleHref}
              scroll={false}
              className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-stoniz-gray-300 bg-white hover:bg-stoniz-gray-50"
              title="Bascule entre allocation salaires Pondérée (intensité ressentie) et Plate (1/N projets actifs)"
            >
              Mode :{' '}
              <strong className="ml-1">
                {mode === 'weighted' ? 'Pondéré' : 'Plat'}
              </strong>
              <span className="text-stoniz-gray-400">↔</span>
              <span className="text-stoniz-gray-500">
                {mode === 'weighted' ? 'Plat' : 'Pondéré'}
              </span>
            </Link>
          </div>
        }
      />

      {/* KPIs en-tête */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Marge portefeuille</div>
          <div className={`text-2xl font-display mt-1 ${margeTotaleSum < 0 ? 'text-red-600' : margeTotaleSum > 0 ? 'text-emerald-700' : ''}`}>
            {formatMoney(margeTotaleSum)}
          </div>
          <div className="text-[11px] text-stoniz-gray-400 mt-0.5">
            mode {mode === 'weighted' ? 'pondéré' : 'plat'}
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Marge moyenne %</div>
          <div className="text-2xl font-display mt-1">
            {margePctMoyenne.toFixed(1)}%
          </div>
          <div className="text-[11px] text-stoniz-gray-400 mt-0.5">sur revenus honoraires</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Projets profitables</div>
          <div className="text-2xl font-display mt-1 text-emerald-700">
            {profitableCount}
            <span className="text-sm text-stoniz-gray-400"> / {totalAfterFilters}</span>
          </div>
          <div className="text-[11px] text-orange-600 mt-0.5">
            {deficitCount} déficitaire{deficitCount > 1 ? 's' : ''}
          </div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Revenus encaissés</div>
          <div className="text-2xl font-display mt-1">{formatMoney(revenusSum)}</div>
          <div className="text-[11px] text-stoniz-gray-400 mt-0.5">honoraires payés (paid + partial)</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Charges totales</div>
          <div className="text-2xl font-display mt-1">{formatMoney(chargesSum)}</div>
          <div className="text-[11px] text-stoniz-gray-400 mt-0.5">
            services + salaires + devis (EUR)
          </div>
        </div>
      </div>

      <ListToolbar
        moduleKey="pl-projets"
        filters={filters}
        searchHint="Référence projet ou nom client… (⌘K)"
        count={{ filtered: totalAfterFilters, total: totalUnfiltered }}
        basePath="/dashboard/pl-projets"
      />

      {/* Tableau */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        {pageRows.length === 0 ? (
          <div className="p-10 text-center text-stoniz-gray-500 text-sm">
            Aucun projet ne correspond aux filtres.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-stoniz-gray-500 border-b">
                <tr>
                  <SortableHeader field="client_name" className="text-left py-2 px-3">
                    Projet
                  </SortableHeader>
                  <SortableHeader field="phase" className="text-left py-2 px-3">
                    Phase
                  </SortableHeader>
                  <SortableHeader field="honoraires_revenus" className="text-right py-2 px-3">
                    Honoraires revenus
                  </SortableHeader>
                  <SortableHeader field="honoraires_marge" className="text-right py-2 px-3">
                    Honoraires marge
                  </SortableHeader>
                  <SortableHeader field="travaux_marge" className="text-right py-2 px-3">
                    Travaux marge
                  </SortableHeader>
                  <SortableHeader field="achats_marge" className="text-right py-2 px-3">
                    Achats marge
                  </SortableHeader>
                  <SortableHeader field="marge_totale" className="text-right py-2 px-3">
                    Total marge
                  </SortableHeader>
                  <SortableHeader field="marge_pct" className="text-right py-2 px-3">
                    %
                  </SortableHeader>
                </tr>
              </thead>
              <tbody className="divide-y divide-stoniz-gray-100">
                {pageRows.map((r) => {
                  const margeTotale = pickMargeTotale(r, mode);
                  const margeHonoraires = pickMargeHonoraires(r, mode);
                  const margePct = pickMargePct(r, mode);
                  const totalTone = marginTone(margeTotale, margePct);
                  const drillHref = `/projects/${r.project_id}/pl?mode=${mode}`;
                  return (
                    <tr
                      key={r.project_id}
                      className="hover:bg-stoniz-gray-50 transition-colors"
                    >
                      <td className="py-2 px-3">
                        <Link href={drillHref} className="block hover:underline">
                          <div className="font-medium text-stoniz-black">
                            {r.client_name ?? <span className="italic text-stoniz-gray-500">Sans client</span>}
                          </div>
                          <div className="text-[11px] text-stoniz-gray-500 font-mono">
                            {r.project_reference}
                          </div>
                          {r.is_lost && (
                            <span className="inline-block mt-0.5 text-[10px] uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-700">
                              Perdu
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="py-2 px-3 text-stoniz-gray-700">
                        {r.current_phase ? formatPhase(r.current_phase) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">
                        {formatMoney(r.honoraires.revenus_eur)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right ${
                          margeHonoraires < 0 ? 'text-red-600' : 'text-stoniz-gray-700'
                        }`}
                      >
                        {formatMoney(margeHonoraires)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right ${
                          r.travaux.marge_eur < 0 ? 'text-red-600' : 'text-stoniz-gray-700'
                        }`}
                        title={`${formatMad(r.travaux.marge_mad)} (${r.travaux.marge_pct.toFixed(1)}%)`}
                      >
                        {formatMoney(r.travaux.marge_eur)}
                      </td>
                      <td
                        className={`py-2 px-3 text-right ${
                          r.achats.marge_eur < 0 ? 'text-red-600' : 'text-stoniz-gray-700'
                        }`}
                        title={`${formatMad(r.achats.marge_mad)} (${r.achats.marge_pct.toFixed(1)}%)`}
                      >
                        {formatMoney(r.achats.marge_eur)}
                      </td>
                      <td className={`py-2 px-3 text-right font-medium ${totalTone}`}>
                        {formatMoney(margeTotale)}
                      </td>
                      <td className={`py-2 px-3 text-right ${totalTone}`}>
                        {margePct.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Pied de tableau : total sur la page filtrée complète, pas la page courante */}
              <tfoot className="bg-stoniz-gray-50 border-t">
                <tr className="text-xs uppercase">
                  <td className="py-2 px-3 text-stoniz-gray-600" colSpan={2}>
                    Total filtré ({totalAfterFilters} projet{totalAfterFilters > 1 ? 's' : ''})
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {formatMoney(revenusSum)}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {formatMoney(
                      filtered.reduce((s, r) => s + pickMargeHonoraires(r, mode), 0),
                    )}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {formatMoney(filtered.reduce((s, r) => s + r.travaux.marge_eur, 0))}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {formatMoney(filtered.reduce((s, r) => s + r.achats.marge_eur, 0))}
                  </td>
                  <td
                    className={`py-2 px-3 text-right font-semibold ${
                      margeTotaleSum < 0 ? 'text-red-600' : margeTotaleSum > 0 ? 'text-emerald-700' : ''
                    }`}
                  >
                    {formatMoney(margeTotaleSum)}
                  </td>
                  <td className="py-2 px-3 text-right font-medium">
                    {margePctMoyenne.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          searchParams={searchParams}
        />
      )}

      <div className="text-[11px] text-stoniz-gray-400 italic">
        <TrendingUp className="w-3 h-3 inline mr-1" />
        Cliquez sur une ligne pour ouvrir le détail P&L du projet. Mode actif :{' '}
        <strong>{mode === 'weighted' ? 'pondéré' : 'plat'}</strong>.
      </div>
    </div>
  );
}

// ─── Sous-composants ───────────────────────────────────────────────────────

function Pagination({
  currentPage,
  totalPages,
  searchParams,
}: {
  currentPage: number;
  totalPages: number;
  searchParams: SP;
}) {
  function hrefFor(page: number): string {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams ?? {})) {
      if (v == null || k === 'page') continue;
      params.set(k, Array.isArray(v) ? v[0] ?? '' : String(v));
    }
    if (page > 1) params.set('page', String(page));
    const qs = params.toString();
    return qs ? `/dashboard/pl-projets?${qs}` : '/dashboard/pl-projets';
  }

  return (
    <div className="flex items-center justify-center gap-2 text-sm">
      {currentPage > 1 && (
        <Link
          href={hrefFor(currentPage - 1)}
          scroll={false}
          className="px-3 py-1.5 border border-stoniz-gray-300 rounded-md hover:bg-stoniz-gray-50"
        >
          ← Précédent
        </Link>
      )}
      <span className="text-stoniz-gray-600">
        Page <strong>{currentPage}</strong> / {totalPages}
      </span>
      {currentPage < totalPages && (
        <Link
          href={hrefFor(currentPage + 1)}
          scroll={false}
          className="px-3 py-1.5 border border-stoniz-gray-300 rounded-md hover:bg-stoniz-gray-50"
        >
          Suivant →
        </Link>
      )}
    </div>
  );
}

// Silencieux : escapeIlike importé pour future extension SQL.
void escapeIlike;
