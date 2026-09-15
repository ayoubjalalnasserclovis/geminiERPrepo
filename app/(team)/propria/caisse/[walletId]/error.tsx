'use client';

import { useEffect } from 'react';

// Boundary d'erreur côté détail caisse. Capture le digest et POST le détail
// vers /api/log-client-error → persistance en BDD (app_error_logs).
// Sans ça, en prod Next masque error.message et Vercel n'a pas de log.

export default function CaisseDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    fetch('/api/log-client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'CaisseDetailError',
        message: error?.message,
        digest: error?.digest,
        name: error?.name,
        stack: error?.stack,
        pathname: typeof window !== 'undefined' ? window.location.pathname : null,
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="font-display text-2xl mb-2">Erreur de chargement de la caisse</h1>
      <p className="text-sm text-stoniz-gray-600 mb-4">
        Quelque chose a planté côté serveur. Envoie ce bloc à Othmane :
      </p>
      <pre className="text-xs bg-stoniz-gray-100 border rounded-md p-4 whitespace-pre-wrap break-words mb-4">
        <strong>digest:</strong> {error.digest ?? '—'}
        {'\n'}
        <strong>message:</strong> {error.message || '(masqué en prod)'}
      </pre>
      <div className="flex gap-2">
        <button
          onClick={() => reset()}
          className="px-4 py-2 rounded-md bg-stoniz-black text-white text-sm"
        >
          Réessayer
        </button>
        <a
          href="/propria/caisse"
          className="px-4 py-2 rounded-md border text-sm"
        >
          Retour à la liste
        </a>
      </div>
    </div>
  );
}
