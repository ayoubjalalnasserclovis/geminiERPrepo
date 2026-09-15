import Link from 'next/link';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { Activity, AlertTriangle, CheckCircle2, Clock, RefreshCw } from 'lucide-react';

/**
 * Page diagnostic CEO Hostaway (CEO 2026-06-12).
 *
 * Créée après le bug "compteurs Daily vs Hostaway divergents" du 12/06.
 * Objectif : voir en un coup d'œil si le cron tourne bien, depuis quand,
 * combien de résa il a synced, et lister les listings qui semblent
 * sous-syncés (= attendre une attention manuelle).
 *
 * Accès : CEO + developer uniquement.
 */
export default async function HostawayDiagnosticPage() {
  await requireRole(['ceo', 'developer']);
  const supabase = createClient();

  // 1) Derniers cron runs (50 dernières lignes)
  const { data: runs } = await supabase
    .from('hostaway_sync_runs')
    .select('id, started_at, ended_at, trigger, triggered_by, status, summary, duration_ms, error_message')
    .order('started_at', { ascending: false })
    .limit(50);

  // 2) Stats globales
  const lastRun = (runs ?? [])[0] as any;
  const lastOk = (runs ?? []).find((r: any) => r.status === 'ok');
  const lastError = (runs ?? []).find((r: any) => r.status === 'error');

  // 3) Compteurs par listing : combien de résa actives dans la fenêtre
  // [aujourd'hui, +7j]. Si un listing est sur-représenté ou sous-représenté,
  // c'est suspect (ex : tous les autres ont 3-5 résa et un seul en a 0).
  const todayIso = new Date().toISOString().slice(0, 10);
  const in7days = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);

  const { data: listings } = await supabase
    .from('hostaway_listings')
    .select('id, hostaway_id, name, propria_unit_id')
    .is('deleted_at', null)
    .order('name');

  const { data: resasWindow } = await supabase
    .from('hostaway_reservations')
    .select('hostaway_listing_db_id, arrival_date, departure_date, status, last_synced_at')
    .in('status', ['new', 'modified'])
    .gte('arrival_date', todayIso)
    .lte('arrival_date', in7days)
    .is('deleted_at', null);

  const countByListing = new Map<string, number>();
  let maxLastSynced: string | null = null;
  for (const r of (resasWindow ?? []) as any[]) {
    const k = r.hostaway_listing_db_id ?? 'no_listing';
    countByListing.set(k, (countByListing.get(k) ?? 0) + 1);
    if (!maxLastSynced || r.last_synced_at > maxLastSynced) maxLastSynced = r.last_synced_at;
  }

  // 3.5) Webhooks Hostaway reçus dans les dernières 24h (temps réel)
  const { data: webhooks } = await supabase
    .from('hostaway_webhook_events')
    .select('id, received_at, event_type, object_type, hostaway_object_id, signature_valid, processing_status, error_message, duration_ms')
    .gte('received_at', new Date(Date.now() - 86400000).toISOString())
    .order('received_at', { ascending: false })
    .limit(50);

  const webhookStats = {
    total: webhooks?.length ?? 0,
    processed: (webhooks ?? []).filter((w: any) => w.processing_status === 'processed').length,
    ignored: (webhooks ?? []).filter((w: any) => w.processing_status === 'ignored').length,
    failed: (webhooks ?? []).filter((w: any) => w.processing_status === 'failed').length,
    last_received_at: (webhooks ?? [])[0]?.received_at ?? null,
  };

  // 4) Arrivées et départs du JOUR (donnée du Daily — source de vérité BDD)
  const { data: arrivalsToday } = await supabase
    .from('hostaway_reservations')
    .select('guest_name, channel_name, status, arrival_date, departure_date, hostaway_listing_db_id, last_synced_at')
    .eq('arrival_date', todayIso)
    .is('deleted_at', null)
    .order('guest_name');

  const { data: departsToday } = await supabase
    .from('hostaway_reservations')
    .select('guest_name, channel_name, status, arrival_date, departure_date, hostaway_listing_db_id, last_synced_at')
    .eq('departure_date', todayIso)
    .is('deleted_at', null)
    .order('guest_name');

  function fmtDateTime(iso: string | null) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
  }
  function timeAgo(iso: string | null) {
    if (!iso) return '—';
    const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "à l'instant";
    if (min < 60) return `il y a ${min} min`;
    if (min < 1440) return `il y a ${Math.round(min / 60)} h`;
    return `il y a ${Math.round(min / 1440)} j`;
  }

  // Indicateur "santé du cron" : si la dernière sync a > 75 minutes, alerte
  // (le cron tourne toutes les heures, on tolère un peu de drift Vercel).
  const lastRunStartedAt = lastRun?.started_at ?? null;
  const minutesSinceLastRun = lastRunStartedAt
    ? Math.round((Date.now() - new Date(lastRunStartedAt).getTime()) / 60000)
    : null;
  const cronHealth =
    minutesSinceLastRun == null
      ? 'unknown'
      : minutesSinceLastRun > 75
      ? 'stale'
      : minutesSinceLastRun > 60
      ? 'late'
      : 'healthy';

  return (
    <div className="max-w-6xl">
      <div className="text-xs text-stoniz-gray-500 uppercase tracking-wider mb-1">
        <Link href="/propria" className="hover:text-stoniz-black">Propria</Link>
        {' · '}
        <Link href="/propria/integrations/hostaway" className="hover:text-stoniz-black">Hostaway</Link>
        {' · Diagnostic'}
      </div>
      <h1 className="text-2xl md:text-3xl font-display mb-2">🩺 Diagnostic Hostaway</h1>
      <p className="text-sm text-stoniz-gray-600 mb-6">
        Visualise la santé du cron Hostaway et détecte les écarts entre ce qui devrait être synchronisé et ce qui est en BDD.
      </p>

      {/* Cards santé cron */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6">
        <div className={`bg-white border rounded-xl p-4 ${
          cronHealth === 'healthy' ? 'border-emerald-300' :
          cronHealth === 'late' ? 'border-amber-300' :
          'border-red-300'
        }`}>
          <div className="text-xs text-stoniz-gray-500 uppercase flex items-center gap-1">
            <Activity className="w-3 h-3" /> Santé cron
          </div>
          <div className={`text-2xl font-display mt-1 ${
            cronHealth === 'healthy' ? 'text-emerald-700' :
            cronHealth === 'late' ? 'text-amber-700' :
            'text-red-700'
          }`}>
            {cronHealth === 'healthy' ? '✓ OK' :
             cronHealth === 'late' ? '⚠ Lent' :
             cronHealth === 'stale' ? '⚠ Bloqué' : '?'}
          </div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1">
            Dernier run : {timeAgo(lastRunStartedAt)}
          </div>
        </div>

        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Dernier OK
          </div>
          <div className="text-base font-display mt-1">{fmtDateTime(lastOk?.started_at ?? null)}</div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1">
            {lastOk ? `${(lastOk.summary as any)?.reservations?.synced ?? '?'} résa synced` : 'jamais'}
          </div>
        </div>

        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-red-600" /> Dernière erreur
          </div>
          <div className="text-base font-display mt-1">{fmtDateTime(lastError?.started_at ?? null)}</div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1 truncate">
            {lastError?.error_message ?? 'aucune'}
          </div>
        </div>

        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase flex items-center gap-1">
            <Clock className="w-3 h-3" /> Donnée la + récente
          </div>
          <div className="text-base font-display mt-1">{timeAgo(maxLastSynced)}</div>
          <div className="text-[11px] text-stoniz-gray-500 mt-1">
            (max last_synced_at résa)
          </div>
        </div>
      </div>

      {/* Compteurs du jour */}
      <h2 className="text-sm font-medium uppercase tracking-wider text-stoniz-gray-500 mb-2">
        Compteurs du jour (vérité BDD)
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">📥 Arrivées du jour</div>
          <div className="text-3xl font-display mt-1">{arrivalsToday?.length ?? 0}</div>
          <p className="text-[11px] text-stoniz-gray-500 mt-1">
            Inclut tous les statuts. Le Daily ne montre que <code>new</code> + <code>modified</code>.
          </p>
          <ul className="mt-2 text-xs space-y-1">
            {(arrivalsToday ?? []).slice(0, 10).map((r: any, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  r.status === 'new' || r.status === 'modified' ? 'bg-emerald-100 text-emerald-800' :
                  r.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  'bg-stoniz-gray-100 text-stoniz-gray-700'
                }`}>{r.status}</span>
                <span className="truncate">{r.guest_name ?? '?'}</span>
                <span className="text-stoniz-gray-400 ml-auto">{r.channel_name ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-white border border-stoniz-gray-200 rounded-xl p-4">
          <div className="text-xs text-stoniz-gray-500 uppercase">📤 Départs du jour</div>
          <div className="text-3xl font-display mt-1">{departsToday?.length ?? 0}</div>
          <p className="text-[11px] text-stoniz-gray-500 mt-1">
            Inclut tous les statuts.
          </p>
          <ul className="mt-2 text-xs space-y-1">
            {(departsToday ?? []).slice(0, 10).map((r: any, i: number) => (
              <li key={i} className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  r.status === 'new' || r.status === 'modified' ? 'bg-emerald-100 text-emerald-800' :
                  r.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                  'bg-stoniz-gray-100 text-stoniz-gray-700'
                }`}>{r.status}</span>
                <span className="truncate">{r.guest_name ?? '?'}</span>
                <span className="text-stoniz-gray-400 ml-auto">{r.channel_name ?? ''}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Historique des runs */}
      <h2 className="text-sm font-medium uppercase tracking-wider text-stoniz-gray-500 mb-2">
        Historique des 20 derniers runs
      </h2>
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden mb-6">
        <table className="w-full text-xs">
          <thead className="bg-stoniz-gray-50 text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Démarré</th>
              <th className="px-3 py-2 text-left">Trigger</th>
              <th className="px-3 py-2 text-center">Status</th>
              <th className="px-3 py-2 text-right">Résa</th>
              <th className="px-3 py-2 text-right">Listings</th>
              <th className="px-3 py-2 text-right">Avis</th>
              <th className="px-3 py-2 text-right">Ménages</th>
              <th className="px-3 py-2 text-right">Durée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {(runs ?? []).slice(0, 20).map((r: any) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{fmtDateTime(r.started_at)}</td>
                <td className="px-3 py-2 text-stoniz-gray-600">{r.trigger}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    r.status === 'ok' ? 'bg-emerald-100 text-emerald-800' :
                    r.status === 'partial' ? 'bg-amber-100 text-amber-800' :
                    r.status === 'error' ? 'bg-red-100 text-red-700' :
                    'bg-stoniz-gray-100 text-stoniz-gray-700'
                  }`}>{r.status}</span>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(r.summary as any)?.reservations?.synced ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(r.summary as any)?.listings?.synced ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {(r.summary as any)?.reviews?.synced ?? '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {((r.summary as any)?.cleanings?.created_voyageur ?? 0)
                    + ((r.summary as any)?.cleanings?.created_poussiere ?? 0) || '—'}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">
                  {r.duration_ms ? `${(r.duration_ms / 1000).toFixed(1)}s` : '—'}
                </td>
              </tr>
            ))}
            {(runs ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-center text-stoniz-gray-500">
                  Aucun run enregistré. Patiente la prochaine heure (cron `0 * * * *`).
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Compteurs par listing — détection sous-sync */}
      <h2 className="text-sm font-medium uppercase tracking-wider text-stoniz-gray-500 mb-2">
        Résa actives par listing (fenêtre +7j)
      </h2>
      <p className="text-xs text-stoniz-gray-500 mb-3">
        Si un listing affiche 0 résa et que tu sais qu'il devrait en avoir (cf Hostaway), c'est qu'il y a un trou dans la sync.
      </p>
      <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-stoniz-gray-50 text-stoniz-gray-600">
            <tr>
              <th className="px-3 py-2 text-left">Listing</th>
              <th className="px-3 py-2 text-right">Hostaway ID</th>
              <th className="px-3 py-2 text-right">Nb résa +7j</th>
              <th className="px-3 py-2 text-center">Suite matchée</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stoniz-gray-100">
            {(listings ?? []).map((l: any) => {
              const count = countByListing.get(l.id) ?? 0;
              return (
                <tr key={l.id} className={count === 0 ? 'bg-amber-50/40' : ''}>
                  <td className="px-3 py-2 truncate max-w-[400px]">{l.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-stoniz-gray-500">{l.hostaway_id}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{count}</td>
                  <td className="px-3 py-2 text-center">
                    {l.propria_unit_id ? '✓' : <span className="text-amber-600">⚠ non</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Webhooks Hostaway temps réel (CEO 2026-06-12) */}
      <h2 className="text-sm font-medium uppercase tracking-wider text-stoniz-gray-500 mb-2 mt-6">
        Webhooks temps réel — 24h
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-3">
          <div className="text-[10px] uppercase text-stoniz-gray-500">Reçus 24h</div>
          <div className="text-xl font-display">{webhookStats.total}</div>
        </div>
        <div className="bg-white border border-emerald-200 rounded-lg p-3">
          <div className="text-[10px] uppercase text-emerald-700">Traités</div>
          <div className="text-xl font-display text-emerald-700">{webhookStats.processed}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-3">
          <div className="text-[10px] uppercase text-stoniz-gray-500">Ignorés</div>
          <div className="text-xl font-display text-stoniz-gray-700">{webhookStats.ignored}</div>
        </div>
        <div className="bg-white border border-red-200 rounded-lg p-3">
          <div className="text-[10px] uppercase text-red-700">Échoués</div>
          <div className="text-xl font-display text-red-700">{webhookStats.failed}</div>
        </div>
        <div className="bg-white border border-stoniz-gray-200 rounded-lg p-3">
          <div className="text-[10px] uppercase text-stoniz-gray-500">Dernier reçu</div>
          <div className="text-xs font-medium mt-1">{timeAgo(webhookStats.last_received_at)}</div>
        </div>
      </div>

      {webhookStats.total === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-xs text-amber-900 mb-4">
          ⚠ <strong>Aucun webhook reçu sur les dernières 24h.</strong> Vérifier la config Hostaway dashboard :
          URL = <code>https://studio.stoniz.co/api/webhooks/hostaway</code> + <code>HOSTAWAY_WEBHOOK_SECRET</code> sur Vercel.
        </div>
      )}

      {(webhooks ?? []).length > 0 && (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-hidden mb-6">
          <table className="w-full text-xs">
            <thead className="bg-stoniz-gray-50 text-stoniz-gray-600">
              <tr>
                <th className="px-3 py-2 text-left">Reçu</th>
                <th className="px-3 py-2 text-left">Event</th>
                <th className="px-3 py-2 text-left">Objet</th>
                <th className="px-3 py-2 text-right">ID</th>
                <th className="px-3 py-2 text-center">Signature</th>
                <th className="px-3 py-2 text-center">Statut</th>
                <th className="px-3 py-2 text-left">Erreur</th>
                <th className="px-3 py-2 text-right">Durée</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {(webhooks ?? []).slice(0, 20).map((w: any) => (
                <tr key={w.id}>
                  <td className="px-3 py-2">{fmtDateTime(w.received_at)}</td>
                  <td className="px-3 py-2 text-stoniz-gray-700">{w.event_type ?? '—'}</td>
                  <td className="px-3 py-2 text-stoniz-gray-700">{w.object_type ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-stoniz-gray-500 tabular-nums">{w.hostaway_object_id ?? '—'}</td>
                  <td className="px-3 py-2 text-center">
                    {w.signature_valid === true ? '✓' : w.signature_valid === false ? '✕' : '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      w.processing_status === 'processed' ? 'bg-emerald-100 text-emerald-800' :
                      w.processing_status === 'ignored' ? 'bg-stoniz-gray-100 text-stoniz-gray-700' :
                      w.processing_status === 'failed' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-800'
                    }`}>{w.processing_status}</span>
                  </td>
                  <td className="px-3 py-2 text-stoniz-gray-500 truncate max-w-[200px]">{w.error_message ?? ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{w.duration_ms ? `${w.duration_ms}ms` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 text-xs text-stoniz-gray-500 space-y-1">
        <div>
          <RefreshCw className="w-3 h-3 inline mr-1" />
          Le cron tourne automatiquement à <code>{'*/15 * * * *'}</code> UTC (toutes les 15 minutes).
        </div>
        <div>
          📡 Webhooks Hostaway en temps réel sur <code>POST /api/webhooks/hostaway</code> (configuration à faire côté dashboard Hostaway).
        </div>
        <div>
          Si la dernière sync est &gt; 20 min et aucun webhook reçu &gt; 1h, c'est probablement un problème côté Vercel ou Hostaway à investiguer.
        </div>
      </div>
    </div>
  );
}
