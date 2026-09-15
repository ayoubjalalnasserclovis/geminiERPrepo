import Link from 'next/link';
import { AlertTriangle, Clock, ChevronRight } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { LOST_STATUS } from '@/lib/projects/lost';
import { RecouvrementDrawerButton, type RecouvrementItem } from './recouvrement-drawer';

/**
 * Bandeau de recouvrement client (CEO 2026-06-11).
 *
 * Affiche 2 cards côte à côte :
 *   - 🔴 Paiements en retard (scheduled_date < today, status='planifie')
 *   - 🟠 Paiements à encaisser dans 30 jours (scheduled_date ∈ [today, today+30])
 *
 * Chaque card : compteur · montant total · 3 previews avec drill-down vers le
 * projet (`/projects/[id]/travaux` ou `/achats`).
 *
 * Source : `travaux_encaissements` et/ou `achats_encaissements` selon `kind`.
 * Filtre : projets perdus exclus (LOST_STATUS).
 */

type Kind = 'travaux' | 'achats' | 'all';

function fmtMad(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n) + ' DH';
}

function fmtDate(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' });
}

function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso + 'T00:00:00Z').getTime();
  const b = new Date(toIso + 'T00:00:00Z').getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

export async function RecouvrementBanner({ kind = 'all' }: { kind?: Kind }) {
  const supabase = createClient();

  const todayIso = new Date().toISOString().slice(0, 10);
  const j30Iso = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // Pull encaissements + projets pour le filtrage perdus + enrichissement
  const [travRes, achatsRes, projectsRes] = await Promise.all([
    (kind === 'travaux' || kind === 'all')
      ? supabase.from('travaux_encaissements')
          .select('id, project_id, amount_mad, scheduled_date, status, notes')
          .eq('status', 'planifie')
          .not('scheduled_date', 'is', null)
          .lte('scheduled_date', j30Iso)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] } as any),
    (kind === 'achats' || kind === 'all')
      ? supabase.from('achats_encaissements')
          .select('id, project_id, amount_mad, scheduled_date, status, notes')
          .eq('status', 'planifie')
          .not('scheduled_date', 'is', null)
          .lte('scheduled_date', j30Iso)
          .is('deleted_at', null)
      : Promise.resolve({ data: [] } as any),
    supabase.from('projects')
      .select('id, reference, status, client:clients(full_name)')
      .is('deleted_at', null)
      .neq('status', LOST_STATUS),
  ]);

  const projectMap = new Map((projectsRes.data ?? []).map((p: any) => [p.id, p]));

  type Item = RecouvrementItem;

  const items: Item[] = [];
  for (const r of (travRes.data ?? []) as any[]) {
    const p = projectMap.get(r.project_id) as any;
    if (!p) continue; // exclu (perdu ou supprimé)
    items.push({
      id: r.id,
      kind: 'travaux',
      project_id: r.project_id,
      project_ref: p.reference ?? '—',
      client_name: p.client?.full_name ?? '—',
      amount_mad: Number(r.amount_mad ?? 0),
      scheduled_date: r.scheduled_date,
      delay_days: daysBetween(todayIso, r.scheduled_date),
    });
  }
  for (const r of (achatsRes.data ?? []) as any[]) {
    const p = projectMap.get(r.project_id) as any;
    if (!p) continue;
    items.push({
      id: r.id,
      kind: 'achats',
      project_id: r.project_id,
      project_ref: p.reference ?? '—',
      client_name: p.client?.full_name ?? '—',
      amount_mad: Number(r.amount_mad ?? 0),
      scheduled_date: r.scheduled_date,
      delay_days: daysBetween(todayIso, r.scheduled_date),
    });
  }

  // Split retard vs à venir
  const retard = items
    .filter((i) => i.scheduled_date < todayIso)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)); // les + anciens en haut
  const venir = items
    .filter((i) => i.scheduled_date >= todayIso)
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date)); // les + proches en haut

  const totRetard = retard.reduce((s, i) => s + i.amount_mad, 0);
  const totVenir = venir.reduce((s, i) => s + i.amount_mad, 0);

  // CEO 2026-06-11 : on AFFICHE toujours le bandeau, même vide. Comme ça
  // l'équipe sait que la donnée est vérifiée et qu'il n'y a rien à recouvrer
  // (et pas qu'on a oublié de la calculer).
  const title = kind === 'travaux'
    ? 'Recouvrement client · Travaux'
    : kind === 'achats'
      ? 'Recouvrement client · Achats'
      : 'Recouvrement client · Travaux + Achats';

  function href(it: Item) {
    return `/projects/${it.project_id}/${it.kind}`;
  }

  return (
    <div className="mb-6">
      <div className="text-xs uppercase tracking-wider text-stoniz-gray-500 mb-2">
        💰 {title}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* En retard */}
        <div className={`rounded-xl border p-4 ${retard.length > 0 ? 'bg-red-50 border-red-200' : 'bg-white border-stoniz-gray-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`text-sm font-medium inline-flex items-center gap-2 ${retard.length > 0 ? 'text-red-800' : 'text-stoniz-gray-500'}`}>
              <AlertTriangle className="w-4 h-4" />
              En retard
            </div>
            <div className="text-right">
              <div className={`text-2xl font-display ${retard.length > 0 ? 'text-red-900' : 'text-stoniz-gray-400'}`}>
                {retard.length}
              </div>
              {retard.length > 0 && (
                <div className="text-xs text-red-700 font-medium">{fmtMad(totRetard)}</div>
              )}
            </div>
          </div>
          {retard.length === 0 ? (
            <div className="text-xs text-stoniz-gray-500">Aucun paiement en retard ✨</div>
          ) : (
            <ul className="space-y-1.5">
              {retard.slice(0, 3).map((i) => (
                <li key={`${i.kind}-${i.id}`}>
                  <Link
                    href={href(i)}
                    className="block border-l-2 border-red-400 pl-2 hover:bg-red-100/50 transition-colors rounded-r"
                  >
                    <div className="text-xs font-medium truncate flex items-center justify-between gap-2">
                      <span className="truncate">
                        {i.project_ref} · <span className="text-stoniz-gray-600">{i.client_name}</span>
                      </span>
                      <span className="text-red-800 shrink-0 font-mono">{fmtMad(i.amount_mad)}</span>
                    </div>
                    <div className="text-[10px] text-red-700 flex items-center gap-2">
                      <span>Échéance {fmtDate(i.scheduled_date)}</span>
                      <span className="font-medium">🔴 Retard {Math.abs(i.delay_days)}j</span>
                      <span className="bg-red-100 px-1 rounded text-[9px] uppercase">{i.kind}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {retard.length > 0 && (
            <div className="mt-2">
              <RecouvrementDrawerButton
                items={retard}
                label={`Voir tous (${retard.length})`}
                variant="retard"
              />
            </div>
          )}
        </div>

        {/* À venir 30j */}
        <div className={`rounded-xl border p-4 ${venir.length > 0 ? 'bg-orange-50 border-orange-200' : 'bg-white border-stoniz-gray-200'}`}>
          <div className="flex items-center justify-between mb-3">
            <div className={`text-sm font-medium inline-flex items-center gap-2 ${venir.length > 0 ? 'text-orange-800' : 'text-stoniz-gray-500'}`}>
              <Clock className="w-4 h-4" />
              À encaisser dans 30 jours
            </div>
            <div className="text-right">
              <div className={`text-2xl font-display ${venir.length > 0 ? 'text-orange-900' : 'text-stoniz-gray-400'}`}>
                {venir.length}
              </div>
              {venir.length > 0 && (
                <div className="text-xs text-orange-700 font-medium">{fmtMad(totVenir)}</div>
              )}
            </div>
          </div>
          {venir.length === 0 ? (
            <div className="text-xs text-stoniz-gray-500">Aucun paiement programmé sur 30j</div>
          ) : (
            <ul className="space-y-1.5">
              {venir.slice(0, 3).map((i) => (
                <li key={`${i.kind}-${i.id}`}>
                  <Link
                    href={href(i)}
                    className="block border-l-2 border-orange-400 pl-2 hover:bg-orange-100/50 transition-colors rounded-r"
                  >
                    <div className="text-xs font-medium truncate flex items-center justify-between gap-2">
                      <span className="truncate">
                        {i.project_ref} · <span className="text-stoniz-gray-600">{i.client_name}</span>
                      </span>
                      <span className="text-orange-800 shrink-0 font-mono">{fmtMad(i.amount_mad)}</span>
                    </div>
                    <div className="text-[10px] text-orange-700 flex items-center gap-2">
                      <span>Échéance {fmtDate(i.scheduled_date)}</span>
                      <span className="font-medium">
                        {i.delay_days === 0 ? "🟠 Aujourd'hui" : `Dans ${i.delay_days}j`}
                      </span>
                      <span className="bg-orange-100 px-1 rounded text-[9px] uppercase">{i.kind}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {venir.length > 0 && (
            <div className="mt-2">
              <RecouvrementDrawerButton
                items={venir}
                label={`Voir tous (${venir.length})`}
                variant="venir"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
