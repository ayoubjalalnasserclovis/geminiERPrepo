// Bibliothèque de modèles de message réutilisables dans le journal de suivi projet.
// Les variables {{client}}, {{bien}}, {{quartier}}, {{phase}} ne sont pas auto-substituées
// (le chef de projet remplace à la main pour rester maître du ton).

export type MessageTemplate = {
  id: string;
  category: string;
  title: string;
  body: string;
  defaultCategory?: 'note'|'appel'|'reunion'|'suivi_chantier'|'interne'|'client'|'partenaire'|'alerte';
};

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  // ─── Client ──────────────────────────────────────────────────────────
  {
    id: 'premier_contact',
    category: 'Client',
    title: 'Premier contact post-onboarding',
    defaultCategory: 'appel',
    body: `Premier appel téléphonique avec {{client}}.

Points couverts :
- Validation du cahier des charges
- Calendrier prévisionnel (sourcing 6-8 semaines, design 4 semaines, travaux 12-16 semaines)
- Étapes de signature côté notaire
- Modalités de virement des honoraires Stoniz

À faire ensuite : envoi du contrat de mission par email + rappel sous 3 jours.`,
  },
  {
    id: 'relance_paiement',
    category: 'Client',
    title: 'Relance virement non reçu',
    defaultCategory: 'appel',
    body: `Relance téléphonique concernant le paiement {{jalon}}.

Le virement n'apparaît pas encore sur notre compte. Le client confirme l'avoir initié le {{date}} via {{banque}}.

Action : vérifier en J+2 et débloquer si besoin.`,
  },
  {
    id: 'visite_bien_client',
    category: 'Client',
    title: 'Compte-rendu visite avec le client',
    defaultCategory: 'reunion',
    body: `Visite du bien {{bien}} à {{quartier}} avec {{client}}.

Impressions client :
- Points appréciés :
- Points d'inquiétude :
- Questions soulevées :

Décision : ☐ Intéressé · ☐ Pas intéressé · ☐ À reconsidérer

Suite à donner :`,
  },

  // ─── Sourcing ────────────────────────────────────────────────────────
  {
    id: 'visite_sourcing',
    category: 'Sourcing',
    title: 'Visite terrain bien candidat',
    defaultCategory: 'note',
    body: `Visite du bien à {{adresse}} avec {{agence}}.

État général : ☐ Bon · ☐ Moyen · ☐ À rénover lourdement

Points forts :
Points faibles :
Travaux estimés :
Marge potentielle :

Décision : ☐ Sourcer · ☐ Refuser · ☐ Négocier prix`,
  },
  {
    id: 'negociation_partenaire',
    category: 'Sourcing',
    title: 'Négociation prix partenaire',
    defaultCategory: 'partenaire',
    body: `Échange avec {{agence}} sur le bien {{bien}}.

Prix annoncé : {{prix}} EUR
Offre Stoniz : {{offre}} EUR
Réponse :

Échéance de réponse : {{date}}.`,
  },

  // ─── Travaux ─────────────────────────────────────────────────────────
  {
    id: 'demarrage_chantier',
    category: 'Travaux',
    title: 'Démarrage chantier',
    defaultCategory: 'suivi_chantier',
    body: `Démarrage officiel du chantier ce jour.

Artisans présents :
Lots démarrés :
État initial photos : (lien Drive)
Délais annoncés :

Point d'attention :`,
  },
  {
    id: 'point_chantier_hebdo',
    category: 'Travaux',
    title: 'Point chantier hebdomadaire',
    defaultCategory: 'suivi_chantier',
    body: `Point de la semaine du {{semaine}}.

Avancement :
- {{lot}} : {{pct}}% terminé
- {{lot2}} : démarré
- {{lot3}} : en attente

Blocages :
Décisions à prendre :
Photos transmises au client : ☐ Oui · ☐ Non`,
  },
  {
    id: 'incident_chantier',
    category: 'Travaux',
    title: 'Incident chantier — alerte',
    defaultCategory: 'alerte',
    body: `Incident remonté ce jour.

Nature :
Lot impacté :
Conséquence sur le planning :
Surcoût estimé :

Action immédiate :
Client informé : ☐ Oui · ☐ Non`,
  },

  // ─── Partenaire / artisan ────────────────────────────────────────────
  {
    id: 'demande_devis',
    category: 'Partenaire',
    title: 'Demande de devis artisan',
    defaultCategory: 'partenaire',
    body: `Demande de devis envoyée à {{artisan}}.

Périmètre :
Spécifications techniques :
Délai attendu pour le devis : 7 jours
Budget cible : {{budget}} MAD`,
  },
  {
    id: 'evaluation_artisan',
    category: 'Partenaire',
    title: 'Évaluation artisan post-lot',
    defaultCategory: 'interne',
    body: `Évaluation de {{artisan}} après le lot {{lot}}.

Qualité du travail : ⭐⭐⭐⭐⭐
Respect des délais : ⭐⭐⭐⭐⭐
Communication : ⭐⭐⭐⭐⭐
Prix vs marché : ⭐⭐⭐⭐⭐

Recommandation pour futurs projets : ☐ Oui · ☐ Avec réserve · ☐ Non
Commentaires :`,
  },

  // ─── Interne ─────────────────────────────────────────────────────────
  {
    id: 'passation_chef',
    category: 'Interne',
    title: 'Passation à un autre chef de projet',
    defaultCategory: 'interne',
    body: `Passation du projet {{ref}} de {{ancien_chef}} à {{nouveau_chef}}.

Contexte actuel :
Points d'attention :
Engagements en cours :
Prochaines échéances :

Briefing fait : ☐ Oui · ☐ Non
Client informé du changement : ☐ Oui · ☐ Non`,
  },
  {
    id: 'note_decision_interne',
    category: 'Interne',
    title: 'Note de décision interne',
    defaultCategory: 'interne',
    body: `Décision prise ce jour suite à {{contexte}}.

Options envisagées :
1.
2.
3.

Décision retenue :
Raisons :
Implications financières :
Validé par :`,
  },
];

export const TEMPLATE_CATEGORIES = Array.from(
  new Set(MESSAGE_TEMPLATES.map(t => t.category))
);
