# Référentiel KPI — Dashboard clients / pilotage du cycle de vie

> Document contractuel à valider **ligne par ligne** avant tout code.
> Session : optimiser le dashboard `clients` existant pour piloter le cycle de vie projet et savoir **où intervenir maintenant**.
> Règle d'or respectée partout : **aucun nouveau champ ni table** ; **projets perdus exclus par défaut** (`lib/projects/lost.ts`) ; **rouge = problème réel uniquement**.
> Périmètre : `app/(team)/dashboard/clients/page.tsx`.

---

## Partie A — Audit de l'existant (ce que le dashboard montre aujourd'hui)

Le dashboard `clients` est solide sur le **volume** et l'**engagement commercial**, mais il a un trou sur le **pilotage opérationnel** : il dit *combien* de projets il y a et *combien de temps en moyenne* ont pris les transitions passées, mais jamais *quel projet est en train de coincer aujourd'hui*. Or « intervenir là où il faut » = répondre à cette dernière question.

| Section actuelle | KPI présents | Verdict |
|---|---|---|
| Volume & activation | Total clients · Nouveaux ce mois (+tendance) · Taux d'invitation · Sans projet | ✅ À garder tel quel |
| Projets par phase | Compteur par phase + barres horizontales | ⚠️ Biais : ne compte que `status = 'actif'` (voir angle mort 1) |
| Délais moyens projet | Onboarding→Compromis · Compromis→Acte · Durée chantier | ⚠️ Rétroviseur seulement, et 3 transitions sur 6 (voir angle mort 2) |
| Activité propositions | Envoyées ce mois · Taux d'acceptation · Délai de réponse | ✅ À garder tel quel |
| Alertes | Propositions en attente >7j · Clients sans projet · Paiements en retard | ✅ Bon réflexe « intervention » — à étendre au cycle de vie |

### Les 3 angles morts (factuels)

**Angle mort 1 — Les projets en pause sont invisibles.**
Ligne 56 : `projects.filter(p => p.status === 'actif')`. La répartition par phase et tous les drill-down ne comptent **que** les projets actifs. Conséquence concrète : un projet mis en pause en phase Travaux **disparaît** du dashboard. C'est exactement l'inverse de ce qu'on veut — un projet en pause est un projet *à surveiller*, pas un projet à cacher. De plus la carte « Terminés » (ligne 256) compte les projets `status = 'actif'` ET `current_phase = 'termine'`, une combinaison contradictoire : les vrais projets clôturés (`status = 'termine'`) ne sont comptés **nulle part** dans cette section.

**Angle mort 2 — Aucun indicateur « temps passé dans la phase actuelle ».**
Les 3 délais affichés se calculent uniquement sur les projets qui ont **déjà** franchi l'étape (les deux dates sont remplies). Un projet bloqué depuis 80 jours en Design, qui n'a pas encore de date de sortie, n'apparaît dans **aucun** délai. Le dashboard ne sait pas voir un projet qui stagne *en ce moment*. C'est le manque le plus coûteux pour le pilotage.

**Angle mort 3 — La donnée la plus riche n'est pas exploitée.**
La table `project_phases_history` (créée à la naissance de chaque projet par le trigger `init_new_project`, alimentée à chaque changement de phase par `advance_phase`) contient, pour chaque projet, une ligne par phase avec `started_at`, `completed_at` et `duration_days` (colonne générée). Le dashboard ne la lit pas du tout. Elle permet pourtant de mesurer la durée **réelle** des 7 phases et le temps passé dans la phase **en cours** — sans aucun nouveau champ.

---

## Partie B — Conventions (rappel canon, non négociable)

**Exclusion des perdus.** Tous les chiffres excluent `status = 'perdu'` et `deleted_at`, via `lib/projects/lost.ts`. Le filtre est `status != 'perdu'` — on **garde** donc `pause` et `termine` (ce qui corrige l'angle mort 1).

**Code couleur (identique au référentiel financier).**

| Couleur | Sens | Déclenchée par |
|---|---|---|
| 🟢 Vert | Tout va bien | Cycle fluide, dans les délais |
| ⚪ Neutre (gris) | Information, ni bon ni mauvais | Compteurs, volumes, durées moyennes |
| 🟠 Orange | À surveiller, pas une perte | Projet en pause, projet qui stagne au-delà du seuil |
| 🔴 Rouge | **Problème réel / retard avéré** | Date de reprise dépassée, projet bloqué très au-delà du seuil |

Un projet en pause est 🟠, **jamais** 🔴 : la pause est une décision métier assumée, pas une perte. Le rouge est réservé à un engagement non tenu (ex : date de reprise prévue déjà passée).

**Sources de données (tables existantes, aucun champ créé).**

| Source | Table.colonne | Déjà alimentée par |
|---|---|---|
| Phase courante | `projects.current_phase` (enum 7 valeurs) | `advance_phase` |
| Statut | `projects.status` ∈ (`actif`,`pause`,`termine`,`perdu`) | RPC lifecycle |
| Entrée dans la phase en cours | `project_phases_history.started_at` (ligne où `completed_at IS NULL`) | `init_new_project` + `advance_phase` |
| Durée réelle d'une phase franchie | `project_phases_history.duration_days` (générée) | trigger |
| Pause | `projects.paused_at`, `pause_reason_code_v`, `expected_resume_at` | `request_lifecycle_pause` |
| Dates jalons | `onboarding_date`, `compromis_date`, `acte_authentique_date`, `travaux_start_date`, `travaux_end_date`, `livraison_date` | saisie / gates |

> **Caveat legacy à valider.** Pour les projets importés (Notion), `project_phases_history.started_at` de la phase courante = date d'import, pas la vraie date d'entrée historique. Le « temps en phase » sera donc sous-estimé ou faussé pour ces projets. Proposition : exclure les projets `legacy_imported = true` des KPI de durée, ou les afficher avec un badge « legacy » sans alerte. _À trancher._

---

## Partie C — KPI proposés (à valider un par un)

### Bloc 1 — Où intervenir maintenant (la valeur ajoutée de la session)

#### 1. Projets en pause
- **Ce que ça dit** : ton portefeuille gelé, et pourquoi.
- **Formule** : nombre de projets `status = 'pause'`, ventilé par `pause_reason_code_v` (financement attendu / sourcing bloqué / client indisponible / litige partenaire / autre).
- **Couleur** : 🟠 si ≥ 1 · ⚪ si 0.
- **Drill-down** : client, référence, phase au moment de la pause (`phase_at_lifecycle_change`), date de pause, durée de pause (`now − paused_at`), raison.
- **Source** : `projects` (status, paused_at, pause_reason_code_v, phase_at_lifecycle_change).

#### 2. Reprise prévue dépassée
- **Ce que ça dit** : projets en pause dont la date de reprise annoncée est passée — décision CEO requise (reprendre, re-planifier ou acter la perte).
- **Formule** : projets `status = 'pause'` ET `expected_resume_at < aujourd'hui`.
- **Couleur** : 🔴 dès 1 (engagement de date non tenu = retard avéré).
- **Source** : `projects.expected_resume_at`.

#### 3. Projets bloqués (stagnation dans la phase en cours) — **le KPI central**
- **Ce que ça dit** : projets actifs qui restent dans leur phase au-delà du temps normal → *là où il faut intervenir*.
- **Formule** : projets `status = 'actif'` dont `now − project_phases_history.started_at` (ligne phase ouverte) dépasse le **seuil de la phase**.
- **Couleur** : 🟠 au-delà du seuil · 🔴 au-delà de 1,5× le seuil. (Pas une perte → jamais rouge tant qu'on est sous 1,5× le seuil.)
- **Drill-down** : trié du plus bloqué au moins bloqué, en jours, avec chef de projet assigné (`assigned_chef_projet`).
- **Seuils par phase** _(✅ validés CEO 2026-05-31)_ : Onboarding 7 j · Sourcing 30 j · Design 21 j · Travaux 90 j · Livraison 14 j · Mise en location 10 j.
- **Source** : `project_phases_history` + `projects.status`.

### Bloc 2 — Fluidité structurelle du cycle (où ça coince en général)

#### 4. Durée moyenne réelle par phase
- **Ce que ça dit** : combien de temps prend *vraiment* chaque phase, sur les 7 phases — pour identifier le goulot d'étranglement structurel.
- **Formule** : moyenne de `project_phases_history.duration_days` par `phase`, sur les phases **franchies** (`completed_at IS NOT NULL`), projets perdus exclus.
- **Couleur** : ⚪ neutre (c'est une mesure, pas une alerte). Option : 🟠 sur la phase qui dépasse son seuil cible.
- **Pourquoi ça remplace partiellement les 3 délais actuels** : les délais actuels couvrent 3 transitions sur 6 et ratent Design, Livraison et Mise en location. `duration_days` couvre les 7 phases avec une seule source homogène.
- **Source** : `project_phases_history`.

#### 5. Délais jalons clés (compléter l'existant)
- **Garder** : Onboarding→Compromis, Compromis→Acte, Durée chantier (déjà ancrés sur les bonnes dates métier, bug legacy déjà corrigé).
- **Ajouter** : Acte authentique→Lancement chantier (`acte_authentique_date`→`travaux_start_date`) et Fin chantier→Livraison (`travaux_end_date`→`livraison_date`) — deux trous actuels du parcours.
- **Couleur** : ⚪ neutre.
- **Source** : colonnes dates de `projects`.

#### 6. Vélocité de clôture (throughput)
- **Ce que ça dit** : combien de projets atteignent la fin du cycle par mois — le rythme réel de la machine.
- **Formule** : nombre de projets passés en `current_phase = 'termine'` (ou `status = 'termine'`) sur le mois en cours, + courbe 12 mois. Date de référence : `livraison_date` ou `completed_at` de la phase `mise_en_location`. _Champ de date à confirmer en B._
- **Couleur** : ⚪ neutre.
- **Source** : `projects` / `project_phases_history`.

### Bloc 3 — Vue pipeline corrigée (réparer l'existant)

#### 7. Répartition par phase, statut inclus
- **Correction** : la section « Projets par phase » compte aussi les projets `pause` (avec un badge orange visible), et la carte « Terminés » s'appuie sur `status = 'termine'` (ou `current_phase = 'termine'`) de façon cohérente — pas sur la combinaison contradictoire actuelle.
- **Couleur** : ⚪ pour les compteurs, badge 🟠 pour la part en pause.

#### 8. Portefeuille par statut
- **Ce que ça dit** : photo nette actif vs pause sur l'ensemble du portefeuille (les perdus restent hors-champ par défaut).
- **Formule** : compteur `actif` / `pause` / `termine`.
- **Couleur** : ⚪ neutre, badge 🟠 sur la part en pause.

---

## Partie D — Faisabilité data (vérifiée dans les migrations)

| # | KPI | Champ source exact | Disponible ? |
|---|---|---|---|
| 1 | Projets en pause | `projects.status`, `paused_at`, `pause_reason_code_v`, `phase_at_lifecycle_change` | ✅ |
| 2 | Reprise dépassée | `projects.expected_resume_at` | ✅ |
| 3 | Projets bloqués | `project_phases_history.started_at` (phase ouverte) + `projects.status` | ✅ (caveat legacy) |
| 4 | Durée moyenne par phase | `project_phases_history.duration_days` (générée) | ✅ (caveat legacy) |
| 5 | Délais jalons ajoutés | `acte_authentique_date`, `travaux_start_date`, `travaux_end_date`, `livraison_date` | ✅ |
| 6 | Vélocité de clôture | `livraison_date` ou `project_phases_history.completed_at` | ✅ — **champ de référence à trancher** |
| 7 | Pipeline statut inclus | `projects.current_phase`, `status` | ✅ |
| 8 | Portefeuille par statut | `projects.status` | ✅ |

Aucun KPI proposé ne nécessite un nouveau champ ni une nouvelle table. Tous réutilisent les données déjà alimentées par les triggers et RPC existants.

---

## Partie E — Seuils à trancher

| Élément | Décision | Statut |
|---|---|---|
| Seuils « projet bloqué » par phase | Onb **7** · Sourcing **30** · Design **21** · Travaux **90** · Livraison **14** · Location **10** (jours) | ✅ validé |
| Escalade rouge sur projet bloqué | 🔴 au-delà de **1,5×** le seuil | ✅ validé |
| Reprise dépassée | 🔴 dès 1 jour de dépassement · carte masquée si aucun projet concerné | ✅ validé |
| Projets legacy dans les durées | **Exclus** des KPI de durée (3, 4), sans alerte | ✅ validé |
| Date de référence « projet clôturé » | **`livraison_date`** | ✅ validé |

---

## Partie F — Décisions à valider avant la moindre ligne de code

1. **Inclure les projets en pause** dans la section pipeline (badge orange) plutôt que les masquer. _(corrige l'angle mort 1)_
2. **Ajouter le bloc « Où intervenir maintenant »** en tête de dashboard (KPI 1, 2, 3), car c'est l'objectif premier de la session.
3. **Brancher `project_phases_history`** comme source des durées (KPI 3 et 4) — table existante, jamais lue jusqu'ici.
4. **Traiter le cas legacy** selon ton choix en Partie E.
5. **Conserver intactes** les sections Volume/activation et Propositions (elles fonctionnent).

> Une fois ce référentiel validé, j'implémente sur `app/(team)/dashboard/clients/page.tsx` avec un helper de calcul pur centralisé (type `lib/projects/lifecycle-kpis.ts`, sans valeur stockée, perdus exclus via `lib/projects/lost.ts`), je réutilise les composants `KpiDrawerCard` / `HorizontalBar` existants, et je te livre les commandes git. Aucun nouveau champ, aucune migration de schéma.
