'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { LogIn } from 'lucide-react';

// Mots-clés détectés comme indiquant une session expirée / non authentifiée.
// Couvre les throws de lib/auth/require.ts (assertRole) + erreurs JWT classiques.
const SESSION_KEYWORDS = [
  'non authentifié',
  'session expirée',
  'permission refusée',
  'unauthenticated',
  'jwt expired',
];

/**
 * Détecte si un message d'erreur de Server Action correspond à une session
 * expirée ou à un défaut d'authentification. Insensible à la casse.
 */
export function isSessionExpiredError(error: string | null | undefined): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return SESSION_KEYWORDS.some(k => lower.includes(k));
}

/**
 * Hook utilitaire : redirige automatiquement vers /login après 2 s si l'erreur
 * reçue correspond à une session expirée. Sinon ne fait rien.
 *
 * Usage :
 *   const handleAuthError = useSessionExpiredRedirect();
 *   ...
 *   if (!r.ok) { handleAuthError(r.error); setError(r.error); return; }
 */
export function useSessionExpiredRedirect() {
  const router = useRouter();
  return useCallback(
    (error: string | null | undefined) => {
      if (!isSessionExpiredError(error)) return;
      console.warn('[auth] session expirée détectée — redirection /login dans 2 s', error);
      setTimeout(() => router.push('/login'), 2000);
    },
    [router],
  );
}

/**
 * Bandeau de feedback pour les erreurs renvoyées par les Server Actions.
 *
 * - Erreur de session (Non authentifié / Permission refusée / JWT expired…) :
 *   mini bandeau ambre avec bouton "Se reconnecter" vers /login.
 * - Toute autre erreur : texte rouge classique (cohérent avec l'existant).
 * - error null : rien.
 */
export function SessionExpiredBanner({ error }: { error: string | null }) {
  const router = useRouter();

  if (!error) return null;

  if (!isSessionExpiredError(error)) {
    // Fallback : style historique des messages d'erreur dans l'ERP.
    return <div className="text-sm text-red-600">{error}</div>;
  }

  return (
    <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-md p-3 flex items-center gap-3">
      <LogIn className="w-5 h-5 shrink-0" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">Ta session a expiré</div>
        <div className="text-xs text-amber-800">Reconnecte-toi pour continuer</div>
      </div>
      <button
        type="button"
        onClick={() => router.push('/login')}
        className="bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium px-3 py-1.5 rounded shrink-0"
      >
        Se reconnecter
      </button>
    </div>
  );
}
