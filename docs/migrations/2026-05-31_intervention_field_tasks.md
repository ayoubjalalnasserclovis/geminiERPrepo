# Tâches terrain Propria — déploiement & test

**Migration :** `20260531120000_intervention_field_tasks.sql`
**Date :** 2026-05-31

## Ce que ça change (langage métier)

On a transformé le module Interventions Propria en vrai **suivi de tâches terrain** :

- Le back office **assigne** une tâche à un collaborateur terrain (champ « Assignée à »), avec une **échéance**.
- Le terrain (rôle `propria`) voit **« Mes tâches »**, dépose une **preuve photo/vidéo** depuis son téléphone, puis **soumet pour validation**. Impossible de soumettre sans au moins une preuve.
- Le back office **valide** ou **refuse avec un motif** (la tâche repart « à refaire », le compteur de refus s'incrémente).
- KPI back office : **À valider**, **En retard**, **Refusées**.

Le bien reste **obligatoire** sur chaque tâche. Aucun nouveau module : on a étendu l'existant. Seule table ajoutée : `propria_intervention_proofs` (preuves, avec traçabilité qui/quand/IP).

## Étape manuelle AVANT la migration (une seule fois)

Le bucket de stockage `intervention-proofs` est créé par la migration avec un plafond de **200 Mo/fichier**. Vérifier dans **Supabase → Storage → Settings** que la *Global file size limit* du projet est **≥ 200 Mo** (sinon le plafond du bucket est écrêté). C'est déjà le cas si le bucket `property-media` (1 Go) fonctionne.

## Déploiement

```bash
cd stoniz-platform
git add -A
git commit -m "feat(propria): suivi des tâches terrain — assignation, preuve photo/vidéo, validation back office

- Étend propria_interventions (assignation terrain, échéance, validation/refus)
- Table propria_intervention_proofs (photo/vidéo, audit)
- RLS resserrée : le terrain (rôle propria) ne voit que ses tâches
- Écran terrain /propria/mes-taches + workflow de validation"
git push origin main

# Appliquer la migration sur la base distante
supabase db push
```

## Test manuel (5 min, dérouler le cycle complet)

1. **Back office** (ceo/chef_projet/assistante) → `/propria/interventions` → « + Nouvelle tâche ».
   - Choisir un bien, une description (« amener du papier toilette »), **Assignée à** = un collaborateur terrain, **Échéance** = demain. Créer.
2. **Terrain** (compte rôle `propria` assigné) → `/propria/mes-taches` → la tâche apparaît en « À faire ».
   - Ouvrir → « Démarrer » → « Ajouter photo/vidéo » (déposer 1 photo) → « Soumettre pour validation ».
   - Vérifier qu'on **ne peut pas** soumettre sans preuve (bouton désactivé).
3. **Back office** → `/propria/interventions` → carte « À valider » = 1.
   - Ouvrir la tâche → « Refuser » avec motif (« photo floue ») → la tâche passe « Refusée », compteur ×1.
4. **Terrain** → « Mes tâches » → la tâche est « À refaire » avec le motif → reprendre, redéposer, resoumettre.
5. **Back office** → « Valider » → statut « Validée », sort des actifs.

## Contrôles de sécurité à vérifier

- Un terrain `propria` qui ouvre l'URL d'une tâche **non assignée** → page introuvable (RLS).
- Le terrain ne voit **pas** le menu « Interventions » (réservé back office), seulement « Mes tâches ».
- Le terrain ne peut **pas** valider/refuser (boutons absents + action refusée côté serveur).

## Rollback

Soft par nature (aucune donnée existante modifiée). Pour annuler le schéma : restaurer les anciennes politiques RLS génériques de `propria_interventions` (voir `20260525002000_propria_foundations.sql`, boucle staff) et `DROP TABLE propria_intervention_proofs`. Les nouvelles colonnes peuvent rester (nullable, sans effet).
