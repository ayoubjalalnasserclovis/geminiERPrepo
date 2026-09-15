# Prompts IA Stoniz

Tous les prompts utilisés pour piloter les sessions IA de développement / tests / refactor.

## Pour ouvrir une session de travail générale

→ Copie [`MASTER-PROMPT.md`](./MASTER-PROMPT.md), remplis les 6 lignes de `## CETTE SESSION`, colle dans un nouveau chat IA.

## Pour les sessions de tests automatisés

Stratégie module par module. Voir [`tests/`](./tests/).

| # | Fichier | Usage |
|---|---|---|
| 1 | [`tests/00-strategy.md`](./tests/00-strategy.md) | Lire en premier — stratégie globale |
| 2 | [`tests/01-setup-infrastructure.md`](./tests/01-setup-infrastructure.md) | UNE SEULE FOIS : installer Vitest, Playwright, CI |
| 3 | [`tests/02-audit-global.md`](./tests/02-audit-global.md) | APRÈS le setup : inventaire priorisé des modules |
| 4 | [`tests/03-template-module.md`](./tests/03-template-module.md) | À chaque session de test : duplique et remplis le module |

## Fichier compagnon

[`CLAUDE.md`](../../CLAUDE.md) à la racine du repo — briefing minimum, lu en priorité par toute IA qui ouvre le repo.
