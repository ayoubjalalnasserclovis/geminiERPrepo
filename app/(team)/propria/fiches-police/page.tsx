import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import {
  POLICE_RECORDS_TABLE,
  type PoliceRecord,
} from '@/lib/propria/police-records';
import { PoliceRecordBadge } from '@/components/propria/police-record-badge';
import { WeeklyRecapDownloadButton } from './weekly-recap-button';

// Filtres simples par URL state — pas de form, juste des Link.
const STATUS_LABELS: Record<string, string> = {
  draft: 'Brouillons',
  complete: 'Complètes',
  submitted: 'Soumises',
  archived: 'Archivées',
};

function startOfWeek(d = new Date()): string {
  const day = d.getUTCDay();
  // Lundi comme premier jour (1) — décalage : si dimanche (0), reculer 6 j
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return monday.toISOString().slice(0, 10);
}

function startOfMonth(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function endOfMonth(d = new Date()): string {
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return end.toISOString().slice(0, 10);
}

export default async function FichesPoliceListPage({
  searchParams,
}: {
  searchParams: { status?: string; periode?: string; from?: string; to?: string };
}) {
  const user = await requireRole(['ceo', 'propria', 'assistante', 'developer']);
  const supabase = createClient();
  const isReadonly = user.role === 'developer';

  // Filtre période arrivée (par défaut : tout)
  let dateFrom: string | null = null;
  let dateTo: string | null = null;
  if (searchParams.periode === 'semaine') {
    dateFrom = startOfWeek();
    const end = new Date(dateFrom + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 6);
    dateTo = end.toISOString().slice(0, 10);
  } else if (searchParams.periode === 'mois') {
    dateFrom = startOfMonth();
    dateTo = endOfMonth();
  } else if (searchParams.periode === 'custom') {
    dateFrom = searchParams.from ?? null;
    dateTo = searchParams.to ?? null;
  }

  let query = supabase
    .from(POLICE_RECORDS_TABLE)
    .select('id, status, data_source, head_first_name, head_last_name, total_persons_count, arrival_date_property, property_id, propria_unit_id, created_at')
    .is('deleted_at', null)
    .order('arrival_date_property', { ascending: false, nullsFirst: false });

  if (searchParams.status && STATUS_LABELS[searchParams.status]) {
    query = query.eq('status', searchParams.status);
  }
  if (dateFrom) query = query.gte('arrival_date_property', dateFrom);
  if (dateTo) query = query.lte('arrival_date_property', dateTo);

  // KPI compteurs sur la table entière (jamais filtrés par UI)
  const [listRes, kpiRes, propsRes, unitsRes] = await Promise.all([
    query.limit(500),
    supabase
      .from(POLICE_RECORDS_TABLE)
      .select('status')
      .is('deleted_at', null),
    supabase
      .from('properties')
      .select('id, name, propria_internal_code')
      .is('deleted_at', null),
    supabase
      .from('propria_units')
      .select('id, code, order_index')
      .is('deleted_at', null),
  ]);

  const rows = (listRes.data ?? []) as Partial<PoliceRecord>[];
  const propsMap = new Map(
    (propsRes.data ?? []).map((p: any) => [p.id as string, (p.propria_internal_code ?? p.name) as string]),
  );
  const unitsMap = new Map(
    (unitsRes.data ?? []).map((u: any) => [
      u.id as string,
      (u.code ?? (u.order_index != null ? `Suite ${u.order_index}` : 'Suite')) as string,
    ]),
  );

  const kpi = {
    draft: 0,
    complete: 0,
    submitted: 0,
    archived: 0,
    total: 0,
  };
  for (const r of (kpiRes.data ?? []) as { status: string }[]) {
    kpi.total++;
    if (r.status in kpi) (kpi as any)[r.status]++;
  }

  const weekIsoStart = startOfWeek();

  const pill = (active: boolean, activeCls = 'bg-stoniz-black text-white') =>
    `px-3 py-1.5 rounded-full ${active ? activeCls : 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200'}`;

  return (
    <div className="max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6">
        <div>
          <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
            <Link href="/propria" className="hover:text-stoniz-black">Propria</Link> · Fiches police voyageurs
          </div>
          <h1 className="text-2xl md:text-3xl font-display">🛂 Fiches de police ({rows.length})</h1>
          {isReadonly && (
            <p className="mt-2 inline-block bg-stoniz-gray-100 text-stoniz-gray-700 text-xs px-2 py-1 rounded">
              Lecture seule (rôle developer)
            </p>
          )}
        </div>
        <div className="flex items-start gap-2 flex-wrap">
          <WeeklyRecapDownloadButton weekStart={weekIsoStart} />
          {!isReadonly && (
            <Link
              href="/propria/fiches-police/new"
              className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 whitespace-nowrap"
            >
              + Créer fiche manuelle
            </Link>
          )}
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <Link
          href="/propria/fiches-police?status=draft"
          className={`block rounded-md border-2 p-4 transition-colors ${
            kpi.draft > 0 ? 'bg-amber-50 border-amber-300 hover:bg-amber-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${kpi.draft > 0 ? 'text-amber-700' : 'text-stoniz-gray-500'}`}>📋 Brouillons</p>
          <p className={`font-display text-3xl ${kpi.draft > 0 ? 'text-amber-900' : 'text-stoniz-gray-400'}`}>{kpi.draft}</p>
        </Link>
        <Link
          href="/propria/fiches-police?status=complete"
          className={`block rounded-md border-2 p-4 transition-colors ${
            kpi.complete > 0 ? 'bg-blue-50 border-blue-300 hover:bg-blue-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${kpi.complete > 0 ? 'text-blue-700' : 'text-stoniz-gray-500'}`}>✓ Complètes</p>
          <p className={`font-display text-3xl ${kpi.complete > 0 ? 'text-blue-900' : 'text-stoniz-gray-400'}`}>{kpi.complete}</p>
        </Link>
        <Link
          href="/propria/fiches-police?status=submitted"
          className={`block rounded-md border-2 p-4 transition-colors ${
            kpi.submitted > 0 ? 'bg-emerald-50 border-emerald-300 hover:bg-emerald-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className={`text-xs uppercase tracking-wider mb-1 ${kpi.submitted > 0 ? 'text-emerald-700' : 'text-stoniz-gray-500'}`}>🔒 Déposées</p>
          <p className={`font-display text-3xl ${kpi.submitted > 0 ? 'text-emerald-900' : 'text-stoniz-gray-400'}`}>{kpi.submitted}</p>
        </Link>
        <Link
          href="/propria/fiches-police?status=archived"
          className={`block rounded-md border-2 p-4 transition-colors ${
            kpi.archived > 0 ? 'bg-stoniz-gray-50 border-stoniz-gray-300 hover:bg-stoniz-gray-100' : 'bg-white border-stoniz-gray-200 opacity-60'
          }`}
        >
          <p className="text-xs uppercase tracking-wider mb-1 text-stoniz-gray-500">📦 Archivées</p>
          <p className={`font-display text-3xl ${kpi.archived > 0 ? 'text-stoniz-gray-900' : 'text-stoniz-gray-400'}`}>{kpi.archived}</p>
        </Link>
      </div>

      {/* Chips statut */}
      <div className="flex flex-wrap gap-2 mb-3 text-xs">
        <Link href="/propria/fiches-police" className={pill(!searchParams.status)}>Tous</Link>
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <Link
            key={key}
            href={`/propria/fiches-police?status=${key}`}
            className={pill(searchParams.status === key)}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Chips période arrivée */}
      <div className="flex flex-wrap gap-2 mb-5 text-xs items-center">
        <span className="text-stoniz-gray-500">Période arrivée :</span>
        <Link
          href={appendStatus('/propria/fiches-police', searchParams.status)}
          className={pill(!searchParams.periode)}
        >
          Tout
        </Link>
        <Link
          href={appendStatus('/propria/fiches-police?periode=semaine', searchParams.status)}
          className={pill(searchParams.periode === 'semaine')}
        >
          Cette semaine
        </Link>
        <Link
          href={appendStatus('/propria/fiches-police?periode=mois', searchParams.status)}
          className={pill(searchParams.periode === 'mois')}
        >
          Ce mois
        </Link>
        <Link
          href={appendStatus(
            `/propria/fiches-police?periode=custom&from=${searchParams.from ?? ''}&to=${searchParams.to ?? ''}`,
            searchParams.status,
          )}
          className={pill(searchParams.periode === 'custom')}
        >
          Personnalisé…
        </Link>
        {searchParams.periode === 'custom' && (
          <form className="flex items-center gap-2" method="get">
            {searchParams.status && <input type="hidden" name="status" value={searchParams.status} />}
            <input type="hidden" name="periode" value="custom" />
            <input
              type="date"
              name="from"
              defaultValue={searchParams.from ?? ''}
              className="border border-stoniz-gray-300 rounded-md px-2 py-1 text-xs"
            />
            <span className="text-stoniz-gray-500">→</span>
            <input
              type="date"
              name="to"
              defaultValue={searchParams.to ?? ''}
              className="border border-stoniz-gray-300 rounded-md px-2 py-1 text-xs"
            />
            <button type="submit" className="bg-stoniz-black text-white text-xs px-2 py-1 rounded">OK</button>
          </form>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-3 text-left">Réf</th>
              <th className="px-3 py-3 text-left">Date arrivée</th>
              <th className="px-3 py-3 text-left">Bien · Lot</th>
              <th className="px-3 py-3 text-left">Voyageur principal</th>
              <th className="px-3 py-3 text-center">Personnes</th>
              <th className="px-3 py-3 text-center">Statut</th>
              <th className="px-3 py-3 text-center">Source</th>
              <th className="px-3 py-3 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {rows.map((r) => {
              const propId = r.property_id as string | null;
              const unitId = r.propria_unit_id as string | null;
              const propLabel = propId ? (propsMap.get(propId) ?? '—') : '—';
              const unitLabel = unitId ? unitsMap.get(unitId) : null;
              const scope = unitLabel ? `${propLabel} · ${unitLabel}` : `${propLabel} · Bien entier`;
              const guest = [r.head_first_name, r.head_last_name].filter(Boolean).join(' ') || '—';
              // Réf affichée : "FP-XXXX-#####" (5 derniers d'UUID — la "vraie" réf
              // (FP-YYYY-NNNN) se calcule au téléchargement PDF).
              const shortId = (r.id ?? '').slice(0, 8);
              return (
                <tr key={r.id} className="hover:bg-stoniz-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-stoniz-gray-600 font-mono">
                    {shortId}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs">
                    {r.arrival_date_property
                      ? new Date((r.arrival_date_property as string) + 'T00:00:00Z').toLocaleDateString('fr-FR')
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    <Link href={`/propria/fiches-police/${r.id}`} className="hover:underline font-medium">
                      {scope}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs">{guest}</td>
                  <td className="px-3 py-2 text-center text-xs">{r.total_persons_count ?? 1}</td>
                  <td className="px-3 py-2 text-center">
                    <PoliceRecordBadge status={(r.status as any) ?? null} />
                  </td>
                  <td className="px-3 py-2 text-center text-xs">
                    {sourceBadge(r.data_source as string | null | undefined)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <Link
                      href={`/propria/fiches-police/${r.id}`}
                      className="text-xs hover:underline"
                    >
                      Voir →
                    </Link>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-stoniz-gray-500 text-sm">
                  Aucune fiche pour ces filtres.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Helpers locaux ───────────────────────────────────────────────────────

function sourceBadge(source: string | null | undefined): React.ReactNode {
  const map: Record<string, { label: string; cls: string }> = {
    hostaway_portal: { label: 'Hostaway', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
    manual_checkin: { label: 'Manuel', cls: 'bg-stoniz-gray-100 text-stoniz-gray-700 border border-stoniz-gray-200' },
    whatsapp: { label: 'WhatsApp', cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
    unknown: { label: 'Inconnue', cls: 'bg-stoniz-gray-50 text-stoniz-gray-500 border border-stoniz-gray-200' },
  };
  const m = source ? map[source] : null;
  if (!m) return <span className="text-stoniz-gray-400">—</span>;
  return <span className={`text-[10px] px-1.5 py-0.5 rounded ${m.cls}`}>{m.label}</span>;
}

function appendStatus(base: string, status?: string): string {
  if (!status) return base;
  return base.includes('?')
    ? `${base}&status=${status}`
    : `${base}?status=${status}`;
}
