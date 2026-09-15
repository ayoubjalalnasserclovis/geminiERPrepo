# Stratégie tests automatisés Stoniz ERP

> Décision CEO 2026-05-30 : **module par module avec audit global préalable**, pas big-bang.

## Pourquoi pas tout d'un coup

1. **Contexte AI limité par session** — tester tout l'ERP dans un seul chat = panne de contexte avant la moitié
2. **Valeur progressive** — un module testé = filet de sécurité immédiat, pas dans 3 semaines
3. **Apprentissage** — le 1er module révèle des problèmes d'approche qu'on corrige pour les suivants
4. **Priorisation par risque** — canon financier > exports CSV ; on commence par ce qui ferait peur si ça cassait demain

## Ordre de bataille

### Étape 0 — Audit global (1 session)
Inventaire tous les modules + criticité + couverture proposée. Voir `02-audit-global.md`.

### Étape 1 — Modules CRITIQUES (4 sessions)
| Ordre | Module | Pourquoi critique |
|---|---|---|
| 1 | Canon financier (`lib/finance/*`) | Bug = facturation cliente faussée |
| 2 | Règle exclusion projets perdus | Bug = stats faussées sur TOUS les dashboards |
| 3 | Imports CSV (achats, travaux) | Bug = corruption en masse |
| 4 | Honoraires Stoniz (5 milestones) | Bug = recouvrement faussé |

### Étape 2 — Modules IMPORTANTS (4 sessions)
| Ordre | Module | Pourquoi |
|---|---|---|
| 5 | Lifecycle workflow (transitions phases) | Bug = projets bloqués |
| 6 | RLS / sécurité | Bug = fuite de données entre projets |
| 7 | Crons (relances paiements, emails) | Bug = mail à mauvaise personne |
| 8 | Propria (interventions, maintenance) | Bug = chambres pas entretenues |

### Étape 3 — Modules COMPLÉMENTAIRES (3 sessions)
| Ordre | Module | Pourquoi |
|---|---|---|
| 9 | Satisfaction (surveys, NPS) | Bug = mauvais NPS affiché |
| 10 | Sourcing (proposals, propositions) | Bug = clients pas matchés |
| 11 | UI components isolés + E2E flows Playwright | Validation end-to-end |

## Comment utiliser les prompts

1. **D'abord** : `01-setup-infrastructure.md` — installer Vitest + Playwright + CI (à faire UNE fois)
2. **Ensuite** : `02-audit-global.md` — un assistant scanne le repo et livre l'inventaire priorisé
3. **Pour chaque module** : `03-template-module.md` — duplicate et remplir le nom du module

Chaque session = nouveau chat AI avec UNIQUEMENT le prompt concerné + le repo en accès.

## Définition de "fini"

Un module est "testé" quand :
- ✅ Tous les chemins critiques ont au moins 1 test
- ✅ Les règles métier du canon sont assertées
- ✅ Les cas dégradés sont couverts (valeurs nulles, négatives, doublons)
- ✅ La CI run les tests à chaque push et fail rouge si régression
- ✅ Le README du module documente comment lancer ses tests
