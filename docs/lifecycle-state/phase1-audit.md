# Phase 1 — Audit lifecycle_state projets

**Date :** 2026-05-29
**Périmètre :** comprendre l'existant autour du statut projet (`actif` / `pause` / `termine` / `perdu`) avant de concevoir le workflow de validation.

## TL;DR — surprise majeure

**Le schéma DB a déjà tout ce qu'il faut.** La table `projects` contient depuis le jour 1 :

- `status TEXT CHECK IN ('actif','pause','termine','perdu')` (défaut `actif`)
- `lost_reason TEXT`, `lost_at TIMESTAMPTZ`
- `paused_at TIMESTAMPTZ`, `resumed_at TIMESTAMPTZ`
- Index UNIQUE partiel `projects_property_active_uniq` sur `property_id` filtré par `status IN ('actif','termine')` → **mettre un projet en `perdu` libère AUTOMATIQUEMENT le bien** côté DB (contrainte d'unicité levée). Excellent côté side effect natif.

**Ce qui manque :**
- Aucune RPC pour effectuer la transition (`pause`, `perdu`, reprise) → modification possible uniquement via SQL editor manuel.
- Aucun workflow de validation côté DB ou app.
- Aucune UI staff pour piloter ces transitions.
- Aucun audit log dédié (différent de `prep_audit_log` qui ne logge que le mode préparation).
- Les colonnes `paused_at`, `resumed_at`, `lost_at`, `lost_reason` sont **dormantes** — référencées dans le schéma mais jamais écrites par l'app.
- Les notifications/relances ne filtrent **pas** par status → un projet en pause continue de recevoir des relances cron.

## 1. Modèle de données existant

### Colonnes lifecycle sur `projects`

| Colonne | Type | Default | Utilisée par l'app ? |
|---|---|---|---|
| `current_phase` | enum | `onboarding` | Oui (RPC `advance_project_phase`) |
| `status` | text (4 valeurs) | `actif` | Lecture seule (filtres, badges, KPI) |
| `lost_reason` | text | NULL | **Dormante** — jamais écrite |
| `lost_at` | timestamptz | NULL | **Dormante** |
| `paused_at` | timestamptz | NULL | **Dormante** |
| `resumed_at` | timestamptz | NULL | **Dormante** |
| `deleted_at` | timestamptz | NULL | Soft delete générique |
| `is_preparation` | bool | false | Pipeline activation client |
| `legacy_imported` | bool | false | Projet historique |
| `activated_at` | timestamptz | NULL | Visibilité portail client |

### Index notables

```sql
projects_phase_status_idx ON projects (current_phase, status)
projects_property_active_uniq UNIQUE ON projects (property_id)
  WHERE deleted_at IS NULL
    AND status IN ('actif','termine')
    AND property_id IS NOT NULL
```

→ L'index UNIQUE est **partiel sur status** : un projet en `perdu` ne bloque plus le bien, donc le bien peut être re-sourcé par un autre client. Logique déjà encodée dans la contrainte. À conserver.

### Tables connexes existantes utilisables

- `project_phases_history` — historique des transitions de phase (≠ status). Référent pour le pattern audit.
- `project_phase_bypass_log` — log super-admin des bypass gates. Réutilisable comme inspiration de structure pour `project_lifecycle_transition`.
- `prep_audit_log` — uniquement en mode préparation. Pas pertinent ici.

## 2. RPC existantes

Une seule RPC touche au cycle de vie : `advance_project_phase(p_project_id, p_new_phase)`.
- Modifie `current_phase`, JAMAIS `status`.
- Vérifie gates strictes (documents, dates, tâches bloquantes).
- Bypass super-admin si projet `is_preparation=true`.
- Crée les paiements jalonnés + tâches auto à chaque phase (sauf en mode préparation).

**Aucune RPC pour `pause` ou `perdu`.** → Greenfield total pour le workflow lifecycle.

## 3. RLS sur `projects`

```sql
projects_staff_full   FOR ALL    USING is_staff(['ceo','chef_projet'])
projects_staff_read   FOR SELECT USING is_staff()
projects_client_own   FOR SELECT USING id IN client_project_ids()
```

→ **Tout chef_projet peut UPDATE `status` directement** via la policy `_full`. Pas de garde côté DB.

**Implication design Phase 2 :** soit on durcit la RLS (UPDATE `status` interdit aux chef_projet, force passage par RPC), soit on garde la RLS souple et on impose le workflow uniquement côté server action. Le **durcissement RLS + RPC SECURITY DEFINER** est plus robuste (résistant à un bypass code).

## 4. UI qui consomment `status`

| Page | Usage | Mutation ? |
|---|---|---|
| `/projects` (liste) | Filtres chips actif/pause/terminé/perdu, badges par carte | Lecture |
| `/projects/[id]` | Badge en haut de fiche | Lecture |
| `/projects/[id]/dashboard` | Badge | Lecture |
| `/dashboard` (vue d'ensemble) | KPI "projets actifs" | Lecture |
| `/dashboard/financier` | Filtre `status != 'perdu'`, KPI projets perdus, projets termine | Lecture |
| `/dashboard/travaux` | KPI projets actifs | Lecture |
| `/dashboard/achats` | KPI projets actifs | Lecture |
| `/dashboard/clients` | Compte projets actifs par client | Lecture |

→ Toute l'app affiche le status mais **aucune** UI ne permet de le modifier. Les filtres "En pause" / "Perdus" existent depuis le jour 1 sans contenu fonctionnel.

## 5. Jobs / triggers / actions dépendant du status

### a) Cron `/api/cron/daily-reminders`

Pré-filtre déjà sur `is_preparation = false AND legacy_imported = false AND activated_at IS NOT NULL`.
**Ne filtre PAS sur `status`.** → Un projet en `pause` ou `perdu` continue de recevoir des relances par mail (onboarding, jalons, etc.).

**Action requise Phase 3 :** ajouter `.eq('status', 'actif')` au pré-filtre, ou mieux, étendre `can_notify_for_project(p_project_id)` pour exiger `status = 'actif'`.

### b) `lib/alerts/collect.ts`

Filtres déjà existants sur `status = 'actif'` à 3 endroits :
- alertes "projet sans chef de projet assigné"
- détection "client sans projet actif > 60j"
- partenaires actifs

**OK, déjà compatible.** Pas de modif requise.

### c) Contrainte UNIQUE `projects_property_active_uniq`

Side effect natif : passer `status = 'perdu'` libère le bien. Idem `termine` puisque l'index inclut `'actif','termine'`. **À conserver tel quel.**

### d) Paiements & honoraires

Le RPC `advance_project_phase` crée les paiements jalonnés à chaque transition de phase. **Pas de hook automatique sur `status`.**

**Action requise Phase 3 :** lors de la transition vers `pause` ou `perdu`, mettre les `payments.status` en attente → enum à étendre (actuellement `pending|paid|overdue|cancelled`). On peut soft-update à `on_hold` (pause) ou `cancelled` (perdu).

### e) Aucune subscription Supabase realtime ni trigger BDD sur `status`

Pas de hook BDD existant à invalider.

## 6. Comportement à l'import Notion

Le script `import-clients-projects.ts` mappe déjà :
- Notion Status `"Perdu"` → `{ phase: 'sourcing', status: 'perdu' }`
- Notion Status `"En pause"` → `{ phase: 'onboarding', status: 'pause' }`

→ Des projets en `pause` et `perdu` existent **déjà** dans la base sans `paused_at` / `lost_at` / `lost_reason` renseignés. **Backfill nécessaire** Phase 3 : pour chaque projet importé en `pause`/`perdu`, créer une ligne `project_lifecycle_transition` rétroactive avec acteur = CEO et `reason = 'imported_from_notion'`.

À auditer avant Phase 2 : combien de projets sont en `pause` / `perdu` actuellement ?

```sql
SELECT status, COUNT(*) FROM projects
WHERE deleted_at IS NULL GROUP BY status;
```

## 7. Colonnes à ajouter / modifier / déprécier

### À ajouter
- `lifecycle_state` ? — **NON, redondant avec le `status` existant**. On garde `status` comme source unique de vérité. (Économise une migration, évite la dérive entre 2 champs.)
- `pause_reason` (enum) — actuellement `lost_reason` est `TEXT` libre, mais rien pour pause.
- `expected_resume_at` (date) — pour pause uniquement.
- `lost_revenue_amount` (numeric) — montant honoraires perdus, snapshot au passage en `perdu`.
- `lessons_learned` (text) — texte libre obligatoire pour `perdu`.
- `last_lifecycle_transition_id` (uuid FK) — raccourci pour afficher la dernière transition sans rejoindre la table audit.

### À enrichir
- `lost_reason TEXT` → laisser pour rétrocompatibilité, mais introduire un champ enum `lost_reason_code` à côté.

### Nouvelle table
- `project_lifecycle_transition` (id, project_id, from_status, to_status, requested_by, validated_by, requested_at, validated_at, reason_code, memo, lost_revenue_snapshot, lessons_learned, expected_resume_at, status enum `pending|approved|rejected|cancelled`)

### Nouveau enum
- `pause_reason_code` : `financement_attendu`, `sourcing_bloque`, `client_indisponible`, `litige_partenaire`, `autre`
- `lost_reason_code` : `client_retire`, `concurrent`, `desaccord_contractuel`, `qualite_reprochee`, `delai_excessif`, `defaut_financement`, `autre`

### Rien à déprécier
- `paused_at`, `resumed_at`, `lost_at`, `lost_reason` restent. Le workflow va les renseigner enfin.

## 8. Risques identifiés

1. **Cron pollution** — tant que le pré-filtre cron ne tient pas compte du status, on spamme les clients en pause. À fixer en Phase 3 même si on ne déploie pas encore le workflow.
2. **Données legacy incohérentes** — les projets importés en `pause`/`perdu` n'ont pas de timestamps ni de raison. Backfill obligatoire pour ne pas casser les dashboards analytics.
3. **Pas de garde-fou côté RLS** — chef_projet peut bypasser le workflow via UPDATE direct. Recommandation : durcir RLS en Phase 3 (UPDATE de `status` réservé à CEO uniquement, sinon passer par RPC).
4. **Index `projects_property_active_uniq` peut piéger lors d'un rollback** — si on passe `perdu → actif` alors que le bien a été repris entre temps par un autre projet, l'INSERT/UPDATE va échouer. À gérer dans `resurrect_from_lost` RPC.

## 9. Recommandation pour Phase 2 (design)

1. Garder le champ `status` existant comme source de vérité (ne pas créer `lifecycle_state` redondant).
2. Créer table `project_lifecycle_transition` (workflow pending → approved/rejected).
3. Créer 4 RPC :
   - `request_lifecycle_transition` (chef_projet, commercial)
   - `validate_lifecycle_transition` (CEO)
   - `mark_lifecycle_direct` (CEO uniquement, bypass workflow)
   - `resume_lifecycle` (depuis pause vers actif, CEO 1-clic)
4. Étendre `can_notify_for_project` pour inclure `status = 'actif'`.
5. Durcir RLS : UPDATE de `status` réservé aux CEO via policy, mutations chef_projet uniquement via RPC.
6. Étendre enum `payments.status` avec `on_hold` (pause).
7. Backfill rétroactif des projets `pause`/`perdu` importés via une ligne d'audit "imported_from_notion".

---

**STOP GATE 1 — Validation requise avant Phase 2 (Design).**
