# Phase 2 — Design du workflow pause/perdu

**Date :** 2026-05-29
**Pré-requis :** phase1-audit.md validé, base nettoyée (64 legacy supprimés, 2 leads en pause conservés : Inés JABER + Ziad Hassan).

## Amendement à la Phase 1

L'audit Phase 1 prévoyait un backfill de toutes les transitions legacy via `project_lifecycle_transition` rétroactif. **Plus pertinent** après le cleanup : seuls Inés et Ziad sont concernés (2 lignes à seeder). Pas de tooling de backfill, juste un INSERT dans la migration Phase 3.

## 2.1 Modèle de données

### Ajouts sur `projects`

| Colonne | Type | Nullable | Sémantique |
|---|---|---|---|
| `phase_at_lifecycle_change` | `project_phase` | OUI | Snapshot de `current_phase` au moment où le projet est passé `pause`/`perdu`. Reste NULL pour `actif`. Reset à NULL au resume. |
| `last_lifecycle_transition_id` | `UUID FK` | OUI | Pointeur sur la dernière transition validée (raccourci d'affichage UI). |
| `lost_revenue_amount` | `NUMERIC(14,2)` | OUI | Montant honoraires perdus snapshoté au passage en `perdu`. NULL sinon. |
| `lessons_learned` | `TEXT` | OUI | Obligatoire pour `perdu` (min 50 chars), NULL pour pause. |
| `expected_resume_at` | `DATE` | OUI | Pour `pause` uniquement, date estimée de reprise. Indicatif, jamais automatique. |
| `pause_reason_code` | `pause_reason_code` | OUI | Enum, obligatoire à la transition. |
| `lost_reason_code` | `lost_reason_code` | OUI | Enum, obligatoire à la transition. |

`paused_at`, `resumed_at`, `lost_at`, `lost_reason` existants : conservés tels quels, désormais renseignés par le workflow.

### Nouveaux enums

```
pause_reason_code :
  financement_attendu | sourcing_bloque | client_indisponible |
  litige_partenaire   | autre

lost_reason_code :
  client_retire       | concurrent         | desaccord_contractuel |
  qualite_reprochee   | delai_excessif     | defaut_financement    |
  autre
```

### Extension `payments.status`

```
pending → paid → ...
       ↓
    on_hold (nouveau, pour pause)
```

Valeur `cancelled` existe déjà → utilisée pour les paiements `perdu`.

### Nouvelle table `project_lifecycle_transition`

```
project_lifecycle_transition
├── id                    UUID PK
├── project_id            UUID FK → projects(id) ON DELETE CASCADE
├── workflow_status       text CHECK ('pending','approved','rejected','cancelled')
├── from_status           text  -- 'actif'|'pause'|'perdu'
├── to_status             text  -- 'pause'|'perdu'|'actif'
├── from_phase_snapshot   project_phase  -- current_phase au moment T
├── requested_by          UUID FK → profiles(id)
├── requested_at          timestamptz default now()
├── validated_by          UUID FK → profiles(id)  -- NULL si auto-validé
├── validated_at          timestamptz             -- NULL tant que pending
├── reason_code           text  -- pause_reason_code OR lost_reason_code
├── memo                  text  -- libre, obligatoire si reason_code = 'autre'
├── lost_revenue_snapshot NUMERIC(14,2)  -- pour perdu
├── lessons_learned       text           -- pour perdu
├── expected_resume_at    date           -- pour pause
├── created_at            timestamptz default now()
```

Index : `(project_id, requested_at DESC)`, `(workflow_status) WHERE workflow_status = 'pending'`.

**Pourquoi un workflow_status sur la transition ?** Parce qu'une demande pause peut être REJETÉE par le CEO — la ligne reste comme trace. Une demande perdu n'a pas ce cycle (CEO direct, créée déjà `approved`).

## 2.2 Workflow de validation

```
                   ┌─────────┐
                   │  actif  │ ◄─────────┐
                   └────┬────┘           │
                        │                │ resume_lifecycle
            ┌───────────┴─────────┐      │ (CEO 1-clic)
            ▼                     ▼      │
       ┌─────────┐           ┌─────────┐ │
       │  pause  │ ────────► │  perdu  │ │
       └─────────┘           └─────────┘ │
            ▲                     │      │
            │                     │      │ resurrect_from_lost
            └─────────────────────┘      │ (CEO + friction)
                                         │
                                         │
                   ┌─────────┐           │
                   │ termine │ (terminal état)
                   └─────────┘
```

| Transition | Qui REQUEST | Qui VALIDATE | Champs obligatoires |
|---|---|---|---|
| `actif → pause` | chef_projet, commercial, CEO | CEO (auto-validé si CEO request) | `pause_reason_code`, `expected_resume_at`, `memo` |
| `actif → perdu` | CEO uniquement (pas de workflow) | — | `lost_reason_code`, `lost_revenue_amount`, `lessons_learned` (50+ chars), `memo` |
| `pause → actif` | CEO uniquement | — | aucun |
| `pause → perdu` | CEO uniquement | — | idem `actif → perdu` |
| `perdu → actif` | CEO uniquement | — | `memo` (justification de résurrection, 50+ chars), check `property_id` disponible |
| `termine → *` | INTERDIT | — | — |
| `actif → termine` | passe par `advance_project_phase`, pas ce workflow | — | — |

**Réversibilité asymétrique :** pause↔actif facile, perdu↔actif friction (memo + check). Pas de pause→perdu automatique, pas d'auto-resume.

## 2.3 Side effects automatiques

| Transition | payments | Notifications client | Sourcing (property) | Documents | Tasks |
|---|---|---|---|---|---|
| `→ pause` | `pending → on_hold` | OFF (via `can_notify_for_project`) | conservés (bien tjs lié) | conservés | bloquantes en `pending` |
| `→ perdu` | `pending → cancelled` | OFF | bien libéré (via index UNIQUE partiel — déjà encodé) | conservés (archive) | bloquantes annulées |
| `pause → actif` (resume) | `on_hold → pending` | ON | rien | rien | rien (tâches restent comme avant pause) |
| `perdu → actif` (resurrect) | `cancelled → pending` (recréés si besoin) | ON | re-réservation bien si libre, sinon ERROR | rien | tâches recréées si phase invalide |

**Choix d'implémentation :** tous les side effects côté **RPC `SECURITY DEFINER`**, pas de triggers DB. Pourquoi :
1. Idempotence et test plus simples (1 entrée, 1 sortie)
2. Auditabilité claire (qui a déclenché quoi, vu dans `project_lifecycle_transition`)
3. Le pattern existe déjà avec `advance_project_phase` — cohérence

## 2.4 RPC à créer (signatures)

```sql
-- 1. Demande de pause par chef_projet/commercial
request_lifecycle_pause(
  p_project_id UUID,
  p_reason_code pause_reason_code,
  p_expected_resume_at DATE,
  p_memo TEXT
) RETURNS jsonb -- { ok, transition_id, auto_validated bool }

-- 2. Validation par CEO d'une demande pause
validate_lifecycle_transition(
  p_transition_id UUID,
  p_decision TEXT -- 'approved' | 'rejected'
) RETURNS jsonb -- { ok, new_status }

-- 3. Mise en perdu directe (CEO seul)
mark_project_lost(
  p_project_id UUID,
  p_reason_code lost_reason_code,
  p_lost_revenue_amount NUMERIC,
  p_lessons_learned TEXT,
  p_memo TEXT
) RETURNS jsonb -- { ok, transition_id }

-- 4. Reprise depuis pause (CEO 1-clic)
resume_lifecycle(
  p_project_id UUID
) RETURNS jsonb -- { ok }

-- 5. Résurrection depuis perdu (CEO + friction)
resurrect_from_lost(
  p_project_id UUID,
  p_justification TEXT  -- min 50 chars
) RETURNS jsonb -- { ok } or ERROR si property_id pris
```

Toutes en `SECURITY DEFINER`, `search_path = public`, vérification `auth.uid()` + rôle dans le corps. Renvoient JSON pour rester compatibles avec les server actions Next.js.

## 2.5 Durcissement RLS

Nouvelle policy `projects_update_status_ceo_only` :

```
UPDATE on projects (column = status)
USING is_staff(['ceo']) AND OLD.status IS DISTINCT FROM NEW.status
```

Pour les chef_projet : ils peuvent UPDATE les autres colonnes mais PAS `status` directement (passage forcé par RPC). PostgreSQL ne supporte pas le column-level CHECK dans une policy, donc on utilise un **trigger BEFORE UPDATE** qui RAISE EXCEPTION si :
- `OLD.status IS DISTINCT FROM NEW.status`
- `current_user` n'est pas CEO
- ET la modification ne vient PAS d'une RPC SECURITY DEFINER (détecté via `current_setting('app.bypass_status_check', true) = 'on'` mis par les RPC)

## 2.6 Intégration cron / notifications

Extension de `can_notify_for_project(p_project_id)` :

```
RETURN
  is_preparation = false
  AND legacy_imported = false
  AND activated_at IS NOT NULL
  AND client_id IS NOT NULL
  AND deleted_at IS NULL
  AND status = 'actif'   -- NOUVEAU
```

Pré-filtre cron `daily-reminders` : à actualiser pour ajouter `.eq('status', 'actif')` côté query Supabase (déjà appelle indirectement `can_notify_for_project` mais le pré-filtre Node évite N appels SQL).

**Bug latent fixé** : un projet en pause ne recevra plus de relances mail.

## 2.7 Anti-patterns rejetés

| Anti-pattern | Pourquoi on le rejette |
|---|---|
| Dropdown libre `<select>` sur status | Pas de workflow, pas d'audit, pas de side effects → corruption garantie en 3 mois. |
| Hard delete des projets perdus (futurs) | On perd les analytics "manque à gagner cumulé". Le cleanup legacy a été ponctuel pour de la propreté, pas un pattern récurrent. |
| Auto-fermeture pause à `expected_resume_at` | L'humain doit confirmer. `expected_resume_at` est indicatif (planning), pas déclencheur (action). |
| Exposition de `status = 'perdu'` au portail client | Côté client : pas de mention "perdu". Le portail filtre déjà sur `client_project_ids()` — RLS empêche la fuite, on ne rajoute aucun label client. |
| Calcul manque à gagner à la volée | Si on change la grille tarifaire dans 6 mois, les anciens perdus seraient recalculés faussement. **Snapshot immuable** au moment de la transition. |
| 2 champs sources de vérité (status + lifecycle_state) | Dérive garantie. On garde `status` unique. |

## 2.8 KPI analytics à ajouter

Sur `/dashboard` CEO (nouvelle section "Cycle de vie") :

1. **Taux de pause / mois (12 mois glissants)** — `COUNT(transitions WHERE to_status='pause') / projets actifs`
2. **Taux de perdus / source** — agrégation par `lost_reason_code`
3. **Manque à gagner cumulé** — `SUM(lost_revenue_amount)` sur projets `perdu` (snapshots fiables, workflow uniquement)
4. **Top raisons de perte (camembert)** — group by `lost_reason_code`, 12 mois
5. **Durée moyenne en pause avant reprise** — `AVG(resumed_at - paused_at)` sur projets resumés
6. **Top "leçons apprises" récentes** — feed des 10 derniers `lessons_learned` (mémoire d'équipe)

Toutes les KPI excluent les projets `legacy_imported = true` (cohérence avec décisions Phase 1).

## Arbitrages validés (STOP GATE 2 — 2026-05-29)

1. **Notification CEO sur demande pause** : email automatique au CEO quand un chef_projet `request_lifecycle_pause`. À implémenter en Phase 4 (server action enrobant la RPC + template email). Wrappé par `EMAIL_KILL_SWITCH`.
2. **Digest hebdo "pause > 30 jours"** : confirmé pour Phase 4. Cron supplémentaire `weekly-stale-pauses` qui agrège et envoie au CEO.
3. **Timeline visuelle des transitions sur fiche projet** : **must-have Phase 4**. Composant React qui lit `project_lifecycle_transition` filtré par `project_id`, affichage chronologique avec acteur/raison/mémo/manque à gagner si perdu.

Validation globale Othmane : **toutes les 8 sections OK**, on passe Phase 3.

---

**STOP GATE 2 — VALIDÉ. Phase 3 (migration SQL) débloquée.**
