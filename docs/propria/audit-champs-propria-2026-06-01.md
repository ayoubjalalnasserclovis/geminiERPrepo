# Audit des champs Propria — 1er juin 2026

Audit en lecture seule du modèle de données Propria : articulation des données, doublons, champs morts, formules et erreurs. Aucune modification effectuée.

---

## Verdict en 3 lignes

Le socle est sain : aucun calcul dérivé n'est stocké en dur, le taux 1 EUR = 10 MAD est forcé partout, le soft-delete est respecté. **Le vrai problème est un découpage bien/lot mal exécuté** : une douzaine de champs « listing » sont *édités sur le bien* mais *lus sur le lot*, donc une modif dans le formulaire bien ne se voit nulle part. Et la jauge de complétude mesure de vieux champs au mauvais endroit, ce qui fausse les scores.

---

## 1. Ce qui va bien (le socle est solide)

- **Aucun dérivé stocké en dur.** Marge intervention, soldes de caisse, valeur de stock, KPI — tout est recalculé en vue SQL, jamais figé en base. Conforme au canon.
- **Taux de change.** 1 EUR = 10 MAD appliqué via `to_eur()` et forcé par trigger sur les paiements. Aucune valeur divergente trouvée.
- **Soft-delete partout.** Pas de suppression dure ni de TRUNCATE ; les suppressions sensibles sont réservées au CEO / chef de projet.
- **Calculs vérifiés justes.** Marge = facturé − coût (bon sens des signes) ; solde caisse = dotations − dépenses ; stock = initial + entrées − sorties. Tout est cohérent.

---

## 2. Le problème central : bien vs lot, édité d'un côté, lu de l'autre

Depuis la bascule vers les lots (`propria_units`), une douzaine de champs « listing » existent en double : une copie sur le **bien** (`properties`) et une sur le **lot** (`propria_units`). Le souci n'est pas le doublon en soi, c'est que **l'écriture et la lecture ne visent pas la même table** :

- Le **formulaire bien** (`app/(team)/propria/biens/actions.ts`) et l'**activation depuis un projet** (`activate/actions.ts`) écrivent ces champs sur **le bien**.
- Les **écrans qui les affichent** (fiche projet, liste des lots, et désormais la page « Lots gérés ») les lisent depuis **le lot**.

Résultat concret : **tu modifies le prix/nuit ou le lien Airbnb dans le formulaire du bien → rien ne change à l'écran**, parce que l'affichage lit le lot, qui n'a pas été mis à jour. C'est exactement la divergence que tu pressentais.

Champs concernés par cette divergence réelle (édités sur le bien, lus sur le lot) :
prix/nuit, URL Airbnb, URL Booking, date de publication, capacité voyageurs, nombre de chambres, type de lits, n° de porte, dossier photos Drive, observations, nombre de clés, code serrure.

### Le bon modèle cible (qui possède quoi)

Le découpage *voulu* est en réalité cohérent — il faut juste l'appliquer à l'écriture :

**Niveau BIEN (bâtiment, partagé par toutes les suites)** → source = `properties`
identité, propriétaire, banque, mandat, commission, eau/élec/internet, accès immeuble (boîte à clés immeuble, badges, ascenseur, syndic, gardien, caméra), **wifi (1 box) et serrure principale**, vidéo d'arrivée.

**Niveau LOT / suite (un par listing)** → source = `propria_units`
prix/nuit, URL Airbnb & Booking, date de publication, capacité, chambres, type de lits, n° de porte de la suite, boîte à clés de la suite, dossier photos, observations, prestataire référent, fiche d'infos à envoyer, accès admin app.

Aujourd'hui, les champs « niveau lot » sont éditables uniquement via le formulaire **bien** (mauvaise table). Il manque l'édition de ces champs **sur le lot**.

---

## 3. La jauge de complétude est faussée

La vue `v_property_completeness` (qui alimente le badge « Complétude » et le filtre « À compléter ») mesure 17 champs **sur le bien** — or plusieurs d'entre eux (wifi SSID, mot de passe wifi, code serrure, n° de porte, serrure électronique) ont leur source de vérité ailleurs ou sont des copies legacy. Conséquence : un bien dont les infos sont correctement renseignées **au bon endroit** peut être affiché « incomplet ». Le score n'est pas fiable tant que la vue n'est pas réalignée sur le bon découpage bien/lot.

À cela s'ajoute un **champ fantôme** : `propria_access_admin` compte dans le score de complétude mais **n'existe dans aucun formulaire** — il est donc impossible à remplir, ce qui bloque mécaniquement le 100 %.

---

## 4. Champs morts (à supprimer, zéro impact)

Définis en base, **jamais lus ni écrits** dans l'application :

- `properties.propria_key_box_building` — boîte à clés immeuble
- `properties.propria_key_box_location` — emplacement boîte à clés immeuble
- `properties.propria_badge_building` — badge immeuble
- `properties.propria_access_admin` — codes accès immeuble (présent uniquement dans le score de complétude, jamais saisi → à retirer du score ou à brancher en UI)
- `propria_units.propria_default_provider_id` — prestataire référent du lot, défini mais branché nulle part

---

## 5. Doublons explicitement marqués « à nettoyer »

Sur `propria_units`, quatre colonnes ont été créées puis **immédiatement marquées DEPRECATED** car le wifi et la serrure sont des attributs du **bâtiment**, pas de la suite : `propria_wifi_ssid`, `propria_wifi_password`, `propria_lock_code`, `propria_smart_lock`. La source de vérité voulue est le bien ; ces copies sur le lot sont à supprimer une fois confirmé qu'aucun écran ne les lit.

---

## 6. Point mineur

Le trigger qui génère le code d'un lot prend « le premier projet » rattaché au bien (`LIMIT 1`) pour construire le slug. Si un même bien est rattaché à plusieurs projets, le code généré devient indéterminé. Cas rare, faible sévérité, à documenter ou sécuriser.

---

## 7. Plan d'action proposé (priorisé)

**P0 — Stopper la divergence (le plus important).**
Faire du **lot la source de vérité unique** pour les champs « niveau lot » : déplacer leur édition du formulaire bien vers un formulaire **lot** (l'action `updatePropriaUnitAction` existe déjà), et retirer ces champs du formulaire bien. Tant que ce n'est pas fait, toute saisie de prix/Airbnb/capacité sur la fiche bien est sans effet visible.

**P1 — Réaligner la complétude.**
Réécrire `v_property_completeness` pour mesurer les champs bien sur le bien et les champs lot sur le lot, et retirer (ou brancher) le champ fantôme `propria_access_admin`. Sans ça, le filtre « À compléter » reste trompeur.

**P2 — Nettoyer (migration de ménage, idempotente, soft).**
Supprimer les champs morts (section 4) et les copies DEPRECATED (section 5) une fois confirmé qu'aucun lecteur ne subsiste, puis migrer les valeurs « niveau lot » encore présentes sur le bien vers le lot avant de retirer les colonnes du bien.

**P3 — Détail.**
Sécuriser/documenter le cas « plusieurs projets pour un bien » dans la génération de code de lot.

Chaque étape se fait avec dry-run + snapshot d'audit avant écriture, et migration SQL versionnée — conformément au canon.
