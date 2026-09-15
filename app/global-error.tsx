'use client';

/**
 * Filet ULTIME de gestion des erreurs — CEO 2026-08-17.
 *
 * Pourquoi ce fichier existait pas avant : Next.js a 3 niveaux de boundaries.
 *   1. `error.tsx` par segment (ex : app/(client)/error.tsx) — attrape les
 *      erreurs des enfants de ce segment.
 *   2. `app/error.tsx` racine — attrape les erreurs qui remontent au-dessus
 *      de tous les segments MAIS reste enfant du root layout.
 *   3. `app/global-error.tsx` — le SEUL boundary qui remplace même le root
 *      layout (raison : si le root layout lui-même crashe, aucun autre
 *      boundary n'a d'endroit où se rendre). C'est ce qui manquait.
 *
 * Sans lui, tout crash côté client suffisamment profond (root layout, ou
 * error.tsx lui-même qui ne peut pas se rendre — cf. Safari iOS en navigation
 * privée qui bloque localStorage → Supabase browser client throw au boot →
 * error.tsx qui utilise fetch throw aussi) tombe sur le fallback interne de
 * Next : "Application error: a client-side exception has occurred". Ce que
 * les clientes voient depuis Gmail iOS.
 *
 * Contraintes de ce fichier :
 *   - Doit être 'use client'
 *   - Doit inclure <html> et <body> (il remplace le root layout)
 *   - Ne DOIT dépendre de RIEN d'externe qui pourrait crasher (pas de
 *     Supabase client, pas de icônes lucide, pas de composant Card custom)
 *   - Doit essayer de logger l'erreur SANS jamais throw (double faute)
 */

import { useEffect } from 'react';

const CONTAINER: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: '24px',
  backgroundColor: '#f5efe6',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#1a1a1a',
};

const CARD: React.CSSProperties = {
  maxWidth: 480,
  width: '100%',
  backgroundColor: '#ffffff',
  borderRadius: 8,
  border: '1px solid #e5e0d5',
  padding: 32,
  textAlign: 'center',
};

const TITLE: React.CSSProperties = { fontSize: 22, fontWeight: 600, margin: '20px 0 8px' };
const BODY: React.CSSProperties = { fontSize: 14, color: '#555', margin: '0 0 20px', lineHeight: 1.5 };
const CODE_BOX: React.CSSProperties = {
  fontSize: 11,
  backgroundColor: '#f5f5f5',
  border: '1px solid #e5e5e5',
  borderRadius: 6,
  padding: 10,
  wordBreak: 'break-all',
  textAlign: 'left',
  marginBottom: 20,
  whiteSpace: 'pre-wrap',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
const BTN_PRIMARY: React.CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '10px 16px',
  backgroundColor: '#1a1a1a',
  color: '#f5efe6',
  border: 'none',
  borderRadius: 6,
  fontSize: 14,
  fontWeight: 500,
  marginBottom: 8,
  cursor: 'pointer',
  textDecoration: 'none',
  textAlign: 'center',
};
const BTN_SECONDARY: React.CSSProperties = {
  ...BTN_PRIMARY,
  backgroundColor: '#ffffff',
  color: '#1a1a1a',
  border: '1px solid #e5e0d5',
};
const LINK: React.CSSProperties = {
  fontSize: 12,
  color: '#888',
  textDecoration: 'underline',
  marginTop: 12,
  display: 'inline-block',
};

function safeLog(error: Error & { digest?: string }) {
  try {
    const payload = JSON.stringify({
      source: 'GlobalErrorRoot',
      message: error?.message,
      digest: error?.digest,
      name: error?.name,
      stack: error?.stack,
      pathname: typeof window !== 'undefined' ? window.location.pathname : null,
      ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });

    // 1) fetch keepalive — marche même si l'utilisateur quitte la page juste après
    try {
      fetch('/api/log-client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* swallow */
    }

    // 2) sendBeacon fallback — parfois plus tolérant sur Safari iOS quand
    // fetch échoue (mode privé, réseau intermittent, redirection).
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon('/api/log-client-error', blob);
      }
    } catch {
      /* swallow */
    }
  } catch {
    /* swallow — on ne veut JAMAIS throw ici, sinon double faute */
  }
}

export default function GlobalErrorRoot({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    safeLog(error);
  }, [error]);

  const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <div style={CONTAINER}>
          <div style={CARD}>
            <img
              src="/logo-full.svg"
              alt="Stoniz"
              style={{ height: 28, width: 'auto', margin: '0 auto', opacity: 0.85 }}
              // Si le logo lui-même n'est pas dispo, on ne veut pas d'icone brisée
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            />
            <h1 style={TITLE}>Oups, une erreur est survenue</h1>
            <p style={BODY}>
              Nous n&apos;avons pas pu charger la page. Rechargez pour réessayer,
              reconnectez-vous, ou contactez votre conseiller Stoniz si le
              problème persiste.
            </p>

            {(error?.digest || pathname) && (
              <pre style={CODE_BOX}>
                {error?.digest ? `code: ${error.digest}\n` : ''}
                {pathname ? `chemin: ${pathname}\n` : ''}
                {`quand: ${new Date().toISOString()}`}
              </pre>
            )}

            <button onClick={() => reset()} style={BTN_PRIMARY}>
              Recharger la page
            </button>
            <a href="/login" style={BTN_SECONDARY}>
              Se reconnecter
            </a>
            <a href="mailto:contact@stoniz.co" style={LINK}>
              contact@stoniz.co
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
