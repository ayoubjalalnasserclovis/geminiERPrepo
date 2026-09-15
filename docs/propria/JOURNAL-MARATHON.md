# Journal de mission — Marathon Propria

Mission lancée le 2026-06-12. Périmètre : 16 chantiers du retour consultant
(`RETOUR_CONSULTANT_PROPRIA_2026-06-11.md`). Décisions de cadrage :
`DECISIONS-MARATHON.md`.

## État des chantiers

| Chantier | Statut | Commit |
|----------|--------|--------|
| Setup mission | ✅ Done | — |
| 1. Clés & Accès | ✅ Done — déployé prod, migration appliquée | 985068a (via main) |
| 2. Infos d'accès tâches | ✅ Done — déployé prod | 985068a (via main) |
| 3. Ménage catégories + DC auto | ✅ Done — déployé prod, migrations appliquées | 985068a (via main) |
| 4. Daily Dashboard | ✅ Done — déployé prod | 985068a (via main) |
| 5. Mobile ménage pictos | ✅ Code déployé — images IA reportées (décision M3) | 985068a (via main) |
| 6. Litiges | ✅ Done | |
| 7. Avis | ✅ Done | |
| 8. Incidents | ✅ Done | |
| 9. Upsell + QR | ✅ Done | |
| 10. Vue Carte | ✅ Done | |
| 11.a/b/c Check-up | ✅ Done (MVP + automatisations + pilotage qualité) | |
| 12. Tâches intelligence | ✅ Done | |
| 13. Performance | ✅ Done | |
| 14. Cash + code résa | ✅ Done | |
| 15. Coûts & rentabilité | ✅ Done (en attente saisie des coûts unitaires) | |
| 16. BNBBOT (doc cadrage) | ✅ Done — `BNBBOT-CADRAGE.md`, RDV Thomas côté CEO | |

## Journal

### 2026-06-12 — Setup
- Cadrage Phase 0 validé par Othmane (cf. DECISIONS-MARATHON.md)
- Staging constatée vide → décision M1 : branche Supabase de prod
- ⚠ INCIDENT INFRA : le shell sandbox de la session est HS (erreur de montage
  du dossier projet). Conséquence : git (branche/commit/push) et builds locaux
  indisponibles depuis cette session. Contournement : code écrit directement
  dans le working tree (branche locale actuelle : main, AUCUN commit ne sera
  fait dessus tant que le shell est HS), migrations testées via branche
  Supabase. Les commits + push + build preview seront faits dès que le shell
  revient. Re-test périodique.

### 2026-06-12 — Chantier 1 : Module Clés & Accès ✅
**Pour les équipes** : chaque jeu de clés physique est désormais tracé
individuellement (boîte voyageur / armoire / bureau / externe / perdu). On ne
saisit plus jamais un comptage : on enregistre un déplacement, les compteurs et
alertes se calculent seuls (bureau 🔴 ≤1 jeu, ⚠ 2 jeux ; armoire <2 réserves ;
cible 4 jeux). Le contrôle clés est intégré à la checklist de chaque ménage.
Les changements de codes (serrure, clé sécurité, boîte à clés) sont historisés.

**Livré** :
- Migration `20260612130000_propria_keys_module.sql` (testée sur branche :
  fixtures, cas limites, advisors — 2 corrections faites : action audit
  `custom` au lieu de valeur hors contrainte ; vue sans jointure mouvements
  pour éviter le double comptage ; REVOKE EXECUTE sur fonctions trigger)
- `app/(team)/propria/cles/` (page parc + actions serveur)
- `components/propria/propria-unit-keys-section.tsx` (4 blocs consultant sur fiche bien)
- Checklist ménage : section « Contrôle des clés » (3 items photo)
- Alertes centrales : stock bureau critique/seuil bas (silencieux tant que
  l'inventaire terrain n'a pas commencé)
- Nav : entrée « Clés » (ceo, assistante, propria)

**Décisions de conception** : décrément auto du stock bureau = le mouvement
bureau→armoire lui-même (pas de matching sur titre de tâche, trop fragile).
Champ `propria_nb_keys` déprécié (plus affiché, conservé en BDD).

**⚠ À valider** : libellés des 5 emplacements ; seuils codés en dur (vue SQL)
— paramétrables plus tard si besoin.

### 2026-06-12 — Chantier 2 : Infos d'accès auto sur les tâches ✅
**Pour les équipes** : chaque tâche ménage et intervention affiche désormais un
encart lecture seule avec tout ce qu'il faut pour entrer : adresse + Maps,
étage, type d'accès immeuble, code ascenseur, badge, gardien (téléphone
cliquable), parking, porte, code serrure, boîte à clés + emplacement, clé
sécurité, procédure d'entrée, vidéo d'arrivée. WiFi affiché sur les
interventions (utile en panne internet), masqué sur les ménages.

**Livré** : `components/propria/propria-access-info-card.tsx` (composant
partagé, zéro duplication de données — pur affichage des champs existants),
branché dans `menage/[id]` et `interventions/[id]`. Aucune migration.

**⚠ À vérifier au preview** : si la RLS bloque la lecture de `properties` pour
le rôle `menage`, l'encart se masque proprement (pas d'erreur) — à tester avec
un compte femme de ménage.

### 2026-06-12 — Chantier 3 : Ménage catégories + Deep Cleaning auto ✅
**Pour les équipes** : les ménages du jour sont catégorisés visuellement
(🛏 avec arrivée / 🏠 sans arrivée / 👤 post-propriétaire / 🧽 Deep Cleaning /
🌬 poussière). La catégorie avec/sans arrivée est calculée en direct depuis les
résas Hostaway — personne ne la saisit, elle ne peut pas être fausse. Le Deep
Cleaning se déclenche automatiquement tous les 10 séjours (paramètre modifiable
en BDD sans redéploiement) en REMPLAÇANT le ménage voyageur du jour (pas de
doublon). Le bandeau « ménages non assignés » n'alerte plus que sur
aujourd'hui + demain + retards.

**Bug réel résolu (U15 WhatsApp)** — cause racine double :
1. le bucket storage refusait les formats WhatsApp (audio/ogg opus, aac,
   video/3gpp) → rejet silencieux ;
2. `capture="environment"` forçait l'appareil photo sur Android et empêchait
   de piocher dans la galerie / dossier WhatsApp.
Les deux sont corrigés (migration bucket + uploader).

**Livré** : migrations `propria_menage_categories_dc` (renommage Gros ménage →
Deep Cleaning, table propria_settings CEO-only, vue enrichie avec category
dérivée — testée sur branche : 4 catégories OK) et
`proofs_bucket_whatsapp_codecs` ; upgrade DC dans `lib/propria/cleanings-auto.ts`
(idempotent, ne touche jamais un ménage démarré, garde anti-course) ;
badges catégorie + description cliquable + bandeau J/J+1 dans la liste ménage ;
helper `lib/propria/cleaning-categories.ts` (réutilisé par le chantier 4).

**⚠ À valider** : la règle « tous les X mois » du DC (en plus des 10 séjours)
n'est PAS implémentée — le consultant disait « premier seuil atteint ». Avec
10 séjours comme seuil validé au cadrage, le seuil temps me semble redondant
pour démarrer ; dis-moi si tu le veux aussi.

### 2026-06-12 — Chantier 4 : Daily Dashboard enrichi ✅
**Pour les équipes** : le Daily 14h montre désormais (1) un Panel Ménage Temps
Réel — une carte par lot, 🟢 prêt avec prochaine arrivée / 🟠 ménage en cours
avec qui et depuis quand / 🔴 bloqué avec le motif (occupé, ménage non
commencé) et le dernier départ, lots rouges en premier ; (2) les Arrivées du
jour avec tout le contexte : dernier départ, dernier ménage, statut du ménage
du jour, sentiment du séjour précédent, litiges/tâches/interventions ouvertes
— l'exemple consultant (plainte clim au séjour précédent → visible avant
l'arrivée suivante) est couvert ; (3) les Départs du jour avec statut ménage
🟢🟠🔴, indicateur « arrivée le même jour », litige sur la résa.

**Livré** : `components/propria/daily-context-sections.tsx` (3 composants),
5 requêtes parallèles ajoutées au daily, mapping listing→lot, tri rouge
d'abord. Rouge réservé aux blocages réels (canon UX). Aucune migration.

### 2026-06-12 — Chantier 5 : Mobile Ménage visuel ✅ (code) / ⚠ images
**Pour les équipes** : chaque item de la checklist photo affiche un GROS emoji
(🛏️ 🚿 🧴 🧻 🔑 🗄️ ☕…) compréhensible sans lire le français, avec un
emplacement prêt pour l'image IA « bon exemple » (fallback propre tant que le
fichier n'existe pas). Item validé = carte verte + ✓ géant. Le bouton devient
« ✅ TERMINER » et reste BLOQUÉ tant que toutes les photos obligatoires ne sont
pas prises (compteur « N photos manquantes » affiché). Les équipements (four,
fer…) ne bloquent pas — un logement peut ne pas en avoir.

**Livré** : `cleaning-checklist.ts` (emoji + image par item),
`cleaning-checklist.tsx` (rendu visuel), `cleaning-workflow-actions.tsx`
(TERMINER bloquant), `menage/[id]/page.tsx` (calcul photos manquantes).

**⚠ Reste** : générer les ~22 images « bon exemple » en IA et les déposer dans
`public/images/checklist/*.webp` — impossible sans shell (fichiers binaires).
À faire dès que le shell revient ; l'UI fonctionne déjà avec les emoji.

### 2026-06-12 (après-midi) — Reprise : incident shell résolu, P0 livrée en prod

**Cause racine de l'incident shell identifiée** : le repo vit sous `~/Documents`,
dossier protégé par macOS (TCC) — le sandbox ne pouvait pas le monter. Résolu en
accordant l'Accès complet au disque à l'app Claude (décision M2). Reproductible :
toute future session sur ce repo nécessite cette autorisation.

**Le plan de commit ci-dessous est OBSOLÈTE** : les fichiers P0 ont été embarqués
sur `main` par la session Hostaway (commit 985068a et suivants, `git add -A`),
poussés et déployés en prod (build Vercel vert). Pas de branche
`feat/propria-consulting-marathon` — voir décision M4.

**Incident corrigé à la reprise** : le code P0 était déployé en prod SANS ses
3 migrations (page Clés et catégories ménage cassées en prod, fix WhatsApp
inactif). Les 3 migrations ont été appliquées en prod le 2026-06-12 et les
versions alignées sur les fichiers du repo (20260612130000 / 150000 / 160000).
Vérifié après application : 64 lots dans `propria_unit_keys_status`, 124 ménages
catégorisés (4 catégories), type Deep Cleaning renommé, seuil DC=10 en BDD,
bucket à 17 mime types. Advisors : aucun nouveau problème sur les nouvelles
tables.

**Push GitHub autonome** : token fine-grained fourni par le CEO (config sandbox
uniquement, à révoquer en fin de marathon).

**Images checklist (chantier 5)** : reportées — décision M3. L'UI tourne avec
les emoji en attendant.

### 2026-06-12 — Chantier 8 : Incidents — photo obligatoire + multi-transformation ✅
**Pour les équipes** : plus aucun incident ne peut être signalé sans photo —
le bouton reste bloqué tant qu'au moins une preuve n'est pas jointe (vérifié
aussi côté serveur : un incident sans preuve est refusé). Côté back-office, la
modale « Transformer » permet désormais de lancer PLUSIEURS actions d'un coup :
tâche d'achat + intervention + litige Airbnb (l'exemple consultant TV cassée
est couvert). L'incident résolu garde le lien vers chaque élément créé.

**Livré** :
- Migration `20260612180000_litiges_incident_link.sql` (appliquée en prod
  AVANT le push, règle M4) : `propria_litiges.source_cleaning_incident_id`
- `reportCleaningIncidentAction` : preuves obligatoires (min 1), rollback du
  signalement si l'enregistrement des photos échoue
- `transformIncidentMultiAction` : tâche et/ou intervention et/ou litige en un
  appel, liens inverses, note de résolution listant les créations
- `cleaning-incidents.tsx` : sélecteur photo terrain (gros bouton, multi-fichiers)
- `incident-actions.tsx` : modale multi-cible à cases à cocher
- Litige grisé si le ménage n'a pas de résa Hostaway (décision M5)

**⚠ À valider** : un litige créé depuis un incident part en colonne
« Ouvrir ticket » sans montant si non saisi — à compléter sur la page Litiges.

### 2026-06-12 — Chantier 6 : Litiges enrichis ✅
**Pour les équipes** : un litige est maintenant un vrai DOSSIER : plusieurs
lignes (table cassée + TV disparue…), chacune avec photos, facture, coût réel
Stoniz et montant demandé à AirCover — totaux et marge calculés tout seuls
(vert si on gagne, rouge si on perd), tout en MAD. N° de dossier AirCover sur
le litige, cause « ménage » disponible, photos du dernier ménage du lot
accessibles en 1 clic pour la preuve avant/après, et boutons « Créer tâche /
intervention » directement depuis le dossier. Nouveau fil de commentaires
internes horodaté avec mentions @ — le MÊME système servira aux avis et aux
incidents (décision B5).

**Livré** : migration `20260612190000_litiges_enrichis.sql` (appliquée en prod
avant push — backfill : le litige existant a été converti en 1 ligne, 0 litige
EUR donc aucun risque de conversion) ; vue dérivée `propria_litiges_totals` ;
table partagée `propria_comments` ; `litige-detail-modal.tsx` (dossier complet) ;
`comments-thread.tsx` + `comments-actions.ts` (réutilisables) ; kanban affichant
le total dérivé ; `propria_litiges.amount` déprécié.

**⚠ À valider** : les mentions @ ne déclenchent pas encore de notification
(mail/alerte) — à brancher si tu le veux ; et la modale de création litige ne
propose plus l'EUR (décision B4 tout-MAD).

### 2026-06-12 — Chantier 7 : Avis enrichis (publiés + préventifs) ✅
**Pour les équipes** : chaque avis s'ouvre désormais en grande modale
« Dossier complet » avec le fil de commentaires internes (mentions @, Entrée
pour envoyer) et un journal qui trace TOUT automatiquement : changements de
colonne, relances, sentiment, cause, assignations. Les 2 kanbans (avis +
préventifs) se manipulent au drag & drop (les boutons restent pour le mobile).
Le ticket préventif affiche les coordonnées du voyageur (email/téléphone
cliquables), le n° de résa et la durée du séjour, le sentiment se corrige à
tout moment, et un QCM « cause principale » (ménage, accès, clim, bruit…)
apparaît sur les préventifs négatifs. Les commentaires d'avis remontent aussi
sur la fiche du bien avec lien direct vers l'avis.

**Livré** : migration `20260612200000_avis_enrichis.sql` (appliquée en prod
avant push) : `main_cause` sur `hostaway_pre_review_tracking` + table journal
`propria_review_events` ; modales `review-detail-modal` / `pre-review-detail-modal` ;
`review-journal.tsx` ; section fiche bien ; DnD sur les 2 kanbans ; logging
best-effort dans toutes les actions avis.

**⚠ À valider** : les commentaires des préventifs réutilisent entity_type
'avis' (pas de type dédié) ; pas de backfill du journal (l'historique n'était
pas tracé avant ce soir) ; mentions @ toujours sans notification.

### 2026-06-12 — Chantier 10 : Vue Carte des lots ✅
**Pour les équipes** : nouvelle page Carte dans la sidebar Propria — tous les
biens sur une carte du Maroc, toggle Projet (1 marqueur par bien) / Logement
(1 marqueur par lot), pastille verte = libre aujourd'hui, bleue = occupé.
Au clic : CA du mois + CA 12 mois, note moyenne, taux d'occupation 30 j,
nb résas, dernier ménage, et lien vers la fiche bien. Filtres quartier /
occupation / bien. Comme AUCUN bien n'était géolocalisé (constat M6), la page
intègre le placement par clic : panneau « À localiser », on clique le bien
puis l'endroit sur la carte — fini. Marqueurs déplaçables pour corriger.

**Livré** : `/propria/carte` (KPI 100 % dérivés server-side, canon résas
new/modified au prorata des nuits, note via rating_normalized), composant
Leaflet/OpenStreetMap (dépendance `leaflet` ajoutée), action
`setPropertyCoordinatesAction` avec audit. Aucune migration (colonnes GPS
existaient déjà).

**⚠ À valider** : filtre « ville » basé sur `quartier` (pas de colonne ville
en BDD) ; audit qualité affiché « — » tant que le module check-up (ch. 11)
n'est pas livré.

### 2026-06-12 — Chantier 9 : Module Upsell + QR codes ✅
**Pour les équipes** : nouvel onglet Upsell — toutes les ventes additionnelles
(transferts, petit-déj, activités, early/late check-out…) saisies en MAD et
systématiquement rattachées à une résa, avec CA dérivé en haut (total, par
catégorie, par logement — MAD + équivalent EUR au taux fixe). Chaque lot a sa
page publique voyageur `/upsell/<slug>` (slug non-devinable, 64/64 lots servis)
avec QR code téléchargeable depuis l'ERP pour impression sur support bois.
Le voyageur commande SANS payer en ligne (décision B6) : sa commande crée
automatiquement une tâche bureau à traiter et le bureau chiffre après contact.

**Livré** : migration `20260612210000_upsell_module.sql` (appliquée en prod
avant push — 64 slugs uniques générés) ; `/propria/upsell` interne + sidebar ;
page publique hors layout team (nom du listing Hostaway uniquement, jamais le
nom du client propriétaire) ; honeypot anti-bot ; middleware ouvert sur le
seul préfixe /upsell ; dépendance `qrcode`.

**⚠ À valider** : vérifier que `NEXT_PUBLIC_APP_URL` est défini sur Vercel
(sinon les QR utilisent l'URL du navigateur) ; pas de rate-limiting sur la
commande publique (honeypot seul) ; commandes QR créées à 0 MAD à chiffrer
par le bureau.

### 2026-06-12 — Chantier 13 : Performance (refonte) ✅
**Pour les équipes** : page renommée « Performance », multi-sélection de
logements (cases à cocher, KPI agrégés sur la sélection), et détail au clic
sur chaque logement : CA, commission Propria (dérivée du taux de mandat),
encaissement voyageurs, revenu net propriétaire estimé, occupation, note.

**BUG RÉEL CORRIGÉ** : la page affichait les revenus avec le symbole « € »
alors que 100 % des 2 259 résas Hostaway sont en MAD (vérifié en BDD) — les
montants à l'écran étaient donc faux d'un facteur ~10. Désormais : « X MAD
(≈ Y €) » partout, taux fixe historisé, jamais de somme mixte. Fiche bien
corrigée aussi, export CSV suffixé (MAD).

**⚠ À valider** : frais de ménage affichés « non suivi » (aucun montant de
ménage en BDD — sera couvert par le chantier 15) ; pas de filtre de période
(la vue SQL est figée à 12 mois glissants) ; « groupes » = multi-sélection
ad hoc, pas de groupes persistés (aucune notion en BDD).

### 2026-06-12 — Chantier 14 : Réservations cash + code résa propagé ✅
**Pour les équipes** : sur la page cash, les indicateurs du haut filtrent la
liste au clic ; chaque montant à récupérer se transforme en tâche terrain
attribuée (anti-doublon : une seule tâche ouverte par résa) ; les résas
DIRECTES hors plateforme se saisissent dans l'ERP (code lisible DIR-XXXXXX,
encaissements cumulés, reste à encaisser calculé — décision A3, Hostaway
reste unidirectionnel). Le code résa est maintenant propagé : sélecteur de
résa sur les tâches/interventions (badge sur la fiche), colonne sur les
transferts, déjà présent sur les upsells et litiges.

**Livré** : migration `20260612230000_cash_code_resa.sql` (appliquée en prod
avant push) : table `propria_direct_reservations` + `propria_transfers.hostaway_ref` ;
helper `lib/propria/reservations.ts` ; boutons collecte ; KPI cliquables.

**⚠ À valider** : réf interne `CASH-XXXXXXXX` pour les résas cash manuelles
sans code Hostaway (format modifiable) ; constat : aucun flag « cash » dans
hostaway_reservations — le cash manuel reste la table propria_cash_reservations.

### 2026-06-12 — Chantier 12 : Tâches & interventions, intelligence opérationnelle ✅
**Pour les équipes** : chaque fiche tâche/intervention affiche le contexte
du logement (occupé ?, prochaine arrivée avec voyageur, prochaine sortie,
prochain ménage), un bandeau ⚠ « À réaliser avant le X — arrivée de Y »
(rouge seulement si l'arrivée est imminente et la tâche pas commencée), un
bandeau « Logement occupé jusqu'au X — intervention impossible aujourd'hui »,
et un encart 💡 mutualisation quand un ménage est prévu sous 14 jours sur le
même lot (lien direct). Symétriquement, la fiche ménage liste les tâches
ouvertes du lot « à confier à l'équipe ménage ». L'exemple consultant
(télécommande clim à acheter avant l'arrivée du 15/06) est couvert. Badges ⚠
aussi dans la liste, description cliquable.

**Livré** : helper partagé `lib/propria/unit-context.ts` (requêtes groupées,
zéro N+1), `unit-context-card.tsx`, fiches intervention + ménage + liste.
100 % dérivé, aucune migration.

**⚠ À valider** : statut `a_valider` exclu des alertes (travail terrain déjà
fait) ; fiche ménage inclut aussi les tâches posées sur le bien entier parent.

### 2026-06-12 — Chantier 11.a : Module Check-up logement (MVP) ✅
**Pour les équipes** : nouveau module Check-ups dans la sidebar — une
inspection structurée comme un ménage : checklist 6 sections / 22 items
(état général, équipements, sécurité & accès, SDB, literie, extérieur),
chaque item noté OK / Problème / N/A, note ET photo OBLIGATOIRES sur chaque
problème (bloqué au serveur), soumission puis validation back-office. À la
validation, les problèmes cochés deviennent automatiquement des tâches ou
interventions tracées (source_checkup_id). Rapport imprimable propre
(bouton Imprimer/PDF) conservé en lien sur la fiche du bien, fil de
commentaires avec mentions @.

**Livré** : migration `20260613000000_checkup_module.sql` (appliquée en prod
avant push) : propria_checkups + items + proofs, commentaires élargis aux
check-ups, lien source_checkup_id sur interventions ; pages liste/fiche/
rapport ; checklist `lib/propria/checkup-checklist.ts` ; section fiche bien.

**⚠ À valider** : rapport = page imprimable (pas de PDF généré côté serveur
— décision MVP) ; checklist non multipliée par nb chambres/SDB ; urgence des
tâches générées fixée à normale ; rôle developer en lecture seule sur les
check-ups.

### 2026-06-12 — Chantier 11.b : Automatisations check-up ✅
**Pour les équipes** : les check-ups se planifient désormais TOUT SEULS,
chaque matin (cron 6h UTC, relançable par le CEO d'un bouton) : un check-up
auto par lot tous les 3 mois OU 10 séjours (premier seuil atteint), planifié
sur la première journée blanche du lot sous 21 jours (sinon « à planifier
manuellement ») ; un contrôle bureau quotidien des ménages d'hier (5/jour ou
10 % — tâche photos) ; un check-up terrain aléatoire lundi/mercredi/vendredi ;
et le « Logement du jour » (le lot contrôlé le moins récemment, jamais
contrôlés en premier). La liste affiche le retard vs fréquence et un badge
🤖/🎲/⭐ sur les check-ups générés. Tous les seuils sont modifiables en BDD
sans redéploiement (propria_settings).

**Livré** : migration `20260613001000_checkup_automations.sql` (appliquée en
prod avant push — auto_source + 6 paramètres), `lib/propria/checkups-auto.ts`
(logique partagée cron + bouton), cron `/api/cron/checkups-auto` (vercel.json),
idempotence stricte par bloc (re-run = zéro doublon).

**⚠ À valider** : lot jamais contrôlé → référence = date de création du lot ;
rythme terrain codé LUN/MER/VEN (le paramètre est documentaire) ; pas de
verrou inter-process si « Lancer maintenant » coïncide à la seconde près avec
le cron (risque négligeable).

### 2026-06-12 — Chantier 11.c : Pilotage qualité consolidé ✅
**Pour les équipes** : nouvelle page Qualité — un tableau par lot, les pires
en haut, avec un score qualité /100 entièrement DÉRIVÉ (note voyageurs 40 %,
fraîcheur ménage 15 %, check-up à jour 15 %, litiges 15 %, préventifs
négatifs 15 % — composantes sans donnée neutralisées), jauges 🟢🟠🔴 sur
chaque date clé (ménage, deep cleaning vs seuil 10 séjours, check-up vs
fréquence, maintenance), filtres bien + période 30j/90j/12m. La fiche bien a
sa section « Pilotage qualité » (5 dates clés + score du bien). Alertes
centrales sur les notes (U30) : <4,8 préventif, <4,6 renforcé, <4,5 critique
(lots avec ≥3 avis sur 90 j).

**Livré** : `lib/propria/quality-score.ts` (fonctions pures, requêtes
groupées), `/propria/qualite`, section fiche bien, alertes dans
lib/alerts/collect.ts. AUCUNE migration (tout existait). Constat factuel :
maintenance préventive = propria_maintenance_visits (intégrée), inventaires
existants mais volontairement hors score.

**⚠ À valider** : pentes de dégressivité (ménage 0 pt à 30 j, check-up 0 pt
à 90 j de retard) ; lot tout neuf sans donnée = score 100 ; inventaires hors
score.

### 2026-06-12 — Chantier 15 : Coûts ménage + rentabilité réelle ✅
**Pour le CEO** : nouvelle page Coûts — 10 coûts unitaires en MAD (main
d'œuvre par type de ménage, linge par chambre/SDB, amortissement,
consommables, transport, frais de gestion), historisés par DATE D'EFFET
(un changement = nouvelle ligne, les rentabilités passées restent justes),
avec override par logement (décision B7). La fiche bien affiche le coût
décomposé d'un ménage standard / poussière / deep cleaning. Le dashboard
Rentabilité (CEO) croise par lot : revenus résas + upsell vs coûts ménages
(valorisés aux paramètres en vigueur À LA DATE de chaque ménage) +
interventions, marge brute MAD≈EUR, et l'indicateur U25 marge par action de
gestion (proxy honnête : on ne mesure pas encore le temps réel). Tant que tu
n'as rien saisi : « en attente de données », jamais de faux zéro.

**Livré** : migration `20260613002000_cost_matrix.sql` (appliquée en prod
avant push), moteur `lib/propria/cost-matrix.ts`, /propria/couts,
/propria/rentabilite, section fiche bien.

**⚠ À valider** : blanchisserie_par_kg_ou_set saisi mais hors calcul (pas de
quantité mesurée par ménage) ; le linge est compté sur TOUTES les catégories
y compris Poussière (override 0 possible) ; propria_nb_sdb rarement rempli →
composante linge SDB « — » tant que non saisie ; interventions sans lot non
imputées par lot.

### 2026-06-12 (soir) — Post-marathon : géocodage des biens + notifications in-app ✅
**Géocodage (demande CEO)** : les 15 biens Propria ont été géolocalisés
automatiquement depuis l'adresse de leur fiche (géocodage OpenStreetMap,
recherche bornée sur Marrakech). 11 au niveau RUE (Allal El Fassi ×3,
Zerktouni, Bata ×2, Yacoub El Mansour, Mauritanie, Hassan II, Tariq Bnou
Ziad, Yougoslavie) et 4 en APPROXIMATIF centre Guéliz (rues introuvables
dans OSM : BEJ GUENI, FOUDAD, MAMOUN, PATISSERIE KAWTAR) — à affiner en
faisant glisser le marqueur sur /propria/carte. Snapshot
`data_fix_log` (fix_name geocode_biens_propria_2026-06-12) avant écriture,
rollback possible, idempotent.

**Notifications in-app (demande CEO)** : cloche 🔔 dans la sidebar (et la
barre mobile) avec badge non-lues — une mention @ dans un commentaire
(litige, avis, incident, check-up) notifie la personne dans l'app ET par
mail ; une assignation (intervention/tâche, litige, avis, préventif)
notifie dans l'app (sans mail, anti-spam ; bulk-assign = 1 notification
groupée). Migration `20260613003000_notifications.sql` appliquée en prod
avant push, RLS chacun-voit-les-siennes, marquer lu / tout marquer lu,
rafraîchissement 60 s.

**⚠ À valider** : 4 biens en position approximative à ajuster au doigt ;
mention/assignation litige et incident pointent vers le kanban (pas de
fiche détail litige) ; tutoiement dans les notifications.

## BILAN VAGUE P3 + FIN DE MISSION — 2026-06-12 ✅

Chantier 15 déployé (matrice de coûts + rentabilité, en attente de la saisie
des coûts unitaires par le CEO) et chantier 16 livré sous forme de document
de cadrage (`docs/propria/BNBBOT-CADRAGE.md`) — aucun dev BNBBOT avant le
RDV Thomas (décision A5).

**Les 16 chantiers du retour consultant sont à l'état Done.** Audit final :
advisors Supabase re-passés après reconnexion — ZÉRO alerte sécurité sur
toutes les tables créées pendant le marathon (P0→P3), versions de migrations
alignées repo ↔ prod, builds Vercel verts sur toute la chaîne.

**Hors périmètre code, à la main du CEO** : saisir les coûts unitaires
(/propria/couts), géolocaliser les 15 biens (clic sur /propria/carte),
recharger Higgsfield pour les 27 images checklist (M3), RDV Thomas BNBBOT,
révoquer le token GitHub du marathon, QA terrain multi-rôles sur P1/P2/P3
avec comptes réels, relire les décisions ⚠ (DECISIONS-MARATHON.md M1→M6 +
sections « À valider » de chaque chantier de ce journal).

## BILAN VAGUE P2 — 2026-06-12 ✅

Les 6 chantiers P2 (13 Performance, 14 Cash + code résa, 12 Tâches
intelligence, 11.a Check-up MVP, 11.b Automatisations, 11.c Pilotage qualité)
sont codés, migrés, poussés et **déployés en production** (6 builds Vercel
verts, commits ceb5011 → c78102f). Les 3 migrations P2 (cash_code_resa,
checkup_module, checkup_automations) appliquées en prod AVANT chaque push
(règle M4), versions alignées repo ↔ prod, RLS posée sur toutes les
nouvelles tables (vérifiée à l'application ; le connecteur Supabase s'est
déconnecté APRÈS la dernière migration — re-passer get_advisors à la
reconnexion pour le filet final). Bug réel corrigé au passage : revenus
Performance affichés en € au lieu de MAD (×10 à l'écran).

Nouvelles tables : propria_direct_reservations, propria_checkups,
propria_checkup_items, propria_checkup_proofs (+ auto_source, main_cause,
source_checkup_id, hostaway_ref transferts, 6 paramètres propria_settings).
Nouveau cron : /api/cron/checkups-auto (6h UTC).

**Reste avant de clore le marathon** : vague P3 (15 Coûts ménage &
rentabilité — vérifier d'abord les inputs ; 16 doc de cadrage BNBBOT),
images checklist (Higgsfield en pause, décision CEO), notifications
mentions @, QA multi-rôles terrain sur P1+P2, reconnecter le connecteur
Supabase et re-passer les advisors.

## BILAN VAGUE P1 — 2026-06-12 ✅

Les 5 chantiers P1 (8 Incidents, 6 Litiges, 7 Avis, 10 Carte, 9 Upsell) +
l'item transverse U18 (Mon dashboard) sont codés, migrés, poussés et
**déployés en production** (5 builds Vercel verts d'affilée, commits f8ee6b3
→ 4cff48c). Audit de vague : les 3 migrations P1 appliquées en prod AVANT
chaque push (règle M4, zéro fenêtre de code-sans-schéma), advisors Supabase
sans aucune alerte sur les nouvelles tables (RLS posée partout), versions de
migrations alignées repo ↔ prod, typecheck sans nouvelle erreur (les ~29
erreurs préexistantes hors Propria restent à traiter un jour — hors scope).

Nouvelles tables : propria_litige_items, propria_comments (partagée),
propria_review_events, propria_upsells (+ main_cause, aircover_reference,
source_cleaning_incident_id, upsell_slug). Nouvelle dépendance : leaflet,
qrcode.

**Reste avant de clore le marathon** : images checklist (en attente recharge
Higgsfield — décision M3), vague P2 (13 Performance, 14 Cash + code résa,
12 Tâches intelligence, 11.a/b/c Check-up), vague P3 (15 Coûts & rentabilité,
16 doc cadrage BNBBOT), notifications sur mentions @ (⚠ récurrent), QA
multi-rôles terrain sur les nouveautés P1 (à faire avec comptes réels).

## VAGUE P0 — récap & plan de commit (OBSOLÈTE — conservé pour trace)

Les 5 chantiers P0 sont codés et testés côté BDD (branche Supabase
`marathon-propria`, miroir exact de prod, 145 migrations + 3 nouvelles).
Bloqué par l'incident shell : commits git, build Vercel preview, merge.

**Dès que le shell revient, exécuter :**
```bash
cd stoniz-platform
git checkout -b feat/propria-consulting-marathon
git add supabase/migrations/20260612130000_propria_keys_module.sql \
        app/\(team\)/propria/cles components/propria/propria-unit-keys-section.tsx \
        components/layout/team-links.ts lib/alerts/collect.ts \
        app/\(team\)/propria/biens/\[id\]/page.tsx lib/propria/cleaning-checklist.ts
git commit -m "Chantier 1 — Module Clés: jeux physiques tracés, compteurs dérivés, alertes seuils, audit codes"
git add components/propria/propria-access-info-card.tsx \
        app/\(team\)/propria/menage/\[id\]/page.tsx app/\(team\)/propria/interventions/\[id\]/page.tsx
git commit -m "Chantier 2 — Infos d'accès auto sur tâches ménage/interventions (lecture seule terrain)"
git add supabase/migrations/20260612150000_propria_menage_categories_dc.sql \
        supabase/migrations/20260612160000_proofs_bucket_whatsapp_codecs.sql \
        lib/propria/cleanings-auto.ts lib/propria/cleaning-categories.ts \
        app/\(team\)/propria/menage/page.tsx components/propria/cleaning-proof-uploader.tsx \
        app/api/cron/hostaway-sync/route.ts
git commit -m "Chantier 3 — Catégories ménage dérivées, Deep Cleaning auto 10 séjours, fix upload WhatsApp (bucket + capture)"
git add components/propria/daily-context-sections.tsx app/\(team\)/propria/daily/page.tsx
git commit -m "Chantier 4 — Daily: panel temps réel + arrivées/départs enrichies"
git add components/propria/cleaning-checklist.tsx components/propria/cleaning-workflow-actions.tsx
git commit -m "Chantier 5 — Checklist mobile visuelle (emoji + images), TERMINER bloquant"
git add docs/propria/ docs/prompts/MASTER-PROMPT-PROPRIA-MARATHON.md
git commit -m "Docs marathon: décisions, journal"
git push -u origin feat/propria-consulting-marathon
# → vérifier build preview Vercel, puis tsc/lint, générer les images checklist,
# → merge main + appliquer les 3 migrations en prod (merge_branch Supabase ou supabase db push)
```

**Audit vague P0 fait** : advisors sécurité passés après chaque migration
(1 faille corrigée), tests SQL fixtures + cas limites OK, RLS posée sur toutes
les nouvelles tables, exclusion perdus N/A (aucune requête sur projects),
soft-delete partout, aucun dérivé stocké.
**Audit restant (bloqué shell)** : tsc/build, test visuel preview, test compte
rôle menage, images IA.
