import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { multi, period as periodParse, single, type SP } from '@/lib/list-filters/parse';
import {
  Clock, User, Plus, Edit, Trash2, RotateCcw, History,
  ArrowRightCircle, Link2, Link2Off, FileText, Search,
} from 'lucide-react';

/**
 * Finance Trésorerie — page admin historique global (CEO 2026-06-24 B2).
 *
 * Vue transverse des actions sur les tables finance/trésorerie, lecture pour
 * CEO + finance + developer. Source : finance_audit_log filtré par table_name
 * (par défaut toutes les tables trésorerie + finance projet). Filtres :
 * action (multi), acteur (multi), période (preset + custom), table (multi),
 * recherche full-text sur label + payload::text.
 *
 * Limite : 500 derniers events (groupés par jour).
 */

export const dynamic = 'force-dynamic';

// Tables candidates au filtre — couvre la trésorerie + les flux projet.
const FINANCE_TABLES = [
  'bank_balances',
  'bank_accounts',
  'bank_companies',
  'bank_transactions',
  'bank_transaction_allocations',
  'bank_category_mappings',
  'payments',
  'achats_lots',
  'achats_payments',
  'achats_encaissements',
  'travaux_lots',
  'travaux_payments',
  'travaux_encaissements',
  'services_lots',
  'services_payments',
  'vendor_documents',
] as const;

const TABLE_LABELS: Record<string, string> = {
  bank_balances: 'Solde bancaire',
  bank_accounts: 'Compte bancaire',
  bank_companies: 'Société bancaire',
  bank_transactions: 'Transaction bancaire',
  bank_transaction_allocations: 'Allocation banque',
  bank_category_mappings: 'Mapping catégorie',
  payments: 'Honoraires',
  achats_lots: 'Lot achats',
  achats_payments: 'Acompte achats',
  achats_encaissements: 'Encaissement achats',
  travaux_lots: 'Lot travaux',
  travaux_payments: 'Acompte travaux',
  travaux_encaissements: 'Encaissement travaux',
  services_lots: 'Lot services',
  services_payments: 'Paiement services',
  vendor_documents: 'Document fournisseur',
};

const ACTION_META: Record<string, { icon: any; color: string; label: string }> = {
  create:           { icon: Plus,             color: 'text-emerald-600 bg-emerald-50',          label: 'Création' },
  update:           { icon: Edit,             color: 'text-blue-600 bg-blue-50',                label: 'Modification' },
  status_change:    { icon: ArrowRightCircle, color: 'text-amber-600 bg-amber-50',              label: 'Bascule statut' },
  allocate:         { icon: Link2,            color: 'text-purple-600 bg-purple-50',            label: 'Allocation' },
  unallocate:       { icon: Link2Off,         color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Désallocation' },
  delete:           { icon: Trash2,           color: 'text-red-600 bg-red-50',                  label: 'Suppression' },
  validate:         { icon: Edit,             color: 'text-purple-600 bg-purple-50',            label: 'Validation' },
  attach_doc:       { icon: FileText,         color: 'text-indigo-600 bg-indigo-50',            label: 'Doc attaché' },
  bulk_update:      { icon: Edit,             color: 'text-pink-600 bg-pink-50',                label: 'Action en masse' },
  category_change:  { icon: ArrowRightCircle, color: 'text-teal-600 bg-teal-50',                label: 'Catégorie' },
  pending_merge:    { icon: Edit,             color: 'text-cyan-600 bg-cyan-50',                label: 'Fusion pending→validé' },
  mask:             { icon: Edit,             color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Masquage' },
  unmask:           { icon: Edit,             color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Démasquage' },
  restore:          { icon: RotateCcw,        color: 'text-emerald-600 bg-emerald-50',          label: 'Restauration' },
};

const ACTION_OPTIONS = [
  { v: 'create',          label: 'Création' },
  { v: 'update',          label: 'Modification' },
  { v: 'status_change',   label: 'Bascule statut' },
  { v: 'allocate',        label: 'Allocation' },
  { v: 'unallocate',      label: 'Désallocation' },
  { v: 'delete',          label: 'Suppression' },
  { v: 'validate',        label: 'Validation' },
  { v: 'attach_doc',      label: 'Doc attaché' },
  { v: 'bulk_update',     label: 'Action en masse' },
  { v: 'category_change', label: 'Catégorie' },
];

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function fmtDayLabel(d: string): string {
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? 'oui' : 'non';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
}

function renderPayload(payload: any) {
  if (!payload || typeof payload !== 'object') return null;
  const entries = Object.entries(payload);
  if (entries.length === 0) return null;
  return (
    <ul className="text-[11px] text-stoniz-gray-600 space-y-0.5 mt-1.5">
      {entries.map(([key, val]: [string, any]) => {
        if (val && typeof val === 'object' && ('before' in val || 'after' in val)) {
          return (
            <li key={key} className="font-mono">
              <span className="text-stoniz-gray-500">{key}</span>{' : '}
              <span className="line-through text-red-600">{formatValue(val.before)}</span>{' → '}
              <span className="text-emerald-700">{formatValue(val.after)}</span>
            </li>
          );
        }
        return (
          <li key={key} className="font-mono">
            <span className="text-stoniz-gray-500">{key}</span>{' : '}
            <span>{formatValue(val)}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Lien vers la fiche cible si on peut le construire à partir du couple
 * (table_name, record_id). Pour les tables sans page dédiée, on renvoie null.
 */
function targetHref(tableName: string, recordId: string | null): string | null {
  if (!recordId) return null;
  switch (tableName) {
    case 'bank_transactions':
      return `/finance/tresorerie/transactions/${recordId}`;
    default:
      return null;
  }
}

export default async function FinanceHistoriquePage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(['ceo', 'finance', 'developer']);
  const admin = createAdminClient();

  // ─── Parse filtres ────────────────────────────────────────────────────
  const selectedActions = multi(searchParams, 'action');
  const selectedActors  = multi(searchParams, 'actor');
  const selectedTables  = multi(searchParams, 'table');
  const periodR         = periodParse(searchParams, 'period');
  const q               = (single(searchParams, 'q') ?? '').trim();

  const tablesFilter = selectedTables.length > 0
    ? selectedTables.filter((t) => (FINANCE_TABLES as readonly string[]).includes(t))
    : (FINANCE_TABLES as readonly string[]).slice();

  // ─── Fetch finance_audit_log filtré ───────────────────────────────────
  let query = admin
    .from('finance_audit_log')
    .select('id, occurred_at, action, label, payload, actor_id, record_id, table_name')
    .in('table_name', tablesFilter as any)
    .order('occurred_at', { ascending: false })
    .limit(500);

  if (selectedActions.length) query = query.in('action', selectedActions as any);
  if (selectedActors.length)  query = query.in('actor_id', selectedActors as any);
  if (periodR.from)           query = query.gte('occurred_at', periodR.from);
  if (periodR.to)             query = query.lte('occurred_at', periodR.to);

  // Recherche full-text : label + payload::text
  if (q) {
    const safe = q.replace(/[%_,()]/g, ' ').trim();
    if (safe) {
      query = query.or(`label.ilike.%${safe}%,payload::text.ilike.%${safe}%`);
    }
  }

  const { data: rawEntries } = await query;
  const entries = (rawEntries ?? []) as any[];

  // Hydrate noms acteurs
  const actorIds = Array.from(new Set(entries.map((e) => e.actor_id).filter(Boolean)));
  const { data: profiles } = actorIds.length
    ? await admin.from('profiles').select('id, full_name, role').in('id', actorIds)
    : { data: [] };
  const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  // Tous les acteurs distincts ayant déjà touché la trésorerie (pour le filtre)
  const { data: allActors } = await admin
    .from('finance_audit_log')
    .select('actor_id')
    .in('table_name', FINANCE_TABLES as any)
    .not('actor_id', 'is', null)
    .limit(5000);
  const allActorIds = Array.from(new Set((allActors ?? []).map((r: any) => r.actor_id).filter(Boolean)));
  const { data: allActorProfiles } = allActorIds.length
    ? await admin.from('profiles').select('id, full_name, role').in('id', allActorIds)
    : { data: [] };

  // Groupage par jour (occurred_at)
  const groups: Record<string, any[]> = {};
  for (const e of entries) {
    const day = String(e.occurred_at).slice(0, 10);
    if (!groups[day]) groups[day] = [];
    groups[day].push(e);
  }
  const sortedDays = Object.keys(groups).sort().reverse();

  // ─── Filtres UI ───────────────────────────────────────────────────────
  const filters: FilterDef[] = [
    {
      kind: 'multi',
      key: 'action',
      label: 'Action',
      options: ACTION_OPTIONS,
    },
    {
      kind: 'multi',
      key: 'table',
      label: 'Table',
      options: (FINANCE_TABLES as readonly string[]).map((t) => ({
        v: t,
        label: TABLE_LABELS[t] ?? t,
      })),
    },
    {
      kind: 'multi',
      key: 'actor',
      label: 'Acteur',
      options: (allActorProfiles ?? []).map((p: any) => ({
        v: p.id,
        label: `${p.full_name} (${p.role})`,
      })),
    },
    { kind: 'period', key: 'period', label: 'Période' },
  ];

  // Compteurs par action (sur l'ensemble filtré)
  const actionCounts = entries.reduce((acc: Record<string, number>, e: any) => {
    acc[e.action] = (acc[e.action] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">Admin</div>
        <h1 className="text-3xl font-display inline-flex items-center gap-2">
          <History className="w-6 h-6 text-stoniz-gray-600" />
          Historique trésorerie & finance
        </h1>
        <p className="text-sm text-stoniz-gray-600 mt-2 max-w-3xl">
          Vue transverse des actions effectuées sur la trésorerie (soldes, comptes,
          transactions, allocations, catégorisations) et la finance projet
          (honoraires, achats, travaux, services, documents fournisseur).
          500 derniers événements affichés.
        </p>
        <p className="text-xs text-stoniz-gray-500 mt-1">
          Vers <Link href="/finance/tresorerie" className="hover:underline">la trésorerie</Link>.
        </p>
      </div>

      {/* KPIs par action */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">Total events</div>
          <div className="text-2xl font-display mt-1">{entries.length}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Plus className="w-4 h-4 text-emerald-500 mb-1" />
          <div className="text-xs text-stoniz-gray-500">Créations</div>
          <div className="text-2xl font-display">{actionCounts.create ?? 0}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Edit className="w-4 h-4 text-blue-500 mb-1" />
          <div className="text-xs text-stoniz-gray-500">Modifications</div>
          <div className="text-2xl font-display">{actionCounts.update ?? 0}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-4">
          <Link2 className="w-4 h-4 text-purple-500 mb-1" />
          <div className="text-xs text-stoniz-gray-500">Allocations</div>
          <div className="text-2xl font-display">{actionCounts.allocate ?? 0}</div>
        </div>
      </div>

      <ListToolbar
        moduleKey="finance-historique"
        filters={filters}
        searchHint="(recherche dans le libellé + payload)"
        count={{ filtered: entries.length, total: entries.length }}
        basePath="/admin/finance-historique"
      />

      {/* Chronologie */}
      {sortedDays.length === 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-10 text-center text-stoniz-gray-500 text-sm">
          <Search className="w-6 h-6 mx-auto mb-2 text-stoniz-gray-400" />
          Aucun événement ne correspond aux filtres.
        </div>
      )}

      {sortedDays.map((day) => (
        <div key={day} className="mb-6">
          <h2 className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2 inline-flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            {fmtDayLabel(day)}
            <span className="text-stoniz-gray-400">({groups[day].length})</span>
          </h2>
          <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden divide-y divide-stoniz-gray-100">
            {groups[day].map((e: any) => {
              const meta = ACTION_META[e.action] ?? ACTION_META.update;
              const Icon = meta.icon;
              const actor = e.actor_id ? (profMap.get(e.actor_id) as any) : null;
              const href = targetHref(e.table_name, e.record_id);
              const tableHuman = TABLE_LABELS[e.table_name] ?? e.table_name;
              return (
                <div key={e.id} className="p-3 flex items-start gap-3">
                  <span
                    className={`shrink-0 w-7 h-7 rounded-full ${meta.color} inline-flex items-center justify-center`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-stoniz-gray-100 text-stoniz-gray-700">
                          {tableHuman}
                        </span>
                        <span className="text-sm font-medium text-stoniz-gray-800">
                          {e.label ?? meta.label}
                        </span>
                      </div>
                      <span className="text-[10px] text-stoniz-gray-500 inline-flex items-center gap-1 shrink-0">
                        <Clock className="w-2.5 h-2.5" />
                        {fmtTime(e.occurred_at)}
                      </span>
                    </div>
                    <div className="text-[11px] text-stoniz-gray-600 mt-0.5 inline-flex items-center gap-2 flex-wrap">
                      <span className="inline-flex items-center gap-1">
                        <User className="w-2.5 h-2.5" />
                        {actor?.full_name ?? <span className="italic">(auteur supprimé)</span>}
                        {actor?.role && (
                          <span className="text-stoniz-gray-400">· {actor.role}</span>
                        )}
                      </span>
                      {href && (
                        <Link
                          href={href}
                          className="text-blue-600 hover:underline"
                        >
                          → voir la cible
                        </Link>
                      )}
                    </div>
                    {renderPayload(e.payload)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {entries.length === 500 && (
        <p className="text-xs text-stoniz-gray-500 italic mt-4 text-center">
          500 événements affichés (limite). Affine les filtres pour voir plus ancien.
        </p>
      )}
    </div>
  );
}
