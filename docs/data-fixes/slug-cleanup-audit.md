# Audit — Nettoyage des slugs clients pollués

**Date :** 2026-05-30 (02h30)

## Slugs à nettoyer

| Client | full_name actuel | slug actuel | full_name cible | slug cible |
|---|---|---|---|---|
| Hakim Boucheniata | `BOUCHENIATA Hakim - BEJ GUENI` | `boucheniata-hakim-bej-gueni` | `BOUCHENIATA Hakim` | `boucheniata-hakim` |
| Yassine El Badaoui | `EL BADAOUI Yassine- MAJORELLE` | `el-badaoui-yassine-majorelle` | `EL BADAOUI Yassine` | `el-badaoui-yassine` |

**Cause racine :** au moment de l'import Notion, le `full_name` du client a hérité du nom du premier projet enregistré sous lui. Le trigger `trg_clients_set_slug` a alors calculé un slug à partir de ce nom pollué.

## Dépendances cartographiées

### 1. Schéma (colonnes qui contiennent ou dérivent du slug)

| Table | Colonne | Type de dépendance |
|---|---|---|
| `clients` | `slug` | UNIQUE INDEX `clients_slug_uniq` |
| `projects` | `code` | Dérivé de `client.slug + suffix` au INSERT, propagé sur UPDATE full_name |
| `propria_units` | `code` | Dérivé de `client.slug + order_index`, **MAIS code_locked=true sur tous nos imports** → préservés |

### 2. Triggers

| Trigger | Table | Quand | Effet sur fix |
|---|---|---|---|
| `clients_set_slug` | `clients` | BEFORE INSERT | Pas concerné (UPDATE pas INSERT) |
| `clients_propagate_rename` | `clients` | AFTER UPDATE OF full_name | **Fire si on change full_name → recalcule slug + propage aux projects.code et propria_units.code non-locked** |
| `trg_projects_set_code` | `projects` | BEFORE INSERT | Pas concerné |
| `trg_propria_units_set_code` | `propria_units` | BEFORE INSERT | Pas concerné |

### 3. Code TypeScript

- `app/(team)/propria/biens/[id]/units/actions.ts` : utilise `propria_units.code` (préservé par code_locked=true)
- `app/(team)/projects/[id]/page.tsx` : affiche `project.code` (sera mis à jour par le fix)
- Aucune URL publique ne référence `clients.slug` ni `projects.code`

### 4. Vues SQL
Aucune vue SQL ne dérive de `clients.slug` ou `projects.code` (recherche `CREATE VIEW` négative).

### 5. RLS Policies
Aucune policy ne filtre sur `slug` ou `code` (uniquement sur `client_id`, `project_id`, `auth.uid()`).

## Stratégie de fix

**Décision :** désactiver temporairement le trigger `clients_propagate_rename`, faire les UPDATEs manuellement avec la nomenclature voulue, puis réactiver.

**Pourquoi pas laisser le trigger faire le travail ?**
Le trigger recalcule les codes projets en `slug-2`, `slug-3` (suffix séquentiel). Or on veut une nomenclature sémantique `slug-<propria_internal_code>` (ex `boucheniata-hakim-af`). Le trigger ne sait pas faire ça.

## Plan d'exécution

1. `ALTER TABLE clients DISABLE TRIGGER clients_propagate_rename`
2. UPDATE `clients.full_name` ET `clients.slug` pour Hakim + Yassine
3. UPDATE manuel `projects.code` pour les 6 projets PROPRIA legacy concernés :
   - `boucheniata-hakim-bej-gueni-2` → `boucheniata-hakim-af`
   - `boucheniata-hakim-bej-gueni-3` → `boucheniata-hakim-majo`
   - `el-badaoui-yassine-majorelle-3` → `el-badaoui-yassine-warda`
   - `el-badaoui-yassine-majorelle-4` → `el-badaoui-yassine-badaoui-af`
   - `paul-serge-ferreira-2` → `paul-serge-ferreira-patisserie-kawtar`
   - `paul-benneli` : OK (pas de fix)
4. UPDATE `projects.code` du projet "principal" Hakim & Yassine (celui dont le code = slug client pollué) :
   - `boucheniata-hakim-bej-gueni` (projet BEJ GUENI livré) → reste tel quel (cohérent avec le bien)
   - `el-badaoui-yassine-majorelle` et `el-badaoui-yassine-majorelle-2` (anciens projets Yassine sans property liée à WARDA/BADAOUI AF) → on les laisse, ce sont des projets historiques séparés
5. `ALTER TABLE clients ENABLE TRIGGER clients_propagate_rename`
6. Vérification : aucun slug pollué, aucun code projet incorrect, aucune duplication
7. Sauvegarde audit dans table `data_fix_log`

## Risques résiduels

- **Aucun risque RLS** (pas de policy basée sur slug)
- **Aucun risque URL** (aucune URL publique ne dépend du slug)
- **Risque UI minor** : les anciens codes projets `bej-gueni-2`, `bej-gueni-3` qui étaient visibles dans des bookmarks Slack/Notion équipe vont changer. Acceptable.

## Rollback

Si erreur post-fix, restauration depuis la table `data_fix_log` :
```sql
UPDATE clients c
SET full_name = (l.snapshot->>'full_name'), slug = (l.snapshot->>'slug')
FROM data_fix_log l
WHERE l.entity = 'clients' AND l.entity_id = c.id::text;

UPDATE projects p
SET code = (l.snapshot->>'code')
FROM data_fix_log l
WHERE l.entity = 'projects' AND l.entity_id = p.id::text;
```
