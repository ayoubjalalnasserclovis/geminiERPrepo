# Prompts tests automatisés Stoniz ERP

Décision CEO 2026-05-30 : on teste l'ERP **module par module**, dans cet ordre :

## Ordre d'exécution

| # | Fichier | À utiliser pour |
|---|---|---|
| 1 | [`00-strategy.md`](./00-strategy.md) | Comprendre la stratégie globale (lecture, pas un prompt à coller) |
| 2 | [`01-setup-infrastructure.md`](./01-setup-infrastructure.md) | **UNE SEULE FOIS** : installer Vitest, Playwright, CI, fixtures |
| 3 | [`02-audit-global.md`](./02-audit-global.md) | **APRÈS le setup** : un assistant scanne et livre l'inventaire priorisé des modules |
| 4 | [`03-template-module.md`](./03-template-module.md) | **À chaque session de test** : duplicate, remplis les `{{...}}`, lance |

## Comment lancer une session de test

1. Ouvre un nouveau chat IA (Claude Desktop, Cursor, ce que tu veux)
2. Donne-lui accès au repo
3. Colle le prompt du fichier concerné
4. L'assistant pose ses questions, code, livre

**Important** : un seul prompt par session = un assistant focus, qui livre vraiment.

## Suivi

Au fur et à mesure que des modules sont testés, ils apparaissent dans `docs/tests/` avec leur liste de règles couvertes.
