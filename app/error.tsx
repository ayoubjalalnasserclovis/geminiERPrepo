'use client';

import { useEffect } from 'react';

// Boundary global. En prod Next masque error.message mais préserve digest.
// On POST le détail vers /api/log-client-error → app_error_logs en BDD,
// qui est la seule trace persistante exploitable.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Double envoi (fetch keepalive + sendBeacon fallback) pour maximiser les
    // chances de capturer l'erreur même sur Safari iOS instable (WebView Gmail,
    // navigation privée, réseau mobile intermittent). CEO 2026-08-17.
    try {
      const payload = JSON.stringify({
        source: 'GlobalError',
        message: error?.message,
        digest: error?.digest,
        name: error?.name,
        stack: error?.stack,
        pathname: typeof window !== 'undefined' ? window.location.pathname : null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
      });
      try {
        fetch('/api/log-client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      } catch { /* swallow */ }
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
          navigator.sendBeacon('/api/log-client-error', new Blob([payload], { type: 'application/json' }));
        }
      } catch { /* swallow */ }
    } catch { /* swallow — jamais throw ici, sinon double faute */ }
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl w-full text-center">
        <h1 className="font-display text-3xl mb-4">Une erreur est survenue</h1>
        <p className="text-stoniz-gray-500 mb-4">{error.message || 'Erreur côté serveur.'}</p>

        {error.digest && (
          <div className="mb-6 text-left">
            <p className="text-xs text-stoniz-gray-500 mb-1">
              Envoie ce bloc à Othmane pour identifier la cause :
            </p>
            <pre className="text-xs bg-stoniz-gray-100 border rounded-md p-3 break-all whitespace-pre-wrap">
              <strong>digest:</strong> {error.digest}
              {'\n'}
              <strong>chemin:</strong>{' '}
              {typeof window !== 'undefined' ? window.location.pathname : ''}
              {'\n'}
              <strong>quand:</strong> {new Date().toISOString()}
            </pre>
          </div>
        )}

        <div className="flex justify-center gap-2">
          <button
            onClick={reset}
            className="bg-stoniz-black text-white px-4 py-2 rounded-md text-sm"
          >
            Réessayer
          </button>
          <a
            href="/"
            className="border px-4 py-2 rounded-md text-sm hover:bg-stoniz-gray-50"
          >
            Retour à l'accueil
          </a>
        </div>
      </div>
    </div>
  );
}
