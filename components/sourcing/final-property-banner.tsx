/**
 * Bandeau félicitations affiché sur la page projet client dès qu'un bien
 * est officiellement sélectionné comme bien final du projet.
 * Visible toute la phase Sourcing — disparaît au passage en Compromis.
 */
export function FinalPropertyBanner({
  propertyName,
  propertyQuartier,
}: {
  propertyName: string;
  propertyQuartier?: string | null;
}) {
  return (
    <div className="bg-yellow/15 border-2 border-stoniz-black rounded-md p-6">
      <p className="eyebrow text-xs mb-2">Étape franchie</p>
      <h2 className="font-display text-2xl mb-3 flex items-center gap-2">
        <span>🏡</span>
        <span>Vous avez trouvé votre bien !</span>
      </h2>

      <div className="bg-white border border-grey-line rounded-sm p-3 mb-4 inline-block">
        <p className="text-[10px] uppercase tracking-wider text-grey-text mb-0.5">Votre bien</p>
        <p className="font-semibold text-stoniz-black">
          {propertyName}
          {propertyQuartier && <span className="text-grey-text font-normal"> — {propertyQuartier}</span>}
        </p>
      </div>

      <div className="space-y-3 text-stoniz-black leading-relaxed">
        <p>
          C'est un moment qu'on n'oublie pas. Après toutes ces visites, ces analyses et ces échanges,
          vous avez identifié le bien qui correspond à votre projet. Bravo — cette décision est la
          <strong> fondation</strong> de tout votre investissement.
        </p>
        <p>Notre équipe entre maintenant en action pour le sécuriser :</p>
        <ul className="list-disc pl-6 space-y-1 text-sm">
          <li>Négociation finale du prix avec le vendeur</li>
          <li>Vérification approfondie du titre foncier</li>
          <li>Préparation du compromis de vente chez le notaire</li>
          <li>Lancement de la visite du bureau d'études pour préparer la phase design</li>
        </ul>
        <p className="text-sm text-grey-text mt-3">
          Vous serez tenu informé à chaque étape via votre portail et par email.
        </p>
      </div>
    </div>
  );
}
