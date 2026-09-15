'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { LogOut } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import type { Role } from '@/lib/auth/require';
import { visibleTeamLinks, teamScopeLabel } from './team-links';
import { NotificationsBell } from './notifications-bell';

// Liens de navigation : source unique dans ./team-links.ts (partagée avec
// le menu mobile mobile-nav-team.tsx). Matrice des rôles documentée là-bas.

const STORAGE_KEY = 'stoniz_sidebar_collapsed';

export function SidebarTeam({ user, initialUnread = 0 }: {
  user: { full_name: string; role: Role; email: string };
  initialUnread?: number;
}) {
  const visible = visibleTeamLinks(user.role);
  const [collapsed, setCollapsed] = useState<boolean | null>(null);

  // Lire l'état initial depuis localStorage (évite flash visuel)
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    setCollapsed(stored === '1');
  }, []);

  useEffect(() => {
    if (collapsed === null) return;
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Pendant le chargement initial : on rend la version étendue (évite layout shift)
  const isCollapsed = collapsed === true;

  const scopeLabel = teamScopeLabel(user.role);

  return (
    <aside
      className={cn(
        // hidden md:flex : sur mobile la navigation passe par MobileNavTeam (drawer)
        'bg-stoniz-black text-cream min-h-screen hidden md:flex flex-col transition-all duration-200',
        isCollapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Logo cliquable = toggle */}
      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        title={isCollapsed ? 'Déplier le menu' : 'Replier le menu'}
        className={cn(
          'flex items-center hover:opacity-90 transition-opacity',
          isCollapsed ? 'p-3 justify-center' : 'p-6 gap-3',
        )}
      >
        {isCollapsed ? (
          <img
            src="/logo-icon.svg"
            alt="Stoniz"
            className="h-7 w-7"
            style={{ filter: 'brightness(0) invert(1)' }}
            onError={(e) => {
              // Fallback : si logo-icon.svg n'existe pas, on utilise le logo complet
              (e.currentTarget as HTMLImageElement).src = '/logo-full.svg';
            }}
          />
        ) : (
          <>
            <img
              src="/logo-full.svg"
              alt="Stoniz"
              className="h-7 w-auto"
              style={{ filter: 'brightness(0) invert(1)' }}
            />
          </>
        )}
      </button>
      {!isCollapsed && (
        <div className="px-6 -mt-2 mb-2 eyebrow text-cream/60">{scopeLabel}</div>
      )}

      {/* Cloche notifications (visible tous rôles staff) */}
      <div className="mb-1">
        <NotificationsBell variant="sidebar" collapsed={isCollapsed} initialUnread={initialUnread} />
      </div>

      <nav className={cn('flex-1 space-y-0.5 overflow-y-auto', isCollapsed ? 'px-2' : 'px-3')}>
        {visible.map(link => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              title={isCollapsed ? link.label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-sm text-[13px] font-medium text-cream/85 hover:bg-cream/10 hover:text-cream transition-colors',
                isCollapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2',
                !isCollapsed && link.indent && 'ml-3 text-cream/60 text-xs font-normal',
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" strokeWidth={1.75} />
              {!isCollapsed && <span className="truncate">{link.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className={cn('border-t border-cream/10', isCollapsed ? 'p-2' : 'p-4')}>
        {!isCollapsed && (
          <>
            <div className="text-sm font-semibold text-cream">{user.full_name}</div>
            <div className="text-[11px] text-cream/60 mb-3 uppercase tracking-wider">{user.role}</div>
          </>
        )}
        <form action="/logout" method="post">
          <button
            type="submit"
            title={isCollapsed ? 'Se déconnecter' : undefined}
            className={cn(
              'flex items-center gap-2 text-xs text-cream/60 hover:text-cream transition-colors',
              isCollapsed && 'justify-center w-full py-1.5',
            )}
          >
            <LogOut className="w-3.5 h-3.5" strokeWidth={1.75} />
            {!isCollapsed && 'Se déconnecter'}
          </button>
        </form>
      </div>
    </aside>
  );
}
