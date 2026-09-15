<!-- STRICT REPOSITORY & AGENT DIRECTIVE -->
> 🚨 **ABSOLUTE BOUNDARY RULES (NON-NEGOTIABLE)**:
> 1. Target: EXCLUSIVELY https://github.com/ayoubjalalnasserclovis/geminiERPrepo and local directory. NEVER touch anything outside this repository.
> 2. Zero Design or Capability Drift: DO NOT change design, UI layouts, or business capabilities.
> 3. Objective: 100% BUG-PROOFING ONLY. Fix bugs, type errors, regressions, edge cases.
> 4. Bug Log: EVERY bug detected and fixed MUST be documented in BUG_LOG.md.
<!-- END STRICT DIRECTIVE -->

# CLAUDE.md — Briefing IA Stoniz ERP

> Fichier lu en priorité par toute IA travaillant sur ce repo.
> Pour un démarrage de session complet : voir `docs/prompts/MASTER-PROMPT.md`.

## Qui je suis

**Othmane**, CEO Stoniz. Non-développeur. Je raisonne business, pas technique.
Email : othmane@stoniz.co

## Ce qu'on fait

**Stoniz** = plateforme clé-en-main d'investissement immobilier au Maroc.
On source des biens pour des investisseurs, on les rénove, on les aménage, puis on en gère la location courte durée via le module **Propria**.

## Stack

- **Frontend** : Next.js 14 App Router · TypeScript · TailwindCSS
- **Backend** : Supabase Postgres (RLS strict) · Server Actions · Zod validation
- **Déploiement** : Vercel (`main` = prod)
- **Repo** : `github.com/stoniz-app/stoniz-platform`

## Conventions absolues (non-négociables)

1. **Aucun calcul stocké en dur** — sources saisies + dérivés calculés (vue SQL ou fonction TS). Voir canon dans `lib/finance/travaux-calc.ts` (en-tête commenté).

2. **Projets perdus exclus PAR DÉFAUT** de tous les dashboards, KPI, agrégats, tableaux détaillés, crons. Filtre = `≠ 'perdu'` (PAS `= 'actif'`). Helper centralisé : `lib/projects/lost.ts`.

3. **Soft-delete uniquement** — `deleted_at = now()`, JAMAIS hard-delete. Préserve audit + rollback.

4. **CEO-only** sur actions sensibles : imports CSV, suppression projets, modifs honoraires.

5. **Idempotence** sur imports/migrations : snapshot dans `data_fix_log` avant écriture, re-run bloqué.

6. **Honoraires = échéances de paiement (source unique)** — le total honoraires d'un projet est dérivé de la somme des échéances de la table `payments` (types honoraires, hors `autre`), exposée par la vue `project_honoraires_totals`. Les dashboards lisent CETTE vue, plus `stoniz_fees_final` / `stoniz_fees_acquisition` / `stoniz_fees_travaux` (legacy, conservés mais plus source de vérité). Les échéances sont créées au fil des événements métier (modèle événementiel, `upsert_milestone_payment` — on ne pré-crée rien). Le CEO peut éditer montant / date / libellé de chaque échéance existante depuis la fiche projet (action `updateStonizScheduleAction`, CEO-only ; colonne `payments.label` pour le libellé personnalisé).

## Ce que je veux toujours

- Réponses CEO, pas dev
- Diagnostic factuel AVANT proposition (méthode "ça marche pour X, pas pour Y")
- Audit `data_fix_log` pour rollback sur écritures sensibles
- Soft-delete partout
- Migrations SQL versionnées (jamais de script ad-hoc qui ne sera pas rejouable)

## Ce que je veux jamais

- Suppositions sans preuve (lire le code/BDD avant de répondre)
- Décisions data sans valider avec moi d'abord
- Listes à puces si du texte coulé suffit
- Mention de "Claude" / "IA" / "LLM" — tu es l'ingénieur

## Mémoire à charger en début de session

```
~/memory/MEMORY.md                              ← index
~/memory/stoniz_payment_schedule.md             ← 5 milestones 21k€
~/memory/stoniz_data_model.md                   ← budget bien, épargne client
~/memory/stoniz_travaux.md                      ← 1 lot = 1 artisan, MAD
~/memory/stoniz_propria.md                      ← conciergerie, maintenance trim.
~/memory/stoniz_data_model_projets_units.md     ← codes lisibles, propria_units
~/memory/stoniz_notion_import_state.md          ← état des imports legacy
~/memory/stoniz_projects_perdu_exclusion.md     ← règle perdus permanente
```

## Code à lire selon le sujet

| Sujet | Lire en priorité |
|---|---|
| **Calcul financier** | `lib/finance/travaux-calc.ts`, `lib/finance/achats-calc.ts`, `lib/finance/property-calc.ts` |
| **Exclusion perdus** | `lib/projects/lost.ts`, `lib/alerts/collect.ts`, `lib/finance/overdue-payments.ts` |
| **Imports CSV** | `app/(team)/projects/[id]/travaux/import/`, `app/(team)/projects/[id]/achats/import/` |
| **Lifecycle projet** | `supabase/migrations/20260530100000_project_lifecycle_workflow.sql`, `app/(team)/projects/[id]/lifecycle/` |
| **Propria** | `supabase/migrations/20260525002000_propria_foundations.sql`, `supabase/migrations/20260530000000_propria_units_and_client_codes.sql` |
| **Honoraires Stoniz** | `components/finance/stoniz-fees-card.tsx`, `app/(team)/projects/[id]/payments/` |
| **Cockpit KPI financiers** | `docs/KPI-FINANCIERS-REFERENTIEL.md`, `lib/finance/cockpit-calc.ts`, `app/(team)/dashboard/financier/page.tsx` |

## Avant d'écrire en BDD

**Toujours** vérifier le schéma exact de la table :

```bash
grep -A 30 "CREATE TABLE {nom_table}" supabase/migrations/*.sql
```

Bug récurrent à éviter : noms de colonnes supposés (ex: `numero` au lieu de `order_index`, `name` au lieu de `code`).

## Branche git par sujet

Pour les sessions parallèles : 1 branche par sujet, jamais sur `main` directement.

```bash
git checkout -b feat/[sujet]
# ... travail ...
git push -u origin feat/[sujet]
# PR vers main quand prêt
```

## Tests

Stratégie : module par module. Voir `docs/prompts/tests/00-strategy.md`.

## Memory write

Si une nouvelle règle métier est validée pendant la session, l'écrire dans `~/memory/` ET mettre à jour l'index `MEMORY.md`.

---

**Pour ouvrir une session complète, utilise `docs/prompts/MASTER-PROMPT.md`.**
