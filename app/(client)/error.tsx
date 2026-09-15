'use client';

/**
 * Error boundary scopé au portail client (groupe de route /client).
 *
 * Pourquoi : un client invité qui voit "Application error: a client-side
 * exception has occurred" reste bloqué sans pouvoir réagir. Un boundary
 * dédié donne un message clair, le digest pour support, et 3 actions
 * concrètes (réessayer, login, contacter).
 *
 * Log : on POST le détail vers /api/log-client-error (best-effort) pour
 * que toute occurrence soit traçable côté BDD (app_error_logs).
 */
import { useEffect } from 'react';

export default function ClientPortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // best-effort, ne JAMAIS throw ici (sinon double-faute)
    try {
      fetch('/api/log-client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'ClientPortalError',
          message: error?.message,
          digest: error?.digest,
          name: error?.name,
          stack: error?.stack,
          pathname: typeof window !== 'undefined' ? window.location.pathname : null,
          ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        }),
        keepalive: true,
      }).catch(() => {});
    } catch {
      /* swallow */
    }
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-cream">
      <div className="max-w-md w-full bg-white rounded-md border border-grey-line p-8 text-center">
        <img src="/logo-full.svg" alt="Stoniz" className="h-7 w-auto mx-auto mb-6 opacity-80" />
        <h1 className="font-display text-2xl mb-2">Oups, une erreur est survenue</h1>
        <p className="text-sm text-stoniz-gray-600 mb-6">
          Nous n&apos;avons pas pu charger votre espace. Rechargez la page ou
          essayez de vous reconnecter. Si le problème persiste, contactez votre
          conseiller Stoniz.
        </p>

        {error?.digest && (
          <div className="mb-6 text-left">
            <p className="text-xs text-stoniz-gray-500 mb-1">
              Code à transmettre au support&nbsp;:
            </p>
            <pre className="text-[11px] bg-stoniz-gray-100 border rounded-md p-2 break-all whitespace-pre-wrap">
              {error.digest}
            </pre>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={reset}
            className="bg-stoniz-black text-cream px-4 py-2.5 rounded-md text-sm font-medium"
          >
            Recharger
          </button>
          <a
            href="/login"
            className="border border-grey-line px-4 py-2.5 rounded-md text-sm hover:bg-stoniz-gray-50"
          >
            Se reconnecter
          </a>
          <a
            href="mailto:contact@stoniz.co"
            className="text-xs text-stoniz-gray-500 hover:text-stoniz-black underline underline-offset-2 pt-2"
          >
            contact@stoniz.co
          </a>
        </div>
      </div>
    </div>
  );
}
