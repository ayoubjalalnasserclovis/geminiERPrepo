'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Menu, X, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Role } from '@/lib/auth/require';
import { visibleTeamLinks, teamScopeLabel } from './team-links';
import { NotificationsBell } from './notifications-bell';

/**
 * Navigation mobile de l'espace équipe (visible < md uniquement).
 * Barre du haut sticky (logo + cloche notifications + hamburger) + drawer
 * plein écran qui reprend exactement les mêmes liens par rôle que la
 * sidebar desktop (team-links.ts).
 */
export function MobileNavTeam({ user, initialUnread = 0 }: {
  user: { full_name: string; role: Role; email: string };
  initialUnread?: number;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const visible = visibleTeamLinks(user.role);

  // Ferme le drawer à chaque navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Bloque le scroll de la page quand le drawer est ouvert
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <div className="md:hidden">
      {/* Barre du haut */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-stoniz-black text-cream px-4 py-3">
        <Link href="/dashboard" aria-label="Accueil">
          <img
            src="/logo-full.svg"
            alt="Stoniz"
            className="h-6 w-auto"
            style={{ filter: 'brightness(0) invert(1)' }}
          />
        </Link>
        <div className="flex items-center gap-1">
          {/* Cloche notifications — reste accessible sans ouvrir le drawer */}
          <NotificationsBell variant="mobile" initialUnread={initialUnread} />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Ouvrir le menu"
            className="p-2 -mr-2 text-cream hover:text-cream/80 transition-colors"
          >
            <Menu className="w-6 h-6" strokeWidth={1.75} />
          </button>
        </div>
      </header>

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-50">
          {/* Voile */}
          <button
            type="button"
            aria-label="Fermer le menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-black/50"
          />
          {/* Panneau */}
          <div className="absolute inset-y-0 right-0 w-[85%] max-w-xs bg-stoniz-black text-cream flex flex-col shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-cream/10">
              <div className="eyebrow text-cream/60">{teamScopeLabel(user.role)}</div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="p-2 -mr-2 text-cream hover:text-cream/80 transition-colors"
              >
                <X className="w-6 h-6" strokeWidth={1.75} />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
              {visible.map(link => {
                const Icon = link.icon;
                const active = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      'flex items-center gap-3 rounded-sm px-3 py-2.5 text-sm font-medium text-cream/85 hover:bg-cream/10 hover:text-cream transition-colors',
                      link.indent && 'ml-3 text-cream/60 text-[13px] font-normal',
                      active && 'bg-cream/10 text-cream',
                    )}
                  >
                    <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
                    <span className="truncate">{link.label}</span>
                  </Link>
                );
              })}
            </nav>

            <div className="border-t border-cream/10 p-4">
              <div className="text-sm font-semibold text-cream">{user.full_name}</div>
              <div className="text-[11px] text-cream/60 mb-3 uppercase tracking-wider">{user.role}</div>
              <form action="/logout" method="post">
                <button
                  type="submit"
                  className="flex items-center gap-2 py-1.5 text-xs text-cream/60 hover:text-cream transition-colors"
                >
                  <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
                  Se déconnecter
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
