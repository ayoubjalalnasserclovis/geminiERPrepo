# PROMPT — Setup infrastructure de tests Stoniz ERP

> À utiliser UNE SEULE FOIS, en premier. Installe Vitest, Playwright, fixtures, CI.

## RÔLE

Tu cumules quatre casquettes :

1. **Ingénieur DevOps + QA senior (Next.js + Supabase + TypeScript)** — tu setup une infra de tests propre, scalable, qui survit aux mises à jour
2. **Product partner pédagogue** — chaque outil installé est justifié en 1 phrase métier
3. **Directeur des opérations** — tu penses production : la CI doit fail si un test casse, jamais merger un PR rouge
4. **UX designer senior** — les logs de tests sont lisibles, les messages d'erreur compréhensibles par le CEO

## CONTEXTE

- Repo : `/Users/othmaneelazzouzi/Documents/Claude/Projects/ERP-STONIZ/stoniz-platform`
- Stack : Next.js 14 App Router · Supabase Postgres + RLS · Server Actions · Zod · TailwindCSS
- Déploiement : Vercel (main = prod)
- Git : GitHub `stoniz-app/stoniz-platform`
- Pas de tests en place aujourd'hui

## OBJECTIFS DE LA SESSION

À la fin de cette session, on doit avoir :

1. **Vitest** installé et configuré pour les tests unitaires (`npm test`)
2. **Playwright** installé pour les tests E2E (`npm run test:e2e`)
3. **Supabase test client** configuré (instance Supabase locale ou DB de test isolée)
4. **Fixtures helpers** dans `tests/fixtures/` (création/cleanup de projets, clients, lots de test)
5. **CI GitHub Actions** qui run les tests à chaque push (`.github/workflows/test.yml`)
6. **1 test smoke** qui prouve que l'infra marche (par exemple `lib/finance/travaux-calc.test.ts` avec 1 assertion sur la marge brute)
7. **README** mis à jour avec : `npm test`, `npm run test:e2e`, comment debugger un test qui foire

## RÈGLES NON-NÉGOCIABLES

- **Tests isolés** : chaque test crée et nettoie ses fixtures (afterEach), JAMAIS de dépendance entre tests
- **Pas de mock DB** : on utilise une vraie Supabase locale (`npx supabase start`) ou une instance de test dédiée. Mocker = on teste autre chose que la vraie app
- **Test ID parlant** : `Test Karim Zaidi · Marge positive` pas `proj_001`
- **Cleanup garanti** : un `test_run_id` UUID par test permet de tout nettoyer même si le test crash
- **CI fail rouge bloque le merge** : configure GitHub branch protection pour empêcher le merge si CI rouge

## LIVRABLES ATTENDUS

1. PR avec :
   - `vitest.config.ts`, `playwright.config.ts`
   - `tests/setup.ts` (init Supabase test client, helpers communs)
   - `tests/fixtures/projects.ts`, `tests/fixtures/clients.ts` (createTestProject, cleanupTestData, etc.)
   - `.github/workflows/test.yml` (run npm test à chaque push)
   - `package.json` mis à jour avec scripts `test`, `test:e2e`, `test:watch`
   - 1 test smoke fonctionnel (`lib/finance/travaux-calc.test.ts`)
   - `README.md` mis à jour
   - `docs/tests/README.md` documentant la stratégie + comment ajouter un test

2. Validation : tu run `npm test` et `npm run test:e2e` en local, ça passe vert

3. Documentation : un schéma simple "comment ajouter un test pour un nouveau module" (10 lignes max)

## ANTI-PATTERNS À PROSCRIRE

- Tester l'implémentation (`expect(supabase.from).toHaveBeenCalled()`) — préfère tester le COMPORTEMENT (la donnée résultante en BDD)
- Tests qui dépendent de l'ordre (`test 2 utilise les données du test 1`)
- Hardcoder des UUID ou des dates dans les assertions
- Cleanup partiel (laisser des données de test en BDD = pollution + flakiness garantie)

## AVANT DE COMMENCER

Lis :
- `package.json` pour voir ce qui est déjà installé
- `next.config.js` pour les particularités de build
- Au moins 1 fichier de `lib/finance/*` pour comprendre le style de code
- La stratégie : `docs/prompts/tests/00-strategy.md`

Puis pose-moi 2-3 questions sur l'infrastructure (instance Supabase locale vs cloud de test, version Vitest, etc.) avant d'installer quoi que ce soit.
