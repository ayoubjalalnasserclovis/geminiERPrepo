# Procédure de test — Refonte projets/propria units

Migration : `20260530000000_propria_units_and_client_codes.sql`
Date cible déploiement : 2026-05-30
Auteur : Othmane + Claude

## Objectif

Vérifier que la migration ne casse aucune relation existante et que les
nouveaux flux (codes lisibles, lots Propria, propagation rename) fonctionnent
de bout en bout.

## Pré-requis

- Branche `main` à jour, code commité avant tests.
- Accès admin Supabase au projet de staging.
- Compte CEO actif pour tester les actions privilégiées.

## Tests en environnement de staging (sur copie BDD prod)

Faire AVANT de pousser en prod. Les 10 scénarios ci-dessous doivent tous
passer sans erreur applicative ni régression visible.

### 1. Création de projet — code auto-généré depuis le nom du client

**Étapes** :
1. Aller sur `/projects/new`.
2. Sélectionner un client existant nommé "Bennani" (créer un client de test
   si nécessaire via `/clients/new`).
3. Créer le projet.

**Résultat attendu** :
- Le projet apparaît dans `/projects` avec le code `bennani`.
- `projects.reference` est toujours présente (STZ-2026-NNN).
- En base : `SELECT id, reference, code, code_locked FROM projects WHERE
  client_id = '<id>'` → `code = 'bennani'`, `code_locked = false`.

### 2. Deuxième projet pour le même client — disambiguation auto

**Étapes** :
1. Créer un deuxième projet pour le même client "Bennani".

**Résultat attendu** :
- Le nouveau projet a `code = 'bennani-2'`.
- Le premier projet conserve `bennani`.

### 3. Projet pour un homonyme — disambiguation auto

**Étapes** :
1. Créer un client "Bennani" différent du premier (deux personnes peuvent
   avoir le même nom).
2. Créer un projet pour ce nouveau client.

**Résultat attendu** :
- Le nouveau client a `slug = 'bennani-2'` (ou suivant disponible).
- Son premier projet a `code = 'bennani-2'`.

### 4. Création d'un bien source

**Étapes** :
1. Sur la fiche du projet "bennani", lier un bien (existant ou nouveau).
2. Vérifier que le bien est correctement enregistré dans `properties`.

**Résultat attendu** :
- Le bien est créé.
- `projects.property_id` est rempli.
- Aucun `propria_unit` n'est encore créé (l'activation Propria est une
  étape distincte).

### 5. Activation Propria + création de 2 lots

**Étapes** :
1. Sur la fiche projet (en phase `termine`), cliquer "Activer Propria".
2. Compléter la fiche d'activation.
3. Une fois Propria activé, créer un premier `propria_unit` avec
   `propria_capacity_voyageurs = 2`, etc.
4. Créer un deuxième `propria_unit` sur le même bien.

**Résultat attendu** :
- `propria_units` contient 2 lignes pour ce bien.
- Codes auto-générés : `bennani-1` (order_index=1), `bennani-2` (order_index=2).
- `code_locked = false` pour les deux.
- Le bien `properties` reste intact, ses anciennes colonnes Propria
  `DEPRECATED` ne sont pas touchées.

### 6. Saisie d'une dépense Caisse rattachée au lot

**Étapes** :
1. Aller sur `/propria/caisse/<wallet_id>`.
2. Saisir une dépense en sélectionnant le lot `bennani-1`.
3. Valider.

**Résultat attendu** :
- La dépense est créée dans `propria_wallet_expenses` avec
  `propria_unit_id = <id du lot bennani-1>` et `property_id = NULL`.
- Contrainte CHECK Option B respectée.

### 7. Rename client — propagation automatique des codes

**Étapes** :
1. Renommer le client "Bennani" en "Bennani-Alami" (via l'interface client
   ou directement en SQL :
   `UPDATE clients SET full_name = 'Bennani-Alami' WHERE id = '<id>'`).
2. Vérifier en base.

**Résultat attendu** :
- `clients.slug = 'bennani-alami'`.
- `projects.code = 'bennani-alami'` (sauf si `code_locked = true`).
- `propria_units.code = 'bennani-alami-1'`, `bennani-alami-2`.
- `SELECT COUNT(*) FROM propria_wallet_expenses WHERE propria_unit_id IN
  (...)` retourne le même nombre qu'avant le rename — **aucune dépense
  perdue**.

### 8. Recherche dans le sélecteur Caisse STONIZ

**Étapes** :
1. Aller sur `/caisse-stoniz/<wallet_id>`.
2. Dans le formulaire de saisie de dépense, ouvrir le sélecteur Projet.

**Résultat attendu** :
- Les options affichent `bennani-alami · Bennani-Alami` au lieu de
  `STZ-2026-NNN`.
- Le tri est alphabétique par code.

### 9. Export comptable / cohérence reference STZ-NNN

**Étapes** :
1. Exécuter en SQL :
   `SELECT id, reference, code FROM projects WHERE reference IS NULL`.

**Résultat attendu** :
- 0 ligne : tous les projets ont toujours leur `reference` STZ-NNN.
- Les emails envoyés par les triggers / cron utilisent toujours `reference`
  (continuité historique).

### 10. Test de rollback (sur copie BDD uniquement)

**Étapes** :
1. Sur une copie de la BDD post-migration, simuler un rollback :
   - Restaurer le snapshot pré-migration de Supabase.
2. Vérifier que les colonnes deprecated de `properties` sont toujours
   présentes et exploitables.

**Résultat attendu** :
- L'app fonctionne en lecture sur la BDD pré-migration sans crash
  (les colonnes `propria_*` sur `properties` existent toujours).
- En cas de rollback réel, on dispose d'une fenêtre de 30 jours avant
  la migration de cleanup (`DROP COLUMN`).

## Tests post-déploiement prod (smoke tests)

À exécuter dans les 30 minutes après `supabase db push` en prod :

1. Vérifier qu'aucun projet n'a `code IS NULL` :
   `SELECT COUNT(*) FROM projects WHERE code IS NULL` → 0.
2. Vérifier qu'aucun client n'a `slug IS NULL` :
   `SELECT COUNT(*) FROM clients WHERE slug IS NULL` → 0.
3. Vérifier l'intégrité des FK Option B sur les 8 tables :
   `SELECT 'propria_interventions' AS t, COUNT(*) FROM propria_interventions
    WHERE (property_id IS NULL) = (propria_unit_id IS NULL);`
   → 0 ligne en violation pour les tables strict (interventions, maintenance,
   inventories, cash_reservations, listing_metrics).
4. Tester la création d'une dépense Caisse STONIZ depuis l'UI (le bug
   racine de cette refonte).
5. Tester la création d'un projet depuis l'UI → `code` rempli.

## En cas de problème

- **Erreur "duplicate key" sur un code** : la disambiguation a échoué. Vérifier
  manuellement la collision et appliquer un suffixe explicite via
  `renameProjectCodeAction` ou directement en SQL.
- **Trigger de propagation rename qui boucle** : vérifier les logs Supabase
  pour détecter une récursion. Si problème, désactiver temporairement le
  trigger :
  `ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename`.
- **Rollback complet** : restaurer le snapshot Supabase pré-migration. Les
  16 colonnes DEPRECATED sur `properties` sont toujours là pour 30 jours,
  l'app legacy reste fonctionnelle.

## Migration de cleanup différée (à exécuter à +30 jours)

Le 2026-06-30 (ou plus tard si refacto Propria pas terminée), créer une
nouvelle migration `20260630000000_drop_deprecated_property_columns.sql`
qui :
- Supprime les 21 colonnes `propria_*` marquées DEPRECATED de `properties`.
- Supprime `propria_google_maps_url` (doublon de `google_maps_url`).
- Supprime le trigger legacy `properties_propria_default_provider_fkey` si
  encore présent.
- Reconstruit la vue `properties_enriched` pour ne plus référencer ces
  colonnes.

Ne pas exécuter cette migration tant que tous les sites de lecture
(pages biens, fiche projet, propria caisse) n'ont pas été refactorés
vers `propria_units`.
