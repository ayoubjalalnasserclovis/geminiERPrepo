'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { clientSignPvAction } from '@/app/(team)/projects/[id]/reception/actions';

export function ClientPvSignForm({
  pvId,
  defaultName,
}: {
  pvId: string;
  defaultName: string;
}) {
  const [accepted, setAccepted] = useState(false);
  const [fullName, setFullName] = useState(defaultName);
  const [rating, setRating] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!accepted) {
      setError('Vous devez accepter le PV pour signer.');
      return;
    }
    if (!fullName.trim()) {
      setError('Votre nom complet est requis pour la signature.');
      return;
    }
    const fd = new FormData();
    fd.set('pv_id', pvId);
    fd.set('client_full_name', fullName);
    if (rating > 0) fd.set('client_satisfaction_rating', String(rating));
    startTransition(async () => {
      try {
        await clientSignPvAction(fd);
        // La page se recharge via revalidatePath
      } catch (err: any) {
        setError(err?.message ?? 'Erreur lors de la signature');
      }
    });
  }

  return (
    <section className="bg-amber-50 border-2 border-amber-300 rounded-xl p-6">
      <h2 className="text-xl font-display mb-2">✍ Signer le PV de réception</h2>
      <p className="text-sm text-stoniz-gray-700 mb-4">
        En signant ce PV, vous accusez réception de votre bien dans l'état décrit ci-dessus,
        y compris avec les réserves listées (qui resteront à lever par Stoniz / les artisans).
        Cette signature électronique vaut acceptation au sens de la loi marocaine 53-05.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">
            Votre nom complet *
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            className="w-full border border-stoniz-gray-300 rounded px-3 py-2 text-sm"
          />
          <p className="text-xs text-stoniz-gray-500 mt-1">
            Tel qu'il apparaîtra sur le PV signé.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">
            Votre satisfaction globale sur ce projet (optionnel)
          </label>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                onClick={() => setRating(rating === n ? 0 : n)}
                className={`text-2xl transition-all ${
                  n <= rating ? 'opacity-100 scale-110' : 'opacity-40 hover:opacity-70'
                }`}
                aria-label={`${n} étoile${n > 1 ? 's' : ''}`}
              >
                ⭐
              </button>
            ))}
            {rating > 0 && (
              <span className="text-sm text-stoniz-gray-600 ml-2 self-center">
                {rating}/5
              </span>
            )}
          </div>
          <p className="text-xs text-stoniz-gray-500 mt-1">
            Une enquête plus détaillée vous sera envoyée juste après votre signature.
          </p>
        </div>

        <label className="flex items-start gap-2 text-sm cursor-pointer p-3 bg-white rounded border border-stoniz-gray-300">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            Je déclare avoir pris connaissance du contenu de ce PV, des réserves listées
            (le cas échéant) et j'en accepte les termes. Je comprends que cette signature
            électronique a valeur de signature manuscrite.
          </span>
        </label>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-3 flex items-center gap-2 text-sm text-red-800">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!accepted || isPending}
          className="w-full bg-stoniz-black text-white py-3 rounded-md font-medium hover:bg-stoniz-gray-800 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isPending ? (
            'Signature en cours…'
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Signer électroniquement le PV
            </>
          )}
        </button>

        <p className="text-[11px] text-stoniz-gray-500 text-center">
          Votre adresse IP, navigateur et l'horodatage seront enregistrés pour preuve juridique.
        </p>
      </form>
    </section>
  );
}
