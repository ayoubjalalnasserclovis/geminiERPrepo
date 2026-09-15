/**
 * Bandeau félicitations affiché sur la page projet client quand la date de
 * signature de l'acte authentique est renseignée par l'équipe.
 * Reste visible toute la phase Design — disparaît au passage en Travaux.
 */
export function ActeAuthentiqueBanner({ signedAt }: { signedAt: string }) {
  const dateStr = new Date(signedAt).toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div className="bg-yellow/15 border-2 border-stoniz-black rounded-md p-6">
      <p className="eyebrow text-xs mb-2">Étape franchie</p>
      <h2 className="font-display text-2xl mb-3 flex items-center gap-2">
        <span>🔑</span>
        <span>C'est officiel, vous êtes propriétaire !</span>
      </h2>

      <div className="bg-white border border-grey-line rounded-sm p-3 mb-4 inline-block">
        <p className="text-[10px] uppercase tracking-wider text-grey-text mb-0.5">
          Date de signature de l'acte authentique
        </p>
        <p className="font-semibold text-stoniz-black">{dateStr}</p>
      </div>

      <div className="space-y-3 text-stoniz-black leading-relaxed">
        <p>
          Vous venez de signer l'acte authentique chez le notaire — le bien est désormais à votre nom.
          C'est une étape majeure de votre projet, <strong>félicitations</strong> 🎉
        </p>
        <p>
          Notre équipe peut maintenant lancer toutes les démarches travaux : finalisation des devis
          artisans, autorisations administratives, et démarrage du chantier dans les prochaines semaines.
        </p>
      </div>
    </div>
  );
}
