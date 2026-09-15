# Import PROPRIA — Terminé

**Date :** 2026-05-30 (00h55)
**Source :** `Fiches biens PROPRIA-89976307` (CSV avec emails)

## Résultats finaux

| Compteur | Valeur |
|---|--:|
| Propriétaires | 12 |
| Biens PROPRIA | **15** |
| Lots (propria_units) | **41** |
| Clients créés | 1 (Paul Benneli) |
| Properties créées | 5 (AF, MAJO, WARDA, BADAOUI AF, PAUL, PATISSERIE KAWTAR) |
| Properties enrichies (UPDATE) | 10 |
| Projets PROPRIA legacy créés | 6 |

### Détail par propriétaire

| Propriétaire | Biens | Lots |
|---|---|--:|
| BOUCHENIATA Hakim | AF \| BEJ GUENI \| MAJO | 11 |
| EL BADAOUI Yassine | BADAOUI AF \| WARDA | 7 |
| JOUNDY Kamil | JOUNDY | 4 |
| EL EULJ Mamoun | MAMOUN | 3 |
| Fatima Rahmane & Patrick SOURD | PATRICK | 3 |
| Duc Nguyen | DUC | 2 |
| EVRARD Catherine | CATHERINE | 2 |
| HAMOUCHE Yamina | YAMINA | 2 |
| LE BOUHRIS Steven | STEVEN | 2 |
| Paul Benneli | PAUL | 2 |
| Redha FOUDAD | FOUDAD | 2 |
| Paul Serge Ferreira | PATISSERIE KAWTAR | 1 |
| **TOTAL** |  | **41** |

## Stratégie d'import (Option A validée)

- 1 projet "PROPRIA legacy" par bien physique (`legacy_imported=true`, `current_phase='mise_en_location'`, `status='actif'`)
- Réutilisation des projets existants quand possible (Hakim BEJ GUENI, autres clients avec 1 bien)
- Création de nouveau projet PROPRIA pour les biens supplémentaires (Hakim AF/MAJO, Yassine WARDA/BADAOUI AF)
- RIAD 1 (Hakim) intact : projet en cours non livré

## Bugs rencontrés et fix

1. `type='appartement'` → fix `'Appartement'` (CHECK case-sensitive)
2. `propria_key_box_home` → renommée en `propria_key_box_suite` (migration `20260530001000`)
3. `COALESCE(floor, 0)` → `COALESCE(floor, '0')` (floor est TEXT)

## Scripts générés (ordre d'exécution)

1. `propria-import-01-matching-report.sql` — diagnostic matching emails CSV ↔ clients base
2. `propria-import-02-pilot-hakim.sql` — pilote 3 biens + 11 lots
3. `propria-import-03-batch-11-clients.sql` — batch final 12 biens + 30 lots

## État final

- Tous les biens PROPRIA sont visibles via `/propria/biens` (lien sidebar)
- Chaque lot apparaîtra dans les vues opérationnelles (interventions, maintenance, caisse, stock, etc.)
- Les emails PROPRIA peuvent commencer à arriver via les workflows en place (kill switch global toujours actif jusqu'à validation manuelle)

## Prochaines étapes possibles

- Vérifier l'UI : ouvrir `/propria/biens` et confirmer les 15 biens + détails lots
- Tester un workflow opérationnel (créer une intervention sur un lot)
- Ajouter les artisans référents (table `propria_providers`) — hors scope de cet import
