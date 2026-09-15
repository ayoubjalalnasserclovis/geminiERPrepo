/**
 * Contenu des guides de phase affichés au client à chaque transition.
 * 4 phases : sourcing, design, travaux, mise_en_location.
 * Le client doit scroller jusqu'en bas pour activer le bouton "J'ai lu et compris".
 */

type PhaseKey = 'sourcing' | 'design' | 'travaux' | 'mise_en_location';

export const PHASE_GUIDE_META: Record<PhaseKey, { title: string; eyebrow: string; emoji: string; pdf: string }> = {
  sourcing: {
    title: 'La recherche de votre bien',
    eyebrow: 'Phase 1 / 4',
    emoji: '🔍',
    pdf: '/guides/stoniz-guide-sourcing.pdf',
  },
  design: {
    title: 'La conception de votre bien',
    eyebrow: 'Phase 2 / 4',
    emoji: '✨',
    pdf: '/guides/stoniz-guide-design.pdf',
  },
  travaux: {
    title: 'Les travaux de votre bien',
    eyebrow: 'Phase 3 / 4',
    emoji: '🛠️',
    pdf: '/guides/stoniz-guide-travaux.pdf',
  },
  mise_en_location: {
    title: 'La mise en location de votre bien',
    eyebrow: 'Phase 4 / 4',
    emoji: '🏡',
    pdf: '/guides/stoniz-guide-mise-en-location.pdf',
  },
};

export function PhaseGuideContent({ phase }: { phase: PhaseKey }) {
  if (phase === 'sourcing') return <SourcingGuide />;
  if (phase === 'design') return <DesignGuide />;
  if (phase === 'travaux') return <TravauxGuide />;
  if (phase === 'mise_en_location') return <MiseEnLocationGuide />;
  return null;
}

/* ─────────────────────────── SOURCING ─────────────────────────── */

function SourcingGuide() {
  return (
    <article className="prose-stoniz">
      <Intro>
        Vous entrez dans la phase de <strong>sourcing</strong> : nous allons identifier le bien
        qui correspond le mieux à vos critères, à votre budget et à votre stratégie locative.
        Cette étape est <strong>capitale</strong> car le bien choisi conditionne toute la suite
        du projet (travaux, rentabilité, gestion). Prenez quelques minutes pour comprendre comment
        elle se déroule.
      </Intro>

      <Section title="Comment nous travaillons">
        <p>
          Nos équipes scannent le marché marocain (Marrakech, Casablanca, Rabat, Tanger…) à travers
          notre réseau d'<strong>agences partenaires, apporteurs d'affaires et hors-marché (off-market)</strong>.
          Pour chaque bien identifié, nous réalisons :
        </p>
        <ul>
          <li>Une visite physique ou virtuelle complète</li>
          <li>Une vérification du <strong>titre foncier</strong> et de la situation juridique</li>
          <li>Une estimation des travaux nécessaires et du potentiel locatif</li>
          <li>Une analyse de rentabilité projetée (TRI, cash-flow, payback)</li>
        </ul>
        <p>
          Vous recevez ensuite des <strong>sélections de biens classés par ordre de pertinence</strong>{' '}
          (1 = meilleur), accompagnées d'une note de votre conseiller expliquant les choix.
        </p>
      </Section>

      <Section title="Combien de temps ça prend ?">
        <p>
          <strong>2 à 8 semaines</strong> en moyenne, parfois davantage selon vos critères.
          La rareté de certains profils (riads avec terrasse panoramique, appartements en R+1 au
          Gueliz, etc.) peut allonger les délais. Nous privilégions toujours <strong>la qualité du
          bien à la rapidité</strong> de la transaction.
        </p>
        <Callout title="Bon à savoir">
          Plus vos critères sont précis, plus la recherche est rapide. À l'inverse, ouvrir le périmètre
          (quartier, surface, état) multiplie les opportunités.
        </Callout>
      </Section>

      <Section title="Ce qu'on peut anticiper">
        <ul>
          <li>
            <strong>Définir un budget enveloppe</strong> (achat + travaux + frais) clair dès le départ.
            Cela évite les mauvaises surprises et nous permet d'écarter d'office les biens hors cible.
          </li>
          <li>
            <strong>Préparer vos fonds propres</strong> : si vous financez par épargne, anticipez le
            transfert sur votre compte au Maroc (délais bancaires variables).
          </li>
          <li>
            <strong>Choisir la stratégie locative</strong> en amont (Airbnb courte durée, location
            meublée longue durée, mix) — elle oriente le sourcing.
          </li>
          <li>
            <strong>Verrouiller votre disponibilité</strong> pour valider les biens : une réponse rapide
            (24-48h) sur les biens off-market peut faire la différence avec d'autres acheteurs.
          </li>
        </ul>
      </Section>

      <Section title="Les risques à connaître">
        <ul>
          <li>
            <strong>La pénurie de biens premium.</strong> Le marché marocain en zones touristiques est
            tendu. Certains profils rares peuvent prendre plusieurs mois. Refuser tous les biens
            « 80% parfaits » pour viser le « 100% » est un risque réel — nous vous conseillerons sur
            le compromis acceptable.
          </li>
          <li>
            <strong>La double-vente / vendeur indélicat.</strong> Rare mais existant. Nous vérifions
            systématiquement le titre foncier auprès de la conservation foncière avant tout compromis.
          </li>
          <li>
            <strong>L'écart entre prix affiché et prix réel.</strong> Au Maroc, les annonces affichent
            souvent un prix « négociable » de 10-20% au-dessus du marché. Nous négocions pour vous.
          </li>
          <li>
            <strong>L'évolution des prix.</strong> Les biens prisés peuvent prendre +5 à +10% en
            quelques mois. Trop attendre coûte parfois plus cher que d'agir.
          </li>
        </ul>
      </Section>

      <Section title="Le protocole étape par étape">
        <ol>
          <li>Vous validez votre cahier des charges (déjà fait ✓)</li>
          <li>Nous démarrons le sourcing — vous recevez des sélections régulières</li>
          <li>Vous donnez votre avis sur chaque bien (intéressé / pas intéressé / besoin d'infos)</li>
          <li>Visite physique ou virtuelle des biens shortlistés</li>
          <li>Nous négocions le prix avec le vendeur</li>
          <li>Signature du compromis chez le notaire — versement de l'acompte (5-10%)</li>
          <li>Acte authentique 30 à 60 jours plus tard — vous êtes propriétaire 🎉</li>
        </ol>
      </Section>

      <Section title="Notre engagement">
        <p>
          Nous ne touchons <strong>aucune rétro-commission</strong> des agences ou vendeurs. Notre
          rémunération vient exclusivement de vos honoraires Stoniz, ce qui garantit notre
          <strong> indépendance totale</strong> dans la sélection des biens. Si un bien n'est pas bon
          pour vous, nous vous le dirons — même si vous avez « eu un coup de cœur ».
        </p>
      </Section>

      <Outro>
        En cliquant sur « J'ai lu et compris », vous confirmez avoir pris connaissance du déroulement
        de cette phase, des délais, des risques et de notre protocole. Vous recevrez ce document par
        email pour pouvoir le consulter à tout moment.
      </Outro>
    </article>
  );
}

/* ─────────────────────────── DESIGN ─────────────────────────── */

function DesignGuide() {
  return (
    <article className="prose-stoniz">
      <Intro>
        Bravo, votre bien est sécurisé ! Vous entrez maintenant dans la phase <strong>design</strong> :
        c'est ici que votre futur appartement prend vie sur le papier. Cette étape conditionne le confort
        d'usage, l'attractivité locative et la valeur revente. Lisez attentivement ce qui suit pour
        bien collaborer avec nos architectes.
      </Intro>

      <Section title="Comment nous travaillons">
        <p>
          Notre studio d'architecture interne et notre bureau d'études (BET) techniques vont produire
          pour vous :
        </p>
        <ul>
          <li>
            Une sélection de <strong>moodboards d'inspiration</strong> dont vous choisissez 1 ou 2
            (cette étape est en cours).
          </li>
          <li>
            Les <strong>plans 3D rendus photoréalistes</strong> de chaque pièce.
          </li>
          <li>
            Les <strong>plans techniques BET</strong> (électricité, plomberie, climatisation, structure).
          </li>
          <li>
            Le <strong>cahier des charges détaillé</strong> par lot (cuisine, SDB, menuiserie, sols, peinture).
          </li>
          <li>
            La <strong>shopping list mobilier &amp; déco</strong> chiffrée et prête à l'achat.
          </li>
        </ul>
      </Section>

      <Section title="Combien de temps ça prend ?">
        <p>
          <strong>4 à 8 semaines</strong>, selon la complexité du bien et le nombre d'aller-retours
          sur les visuels. Plus vos retours sur les premiers rendus sont précis, plus la phase est
          courte.
        </p>
        <Callout title="Bon à savoir">
          Les modifications après validation des plans BET <strong>coûtent cher</strong> en chantier
          (casse, reprises, retards). Prenez le temps de valider sereinement maintenant.
        </Callout>
      </Section>

      <Section title="Ce qu'on peut anticiper">
        <ul>
          <li>
            <strong>Soyez précis dans vos retours.</strong> « Je n'aime pas » ne suffit pas — dites-nous
            ce qui vous gêne (matière, couleur, proportion) pour qu'on puisse ajuster efficacement.
          </li>
          <li>
            <strong>Pensez usage avant esthétique.</strong> Un bien Airbnb se conçoit différemment d'un
            bien à louer en longue durée. Notre architecte vous orientera.
          </li>
          <li>
            <strong>Anticipez les contraintes structurelles.</strong> Certains murs sont porteurs, certaines
            colonnes incontournables. Le BET vous le dira clairement.
          </li>
          <li>
            <strong>Validez les pièces étape par étape.</strong> Plutôt que de tout revoir d'un coup,
            nous procédons pièce par pièce pour avancer sereinement.
          </li>
        </ul>
      </Section>

      <Section title="Les risques à connaître">
        <ul>
          <li>
            <strong>L'envie de tout personnaliser.</strong> Plus le bien est « unique », plus il est
            difficile à revendre ou à louer. Nous vous orientons vers des choix esthétiques pérennes
            et largement appréciés.
          </li>
          <li>
            <strong>Le décalage budget vs. attentes.</strong> Une cuisine premium italienne ne rentre
            pas dans tous les budgets. Nous ajustons les ambitions au budget travaux validé.
          </li>
          <li>
            <strong>Les retards de validation.</strong> Si vous tardez à valider les plans, la phase
            travaux glisse d'autant. Un plan validé en 1 semaine = 1 semaine de chantier gagnée.
          </li>
          <li>
            <strong>Les modifications post-validation.</strong> Une fois les plans BET signés, toute
            modification = avenant + délai supplémentaire + surcoût.
          </li>
        </ul>
      </Section>

      <Section title="Le protocole étape par étape">
        <ol>
          <li>Vous sélectionnez 1 ou 2 moodboards (en cours)</li>
          <li>Notre architecte conçoit les plans 2D + 3D</li>
          <li>Vous validez les rendus visuels pièce par pièce</li>
          <li>Le bureau d'études produit les plans techniques (BET)</li>
          <li>Vous validez le plan BET final (étape obligatoire)</li>
          <li>Nous préparons les devis artisans pour la phase travaux</li>
        </ol>
      </Section>

      <Section title="Sur les choix de matériaux">
        <p>
          Tous nos matériaux sont sélectionnés pour leur <strong>durabilité, leur facilité d'entretien
          et leur attrait visuel</strong>. Nous évitons les modes éphémères et privilégions les
          classiques modernes (tadelakt, zellige, bois massif, marbre de qualité).
        </p>
        <p>
          Si vous avez des allergies, des préférences fortes (vegan, sans bois exotique, etc.) ou des
          contraintes religieuses sur certains matériaux, signalez-le maintenant à votre conseiller.
        </p>
      </Section>

      <Outro>
        En cliquant sur « J'ai lu et compris », vous confirmez avoir pris connaissance du déroulement
        de la phase design, du processus de validation et des risques. Vous recevrez ce document par
        email.
      </Outro>
    </article>
  );
}

/* ─────────────────────────── TRAVAUX ─────────────────────────── */

function TravauxGuide() {
  return (
    <article className="prose-stoniz">
      <Intro>
        Le chantier démarre ! C'est la phase la plus <strong>longue, la plus visible et la plus
        sensible</strong> du projet. C'est aussi celle où nous mobilisons le plus d'énergie pour
        vous protéger des aléas. Lisez ce guide en entier — il vous évitera bien des inquiétudes
        pendant les 5 à 6 prochains mois.
      </Intro>

      <Section title="Comment nous travaillons">
        <p>
          Nous orchestrons en direct <strong>5 à 8 corps d'état</strong> sur votre chantier :
          gros œuvre, électricité, plomberie, climatisation, menuiserie, peinture, carrelage, finitions.
        </p>
        <p>
          Notre chef de chantier passe sur place <strong>toutes les semaines</strong> et vous envoie
          un point hebdomadaire avec photos. Toutes les décisions importantes vous sont remontées en
          amont.
        </p>
      </Section>

      <Section title="Combien de temps ça prend ?">
        <p>
          <strong>5 à 6 mois</strong> en moyenne pour une rénovation complète, selon :
        </p>
        <ul>
          <li>La taille du bien (m²)</li>
          <li>L'étendue des travaux (rafraîchissement vs. restructuration complète)</li>
          <li>La disponibilité des artisans (haute saison = délais)</li>
          <li>Les aléas (découvertes en gros œuvre, retards fournisseurs)</li>
        </ul>
        <p>
          Nous vous remettons un <strong>planning prévisionnel</strong> en début de chantier, mis à
          jour mensuellement.
        </p>
      </Section>

      <Section title="Ce qu'on peut anticiper">
        <ul>
          <li>
            <strong>Vous éloigner si vous êtes anxieux.</strong> Visiter le chantier en cours est
            <strong> souvent angoissant</strong> (béton brut, gravats, désordre apparent). Faites-nous
            confiance — c'est normal jusqu'au mois 4-5.
          </li>
          <li>
            <strong>Anticiper les achats long délai.</strong> Cuisine italienne, marbre sur mesure,
            menuiserie sur mesure : 6 à 12 semaines de fabrication. Nous commandons dès la validation
            BET pour gagner du temps.
          </li>
          <li>
            <strong>Documenter en photo.</strong> Nous photographions chaque étape (avant, pendant,
            après) pour la traçabilité et la valorisation revente.
          </li>
        </ul>
      </Section>

      <Section title="Les risques à connaître">
        <ul>
          <li>
            <strong>Les découvertes en gros œuvre.</strong> Mur fissuré, canalisation rouillée, structure
            non conforme : c'est <strong>quasi-systématique</strong> sur les biens anciens.
          </li>
          <li>
            <strong>Les retards fournisseurs.</strong> Marbre en provenance d'Italie, robinetterie de
            marque, électroménager allemand : les délais peuvent glisser de 2 à 6 semaines.
          </li>
          <li>
            <strong>Les artisans défaillants.</strong> Rare avec nos partenaires habituels, mais
            possible. Nous avons des plans B sur chaque lot et nous payons toujours par <strong>acomptes
            sur avancement</strong>, jamais d'avance.
          </li>
          <li>
            <strong>Les modifications en cours de chantier.</strong> Chaque changement = devis avenant
            + délai + coût. Nous vous le déconseillons fermement sauf vraie nécessité.
          </li>
          <li>
            <strong>Les saisons.</strong> Ramadan, Aïd, été (chaleur extrême) ralentissent les chantiers.
            Nous lissons l'effort sur l'année.
          </li>
        </ul>
      </Section>

      <Section title="Comment nous vous protégeons">
        <ul>
          <li>
            <strong>Validation devis par lot.</strong> Vous validez chaque devis avant lancement.
            Aucune dépense sans votre accord.
          </li>
          <li>
            <strong>Photos hebdomadaires.</strong> Vous suivez le chantier comme si vous étiez sur place.
          </li>
        </ul>
      </Section>

      <Section title="Le protocole étape par étape">
        <ol>
          <li>Validation des devis artisans (lot par lot)</li>
          <li>Démolition et gros œuvre (mois 1-2)</li>
          <li>Réseaux : électricité, plomberie, climatisation (mois 2)</li>
          <li>Maçonnerie de second œuvre, cloisons, enduits (mois 2-3)</li>
          <li>Carrelage, sols, faïence (mois 3-4)</li>
          <li>Menuiserie, peinture, finitions (mois 4-5)</li>
          <li>Cuisine et SDB équipées (mois 5)</li>
          <li>Nettoyage, livraison du bien fini (mois 5-6)</li>
        </ol>
      </Section>

      <Outro>
        En cliquant sur « J'ai lu et compris », vous confirmez avoir pris connaissance du déroulement
        du chantier, des délais, des risques et de notre protocole de protection. Vous recevrez ce
        document par email.
      </Outro>
    </article>
  );
}

/* ─────────────────────────── MISE EN LOCATION ─────────────────────────── */

function MiseEnLocationGuide() {
  return (
    <article className="prose-stoniz">
      <Intro>
        Votre bien est livré, meublé et opérationnel : il est temps de le <strong>rentabiliser</strong>.
        C'est maintenant que tout le travail amont prend son sens. Notre équipe Propria prend le relais
        pour gérer votre bien comme si c'était le nôtre.
      </Intro>

      <Section title="Comment nous travaillons">
        <p>
          Notre service de conciergerie <strong>Propria by Stoniz</strong> opère votre bien de A à Z :
        </p>
        <ul>
          <li>Création et optimisation des annonces (Airbnb, Booking, Vrbo, etc.)</li>
          <li>Yield management : ajustement des prix en temps réel selon la demande</li>
          <li>Accueil des voyageurs (check-in, check-out, remise de clés)</li>
          <li>Ménage et linge hôtelier entre chaque séjour</li>
          <li>Maintenance préventive trimestrielle (obligatoire)</li>
          <li>Gestion des incidents 24/7</li>
          <li>Reporting mensuel des revenus et dépenses</li>
        </ul>
      </Section>

      <Section title="Combien de temps avant d'avoir des revenus ?">
        <p>
          <strong>2 à 4 semaines</strong> après la livraison :
        </p>
        <ul>
          <li>Semaine 1 : shooting photo professionnel + rédaction des annonces</li>
          <li>Semaine 2 : mise en ligne sur les plateformes + premières réservations</li>
          <li>Semaine 3-4 : premiers voyageurs, premiers revenus</li>
        </ul>
        <p>
          Le <strong>taux d'occupation</strong> monte progressivement sur les 3 premiers mois (effet
          « jeune annonce »), puis se stabilise.
        </p>
      </Section>

      <Section title="Ce qu'on peut anticiper">
        <ul>
          <li>
            <strong>Compter sur 60-75% d'occupation</strong> en moyenne annuelle pour un bien bien
            géré en zone touristique marocaine. Les pics (avril-mai, septembre-octobre, vacances
            scolaires) compensent les creux (août très chaud, janvier-février).
          </li>
          <li>
            <strong>Anticiper les charges fixes.</strong> Eau, électricité, internet, syndic, taxes
            locales — environ 100-300 €/mois selon le bien.
          </li>
          <li>
            <strong>Provisionner pour le renouvellement.</strong> Linge, vaisselle, petits équipements
            : prévoir 2-3% du CA en remplacements annuels.
          </li>
          <li>
            <strong>Visiter votre bien.</strong> Vous pouvez réserver vos propres dates (selon
            disponibilité) — sans frais, gratuitement, sur réservation 30 jours à l'avance.
          </li>
        </ul>
      </Section>

      <Section title="Les risques à connaître">
        <ul>
          <li>
            <strong>L'évolution réglementaire.</strong> Les règles sur la location courte durée
            évoluent (autorisation préfectorale, plafonds annuels, taxes). Nous vous tenons informés
            de tout changement.
          </li>
          <li>
            <strong>Les voyageurs problématiques.</strong> Casse, fête bruyante, plaintes voisinage —
            statistiquement &lt; 2% des séjours. Notre filtrage en amont (caution, score voyageur)
            minimise le risque, mais zéro risque n'existe pas.
          </li>
          <li>
            <strong>La saisonnalité.</strong> Été à Marrakech (45°C) = creux d'occupation, à
            anticiper budgétairement.
          </li>
          <li>
            <strong>L'usure naturelle.</strong> Un bien loué 200 nuits par an s'use 5x plus vite qu'une
            résidence principale. Rénovations à prévoir tous les 5-7 ans.
          </li>
          <li>
            <strong>La concurrence locale.</strong> De nouveaux biens apparaissent en permanence sur
            les plateformes. Nous adaptons vos tarifs et votre offre pour rester compétitifs.
          </li>
        </ul>
      </Section>

      <Section title="Notre protocole opérationnel">
        <ul>
          <li>
            <strong>Maintenance préventive trimestrielle obligatoire.</strong> Climatisation, plomberie,
            électricité, chaudière : vérifications systématiques pour éviter les pannes pendant les
            séjours.
          </li>
          <li>
            <strong>Ménage hôtelier entre chaque voyageur.</strong> Linge propre, désinfection, kit
            d'accueil — toujours.
          </li>
          <li>
            <strong>Caution voyageurs.</strong> Empreinte CB ou caution bloquée pour couvrir les
            éventuels dégâts.
          </li>
          <li>
            <strong>Astreinte 24/7.</strong> Un voyageur a un problème la nuit ? Nous répondons.
          </li>
          <li>
            <strong>Reporting financier mensuel.</strong> CA, charges, net à percevoir, taxes — tout
            est tracé.
          </li>
        </ul>
      </Section>

      <Section title="Versement de vos revenus">
        <p>
          Vos revenus locatifs vous sont versés <strong>mensuellement</strong> (en fin de mois suivant),
          déduction faite des frais de conciergerie, charges courantes et taxes. Le reporting détaillé
          accompagne chaque versement.
        </p>
      </Section>

      <Outro>
        En cliquant sur « J'ai lu et compris », vous confirmez avoir pris connaissance du fonctionnement
        de la gestion locative, des risques et de notre protocole. Vous recevrez ce document par email.
        Bienvenue dans la communauté des investisseurs Stoniz 🎉
      </Outro>
    </article>
  );
}

/* ─────────────────────────── PRIMITIVES ─────────────────────────── */

function Intro({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-yellow/20 border-l-4 border-stoniz-black p-5 rounded-sm mb-6">
      <p className="text-stoniz-black leading-relaxed m-0">{children}</p>
    </div>
  );
}

function Outro({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-8 pt-6 border-t-2 border-stoniz-black">
      <p className="text-sm text-grey-text leading-relaxed italic">{children}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="font-display text-xl mb-3 text-stoniz-black">{title}</h3>
      <div className="space-y-3 text-stoniz-black leading-relaxed [&_ul]:space-y-1.5 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:space-y-1.5 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:m-0">
        {children}
      </div>
    </section>
  );
}

function Callout({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-cream-soft border border-grey-line rounded-sm p-4 my-3">
      <p className="text-xs font-bold uppercase tracking-wider text-stoniz-black mb-1">💡 {title}</p>
      <div className="text-sm text-stoniz-black leading-relaxed">{children}</div>
    </div>
  );
}
