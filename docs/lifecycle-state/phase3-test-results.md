# Phase 3 — Rapport de revue statique de la migration

**Date :** 2026-05-29 (Option C — revue statique sans exécution)
**Fichier audité :** `supabase/migrations/20260530100000_project_lifecycle_workflow.sql`
**Méthodologie :** lecture critique ligne par ligne avec vérification croisée des autres migrations (helpers `is_staff`, RLS profiles, trigger sync_payment_status, etc.). Pas d'exécution — sandbox bash indisponible.

## Verdict global

⚠ **Migration globalement saine, 2 bugs à fixer + 5 améliorations à arbitrer avant prod.**

Pas de bug bloquant : la migration s'applique en théorie sans erreur. Mais 2 cas opérationnels créent de mauvaises données silencieusement → à corriger avant déploiement.

## 🔴 Bugs à corriger avant prod

### Bug 1 — `resurrect_from_lost` ne nettoie pas `lost_revenue_amount` ni `lessons_learned`

**Symptôme :** un projet ressuscité (perdu → actif) garde sur sa fiche projets le montant honoraires perdus et les leçons apprises du précédent passage en perdu. Les KPI "manque à gagner cumulé" continuent à compter ce projet comme perdu.

**Cause :** la fonction n'efface que `lost_at`, `lost_reason`, `lost_reason_code_v`, `phase_at_lifecycle_change`. Elle oublie `lost_revenue_amount` et `lessons_learned`.

**Fix :** ajouter aux SET du UPDATE projects dans `resurrect_from_lost` :
```
lost_revenue_amount = NULL,
lessons_learned = NULL,
```

### Bug 2 — Nom de la contrainte `payments_status_check` pas garanti

**Symptôme :** la migration `DROP CONSTRAINT IF EXISTS payments_status_check` suppose un nom auto-généré par PostgreSQL. Selon la version PG et l'historique des migrations, le nom réel peut être différent (par exemple `payments_check` ou `payments_status_check1`). Si le nom ne match pas, le DROP est ignoré silencieusement et le nouveau ADD CONSTRAINT échoue parce que l'ancien CHECK existe encore.

**Cause :** PG ne garantit pas le nom des contraintes inline. La déclaration originale (`status TEXT NOT NULL DEFAULT 'pending' CHECK (...)`) génère un nom dépendant du contexte.

**Fix :** approche plus robuste qui boucle sur toutes les contraintes CHECK qui mentionnent `status`, ou requête `pg_constraint` pour trouver le nom réel avant DROP. Variant simple :

```sql
DO $$
DECLARE c text;
BEGIN
  SELECT conname INTO c FROM pg_constraint
  WHERE conrelid = 'payments'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%pending%';
  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE payments DROP CONSTRAINT %I', c);
  END IF;
END $$;
```

## 🟡 Améliorations à arbitrer (pas bloquant)

### A1. Le trigger de protection peut bloquer le service_role / SQL editor

**Risque :** quand le trigger `projects_protect_status` est appelé depuis un contexte sans `auth.uid()` (par exemple le SQL editor Supabase en service_role, ou un script Node admin), `v_caller_role` est NULL → l'EXCEPTION fire. Ça force tout utilisateur admin à `SET app.bypass_status_check = 'on'` avant de toucher au status.

**Recommandation :** soit (a) accepter ce comportement et le documenter, soit (b) ajouter une exception pour le rôle `service_role` PostgreSQL via `current_user = 'service_role'`. Ma reco : **(a) accepter** — c'est cohérent avec le principe "passage par RPC obligatoire" et évite des bypass silencieux.

### A2. `request_lifecycle_pause` n'empêche pas plusieurs demandes pending simultanées

**Risque :** un chef_projet peut appeler la RPC 3 fois → 3 lignes pending dans la file CEO. Pas catastrophique mais bordélique. Le CEO doit toutes les rejeter / valider.

**Recommandation :** ajouter un check `IF EXISTS (SELECT 1 FROM project_lifecycle_transition WHERE project_id = p_project_id AND workflow_status = 'pending') THEN RAISE EXCEPTION 'Une demande de transition est déjà en attente';`.

### A3. `mark_project_lost` n'a pas de check `lost_revenue_amount >= 0`

**Risque :** un montant négatif passé en argument est accepté. Casse les KPI cumulatifs.

**Recommandation :** `IF p_lost_revenue_amount IS NULL OR p_lost_revenue_amount < 0 THEN RAISE EXCEPTION ...`

### A4. Naming `pause_reason_code_v` et `lost_reason_code_v`

**Risque :** le suffixe `_v` (pour "valeur") est moche. Les types enum `pause_reason_code` / `lost_reason_code` créés en début de migration auraient pu coexister avec des colonnes du même nom dans PostgreSQL (les namespaces sont distincts), mais j'ai préféré la prudence.

**Recommandation :** renommer en `pause_reason` et `lost_reason_enum` (ou laisser tel quel et documenter). À ce stade, renommer demande une nouvelle migration — pas urgent.

### A5. `paused_at` jamais effacé au resume

**Risque :** un projet qui passe pause → actif → pause à nouveau aura `paused_at` mis à jour à chaque pause (ok), mais entre temps `paused_at` non-NULL alors que le projet est en actif. Pas trompeur si on regarde `status` en même temps, mais peut induire en erreur des queries naïves.

**Recommandation :** **laisser tel quel**. Le champ `paused_at` représente "dernière fois où le projet est passé en pause". `resumed_at` raconte la fin. Les analytics croisent les deux.

## ✅ Points vérifiés OK

- Idempotence : `IF NOT EXISTS` / `DO BEGIN EXCEPTION duplicate_object` partout
- Helper `is_staff(ARRAY['ceo'])` : matche la signature existante (vérifié dans `20260521000100_profiles.sql:75`)
- RLS profiles `profiles_self_or_staff_read` autorise un user à lire son propre rôle → le trigger fonctionne pour les users authentifiés
- Le seed step UPDATE projects ne modifie pas `status` → le trigger ne fire pas → pas de blocage durant l'install
- Trigger `sync_payment_status` patché correctement (early return si status IN `on_hold`, `cancelled`)
- Index UNIQUE partiel `projects_property_active_uniq` reste compatible avec `perdu` (libère le bien)
- `set_config('app.bypass_status_check', 'on', true)` avec `is_local=true` : scope transaction, reset auto à la fin → pas de pollution inter-RPC
- GRANT EXECUTE signatures exactes
- FK `projects_last_lifecycle_transition_fkey` ajoutée APRÈS création de la table audit → ordre correct
- Permissions audit : staff_read + ceo_write (lecture par tout staff pour la timeline UI)
- `can_notify_for_project` étendu avec `status = 'actif'` → bug cron fixé

## Décision finale et déploiement

**2026-05-29 23h33 — Migration v2 déployée sur stoniz-prod** ✅

Décision Othmane : déploiement direct en prod sans passage par staging, après application des 4 fixes (Bug 1, Bug 2, A2, A3).

Vérification post-migration (SQL editor prod) :
- nb_enums = 2 ✓
- nb_cols = 7 ✓
- nb_rpc = 5 ✓
- nb_trigger = 1 ✓
- nb_seed = 2 (Inés + Ziad) ✓

**Effets immédiats en prod :**
- Cron daily-reminders n'envoie plus d'emails aux projets pause/perdu (bug latent fixé)
- Trigger de protection actif : toute mod directe de `projects.status` par un non-CEO est bloquée
- Backend complet pour Phase 4 (UI + server actions à venir)

A1, A4, A5 restent ouverts comme dette technique non bloquante.
