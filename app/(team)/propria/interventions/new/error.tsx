'use client';

// Boundary d'erreur sur le form intervention — expose digest + message pour
// pouvoir tracer les bugs réels en prod (le message est souvent vide en build
// production, mais le digest matche un log Vercel).

export default function NewInterventionError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="font-display text-2xl mb-2">Erreur lors de la création de l'intervention</h1>
      <p className="text-sm text-stoniz-gray-600 mb-4">
        Copie-colle ce bloc et envoie-le à Othmane pour qu'il identifie la cause :
      </p>
      <pre className="text-xs bg-stoniz-gray-100 border rounded-md p-4 whitespace-pre-wrap break-words mb-4">
        <strong>digest:</strong> {error.digest ?? '—'}
        {'\n'}
        <strong>message:</strong> {error.message || '(masqué en prod)'}
      </pre>
      <button
        onClick={() => reset()}
        className="px-4 py-2 rounded-md bg-stoniz-black text-white text-sm"
      >
        Recharger le formulaire
      </button>
    </div>
  );
}
