# Stratégie de tests — Stoniz Platform

Ce document décrit comment les tests sont organisés, pourquoi, et comment en
ajouter un. Objectif : une suite qui **survit aux mises à jour**, qui **bloque
les merges cassés**, et que **n'importe qui dans l'équipe peut lire**.

---

## 1. Les trois étages

| Étage | Commande | Touche la DB ? | Lancé en CI | Rôle |
|---|---|---|---|---|
| **Unitaire** | `npm test` | Non (logique pure) | ✅ gate bloquant | Calculs finance, KPIs, validators… |
| **Intégration** | `npm run test:int` | Oui (Supabase local) | ✅ job dédié | Fixtures, RLS, comportement réel en base |
| **E2E** | `npm run test:e2e` | Oui (app + Supabase) | ✅ job dédié | Parcours utilisateur dans un vrai navigateur |

**Pourquoi cette séparation ?** `npm test` ne doit dépendre d'aucun service
externe : il tourne partout, en une poignée de secondes, et reste vert si le code
est correct. C'est lui le **gate bloquant**. Les tests qui ont besoin d'une vraie
base (intégration, E2E) sont plus lents et plus fragiles : on les isole pour ne
pas rendre le gate instable.

> **On ne mocke jamais la base.** Un mock teste notre idée de Supabase, pas
> Supabase. Les tests DB tournent sur une **vraie** instance locale
> (`npx supabase start`), avec le vrai RLS et les vraies migrations.

---

## 2. Convention de nommage des fichiers

- `lib/**/<module>.test.ts` → **unitaire** (à côté du code testé).
- `tests/integration/<module>.itest.ts` → **intégration** (DB réelle).
- `tests/e2e/<parcours>.spec.ts` → **E2E** (Playwright).

L'extension `.itest.ts` est ce qui exclut un test du gate `npm test`.

---

## 3. Règles non négociables

1. **Tests isolés.** Aucun test ne dépend d'un autre ni de l'ordre d'exécution.
2. **Chaque test nettoie ses fixtures** en `afterEach`, via son `test_run_id`.
3. **Cleanup crash-safe.** Le `test_run_id` est embarqué dans des champs réels
   (email `@stoniz.test`, référence projet `STZTEST-…`) : on peut tout retrouver
   et supprimer même si un test plante avant son `afterEach`.
4. **On teste le comportement, pas l'implémentation.** On vérifie la donnée
   résultante (en base ou en sortie de fonction), jamais « telle méthode a été
   appelée ».
5. **Pas d'UUID ni de dates en dur** dans les assertions : on les dérive du run.
6. **Garde anti-prod.** Le client Supabase de test refuse toute URL non locale
   (override explicite `TEST_DB_ALLOW_REMOTE=true` réservé à un projet cloud de
   test dédié).

---

## 4. Ajouter un test pour un nouveau module — en 10 lignes

```
LOGIQUE PURE (calcul, transformation) ?
  → fichier  lib/<domaine>/<module>.test.ts
  → import { describe, it, expect } from 'vitest'
  → appelle la fonction, assert la valeur de sortie.  Lancer: npm test

TOUCHE LA BASE (lecture/écriture, RLS) ?
  → fichier  tests/integration/<module>.itest.ts
  → beforeEach: run = newTestRun()
  → crée tes données via les fixtures (createTestClient/createTestProject…)
  → assert la donnée RELUE en base
  → afterEach: await cleanupTestData(run)            Lancer: npm run test:int
```

Besoin d'une nouvelle fixture ? Ajoute-la dans `tests/fixtures/`, taggue-la avec
le `run` (email/référence), et étends `cleanupTestData` si une nouvelle table est
concernée.

---

## 5. Anatomie d'un test d'intégration (patron à copier)

Voir `tests/integration/clients.itest.ts`. Le squelette :

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { newTestRun, createTestProject, cleanupTestData, type TestRun } from '../fixtures';

describe('Mon module', () => {
  let run: TestRun;
  beforeEach(() => { run = newTestRun(); });
  afterEach(async () => { await cleanupTestData(run); });

  it('fait ce qu'il faut', async () => {
    const project = await createTestProject(run);
    // …assert la donnée réelle en base…
  });
});
```

---

## 6. Débugger un test qui foire

**Unitaire (Vitest)**
- `npm run test:watch` puis tape `p` pour filtrer par nom de fichier.
- Lancer un seul fichier : `npx vitest run lib/finance/travaux-calc.test.ts`.
- Isoler un cas : `it.only('…')` (à retirer avant de commit).
- Le message d'échec montre `attendu` vs `reçu` : compare les nombres, c'est
  presque toujours une formule, pas l'infra.

**Intégration (DB)**
- Erreur `Variable d'environnement manquante` → `cp .env.test.example .env.test`
  puis renseigne les clés via `npx supabase status`.
- Erreur `Refus de cibler une base NON locale` → ton URL ne pointe pas vers
  Supabase local. C'est la garde anti-prod : corrige `SUPABASE_TEST_URL`.
- Données de test restées en base après un crash → `npm run test:int` rejoue le
  cleanup par run ; pour un grand ménage, appelle `cleanupAllTestData()`.
- Inspecte la base : Supabase Studio sur http://localhost:54323.

**E2E (Playwright)**
- `npm run test:e2e:ui` ouvre le mode interactif (time-travel, sélecteurs).
- Après un échec, le **rapport HTML** s'ouvre tout seul (capture + trace).
- Rejouer le rapport : `npx playwright show-report`.
- L'app ne démarre pas → vérifie `.env.local` (clés Supabase) et que
  `npx supabase start` tourne.

---

## 7. Intégration continue (GitHub Actions)

Workflow : `.github/workflows/test.yml`, déclenché à chaque push et chaque PR.

- **`quality`** (bloquant) : lint + `tsc --noEmit` + `npm test`. Rapide, sans
  Docker. C'est lui qui doit empêcher un merge cassé.
- **`integration-e2e`** : démarre Supabase, applique les migrations, lance
  `test:int` puis `test:e2e`. Plus lent ; informatif tant qu'il n'est pas stable.

### Brancher le « CI rouge bloque le merge » (à faire une fois, par un admin)

Sur GitHub : **Settings → Branches → Add branch protection rule**
1. Branch name pattern : `main`
2. Coche **Require a pull request before merging**
3. Coche **Require status checks to pass before merging**
4. Dans la liste, sélectionne le check **`Lint · Typecheck · Unit`**
   (job `quality`). C'est le check requis.
5. (Optionnel) Quand le job `integration-e2e` aura prouvé sa stabilité sur
   quelques semaines, ajoute-le aussi en check requis.

Résultat : impossible de merger une PR tant que le gate est rouge.

---

## 8. Runbook — faire tourner toute la suite en local

```bash
# 1. Dépendances
npm install
npx playwright install chromium   # navigateur pour l'E2E (une fois)

# 2. Base de test locale
npx supabase start                 # démarre Postgres + applique les migrations
npx supabase status                # note API URL / anon key / service_role key

# 3. Env des tests d'intégration
cp .env.test.example .env.test     # puis colle les valeurs de `supabase status`

# 4. Lancer
npm test            # unitaires (dont le smoke marge brute) — doit être vert
npm run test:int    # intégration (fixtures + DB)
npm run test:e2e    # E2E (démarre l'app automatiquement)
```
