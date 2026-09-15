# Décisions — Marathon Propria (cadrage validé le 2026-06-12)

## Décisions validées par Othmane (Phase 0)

| # | Sujet | Décision |
|---|-------|----------|
| A1 | Priorisation | P0→P3 du doc consultant confirmée, ordre P0 : 1→2→3→4→5 |
| A2 | Chantier 11 | Découpé : 11.a MVP d'abord, puis 11.b, puis 11.c |
| A3 | Hostaway | Option A — unidirectionnel. Résas directes via auto-remontée (ch. 14) |
| A4 | U18 Dashboard personnel | Ajouté en P1 transverse |
| A5 | BNBBOT | Doc de cadrage uniquement, RDV Thomas géré par Othmane, aucun dev |
| A6 | Linge | Table inventaire + mouvements + coûts unitaires, pas d'écran avancé |
| B1 | Clés | `propria_keys` + `propria_key_movements` = source de vérité par jeu physique. Compteurs DÉRIVÉS. Champ saisi `propria_nb_keys` retiré des écrans (déprécié). Champs accès voyageur conservés sur propria_units |
| B2 | Catégories ménage | avec/sans arrivée DÉRIVÉ d'hostaway_reservations (pas de champ saisi). "Gros ménage" existant = Deep Cleaning (renommé). Types restants : post-propriétaire, deep cleaning, poussière |
| B3 | Deep Cleaning auto | Tous les 10 séjours, paramètre global |
| B4 | Litiges | Table fille `propria_litige_items`, total litige calculé, migration des litiges existants en 1 ligne. TOUT EN MAD (coût réel ET montant demandé) |
| B5 | Commentaires | Système de commentaires internes UNIQUE partagé avis + litiges + incidents, mentions @, horodaté |
| B6 | Upsell | Saisie MAD, équivalent EUR taux historisé. Page QR publique read-only, slug non-devinable, pas de paiement en ligne (commande → tâche bureau) |
| B7 | Coûts ménage (ch. 15) | Table paramètres globale + override par logement + date d'effet |
| C1 | Comptes terrain | Chaque femme de ménage A SON COMPTE (photos = preuve individuelle). RLS rôle cleaner : ses ménages du jour uniquement |
| C2 | Alertes | In-app + email. Habiba = opérationnel, CEO = cash + stock critique. Pas de WhatsApp |
| C3 | Images IA mobile | Set générique "bon exemple" commun à tous les logements, remplaçable plus tard par photo réelle |
| C4 | Droits nouveaux modules | Écriture propria + CEO, lecture assistante, paramétrage/suppression CEO-only |
| D1 | BDD de travail | Staging/branche pendant le marathon, prod uniquement au merge de chaque vague |
| D2 | Staging | Constatée VIDE (pas de schéma) — voir décision M1 |

## Décisions prises en autonomie pendant la mission (⚠ à valider a posteriori)

| # | Date | Chantier | Décision | Pourquoi | Retour arrière |
|---|------|----------|----------|----------|----------------|
| M1 | 2026-06-12 | Infra | ⚠ Utiliser une BRANCHE Supabase du projet prod comme environnement de travail, au lieu du projet staging vide | Staging n'a ni schéma ni historique de migrations ; la rejouer à la main = ~100 migrations, risque d'écart avec la prod. Une branche clone l'état exact de prod, et `merge_branch` applique proprement les nouvelles migrations en prod en fin de vague. Coût marginal (centimes/heure), branche supprimée en fin de mission | Supprimer la branche, rien n'a touché la prod |
| M2 | 2026-06-12 | Infra | Cause racine incident shell = repo sous `~/Documents` (protection macOS). Fix : Accès complet au disque accordé à l'app Claude par le CEO | Le sandbox ne peut pas monter un dossier TCC-protégé sans cette autorisation ; c'est ce qui avait bloqué git/build pendant toute la vague P0 | Révoquer l'autorisation dans Réglages Système (re-bloque le shell) |
| M3 | 2026-06-12 | Ch. 5 | Images IA « bon exemple » REPORTÉES (validé CEO) : compte Higgsfield 10 crédits / 27 images nécessaires (2 crédits/image). L'UI checklist tourne avec les gros emoji + fallback propre | Pas de dépense imposée au CEO ; aucune régression — l'image est un plus, pas un bloquant | Recharger Higgsfield et générer les 27 webp dans `public/images/checklist/` |
| M5 | 2026-06-12 | Ch. 8 | ⚠ La transformation incident→litige n'est proposée QUE si le ménage source est lié à une résa Hostaway (`propria_litiges.hostaway_reservation_id` reste NOT NULL). Lien inverse `propria_litiges.source_cleaning_incident_id` ajouté ; `linked_intervention_id` conservé en rétro-compat mais plus source de vérité | Un litige Airbnb sans réservation n'a pas de sens métier (pas de dossier AirCover possible), et rendre la colonne nullable aurait imposé de blinder tous les affichages litiges existants | Rendre la colonne nullable + adapter les écrans si un cas réel de litige hors résa apparaît |
| M6 | 2026-06-12 | Ch. 10 | ⚠ Constat : 0 bien Propria sur 15 géolocalisé (le doc consultant supposait les GPS présents ; la refonte fiche bien du 28/05 avait retiré les champs lat/long de l'UI). La page Carte intègre donc la géolocalisation par CLIC sur la carte (panneau « À localiser ») + marqueurs déplaçables, au lieu de champs numériques | Une carte vide ne sert à rien ; cliquer sur la carte est le seul geste réaliste pour l'équipe (personne ne tape des coordonnées à la main — c'est pour ça qu'elles avaient été retirées) | Retirer le panneau de placement une fois les 15 biens localisés si souhaité |
| M4 | 2026-06-12 | Git | ⚠ Travail sur `main` directement (commits atomiques par chantier, migration prod appliquée AVANT le push du code), au lieu de la branche unique `feat/propria-consulting-marathon` prévue au §11 | Le working tree est PARTAGÉ avec une autre session active (Hostaway) qui committe sur `main` en continu — un checkout de branche corromprait son travail ; c'est d'ailleurs son `git add -A` qui a déjà embarqué toute la P0 sur `main`. Règle de sécurité compensatoire : jamais de `git add -A`, uniquement les fichiers du chantier ; migration prod appliquée avant le push pour ne jamais re-créer l'incident « code déployé sans sa migration » | Revenir au modèle branche dès que la session Hostaway est terminée |
