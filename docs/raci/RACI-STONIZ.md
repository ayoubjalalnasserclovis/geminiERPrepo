# Matrices RACI — Stoniz (hors Propria)

> CEO 2026-08-19 · construit à partir des permissions réelles de l'ERP
> (`requireRole` / `assertRole` dans les server actions) et du canon métier.
>
> **Légende**
> - **R** — Responsible : fait le travail concrètement
> - **A** — Accountable : rend compte et valide ; **UN SEUL par activité**
> - **C** — Consulted : donne un avis AVANT décision
> - **I** — Informed : tenu au courant APRÈS action
>
> Cellule vide = pas impliqué. Un rôle peut être `R + A` s'il fait ET
> répond du résultat (fréquent pour les activités CEO).
>
> **Rôles couverts** : CEO · Chef projet (CP) · Sourcing · Finance · Achats

---

## 1. Chasse de biens (sourcing)

| Activité | CEO | CP | Sourcing | Finance | Achats |
|---|:---:|:---:|:---:|:---:|:---:|
| Prospection nouveaux biens (visites, RDV agents) | A | I | R | | |
| Négociation prix vendeur | A | | R | C | |
| Création fiche bien dans l'ERP | A | | R | | |
| Enrichissement photos / vidéos / plan / prix | A | I | R | | |
| Signature mandat de recherche client | R+A | I | C | I | |
| Proposition d'un bien à un client (sourcing_proposition) | A | C | R | I | |
| Retour client sur proposition (accepté / refusé) | I | R | C | | |
| Suivi partenaires (agents immo, avocats, notaires) | A | I | R | | |
| Création partenaire en BDD | A | | R | C | |
| Complétude fiche partenaire (RIB, attestations fiscales) | I | | R | A | |
| Attestations fiscales partenaires (upload / relance) | I | | C | R+A | |
| Relance sourcing sans bien > 14 jours (daily) | I | I | R+A | | |
| Marquer un bien comme "vendu / indisponible" | R+A | I | C | | |
| Marquer une proposition perdue (motif) | A | I | R | | |

---

## 2. Cycle de vie projet client

| Activité | CEO | CP | Sourcing | Finance | Achats |
|---|:---:|:---:|:---:|:---:|:---:|
| Onboarding client (création fiche client) | A | R | C | I | |
| Création projet dans l'ERP | R+A | R | C | I | |
| Activation projet (`activated_at`) | A | R | | I | |
| Tag Clé en main / Coaching (`service_type`) | A | R | | I | |
| Assignation chef de projet | R+A | I | | I | |
| Compléter briefing client + moodboard | A | R | | | |
| Passage de phase (sourcing → design → travaux → livraison) | A | R | I | I | I |
| Communication client (emails, updates hebdo) | I | R+A | | | |
| Demande de mise en pause | A (approuve) | R | I | I | I |
| Approuver / rejeter demande de pause | R+A | I | | I | |
| Reprise d'activité après pause | A | R | | I | |
| Marquer projet perdu (motif + manque à gagner) | R+A | C | C | I | |
| Édition dates clés (compromis, acte, travaux, livraison) | R+A | C | | I | |
| Signature compromis de vente | A | R | I | I | |
| Signature acte authentique | A | R | I | I | |
| PV réception travaux (envoi client + relance) | A | R | | I | |
| Signature PV réception par client | A (approuve) | R | | I | |
| Documents projet (contrats, plans 3D, PV) upload | A | R | | | C |
| Suppression / restauration document projet | R+A | R | | | |
| Suppression hard-delete projet (rare) | R+A | | | | |

---

## 3. Travaux (chantiers artisans)

| Activité | CEO | CP | Sourcing | Finance | Achats |
|---|:---:|:---:|:---:|:---:|:---:|
| Import CSV lots travaux (initial) | R+A | C | | | |
| Création manuelle d'un lot travaux | A | R | | | C |
| Choix / assignation d'un artisan sur un lot | A | R | | | C |
| Négociation devis artisan | A | R | | C | |
| Saisie devis_artisan_mad + budget_estime_mad | A | R | | C | |
| Suivi avancement chantier (status lot) | A | R+A | | | |
| Création d'un acompte planifié | A | R | | R | R |
| Édition montant / % / date d'un acompte | A | R | | R | R |
| Demande de paiement acompte (workflow validation) | I | R | | C | R |
| Validation demande de paiement (CEO seul) | R+A | I | | I | I |
| Marquer acompte payé (post-virement bancaire) | I | R | | R+A | |
| Facturation client (encaissements travaux planifiés) | A | R | | R | |
| Décalage date encaissement travaux | A | R | | R | |
| Documents artisan (devis, facture, BC) upload / delete | A | R | | | C |
| Attestations fiscales artisans (upload / relance) | I | I | | R+A | C |
| PV réception travaux — cross-check avec artisans | A | R | | | |
| Modifier données artisan (contact, RIB, catégorie) | A | R | | C | R |

---

## 4. Achats & fournisseurs

| Activité | CEO | CP | Sourcing | Finance | Achats |
|---|:---:|:---:|:---:|:---:|:---:|
| Import CSV lots achats (initial Notion) | R+A | C | | | C |
| Création manuelle d'un lot achats | A | C | | | R |
| Sélection fournisseur | A | C | C | | R |
| Devis fournisseur (saisie + validation) | A | I | | C | R |
| Bon de commande (upload BC) | A | I | | | R+A |
| Suivi livraison + statut lot | A | I | | | R+A |
| Création acompte achats + planification | A | I | | R | R |
| Édition montant / % / date d'un acompte achats | A | I | | R | R |
| Demande de paiement acompte achats | I | | | C | R |
| Validation paiement acompte achats (CEO seul) | R+A | | | I | I |
| Marquer acompte achats payé | I | | | R+A | R |
| Facture fournisseur (upload + rattachement) | A | | | R | R |
| Encaissements clients achats planifiés | A | I | | R | R |
| Modifier données fournisseur (contact, RIB, TVA) | A | | | C | R+A |

---

## 5. Finance & Trésorerie (opérationnel)

| Activité | CEO | CP | Sourcing | Finance | Achats |
|---|:---:|:---:|:---:|:---:|:---:|
| Import relevé bancaire XLSX/CSV | A | | | R | |
| Confirmation import + gestion doublons | A | | | R+A | |
| Catégorisation d'une transaction | A | | | R+A | |
| Mémorisation d'un mapping bénéficiaire | A | | | R+A | |
| Allocation transaction à un projet (travaux/achats/services) | A | C | | R+A | C |
| Réconciliation bancaire (croisement matched/orphelins) | A | | | R+A | |
| Saisie manuelle solde bancaire (snapshot) | A | | | R+A | |
| Création / désactivation compte bancaire | R+A | | | C | |
| Caisse Stoniz — création d'un wallet | R+A | R | C | R | R |
| Caisse Stoniz — dotation (versement au wallet) | R+A | | | I | I |
| Caisse Stoniz — saisie dépense | A | R | | R | R |
| Caisse Stoniz — validation dépense (CEO seul) | R+A | I | | I | I |
| Caisse Stoniz — attacher pièce justificative | A | R | | R | R |
| Honoraires Stoniz — création manuelle échéance | A | R | | R | |
| Honoraires Stoniz — édition MONTANT (CEO + finance) | R+A | I | | R | |
| Honoraires Stoniz — décaler DATE (dépuis 2026-07-10) | A | R | | R | |
| Honoraires — page "à percevoir" (marquer confirmé) | R+A | I | | R | |
| Honoraires — saisir mois prévisionnel par milestone | A | I | | R+A | |
| Projection cashflow 30/60/90j (consultation + simulation) | R+A | | | R | |
| Projection mensuelle (édit inline des dates) | R+A | | | R | |
| P&L par projet — consultation | R+A | I | | R | |
| P&L config (coefficients de phase, masse cible) | R+A | | | R | |
| Envoi mails encaissements en retard clients | A | R | | R+A | |

---

## 6. Comptabilité (interne — Nabil / Finance)

| Activité | CEO | CP | Sourcing | Finance | Achats |
|---|:---:|:---:|:---:|:---:|:---:|
| Journaux comptables mensuels | A | | | R+A | |
| Déclaration TVA mensuelle | A | | | R+A | |
| Déclaration DGI (IS, IR) | A | | | R+A | |
| Déclaration CNSS + paiement charges sociales | A | | | R+A | |
| Bilan annuel + compte de résultat | R+A | | | R+A | |
| Liasse fiscale annuelle | R+A | | | R+A | |
| Suivi factures fournisseurs (rapprochement compta) | A | | | R+A | C |
| Rapprochement bancaire mensuel (comptable) | A | | | R+A | |
| Préparation & versement salaires | R+A | | | R+A | |
| Notes de frais / remboursements équipe | A | | | R+A | |
| Attestations fiscales — vérification annuelle | A | | | R+A | C |
| Clôture annuelle (arrêté des comptes) | R+A | | | R+A | |
| Archivage justificatifs (papier + digital) | A | | | R+A | C |

---

## Annexes

### Convention d'usage
- Le **CEO est Accountable partout par défaut** dans une structure de la taille de Stoniz — c'est normal, il rend compte in fine devant les tiers (banque, DGI, clients). Les cellules avec `A` ne signifient pas "il doit tout faire", juste qu'il est le point d'escalade.
- Une activité doit avoir **exactement un A**. Si tu vois 2 A dans une ligne, c'est un bug de matrice à corriger.
- **R sans A** = travail exécuté mais personne ne rend compte — anti-pattern. À éviter.

### Sources dans le code
Les rôles autorisés à chaque action sont vérifiés dans les `assertRole([...])` /
`requireRole([...])` des server actions du repo. Cette matrice a été construite
en lisant ces définitions au 2026-08-19 (commit `c9030bc`).

Si les permissions ERP évoluent (nouveau rôle, nouvelle action, réattribution),
mettre à jour cette matrice dans le même chantier.

### Prochaine étape possible
Page ERP `/admin/raci` où chaque collaborateur voit uniquement les activités
où il est **R** ou **A** (recentre sur son périmètre). À faire dans un second
chantier si tu veux industrialiser le suivi.
