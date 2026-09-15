# Cadrage intégration BNBBOT — IA Messagerie voyageurs

> Chantier 16 marathon Propria (consultant U22, décision CEO A5 :
> document de cadrage UNIQUEMENT, aucun développement avant le RDV avec
> Thomas — BNBBOT, +33 7 77 31 50 22). Rédigé le 2026-06-12.

## 1. Objectif métier

Décharger l'équipe (Habiba, bureau) de la messagerie voyageurs Hostaway en
gardant l'ERP comme source de vérité opérationnelle. Cibles consultant :
assistance rédactionnelle, réponses suggérées, détection automatique des
voyageurs mécontents, des litiges naissants et des demandes d'upsell, résumé
des conversations, génération de tâches depuis les conversations.

## 2. Principe d'architecture recommandé

BNBBOT se connecte à Hostaway de son côté (c'est son métier — l'ERP ne
stocke pas les messages voyageurs et ne doit pas le devenir). L'ERP reçoit
de BNBBOT des ÉVÉNEMENTS STRUCTURÉS via un webhook entrant, sur le modèle
déjà en prod pour Hostaway (`/api/webhooks/hostaway`, Basic Auth,
log d'audit). Aucune écriture de l'ERP vers BNBBOT en phase 1.

Chaque événement BNBBOT serait mappé sur l'existant ERP — tout est déjà prêt
côté modèle de données :

| Événement BNBBOT | Atterrissage ERP (existant) |
|---|---|
| Voyageur mécontent détecté | `hostaway_pre_review_tracking` (préventif, sentiment + `main_cause` QCM du ch.7) |
| Litige naissant détecté | `propria_litiges` (+ ligne `propria_litige_items`) |
| Demande d'upsell détectée | `propria_upsells` (source à étendre : 'bnbbot') |
| Tâche détectée dans une conversation | `propria_interventions` kind='tache' + `hostaway_ref` (code résa propagé, ch.14) |
| Résumé de conversation | commentaire `propria_comments` sur le préventif/litige concerné |

## 3. Questions à poser à Thomas (RDV)

1. BNBBOT expose-t-il des webhooks sortants (événements structurés JSON) ou
   seulement une UI ? Format, authentification, retries ?
2. Quels déclencheurs de détection sont configurables (mécontentement,
   litige, upsell) et avec quelle fiabilité mesurée (faux positifs) ?
3. Multi-langue : FR / EN / arabe darija — couvert ?
4. Le bot répond-il seul (auto-send) ou en suggestion validée par un humain ?
   Position Stoniz recommandée : suggestion validée au démarrage.
5. Mapping listings : BNBBOT identifie-t-il les logements par listing
   Hostaway ID (notre clé de jointure `hostaway_listings`) ?
6. Tarification : par listing / par message / forfait ? Engagement ?
7. Données : hébergement, rétention, RGPD/loi 09-08 marocaine, qui est
   propriétaire des historiques si on arrête ?
8. Sandbox/essai possible sur 2-3 listings avant déploiement parc complet ?

## 4. Critères de décision GO/NO-GO

GO si : webhooks sortants structurés disponibles (sinon la valeur ERP est
quasi nulle — juste un outil de plus à consulter), mode suggestion-humaine
disponible, essai limité possible, coût mensuel < gain estimé (≈ temps
messagerie actuel de l'équipe, à chiffrer avec Habiba avant le RDV).

## 5. Si GO — phasage proposé (dev ERP)

Phase 1 (petit) : endpoint `/api/webhooks/bnbbot` (pattern Hostaway existant)
+ table d'audit des événements reçus + création automatique des préventifs.
Phase 2 : litiges + upsells + tâches automatiques (avec garde-fous
anti-doublon, pattern idempotence du cron check-ups). Phase 3 : tableau de
bord « détections BNBBOT » + boucle qualité (taux de faux positifs).

## 6. Action en attente

RDV Thomas géré par Othmane (décision A5). Ce document sert de support :
les sections 3 et 4 sont la checklist du RDV.
