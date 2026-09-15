'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import {
  getMyNotificationsAction,
  markAllReadAction,
  markNotificationReadAction,
  type AppNotification,
} from '@/app/(team)/notifications-actions';

/**
 * Cloche de notifications in-app (CEO 2026-06-12).
 *
 * Montée à DEUX endroits du layout équipe (mêmes données, deux rendus) :
 *   • variant="sidebar" : ligne dans la sidebar desktop (sous le logo),
 *     panneau qui s'ouvre à droite de la sidebar.
 *   • variant="mobile"  : icône dans la barre du haut mobile (à côté du
 *     hamburger), panneau en dropdown sous la barre.
 *
 * Rafraîchissement simple : compteur rechargé toutes les 60 s + au focus
 * de l'onglet + à chaque ouverture du panneau. Pas de realtime (volontaire).
 * Le compteur initial est hydraté server-side depuis le layout.
 */

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}

export function NotificationsBell({
  variant,
  initialUnread = 0,
  collapsed = false,
}: {
  variant: 'sidebar' | 'mobile';
  initialUnread?: number;
  collapsed?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(initialUnread);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await getMyNotificationsAction();
      if (res.ok) {
        setUnread(res.unread);
        setItems(res.notifications);
      }
    } catch {
      // best effort — silencieux (ex: session expirée, table pas encore migrée)
    }
  }, []);

  // Compteur : toutes les 60 s + au retour de focus sur l'onglet
  useEffect(() => {
    const interval = setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      setLoading(true);
      await refresh();
      setLoading(false);
    }
  };

  const onItemClick = (n: AppNotification) => {
    setOpen(false);
    if (!n.read_at) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      void markNotificationReadAction({ notification_id: n.id }).catch(() => {});
    }
    if (n.href) router.push(n.href);
  };

  const onMarkAll = () => {
    setUnread(0);
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() })));
    void markAllReadAction().catch(() => {});
  };

  const badge =
    unread > 0 ? (
      <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
        {unread > 99 ? '99+' : unread}
      </span>
    ) : null;

  const panel = open ? (
    <>
      {/* Voile transparent : clic dehors = fermeture */}
      <button
        type="button"
        aria-label="Fermer les notifications"
        onClick={() => setOpen(false)}
        className="fixed inset-0 z-40 cursor-default"
      />
      <div
        className={cn(
          'z-50 flex flex-col overflow-hidden rounded-md border border-black/10 bg-white text-gray-900 shadow-xl',
          variant === 'sidebar'
            ? 'absolute left-full top-0 ml-2 w-80'
            : 'absolute right-0 top-full mt-2 w-[min(20rem,calc(100vw-1.5rem))]',
        )}
      >
        <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
          <span className="text-sm font-semibold">Notifications</span>
          <button
            type="button"
            onClick={onMarkAll}
            disabled={unread === 0}
            className="text-xs text-gray-500 transition-colors hover:text-gray-900 disabled:cursor-default disabled:opacity-40"
          >
            Tout marquer lu
          </button>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {loading && items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">Chargement…</div>
          ) : items.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-gray-400">Aucune notification</div>
          ) : (
            items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => onItemClick(n)}
                className={cn(
                  'block w-full border-b border-black/5 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-gray-50',
                  !n.read_at && 'bg-amber-50/70',
                )}
              >
                <div className="flex items-start gap-2">
                  {!n.read_at && (
                    <span className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-gray-900">{n.title}</div>
                    {n.body && (
                      <div className="mt-0.5 line-clamp-2 text-xs text-gray-500">{n.body}</div>
                    )}
                    <div className="mt-0.5 text-[11px] text-gray-400">
                      {relativeTime(n.created_at)}
                    </div>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  ) : null;

  if (variant === 'sidebar') {
    return (
      <div className={cn('relative', collapsed ? 'px-2' : 'px-3')}>
        <button
          type="button"
          onClick={() => void toggle()}
          title="Notifications"
          className={cn(
            'flex w-full items-center gap-3 rounded-sm text-[13px] font-medium text-cream/85 transition-colors hover:bg-cream/10 hover:text-cream',
            collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
          )}
        >
          <span className="relative flex-shrink-0">
            <Bell className="h-4 w-4" strokeWidth={1.75} />
            {badge}
          </span>
          {!collapsed && <span className="truncate">Notifications</span>}
        </button>
        {panel}
      </div>
    );
  }

  // variant === 'mobile' : icône dans la barre du haut
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label="Notifications"
        className="relative p-2 text-cream transition-colors hover:text-cream/80"
      >
        <Bell className="h-5 w-5" strokeWidth={1.75} />
        {badge}
      </button>
      {panel}
    </div>
  );
}
