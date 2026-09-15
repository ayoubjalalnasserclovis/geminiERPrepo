import Link from 'next/link';

/**
 * Garde-fou : `full_name` peut être null pour un compte fraîchement créé via
 * inviteUserByEmail si le métadonnée n'a pas été propagée dans profiles
 * (vu en prod le 30/06/2026 — 14 clients invités d'un coup, plusieurs profils
 * sans full_name côté Supabase). `.split` sur null crashait le client side.
 */
function firstNameOf(full: string | null | undefined): string {
  if (!full) return '';
  return full.split(' ')[0] ?? '';
}

export function HeaderClient({
  user,
  newDocsCount = 0,
}: {
  user: { full_name: string | null };
  /** CEO 2026-08-19 (session C) : nb de documents jamais consultés — badge sur l'onglet. */
  newDocsCount?: number;
}) {
  const first = firstNameOf(user?.full_name);
  return (
    <header className="border-b border-grey-line bg-cream sticky top-0 z-30">
      <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
        <Link href="/client" aria-label="Accueil Stoniz" className="text-stoniz-black">
          <img src="/logo-full.svg" alt="Stoniz" className="h-7 w-auto" />
        </Link>
        <nav className="flex items-center gap-5 text-sm font-medium">
          <Link href="/client" className="text-stoniz-black hover:underline underline-offset-4">Mon projet</Link>
          <Link href="/client/documents" className="text-stoniz-black hover:underline underline-offset-4 inline-flex items-center gap-1.5">
            Mes documents
            {newDocsCount > 0 && (
              <span className="bg-blue-600 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] px-1 inline-flex items-center justify-center">
                {newDocsCount > 9 ? '9+' : newDocsCount}
              </span>
            )}
          </Link>
          <Link href="/client/profile" className="text-stoniz-black hover:underline underline-offset-4">Mon profil</Link>
          {first && (
            <>
              <span className="text-grey-line hidden sm:inline">·</span>
              <span className="text-grey-text hidden sm:inline">Bonjour, {first}</span>
            </>
          )}
          <form action="/logout" method="post">
            <button className="text-grey-text hover:text-stoniz-black hover:underline underline-offset-4 transition-colors">
              Déconnexion
            </button>
          </form>
        </nav>
      </div>
    </header>
  );
}
