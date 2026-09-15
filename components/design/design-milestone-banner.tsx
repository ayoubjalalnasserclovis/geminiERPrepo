/**
 * Bandeau félicitations affiché sur la page projet client après validation
 * d'un document jalon de la phase Design.
 * Reste visible toute la phase Design (disparaît automatiquement au passage en Travaux).
 */

type Milestone = 'plans_3d' | 'lots_techniques' | 'shopping_list' | 'devis_travaux';

type ContentBlock = {
  eyebrow: string;
  emoji: string;
  title: string;
  body: React.ReactNode;
};

const CONTENT: Record<Milestone, ContentBlock> = {
  plans_3d: {
    eyebrow: 'Étape franchie',
    emoji: '🎨',
    title: 'Bravo, vos plans 3D sont validés !',
    body: (
      <>
        <p>
          Votre vision prend vie. En validant ces plans, vous venez de figer le <strong>design définitif</strong>{' '}
          de votre futur bien — c'est une étape clé du projet. Notre équipe peut maintenant lancer la
          préparation des devis artisans, sourcer les matériaux choisis et planifier le démarrage du chantier.
        </p>
        <p>
          Vous recevrez bientôt le détail des lots techniques (cuisine, salle de bain, sols, peinture…)
          et le calendrier prévisionnel des travaux.
        </p>
        <p className="text-sm text-grey-text mt-3">
          Profitez-en pour souffler quelques jours : votre prochain rendez-vous important sera la
          validation des devis avant lancement du chantier.
        </p>
      </>
    ),
  },
  lots_techniques: {
    eyebrow: 'Étape franchie',
    emoji: '🔧',
    title: 'Lots techniques validés — vos choix sont actés',
    body: (
      <>
        <p>
          Cuisine, salle de bain, sols, peinture, menuiseries… vous venez de figer chaque détail
          technique de votre futur bien. C'est une étape capitale : nos équipes peuvent désormais
          consulter les artisans pour devis, sécuriser les matériaux à long délai et préparer le
          démarrage du chantier.
        </p>
        <p>
          Vous recevrez bientôt les <strong>devis détaillés par lot</strong>, à valider avant le
          lancement des travaux.
        </p>
      </>
    ),
  },
  shopping_list: {
    eyebrow: 'Étape franchie',
    emoji: '🛋️',
    title: 'Shopping list validée — on commande votre univers',
    body: (
      <>
        <p>
          Canapé, luminaires, vaisselle, linge, déco… vous venez de valider tout le mobilier et les
          objets qui donneront son âme à votre bien. C'est l'aboutissement de votre vision esthétique.
        </p>
        <p>
          Nos équipes lancent dès maintenant les commandes auprès de nos fournisseurs marocains et
          européens. Tout sera livré et mis en place au moment de la <strong>livraison finale</strong>{' '}
          du bien.
        </p>
      </>
    ),
  },
  devis_travaux: {
    eyebrow: 'Étape franchie',
    emoji: '💶',
    title: 'Devis travaux validés — on lance le chantier',
    body: (
      <>
        <p>
          Vous venez de valider l'enveloppe financière des travaux. C'est le <strong>dernier feu vert</strong>{' '}
          avant le démarrage du chantier : nos artisans peuvent signer leurs devis, sécuriser leur
          planning et commencer leurs achats matériaux.
        </p>
        <p>
          Vous entrerez bientôt en <strong>phase Travaux</strong> — votre chef de chantier deviendra
          votre interlocuteur principal et vous recevrez un point hebdomadaire avec photos pour suivre
          l'avancement.
        </p>
      </>
    ),
  },
};

export function DesignMilestoneBanner({ milestone }: { milestone: Milestone }) {
  const c = CONTENT[milestone];
  return (
    <div className="bg-yellow/15 border-2 border-stoniz-black rounded-md p-6">
      <p className="eyebrow text-xs mb-2">{c.eyebrow}</p>
      <h2 className="font-display text-2xl mb-3 flex items-center gap-2">
        <span>{c.emoji}</span>
        <span>{c.title}</span>
      </h2>
      <div className="space-y-2 text-stoniz-black leading-relaxed">{c.body}</div>
    </div>
  );
}
