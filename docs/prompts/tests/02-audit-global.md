# PROMPT — Audit global modules Stoniz ERP

> À utiliser après le setup infra. Livre l'inventaire priorisé des modules à tester.

## RÔLE

Tu cumules quatre casquettes :

1. **Ingénieur QA senior + architecte** — tu cartographies le code par responsabilité métier, pas par dossier
2. **Product partner pédagogue** — pour chaque module, tu nommes l'INTENTION métier et le RISQUE si bug
3. **Directeur des opérations (20 ans)** — tu pries la criticité par impact business, pas par complexité technique
4. **UX designer senior** — ton inventaire final est lisible par un CEO non-tech en 5 minutes

## CONTEXTE

- Repo : `/Users/othmaneelazzouzi/Documents/Claude/Projects/ERP-STONIZ/stoniz-platform`
- Infra tests déjà setup (Vitest + Playwright + CI). Voir `docs/prompts/tests/01-setup-infrastructure.md`.
- Stratégie : tests module par module, voir `docs/prompts/tests/00-strategy.md`
- Aujourd'hui : zéro test au-delà du smoke

## OBJECTIF UNIQUE DE LA SESSION

Livrer un **inventaire priorisé des modules à tester**, sans coder de test pendant cette session.

## MÉTHODE

1. **Scan exhaustif** :
   - Tous les `lib/**/*.ts` (utils, calculs, helpers)
   - Toutes les pages dashboard `app/(team)/dashboard/**/*.tsx`
   - Toutes les server actions `app/**/actions.ts`
   - Tous les crons `app/api/cron/**/route.ts`
   - Toutes les vues SQL dans `supabase/migrations/*.sql` (CREATE VIEW, RPC)
   - Toutes les RLS policies actives

2. **Pour chaque module** identifié, remplir le tableau ci-dessous :

| Module | Path principal | Intention métier (1 phrase) | Risque si bug | Criticité (1-5) | Volume LOC | Dépendances | Couverture testable | Effort estimé |
|---|---|---|---|---|---|---|---|---|

3. **Grouper par responsabilité métier** :
   - Finance (calculs, paiements, recouvrement, marges)
   - Lifecycle (phases, transitions, validations)
   - Imports / migrations data (CSV, scripts SQL)
   - Sécurité / RLS / audit
   - Communications (emails, crons, alertes)
   - UI / dashboards
   - Propria (conciergerie, interventions, maintenance)

4. **Détecter les angles morts** :
   - Code sans aucun usage (mort) → recommander suppression
   - Code dupliqué entre modules → recommander factorisation avant test
   - Logique métier non-documentée (pas dans `/docs/` ni `/memory/`)

5. **Carte des dépendances** :
   - Quels modules s'appuient sur quels autres ? (ex: dashboard financier dépend de `lib/finance/*`)
   - Quels tests doivent être faits AVANT d'autres ? (les fondations financières avant les dashboards)

## LIVRABLES ATTENDUS

1. **Fichier `docs/tests/audit-modules-{date}.md`** contenant :
   - Tableau exhaustif (1 ligne par module)
   - Groupement par responsabilité métier
   - Top 10 risques (modules critiques sans aucun test)
   - Plan de bataille recommandé (ordre des modules à tester sur 12 sessions)
   - Estimation totale effort (en sessions IA)

2. **Schéma de dépendances** (ASCII ou Mermaid) montrant les couches : core financier → dashboards → UI

3. **Liste des "quick wins"** : modules <100 LOC + criticité 5 + 0 dépendance = bon premier test

## RÈGLES NON-NÉGOCIABLES

- Tu ne codes RIEN pendant cette session (juste de la lecture et de la doc)
- Tu utilises le canon métier de `lib/finance/travaux-calc.ts` (commentaire en-tête) comme référence
- Tu cites les règles métier déjà documentées en mémoire : `~/memory/stoniz_*.md` (échéancier honoraires, exclusion perdus, modèle data, etc.)
- Si une règle métier n'est documentée NULLE PART (ni code ni doc), tu la flag explicitement comme "à clarifier avec CEO avant test"

## FORMAT DE LIVRABLE

Sortie en markdown, lisible par le CEO. Pour chaque module :

```
### Module : Canon financier (lib/finance/travaux-calc.ts)
- **Intention** : Calculer marge, trésorerie et anomalies du suivi travaux d'un projet
- **Risque si bug** : Facturation client faussée, anomalies cash flow invisibles
- **Criticité** : 5/5
- **Volume** : 220 LOC
- **Dépendances** : aucune (fonction pure)
- **Couverture testable** : 100% (fonction pure, 6+ scénarios à couvrir)
- **Effort** : 1 session (~2h IA)
- **Quick win** : ✅
```

## AVANT DE COMMENCER

Lis (dans cet ordre) :
1. `docs/prompts/tests/00-strategy.md` — stratégie générale
2. `lib/finance/travaux-calc.ts` et `lib/finance/achats-calc.ts` — voir un canon en code
3. `lib/projects/lost.ts` — voir un helper centralisé bien fait
4. `supabase/migrations/20260530120000_offer_workflow_and_yield_fix.sql` — voir une migration métier récente

Puis pose-moi MAX 3 questions de cadrage (exemples : "veux-tu inclure les pages client portal ?", "le module Propria est-il à tester maintenant ou plus tard ?") avant de scanner.
