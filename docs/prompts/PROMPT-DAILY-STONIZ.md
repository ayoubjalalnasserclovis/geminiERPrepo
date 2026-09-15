# PROMPT SESSION — Daily Stoniz

> **Usage :** colle d'abord `MASTER-PROMPT.md` en entier, puis ce fichier.
> Le bloc `CETTE SESSION` ci-dessous remplace celui du master prompt.

═══════════════════════════════════════════════════════
## CETTE SESSION
═══════════════════════════════════════════════════════

SUJET : Dashboard Daily Stoniz (point quotidien équipes)
BRANCHE GIT : feat/daily-stoniz
OBJECTIF DE LA SESSION : une page `/daily` (espace équipe) sur le modèle du Daily Propria — écran unique pour animer le point quotidien, zéro oubli des sujets critiques, suivi d'avancée visible en 30 secondes.
FICHIERS / MODULES CONCERNÉS : `app/(team)/daily/` (nouveau) · s'inspirer de `app/(team)/propria/daily/page.tsx` et `components/propria/daily-notes-card.tsx` · tables `tasks`, `projects`, `payments`, `travaux_payments`, `property_proposals`, `project_phases_history`, `email_logs`
SCOPE INTERDIT : ne pas toucher au Daily Propria existant, ni aux calculs financiers (`lib/finance/travaux-calc.ts`), ni aux migrations existantes.
SUJETS EN PARALLÈLE (autres sessions actives) : [à remplir]

═══════════════════════════════════════════════════════
## SPEC MÉTIER — Daily Stoniz
═══════════════════════════════════════════════════════

### Objectif
Le Daily Propria couvre l'exploitation locative. Le Daily Stoniz couvre le
métier clé-en-main : sourcing → compromis → design → travaux → livraison.
Un seul écran, lu du plus urgent au moins urgent, qui structure la discussion
quotidienne. Chaque zone = card cliquable : compteur + 3 items preview +
lien « Voir tout » vers le module concerné. Exclusion projets perdus partout
(helper `lib/projects/lost.ts`).

### Les 8 zones (ordre = ordre de lecture du daily)

**1. 🔴 Blocages & décisions en attente**
Ce qui empêche d'avancer : validations en attente (module `validations`),
demandes de paiement non traitées (`mes-demandes-paiement`), tâches marquées
bloquées. C'est la zone qu'on traite EN PREMIER au daily.
→ Compteur par type + ancienneté du blocage (rouge si > 3 jours).

**2. ⏰ Tâches en retard & du jour**
Depuis `tasks` : en retard (due_date < aujourd'hui, non terminées) groupées
par responsable, puis tâches du jour. Le daily sert à réassigner ou
re-prioriser à voix haute.
→ Compteur retard en rouge, groupé par chef de projet.

**3. 📅 Jalons des 7 prochains jours**
Ce qui arrive et ne doit pas être raté : signatures compromis, présentations
3D, lancements chantier, livraisons, visites planifiées. Source : phases
projets + tâches jalon + milestones honoraires.
→ Liste chronologique J → J+7, projet + jalon + responsable.

**4. 🏗️ Chantiers en cours**
Projets en phase travaux : lots sans avancement récent (> 7 jours sans
mise à jour), acomptes artisans à verser cette semaine (`travaux_payments`),
alertes dépassement devis.
→ Un item par projet en travaux avec son point d'attention principal.

**5. 💶 Encaissements & paiements**
Reste à encaisser échu (milestone atteint, facture émise, non encaissée),
relances client à faire, paiements artisans dus. Dérivés canon uniquement
(`reste_a_encaisser`, `reste_a_payer`) — rien de stocké en dur.
→ Deux compteurs : « à encaisser en retard » (€) / « à payer cette semaine » (€ + MAD).

**6. 🔍 Sourcing**
Deux volets dans la même card :
- **Momentum de la semaine** (semaine = lundi 00:00 → dimanche 23:59) :
  nombre de **nouveaux biens sourcés** cette semaine (`properties.created_at`)
  et nombre de **nouveaux partenaires immobiliers** cette semaine
  (`partners.created_at`, type immobilier). Comparaison vs semaine
  précédente (↗ / ↘).
- **En souffrance** : propositions envoyées sans retour client > 5 jours
  (`property_proposals`), projets en sourcing sans bien proposé depuis
  > 14 jours, visites à organiser.
C'est le pipeline : s'il dort, le CA de dans 6 mois dort.
→ 2 compteurs semaine + compteur souffrance avec ancienneté, groupé par
responsable sourcing.

**7. 📞 Clients sans nouvelles**
Projets actifs sans interaction (email, note, tâche complétée) depuis > 10
jours. Un client sans nouvelles = un client qui s'inquiète.
→ Liste projet + client + jours de silence + dernier contact.

**8. 📋 Complétude dossiers — top 3 manques critiques**
Extrait du calcul `/admin/completude-projets` : les manques les plus
pénalisants du moment (ex. CDC client non validé). Pas tout l'audit — juste
de quoi rappeler au daily qui doit compléter quoi.
→ 3 items max, avec responsable.

### Zone transverse : Notes du daily
Même mécanique que `DailyNotesCard` Propria : notes datées du jour +
**rappel des notes/actions de la veille non pointées** (c'est ça qui évite
que les décisions du daily s'évaporent).

### Permissions
`requireRole(['ceo', 'developer', 'chef_projet', ...])` — à confirmer en
question de cadrage.

═══════════════════════════════════════════════════════
## QUESTIONS DE CADRAGE (à me poser AVANT de coder — max 3)
═══════════════════════════════════════════════════════

1. **Qui voit le Daily Stoniz ?** Toute l'équipe (y compris sourcing,
   commercial, assistante) ou restreint comme le Daily Propria ?
   Et : chacun voit-il tout, ou filtré sur ses projets ?
2. **Seuils d'alerte** — valider ou ajuster : blocage rouge > 3 j ·
   lot sans avancement > 7 j · proposition sans retour > 5 j ·
   sourcing sans bien > 14 j · client sans nouvelles > 10 j.
3. **Zone 7 (clients sans nouvelles)** : quelle source fait foi pour
   « dernier contact » — `email_logs` seul, ou email + note + tâche
   complétée ? (Impacte la fiabilité de l'indicateur.)

═══════════════════════════════════════════════════════
## PLAN D'EXÉCUTION ATTENDU
═══════════════════════════════════════════════════════

1. Cadrage : poser les 3 questions, récap des décisions validées.
2. Lire les migrations des tables utilisées (colonnes EXACTES).
3. Page `/daily` : pulls parallèles (Promise.all comme Daily Propria),
   zones 1-2-3 d'abord (cœur du daily), démo.
4. Zones 4-5-6-7-8 + notes du daily.
5. Audit final : exclusion perdus vérifiée sur chaque requête, RLS,
   perfs (une seule vague de requêtes), lien dans la nav équipe.
6. Récap fichiers modifiés + commande push.
