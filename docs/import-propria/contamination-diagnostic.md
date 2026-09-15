# Contamination PROPRIA en prod — Diagnostic

**Date :** 2026-05-30 (01h15)
**Source du problème identifiée :** `supabase/seeds/demo_seed_propria.sql` exécuté sur stoniz-prod (probablement via le SQL editor, copier-coller manuel)

## Preuve

Le fichier `demo_seed_propria.sql` contient explicitement les 5 noms suspects :

```
Apt Atlas 1     → Fatima Benkirane    (f.benkirane@example.com)
AF-1, AF-2      → Andre Fortin        (andre.fortin@example.com)
CATH-1          → Catherine Dupond    (catherine.dupond@example.com)
DUC-1           → Famille Duc         (duc.famille@example.com)
HABIB-1         → Habib Sellami       (h.sellami@example.com)
```

Le seed marque toutes les données démo avec le tag `[PROPRIA-DEMO]` dans le champ `propria_observations` (et équivalents sur les tables enfants), ce qui rend le cleanup trivial.

## Hypothèse sur la cause

Pas d'exécution automatique (CI/seed.sql n'est pas lancé en prod). Le seed a probablement été copié-collé dans le SQL editor Supabase prod par erreur, possiblement durant le développement du module Propria (semaine 25-28 mai).

**Aucune accusation** — c'est une erreur typique quand on n'a pas de garde-fou anti-prod dans les seeds.

## Risques actuels

1. **Pollution visuelle** : ces biens fictifs apparaissent dans `/propria/biens` (30 biens au lieu de 15 légitimes)
2. **KPI faussés** : moyennes/comptages PROPRIA incluent les fictifs
3. **Confusion équipe** : un chef de projet qui ouvre "AF-1 (Andre Fortin)" se demande qui c'est
4. **Pas de risque RGPD** : les emails fictifs sont `*.example.com`, pas de vraies données personnelles

## Options de cleanup

### Option A — Hard DELETE via le cleanup natif du seed (recommandé)

Le seed lui-même contient déjà toute la logique de cleanup en haut du fichier (lignes 7-32). On l'extrait dans `propria-cleanup-demo-seed.sql` et on l'exécute.

**Pro** : code testé, idempotent, supprime aussi les satellites (interventions, wallets, inventories, etc.)
**Con** : irréversible

### Option B — Soft delete (deleted_at = now())

Marquer toutes ces lignes comme supprimées sans les retirer physiquement.

**Pro** : réversible, garde l'historique
**Con** : pollue les requêtes qui n'utilisent pas `deleted_at IS NULL`

### Option C — Colonne `is_demo`

Migration qui ajoute `properties.is_demo BOOLEAN DEFAULT false`, marque les 5+ biens à true, et toutes les vues prod filtrent par défaut.

**Pro** : architecture la plus propre à long terme
**Con** : migration de schéma + toucher toutes les vues UI

**Ma reco : Option A.** Vu que les données sont des seeds clairement identifiés, il n'y a pas de valeur historique. Hard DELETE propre, ça remet la base à l'état attendu de notre import légitime de cette nuit.

## Recommandations durables (prévention)

### R1. Renommer les seeds en `.DO_NOT_RUN_IN_PROD.sql`

Renommer `supabase/seeds/demo_seed_propria.sql` → `supabase/seeds/demo_seed_propria.DO_NOT_RUN_IN_PROD.sql`. Signal visuel fort, impossible de copier-coller dans SQL editor sans voir le warning.

### R2. Header de sécurité dans chaque seed

Ajouter en tête de chaque seed :

```sql
-- ⛔ DEMO SEED — NE PAS EXÉCUTER EN PRODUCTION
-- Ce fichier crée des données fictives pour le développement local.
DO $$
BEGIN
  IF current_setting('app.environment', true) = 'production' THEN
    RAISE EXCEPTION '⛔ Seed démo refuse de tourner en production.';
  END IF;
END $$;
```

Et configurer côté prod un `ALTER DATABASE stoniz SET app.environment = 'production';` une fois pour toutes.

### R3. Documenter dans CLAUDE.md / README

Section "Seeds & data hygiene" qui liste les conventions et avertit explicitement.

### R4. Audit périodique (mensuel)

Requête sentinelle qui détecte la présence de tag `[PROPRIA-DEMO]` ou emails `@example.com` en prod et alerte le CEO.

## Plan d'exécution proposé

1. **STOP GATE** — Othmane valide Option A + recommandations R1, R2
2. Exécuter le bloc DIAGNOSTIC de `propria-cleanup-demo-seed.sql` (lecture seule)
3. Vérifier les compteurs (attendu : 5 properties, ~10 units, quelques satellites)
4. Décommenter et exécuter le bloc CLEANUP
5. Vérifier post-cleanup (doit donner 0 properties demo + 15 properties PROPRIA légitimes)
6. Appliquer R1 + R2 sur le repo + commit + push
