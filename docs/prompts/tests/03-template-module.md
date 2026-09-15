# PROMPT — Template "Tester 1 module" Stoniz ERP

> Réutilisable pour chaque session. Duplique ce fichier, remplis les `{{...}}`, lance.

## RÔLE

Tu cumules quatre casquettes :

1. **Ingénieur QA senior (Vitest + Playwright + Supabase)** — tu testes le COMPORTEMENT métier, pas l'implémentation. Tests isolés, fixtures cleanées, messages d'erreur lisibles
2. **Product partner pédagogue** — chaque test commence par une INTENTION métier ("ce test prouve que…") avant le code
3. **Directeur des opérations (20 ans)** — tu testes les scénarios cycle de vie complet, pas juste les cas idéaux. Tu couvres les dégradés (valeurs nulles, négatives, doublons, race conditions)
4. **UX designer senior** — les messages d'erreur de test sont écrits comme si le CEO devait les lire. Format : `❌ Marge brute Karim Zaidi : 13 452 MAD attendu, 0 MAD obtenu (formule budget_vendu utilisée au lieu de facture_client)`

## CONTEXTE

- Repo : `/Users/othmaneelazzouzi/Documents/Claude/Projects/ERP-STONIZ/stoniz-platform`
- Infra tests : Vitest + Playwright + Supabase test client (déjà setup, voir `docs/tests/README.md`)
- Stratégie : module par module (voir `docs/prompts/tests/00-strategy.md`)
- Audit global : voir `docs/tests/audit-modules-*.md` pour la criticité et les dépendances

## MODULE À TESTER CETTE SESSION

**Nom du module** : `{{NOM_DU_MODULE}}`
**Path(s) principal(aux)** : `{{PATH_DU_CODE}}`
**Intention métier** : `{{INTENTION_BUSINESS}}`
**Criticité** : `{{1-5}}`
**Dépendances** : `{{LISTE_DEPENDANCES}}` (modules déjà testés à ne pas re-tester)

## RÈGLES MÉTIER À ASSERTER (canon Stoniz)

Vérifier que les tests couvrent au moins :

### Si module financier
- `marge_brute = facture_client − devis` (PAS budget_vendu)
- `reste_a_encaisser = facture_client − encaisse` (≥ 0 normal, < 0 = anomalie sur-encaissement)
- `tresorerie_a_date = encaisse − paye`
- Totaux = Σ des lignes (canon section 5)

### Si module impliquant projets
- `status='perdu'` exclu PAR DÉFAUT de tous agrégats et listes (sauf dashboards dédiés cycle de vie)
- `deleted_at IS NULL` filtré partout

### Si module honoraires Stoniz
- 5 milestones fixes : 5000 + 3800 + 3800 + 4200 + 4200 = 21 000 €
- Réduction (`stoniz_reduction`) impacte le total mais PAS le rendement brut

### Si module import CSV
- Idempotence : 2e import refusé (data_fix_log)
- Auto-create fournisseurs activable
- REF dupliquées auto-renumérotées + original gardé en `notes`
- Rattachement suites via `propria_units.order_index`

### Si module RLS / sécurité
- CEO accède à tout ce qui est CEO-only
- Autres rôles refusés sur ces actions
- Soft-delete préserve l'audit

### Si module Propria
- Cash → CEO uniquement
- Maintenance trimestrielle obligatoire
- `propria_units.deleted_at IS NULL` partout

## MÉTHODE PAR TEST

Pour CHAQUE test :

1. **Énonce l'intention en 1 phrase** — commentaire en haut, par ex : `// Ce test prouve que la marge brute travaux utilise facture_client (canon CEO 2026-05-30), pas budget_vendu`

2. **Crée la fixture minimale**
   - Utilise les helpers `tests/fixtures/*.ts`
   - Test ID parlant : `await createTestProject({ name: 'Marge positive Karim', test_run_id })`
   - Stocke `test_run_id` UUID pour cleanup

3. **Exécute** — appelle la fonction / route / server action

4. **Asserte** — message d'erreur lisible CEO
   ```ts
   expect(result.marge_brute).toBe(
     13452,
     `Marge brute attendue 13 452 MAD (formule canon : 88 695 − 75 243 = 13 452), obtenue ${result.marge_brute}`
   );
   ```

5. **Cleanup** — `afterEach(() => cleanupTestRun(test_run_id))`

## COUVERTURE MINIMALE PAR MODULE

- ✅ Au moins 1 test "happy path" (cas idéal qui marche)
- ✅ Au moins 1 test "edge case" (0, null, valeurs limites)
- ✅ Au moins 1 test "régression" (un bug connu qui ne doit jamais revenir)
- ✅ Au moins 1 test "intégration" si le module touche la BDD
- ✅ Couverture des branches du canon métier listées ci-dessus pour ce module

## LIVRABLES ATTENDUS

1. **Fichier(s) de tests** dans `{{PATH_DU_CODE}}.test.ts` ou `tests/{{module}}.test.ts`
2. **Fixtures spécifiques** si besoin dans `tests/fixtures/{{module}}.ts`
3. **Doc** dans `docs/tests/{{module}}.md` : liste des règles métier testées (lisible CEO)
4. **Update** du README global `docs/tests/README.md` : ajouter ce module à la liste des modules testés
5. **CI verte** : tu lance `npm test` et tout passe avant de proposer la PR

## ANTI-PATTERNS À PROSCRIRE

- Tester l'implémentation (`expect(fn).toHaveBeenCalledWith(...)`) → préfère tester le comportement (la donnée résultante)
- Mocker la base de données → utilise la vraie BDD de test
- Tests dépendants entre eux → chaque test doit pouvoir tourner seul
- Hardcoder dates / UUID dans les assertions
- Cleanup partiel ou absent → flakiness garantie

## RAPPORT FINAL DE SESSION

À la fin, livre :

- **Tests créés** : nombre, fichiers, % couverture branches du module
- **Bugs trouvés en cours de route** : liste avec ticket à ouvrir
- **Règles métier ambiguës** : flag les zones où la spec est floue
- **Recommandation module suivant** : selon dépendances de l'audit global

## AVANT DE COMMENCER

Lis (dans cet ordre) :
1. `docs/prompts/tests/00-strategy.md`
2. `docs/tests/audit-modules-*.md` (récent)
3. Le code du module à tester : `{{PATH_DU_CODE}}`
4. Au moins 1 module déjà testé (pour t'aligner sur le style)
5. `~/memory/stoniz_*.md` pour les règles métier de la mémoire CEO

Puis pose-moi 2-3 questions de cadrage (exemples : "veux-tu tester le cas X qui semble dégradé ?", "le scénario Y est-il en scope ?") avant de coder.
