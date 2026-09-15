# Hiérarchie d'affichage Propria — Analyse et plan

**Date :** 2026-05-30 (02h05)

## TL;DR

La **structure en base est saine et complète**. Tous les liens sont en place :

```
Client → Project → Property → Propria_units (lots)
```

Le problème est uniquement **côté UI** : certaines pages affichent peu ou pas les niveaux inférieurs.

## Diagnostic UI (lecture des pages actuelles)

### Fiche bien `/propria/biens/[id]`

| Élément | Affiché ? |
|---|---|
| Infos bien (nom, adresse, mandat, RIB, contrats utility) | ✅ Oui |
| Bouton supprimer (CEO) | ✅ Oui (Phase précédente) |
| Lien retour projet Stoniz si rattaché | ✅ Oui |
| **Liste des lots du bien avec leurs détails** | ❌ **NON** |
| Compteur de lots | ⚠ Juste un nombre, pas les détails |

→ **Bug UI #1** : tu vois "11 lots" pour BEJ GUENI mais pas leurs prix Airbnb, WiFi, codes serrure, photos Drive.

### Fiche projet `/projects/[id]`

| Élément | Affiché ? |
|---|---|
| Infos projet (phase, status, client) | ✅ Oui |
| Bien lié (nom, quartier, prix) | ✅ Oui |
| Badge "Géré par Propria" si actif | ✅ Oui |
| **Section Propria dédiée (lots, mandat, etc.)** | ❌ **NON** |
| Lien direct vers fiche bien Propria | ⚠ Juste un badge cliquable, pas un encart |

→ **Bug UI #2** : sur la fiche projet d'Hakim BEJ GUENI, tu vois "Géré par Propria" mais pas la liste des lots ni leurs métriques.

## Schéma cible

```
┌─ Page Fiche CLIENT (/clients/[id])
│  └─ Liste de ses projets
│
└─ Page Fiche PROJET (/projects/[id])
   ├─ Infos projet (déjà OK)
   ├─ Encart bien lié (déjà OK)
   └─ [NOUVEAU] Encart Propria :
      ├─ Mandat (date début, commission)
      ├─ Liste des lots actifs avec mini-cartes (wifi, prix, Airbnb)
      └─ Lien "Voir la fiche bien complète"

   └─ Page Fiche BIEN (/propria/biens/[id])
      ├─ Infos bien (déjà OK)
      ├─ Lien projet Stoniz (déjà OK)
      └─ [NOUVEAU] Section "Lots gérés (N)" :
         └─ Pour chaque lot :
            ├─ Code (ex "BEJ GUENI 1")
            ├─ Capacité voyageurs, nb chambres
            ├─ Prix nuit, lien Airbnb
            ├─ WiFi SSID
            └─ Lien photos Drive
```

## 3 options de mise en œuvre

### Option A — Liste des lots sur fiche BIEN seulement (1h dev)

On ajoute UN composant `PropriaUnitsList` qui apparaît sur `/propria/biens/[id]`, en bas de la fiche, avant le bouton supprimer.

Cas d'usage : un agent qui ouvre la fiche d'un bien pour préparer une intervention → voit les lots et leurs codes serrure.

### Option B — Encart Propria sur fiche PROJET seulement (1h dev)

On ajoute UN encart `PropriaSummaryCard` qui apparaît sur `/projects/[id]` quand `propria_managed_at IS NOT NULL`, montrant mandat + 3 lots max + lien vers fiche bien.

Cas d'usage : un CEO qui ouvre un projet pour voir l'état complet du client → voit que le bien est en Propria et combien de lots produisent.

### Option C — Les deux (2h dev) — **RECOMMANDÉ**

Le plus complet. La même donnée (lots) est consultable depuis 2 entrées : projet ET bien. Cohérent avec ce que tu as décrit :

> "les infos des lots doivent aller sur le projet puis le bien"

C'est exactement option C : un lot a son détail sur la fiche BIEN, et un résumé sur la fiche PROJET.

## Recommandation : Option C

Ratio temps/valeur le meilleur. Pas de duplication de logique : on extrait un composant `PropriaUnitsList` qui est utilisé sur les 2 pages avec une prop `compact={true/false}` pour la version courte (fiche projet) ou longue (fiche bien).

## ⛔ STOP — Validation

Tu valides l'analyse + le choix d'option ?
