# Référentiel KPI financiers — cockpit CEO

> Document contractuel à valider **ligne par ligne** avant tout code.
> Session : définition des KPI de pilotage. Périmètre : paiements, travaux, achats, encaissements.
> Règle d'or respectée partout : **5 champs sources, tout le reste dérivé** ; **projets perdus exclus par défaut** ; **aucun nouveau champ ni table**.

---

## Conventions communes

**Devise.** Tout est consolidé en **euros**. Conversion au **taux fixe historisé 1 EUR = 10 MAD** (canon). Concrètement : tout montant en dirhams est divisé par 10. Les honoraires sont déjà en euros.

**Exclusion des perdus.** Tous les chiffres ci-dessous excluent les projets `status = 'perdu'` et les projets supprimés (`deleted_at`), via le helper `lib/projects/lost.ts`. Seule exception : la carte « Projets perdus » de l'étage 3, qui les compte volontairement.

**Code couleur (canon UX, non négociable).**

| Couleur | Sens | Déclenchée par |
|---|---|---|
| 🟢 Vert | Tout va bien | Trésorerie et marge positives |
| ⚪ Neutre (gris) | Information, ni bon ni mauvais | Reste à encaisser / à payer, volumes, compteurs |
| 🟠 Orange | À surveiller, pas une perte | Anomalie de saisie, projet perdu, sortie cash qui dépasse le disponible |
| 🔴 Rouge | **Perte réelle ou retard avéré uniquement** | Trésorerie < 0, marge < 0, écart de marge < 0, client en retard |

Le rouge n'est **jamais** un artefact de formule (ex : un « reste à encaisser » élevé n'est pas rouge, c'est normal d'attendre des règlements).

**Les 5 champs sources** (rappel, par module) :

| Source | Honoraires | Travaux | Achats |
|---|---|---|---|
| budget_estimé | — (forfait fixe) | `travaux_lots.budget_estimate_mad` | `achats_lots.budget_estimate_mad` |
| devis (ce qu'on doit) | — | `travaux_lots.devis_artisan_mad` | `achats_lots.devis_fournisseur_mad` |
| facturé client | `payments.amount_expected` | `travaux_lots.facture_client_mad` | `achats_lots.facture_client_mad` |
| encaissé (reçu du client) | `payments.amount_paid` | `travaux_encaissements.amount_mad` | `achats_encaissements.amount_mad` |
| payé (versé au prestataire) | — | `travaux_payments.amount_paid` | `achats_payments.amount_paid` |

**D'où vient le « facturé ».** Il n'existe pas de table de factures ni de document émis : le facturé est une **saisie manuelle**. Honoraires → `payments.amount_expected` (le montant de chaque échéance-jalon). Travaux/achats → `facture_client_mad`, renseigné **lot par lot** dans le tableau des lots de la fiche projet ou par import CSV. Conséquence : un lot avec devis mais sans `facture_client_mad` sortirait une marge faussement négative. Donc, sur l'étage rentabilité, le taux de marge **ne compte que les lots dont le facturé est renseigné**, et un compteur « X lots sans facturé » indique la base de calcul. _À valider._

Agrégats consolidés réutilisés ci-dessous (tous en EUR, perdus exclus) :

- **Encaissé total** = honoraires payés + (encaissements travaux ÷ 10) + (encaissements achats ÷ 10)
- **Payé total** = (paiements artisans ÷ 10) + (paiements fournisseurs ÷ 10)
- **Facturé client total** = honoraires attendus + (facture travaux ÷ 10) + (facture achats ÷ 10)
- **Devis total** = (devis artisans ÷ 10) + (devis fournisseurs ÷ 10)

---

## Étage 1 — Santé cash (la survie)

> La question : *ai-je assez de cash, et qui me doit / à qui je dois ?*

### 1. Trésorerie à date
- **Ce que ça dit** : le cash net déjà passé en banque, tous flux confondus.
- **Formule** : `Encaissé total − Payé total`
- **Couleur** : 🟢 si ≥ 0 · 🔴 si < 0 (découvert réel)
- **Source** : `payments`, `travaux_encaissements`, `achats_encaissements`, `travaux_payments`, `achats_payments`

### 2. Reste à encaisser (clients)
- **Ce que ça dit** : ce que les clients te doivent encore.
- **Formule** : `Facturé client total − Encaissé total`
- **Couleur** : ⚪ neutre (≥ 0 = normal). Si une composante est < 0 → remonté en anomalie (étage 2), pas en rouge ici.
- **Source** : factures (lots + honoraires attendus) vs encaissements

### 3. Reste à payer (artisans + fournisseurs)
- **Ce que ça dit** : ce que tu dois encore aux prestataires.
- **Formule** : `Devis total − Payé total`
- **Couleur** : ⚪ neutre (≥ 0 = normal)
- **Source** : devis des lots vs paiements

### 4. Reste net à venir
- **Ce que ça dit** : le solde des flux restants — vas-tu encaisser plus que tu ne dois sortir ?
- **Formule** : `Reste à encaisser − Reste à payer`
- **Couleur** : 🟢 si ≥ 0 · 🔴 si < 0 (tu devras sortir du cash net pour finir les chantiers en cours)

### 5. Clients en retard
- **Ce que ça dit** : règlements clients dont l'échéance est dépassée.
- **Formule** : `Σ (amount_expected − amount_paid)` sur `payments.status = 'overdue'`
- **Couleur** : 🔴 dès que > 0 (tout retard est anormal)
- **Source** : `payments`
- **Note** : aujourd'hui seuls les honoraires portent une notion d'échéance/retard. Travaux et achats n'ont pas de statut « retard client » → non comptés ici (à confirmer : veux-tu qu'on ajoute un suivi d'échéance côté travaux/achats plus tard ?).

### 6. Sorties cash 90 jours
- **Ce que ça dit** : ce que tu devras verser aux prestataires dans les 3 mois.
- **Formule** : `Σ (amount_total − amount_paid)` sur `travaux_payments` + `achats_payments` où `scheduled_date ≤ aujourd'hui + 90j` et `status ≠ 'paid'`, ÷ 10
- **Couleur** : ⚪ neutre · 🟠 si ce montant **dépasse la trésorerie à date** (alerte : tu vas devoir sortir plus que ton cash disponible)
- **Source** : `travaux_payments`, `achats_payments`

---

## Étage 2 — Rentabilité (gagne-t-on de l'argent ?)

> La question : *chaque projet me rapporte-t-il ce qu'il devrait ?*

### 7. Marge brute consolidée
- **Ce que ça dit** : ta marge réelle, tous métiers confondus.
- **Formule** : `Honoraires attendus + (Facture travaux − Devis travaux) + (Facture achats − Devis achats)`, en EUR
- **Couleur** : 🟢 si > 0 · 🔴 si < 0
- **Pourquoi ça remplace l'ancienne « Marge brute YTD »** : l'ancienne soustrayait les versements artisans (coût des chantiers, MAD) des honoraires encaissés (revenu de service, EUR). Deux métiers différents, aucun lien garanti entre eux → chiffre ininterprétable. Le canon impose `marge = facturé − devis`.

### 8. Taux de marge chantier
- **Ce que ça dit** : combien tu gardes sur 100 € de travaux/achats facturés.
- **Formule** : `(Marge travaux + Marge achats) ÷ (Facture travaux + Facture achats) × 100`
- **Couleur** : 🟢 au-dessus de la cible · 🟠 en dessous · 🔴 si négatif
- **Seuil** : cible **30 %** (🟠 en dessous, 🔴 si négatif). _Validé par le CEO._
- **Note** : les honoraires sont exclus de ce taux (marge de 100 %, ils fausseraient la lecture).

### 9. Écart de marge vs cible
- **Ce que ça dit** : facture-t-on ce qu'on avait prévu de facturer au départ ?
- **Formule** : `Σ (facture_client − budget_estimé)` sur travaux + achats, ÷ 10 = `Marge brute chantier − Marge cible chantier`
- **Couleur** : 🟢 si ≥ 0 · 🔴 si < 0 (on facture sous le budget annoncé au client)
- **Source** : lots travaux + achats

### 10. Honoraires moyen par projet livré
- **Ce que ça dit** : combien rapporte en moyenne un projet mené à terme.
- **Formule** : `Σ honoraires des projets status = 'termine' ÷ nombre de projets terminés`
- **Couleur** : ⚪ neutre
- **Source** : vue `project_honoraires_totals` + `projects`

### 11. Anomalies d'intégrité
- **Ce que ça dit** : saisies incohérentes à corriger (pas une perte, un signal qualité de données).
- **Formule** : nombre de projets en **sur-encaissement** (encaissé > facturé) **ou sur-paiement** (payé > devis)
- **Couleur** : ⚪ si 0 · 🟠 si ≥ 1
- **Source** : contrôles déjà définis dans `travaux-calc.ts` / `achats-calc.ts`

---

## Étage 3 — Croissance (le moteur tourne-t-il ?)

> La question : *combien de projets, combien de CA, et qu'est-ce qui me file entre les doigts ?*

### 12. Projets actifs
- **Ce que ça dit** : ton portefeuille en production.
- **Formule** : nombre de projets `status ∉ ('perdu', 'termine')`, ventilé par phase
- **Couleur** : ⚪ neutre
- **Source** : `projects`

### 13a. CA honoraires (mois / YTD)
- **Ce que ça dit** : ta vraie recette de service encaissée.
- **Formule** : `Σ payments.amount_paid` sur la période (mois en cours, puis depuis le 1ᵉʳ janvier)
- **Couleur** : ⚪ neutre
- **Source** : `payments`

### 13b. Volume facturé total
- **Ce que ça dit** : tout ce que tu factures au client (service + refacturation chantiers/ameublement). À ne **pas** confondre avec ta marge.
- **Formule** : `Honoraires attendus + (Facture travaux + Facture achats) ÷ 10`
- **Couleur** : ⚪ neutre
- **Source** : honoraires attendus + lots
- **Décision actée** : 13a et 13b affichés **côte à côte**, jamais fusionnés, pour distinguer marge de service et flux de refacturation.

### 14. Pipeline entrées 90 jours
- **Ce que ça dit** : les règlements clients attendus dans les 3 mois.
- **Formule** : `Σ (amount_expected − amount_paid)` sur `payments` où `due_date ≤ aujourd'hui + 90j` et `status ≠ 'paid'`
- **Couleur** : ⚪ neutre
- **Source** : `payments`

### 15. Projets perdus
- **Ce que ça dit** : ce qui n'a pas abouti = proxy de ton taux de transformation.
- **Formule** : nombre de projets `status = 'perdu'` + valeur d'honoraires non concrétisée (`Σ honoraires_expected`)
- **Couleur** : ⚪ si 0 · 🟠 sinon
- **Source** : `projects` (vue `include_lost`), `project_honoraires_totals`

### Graphe — Évolution du CA encaissé (12 mois)
- **Conservé tel quel** depuis le dashboard actuel : barres mensuelles de `payments.amount_paid`, 12 derniers mois.

---

## Récapitulatif des seuils à trancher

| KPI | Seuil proposé | À valider |
|---|---|---|
| Clients en retard | 🔴 dès 1 € | ☐ |
| Sorties cash 90j | 🟠 si > trésorerie à date | ☐ |
| Taux de marge chantier | cible 30 % (🟠 en dessous, 🔴 si < 0) | ✅ validé |
| Anomalies d'intégrité | 🟠 si ≥ 1 | ☐ |
| Trésorerie / marge / écart / reste net | 🔴 si < 0 (perte réelle) | ☐ |

## Décisions verrouillées

1. **Taux de marge chantier cible** → **30 %** (🟠 en dessous, 🔴 si négatif).
2. **CA** → honoraires et volume facturé affichés **séparément** (étage 3).
3. **Marge vs cash, deux chiffres distincts** :
   - Étage Rentabilité → **marge = ce que tu factures − ce que tu dois** (facturé − devis). Insensible au timing des règlements. C'est « l'affaire est-elle rentable ? ».
   - Étage Santé cash → **trésorerie = ce que tu as encaissé − ce que tu as payé**. C'est « combien j'ai en poche maintenant ? ».
   - Les deux apparaissent, jamais fusionnés.
4. **Retards** → mesurés sur les honoraires uniquement (seul flux avec une date d'échéance client). Suivi d'échéance côté chantiers = évolution future, hors scope.
5. **Garde-fou marge** → seuls les lots dont le facturé est renseigné entrent dans le taux de marge ; un compteur « lots sans facturé » indique la base de calcul.
6. **Plancher 2026 sur les flux datés** → les mouvements d'argent (encaissé, payé) ne sont comptés qu'à partir du 1ᵉʳ janvier 2026 (legacy 2025 exclu) : trésorerie, CA, sorties cash, graphes d'évolution. Les soldes (restes à encaisser/payer) et les marges restent calculés sur l'ensemble des lots ouverts. Les graphes affichent les mois de l'année en cours.
7. **Graphes d'évolution** → deux bandeaux mensuels distincts : CA honoraires encaissés, et CA travaux + achats (encaissements chantiers). Barres hautes + valeur en k€ pour lisibilité.

---

*Une fois ce référentiel validé, j'implémente le cockpit dans `app/(team)/dashboard/financier/page.tsx` sur la branche `feat/kpi-financiers`, avec un helper de consolidation EUR centralisé (pas de calcul dupliqué), et je te livre les commandes git.*
