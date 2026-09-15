import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createAdminClient } from '@/lib/supabase/admin';
import { ListToolbar, type FilterDef } from '@/components/ui/list-toolbar';
import { multi, period as periodParse, type SP } from '@/lib/list-filters/parse';
import {
  Clock, User, Plus, Edit, Trash2, RotateCcw, History,
  ArrowRightCircle, Link2, Link2Off,
} from 'lucide-react';

/**
 * Caisse STONIZ — page admin historique global (CEO 2026-06-22).
 *
 * CEO-only. Lit finance_audit_log filtré sur table_name = 'stoniz_wallet_expenses',
 * joint au profile pour le nom de l'acteur. Affichage chronologique groupé
 * par jour, avec filtres action / acteur / période.
 *
 * Limite : 500 derniers events par défaut.
 */

export const dynamic = 'force-dynamic';

const ACTION_META: Record<string, { icon: any; color: string; label: string }> = {
  create:        { icon: Plus,            color: 'text-emerald-600 bg-emerald-50',     label: 'Création' },
  update:        { icon: Edit,            color: 'text-blue-600 bg-blue-50',           label: 'Modification' },
  status_change: { icon: ArrowRightCircle, color: 'text-amber-600 bg-amber-50',         label: 'Bascule statut' },
  allocate:      { icon: Link2,           color: 'text-purple-600 bg-purple-50',       label: 'Allocation' },
  unallocate:    { icon: Link2Off,        color: 'text-stoniz-gray-600 bg-stoniz-gray-100', label: 'Désallocation' },
  delete:        { icon: Trash2,          color: 'text-red-600 bg-red-50',             label: 'Suppression' },
  validate:      { icon: Edit,            color: 'text-purple-600 bg-purple-50',       label: 'Validation' },
  restore:       { icon: RotateCcw,       color: 'text-emerald-600 bg-emerald-50',     label: 'Restauration' },
};

const ACTION_OPTIONS = [
  { v: 'create',  label: 'Création' },
  { v: 'update',  label: 'Modification' },
  { v: 'delete',  label: 'Suppression' },
  { v: 'restore', label: 'Restauration' },
];

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
}

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

export default async function CaisseStonizHistoriquePage({
  searchParams,
}: {
  searchParams: SP;
}) {
  await requireRole(['ceo']);
  const admin = createAdminClient();

  // ─── Parse filtres ────────────────────────────────────────────────────
  const selectedActions = multi(searchParams, 'action');
  const selectedActors  = multi(searchParams, 'actor');
  const periodR         = periodParse(searchParams, 'period');

  // ─── Fetch finance_audit_log filtré sur stoniz_wallet_expenses ──────
  let query = admin
    .from('finance_audit_log')
    .select('id, occurred_at, action, label, payload, actor_id, record_id')
    .eq('table_name', 'stoniz_wallet_expenses')
    .order('occurred_at', { ascending: false })
    .limit(500);

  if (selectedActions.length) query = query.in('action', selectedActions as any);
  if (selectedActors.length)  query = query.in('actor_id', selectedActors as any);
  if (periodR.from)           query = query.gte('occurred_at', periodR.from);
  if (periodR.to)             query = query.lte('occurred_at', periodR.to);

  const { data: rawEntries } = await query;
  const entries = (rawEntries ?? []) as any[];

  // Hydrate noms acteurs
  const actorIds = Array.from(new Set(entries.map((e) => e.actor_id).filter(Boolean)));
  const { data: profiles } = actorIds.length
    ? await admin.from('profiles').select('id, full_name, role').in('id', actorIds)
    : { data: [] };
  const profMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

  // Pour le filtre "Acteur", on aussi besoin de tous les acteurs distincts qui
  // ont déjà eu une activité (pas seulement ceux qui matchent le filtre courant).
  const { data: allActors } = await admin
    .from('finance_audit_log')
    .select('actor_id')
    .eq('table_name', 'stoniz_wallet_expenses')
    .not('actor_id', 'is', null)
    .limit(2000);
  const allActorIds = Array.from(new Set((allActors ?? []).map((r: any) => r.actor_id).filter(Boolean)));
  const { data: allActorProfiles } = allActorIds.length
    ? await admin.from('profiles').select('id, full_name, role').in('id', allActorIds)
    : { data: [] };

  // Vérifie quelles record_id existent toujours (pour le lien "voir la ligne")
  const recordIds = Array.from(new Set(entries.map((e) => e.record_id).filter(Boolean)));
  const { data: existingExpenses } = recordIds.length
    ? await admin
        .from('stoniz_wallet_expenses')
        .select('id, wallet_id, deleted_at')
        .in('id', recordIds)
    : { data: [] };
  const expenseMap = new Map((existingExpenses ?? []).map((e: any) => [e.id, e]));

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
          Caisse STONIZ — historique global
        </h1>
        <p className="text-sm text-stoniz-gray-600 mt-2 max-w-3xl">
          Toutes les actions effectuées sur les dépenses Caisse STONIZ
          (créations, modifications, suppressions, restaurations). 500 derniers
          événements affichés.
        </p>
        <p className="text-xs text-stoniz-gray-500 mt-1">
          Vers <Link href="/caisse-stoniz" className="hover:underline">les caisses</Link>.
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
          <Trash2 className="w-4 h-4 text-red-500 mb-1" />
          <div className="text-xs text-stoniz-gray-500">Suppressions</div>
          <div className="text-2xl font-display">{actionCounts.delete ?? 0}</div>
        </div>
      </div>

      <ListToolbar
        moduleKey="caisse-stoniz-historique"
        filters={filters}
        searchHint="(filtrez par action / acteur / période)"
        count={{ filtered: entries.length, total: entries.length }}
        basePath="/admin/caisse-stoniz-historique"
      />

      {/* Chronologie */}
      {sortedDays.length === 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-10 text-center text-stoniz-gray-500 text-sm">
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
              const expense = expenseMap.get(e.record_id) as any;
              return (
                <div key={e.id} className="p-3 flex items-start gap-3">
                  <span
                    className={`shrink-0 w-7 h-7 rounded-full ${meta.color} inline-flex items-center justify-center`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-sm font-medium text-stoniz-gray-800">
                        {e.label ?? meta.label}
                      </span>
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
                      {expense && (
                        <Link
                          href={`/caisse-stoniz/${expense.wallet_id}`}
                          className="text-blue-600 hover:underline"
                          title={expense.deleted_at ? 'Dépense supprimée — visible CEO uniquement' : undefined}
                        >
                          → voir la caisse{expense.deleted_at ? ' (supprimée)' : ''}
                        </Link>
                      )}
                      {!expense && e.record_id && (
                        <span className="text-stoniz-gray-400 italic">(ligne purgée)</span>
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
