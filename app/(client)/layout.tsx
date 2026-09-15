import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { requireRole } from '@/lib/auth/require';
import { createClient } from '@/lib/supabase/server';
import { HeaderClient } from '@/components/layout/header-client';

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireRole(['client']);

  // Détermine l'URL courante (next-url custom header injecté par middleware Next)
  const h = headers();
  const path = h.get('x-pathname') ?? h.get('next-url') ?? '';

  // Gate onboarding : si pas complété ET pas déjà sur /client/onboarding → redirect.
  // Pattern défensif : on emballe la query dans try/catch — si Supabase tombe
  // (rare mais déjà vu en prod), on dégrade vers l'onboarding plutôt que de
  // laisser le layout throw et déclencher "Application error: client-side exception".
  let client: { id: string; onboarding_completed_at: string | null; profile_id?: string | null } | null = null;
  try {
    const supabase = createClient();
    const { data: byProfile } = await supabase
      .from('clients')
      .select('id, onboarding_completed_at')
      .eq('profile_id', user.id)
      .maybeSingle();
    client = byProfile;

    // Fallback : lookup par email (user invité avant que sa fiche client soit créée)
    if (!client && user.email) {
      const { data: byEmail } = await supabase
        .from('clients')
        .select('id, onboarding_completed_at, profile_id')
        .eq('email', user.email)
        .is('profile_id', null)
        .maybeSingle();
      if (byEmail) {
        await supabase.from('clients').update({ profile_id: user.id }).eq('id', byEmail.id);
        client = byEmail;
      }
    }
  } catch (e) {
    // On NE throw PAS — on dégrade vers l'onboarding (page de courtoisie).
    // Si on est déjà sur /client/onboarding, on continue (sinon redirect loop).
    console.error('[client-layout] clients lookup failed', e);
  }

  const onOnboarding = path.includes('/client/onboarding');
  // Pas de fiche client OU onboarding incomplet → /client/onboarding (qui affichera le bon message)
  if ((!client || !client.onboarding_completed_at) && !onOnboarding) {
    redirect('/client/onboarding');
  }

  // CEO 2026-08-19 (session C) : compteur de documents jamais consultés pour
  // le badge de l'onglet « Mes documents ». Défensif : un échec de comptage ne
  // doit jamais casser le layout (badge à 0 par défaut).
  let newDocsCount = 0;
  try {
    const supabase = createClient();
    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('is_visible_to_client', true)
      .eq('uploaded_by_role', 'stoniz')
      .is('client_first_viewed_at', null)
      .is('deleted_at', null);
    newDocsCount = count ?? 0;
  } catch (e) {
    console.warn('[client-layout] comptage nouveaux documents échec', e);
  }

  return (
    <div className="min-h-screen flex flex-col bg-cream">
      <HeaderClient user={user} newDocsCount={newDocsCount} />
      <main className="max-w-5xl mx-auto px-6 py-10 w-full flex-1">{children}</main>
      <footer className="border-t border-grey-line mt-8 py-6 bg-cream">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-xs text-grey-text flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <img src="/icon.svg" alt="" className="h-4 w-auto opacity-70" />
            <span>Stoniz — investissement immobilier clé en main au Maroc</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="mailto:contact@stoniz.co" className="hover:text-stoniz-black">contact@stoniz.co</a>
            <a href="https://stoniz.co" target="_blank" rel="noopener" className="hover:text-stoniz-black">stoniz.co</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
