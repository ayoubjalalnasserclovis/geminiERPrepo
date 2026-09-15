'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';
import { syncHostawayReservationsAction } from '@/app/(team)/propria/integrations/hostaway/actions';

type Reservation = {
  id: string;
  hostaway_id: number;
  hostaway_listing_id: number;
  guest_name: string | null;
  guest_email: string | null;
  number_of_guests: number | null;
  arrival_date: string;
  departure_date: string;
  check_in_time: string | null;
  check_out_time: string | null;
  nights: number | null;
  status: string | null;
  channel_name: string | null;
  total_price: number | null;
  currency: string | null;
  guest_note: string | null;
  last_synced_at: string;
  // Enrichis côté serveur
  listing_name: string | null;
  unit_code: string | null;
  property_name: string | null;
  property_code: string | null;
};

const STATUS_BADGE: Record<string, string> = {
  new: 'bg-blue-100 text-blue-800',
  modified: 'bg-amber-100 text-amber-800',
  cancelled: 'bg-red-100 text-red-800',
  ownerStay: 'bg-purple-100 text-purple-800',
  inquiry: 'bg-stoniz-gray-100 text-stoniz-gray-700',
};

const CHANNEL_ICON: Record<string, string> = {
  'airbnb': '🅰️',
  'booking.com': '🅱️',
  'direct': '🔗',
};

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatMoney(n: number | null, currency: string | null): string {
  if (n == null) return '—';
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(n)} ${currency ?? ''}`.trim();
}

export function HostawayReservationsTable({
  reservations,
  counts,
  channels,
  currentFilter,
  currentChannel,
}: {
  reservations: Reservation[];
  counts: { upcoming: number; today: number; ongoing: number; checkinsToday: number; checkoutsToday: number; week: number; past: number; all: number };
  channels: string[];
  currentFilter: string;
  currentChannel: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  function runSync() {
    setMsg(null);
    start(async () => {
      const r = await syncHostawayReservationsAction()
        .catch((e: any) => ({ ok: false as const, error: e?.message ?? 'Erreur' }));
      if (!r?.ok) {
        setMsg({ kind: 'err', text: r?.error ?? 'Échec sync.' });
        return;
      }
      const total = (r as any).total ?? 0;
      const created = (r as any).created ?? 0;
      const updated = (r as any).updated ?? 0;
      const info = (r as any).info;
      setMsg({
        kind: 'ok',
        text: info ?? `✓ ${total} réservation(s) synchronisée(s) — ${created} créée(s), ${updated} mise(s) à jour.`,
      });
      router.refresh();
    });
  }

  function chipClass(active: boolean, color: 'black' | 'blue' | 'orange' | 'emerald' = 'black') {
    if (active) {
      const map = { black: 'bg-stoniz-black', blue: 'bg-blue-600', orange: 'bg-orange-600', emerald: 'bg-emerald-600' };
      return `${map[color]} text-white`;
    }
    return 'bg-stoniz-gray-100 hover:bg-stoniz-gray-200 text-stoniz-gray-700';
  }

  return (
    <div className="space-y-4">
      {/* Toolbar : filtres + sync */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href="/propria/reservations?filter=ongoing"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'ongoing', 'emerald')}`}>
            🏠 En cours ({counts.ongoing})
          </Link>
          <Link href="/propria/reservations?filter=today"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'today', 'blue')}`}>
            Aujourd'hui ({counts.today})
          </Link>
          <Link href="/propria/reservations?filter=checkins-today"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'checkins-today', 'emerald')}`}>
            Check-ins aujourd'hui ({counts.checkinsToday})
          </Link>
          <Link href="/propria/reservations?filter=checkouts-today"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'checkouts-today', 'orange')}`}>
            Check-outs aujourd'hui ({counts.checkoutsToday})
          </Link>
          <Link href="/propria/reservations?filter=week"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'week', 'blue')}`}>
            Cette semaine ({counts.week})
          </Link>
          <Link href="/propria/reservations?filter=upcoming"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'upcoming' || !currentFilter, 'black')}`}>
            À venir ({counts.upcoming})
          </Link>
          <Link href="/propria/reservations?filter=past"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'past')}`}>
            Passées ({counts.past})
          </Link>
          <Link href="/propria/reservations?filter=all"
            className={`px-3 py-1.5 rounded-full ${chipClass(currentFilter === 'all')}`}>
            Toutes ({counts.all})
          </Link>
        </div>

        <button
          type="button"
          onClick={runSync}
          disabled={pending}
          className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-800 disabled:opacity-50 inline-flex items-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${pending ? 'animate-spin' : ''}`} />
          {pending ? 'Sync…' : 'Synchroniser'}
        </button>
      </div>

      {/* Filtres canaux */}
      {channels.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs">
          <Link href={`/propria/reservations?filter=${currentFilter}`}
            className={`px-3 py-1.5 rounded-full ${chipClass(!currentChannel)}`}>
            Tous canaux
          </Link>
          {channels.map((c) => (
            <Link key={c}
              href={`/propria/reservations?filter=${currentFilter}&channel=${encodeURIComponent(c)}`}
              className={`px-3 py-1.5 rounded-full ${chipClass(currentChannel === c)}`}>
              {CHANNEL_ICON[c.toLowerCase()] ?? '·'} {c}
            </Link>
          ))}
        </div>
      )}

      {msg && (
        <div className={`text-sm rounded-md px-3 py-2 ${msg.kind === 'ok' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg.text}
        </div>
      )}

      {reservations.length === 0 ? (
        <div className="bg-stoniz-beige border border-stoniz-gray-200 rounded-xl p-10 text-center">
          <p className="text-stoniz-gray-700 mb-2">Aucune réservation pour ces filtres.</p>
          <p className="text-xs text-stoniz-gray-500">
            Si c'est la 1ère fois, clique sur <strong>« Synchroniser »</strong> pour pull les réservations depuis Hostaway.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-stoniz-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-stoniz-gray-50 text-xs uppercase text-stoniz-gray-600">
              <tr>
                <th className="px-3 py-3 text-left">Check-in → Check-out</th>
                <th className="px-3 py-3 text-left">Listing / Suite Stoniz</th>
                <th className="px-3 py-3 text-left">Voyageur</th>
                <th className="px-3 py-3 text-center">Pers.</th>
                <th className="px-3 py-3 text-center">Canal</th>
                <th className="px-3 py-3 text-center">Statut</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stoniz-gray-100">
              {reservations.map((r) => {
                const isMatched = !!r.unit_code;
                return (
                  <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50' : 'hover:bg-stoniz-gray-50'}>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <div className="text-xs text-stoniz-gray-600">{formatDate(r.arrival_date)} → {formatDate(r.departure_date)}</div>
                      <div className="text-[10px] text-stoniz-gray-500">
                        {r.nights ?? '?'} nuit{(r.nights ?? 0) > 1 ? 's' : ''}
                        {r.check_in_time && ` · arr ${r.check_in_time}`}
                        {r.check_out_time && ` · dép ${r.check_out_time}`}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-xs font-medium truncate max-w-xs" title={r.listing_name ?? ''}>
                        {r.listing_name ?? <em className="text-stoniz-gray-400">(listing non trouvé)</em>}
                      </div>
                      {isMatched ? (
                        <div className="text-[11px] text-emerald-700 inline-flex items-center gap-1 mt-0.5">
                          <CheckCircle2 className="w-3 h-3" />
                          <span className="font-mono">{r.unit_code}</span>
                          {r.property_name && <span className="text-emerald-600">· {r.property_name}</span>}
                        </div>
                      ) : (
                        <div className="text-[11px] text-orange-700 inline-flex items-center gap-1 mt-0.5">
                          <AlertCircle className="w-3 h-3" />
                          Listing non matché
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className="font-medium">{r.guest_name ?? '—'}</div>
                      {r.guest_email && (
                        <div className="text-[10px] text-stoniz-gray-500 truncate max-w-[180px]">{r.guest_email}</div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-center text-xs">{r.number_of_guests ?? '—'}</td>
                    <td className="px-3 py-3 text-center text-xs whitespace-nowrap">
                      {r.channel_name ? (
                        <span title={r.channel_name}>
                          {CHANNEL_ICON[r.channel_name.toLowerCase()] ?? ''} {r.channel_name}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {r.status && (
                        <span className={`text-[10px] uppercase px-2 py-0.5 rounded-full ${STATUS_BADGE[r.status] ?? 'bg-stoniz-gray-100 text-stoniz-gray-700'}`}>
                          {r.status}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right text-xs whitespace-nowrap">
                      {formatMoney(r.total_price, r.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
