import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { SidebarTeam } from '@/components/layout/sidebar-team';
import { MobileNavTeam } from '@/components/layout/mobile-nav-team';

export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['ceo','chef_projet','developer','sourcing','commercial','finance','marketing','assistante','propria','achats','menage']);

  // Compteur initial de notifications non-lues (hydrate la cloche client).
  // Best effort : si la table n'existe pas encore / erreur, on part de 0.
  const supabase = createClient();
  const { count } = await supabase
    .from('propria_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .is('read_at', null)
    .is('deleted_at', null);
  const initialUnread = count ?? 0;

  return (
    <div className="min-h-screen md:flex">
      {/* Sidebar desktop (hidden < md) — contient la cloche notifications */}
      <SidebarTeam user={user} initialUnread={initialUnread} />
      <div className="flex min-h-screen flex-1 flex-col min-w-0">
        {/* Barre du haut + drawer mobile (hidden ≥ md) — cloche à côté du hamburger */}
        <MobileNavTeam user={user} initialUnread={initialUnread} />
        <main className="flex-1 p-4 md:p-8 overflow-x-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
