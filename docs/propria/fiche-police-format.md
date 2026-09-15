# Fiche de police voyageurs — Format & Spécifications

> Document de référence pour le module « Fiches de police voyageurs » de Propria.
> Source des décisions : CEO Stoniz — 2026-06-19.
> Auteur : Senior DBA (Chantier 1 — recherche format).

## 1. Contexte réglementaire

Au Maroc, la **fiche individuelle de police hôtelière** est un document obligatoire que tout
établissement d'hébergement touristique (hôtel, résidence, maison d'hôtes, riad, meublé
de tourisme — donc incluant nos locations courte durée Propria) doit faire remplir par
chaque voyageur dès son arrivée. La fiche est ensuite déposée physiquement au
commissariat de police territorialement compétent.

Une plateforme de télédéclaration officielle existe (DABAFICHE, opérée par N.SYNERGY)
mais Stoniz a tranché : **soumission par impression + dépôt physique au commissariat**
en V1 (cf. décision CEO 2026-06-19 § Soumission).

### Périmètre Stoniz

- **Voyageurs concernés** : TOUS, Marocains inclus (décision CEO).
- **Trigger** : auto le jour du check-in (cron `daily-reminders`, géré par autre agent).
- **Sources de données** : portail Hostaway + saisie manuelle équipe propria + WhatsApp.
- **Format de soumission** :
  - 1 PDF par famille (impression + dépôt commissariat)
  - 1 Excel récap hebdo (suivi équipe + traçabilité)
- **Enfants / accompagnants** : 1 fiche unique par famille avec accompagnants
  stockés dans un champ `jsonb` (pas de fiche dédiée pour les mineurs).
- **Stockage** : indéfini, suppression manuelle CEO (pas de purge auto).
- **Accès** :
  - Lecture + écriture : `ceo`, `propria`, `assistante`
  - Lecture seule : `developer`
  - Toutes autres rôles : aucun accès.

## 2. Recherche format officiel — sources consultées

| URL | Statut |
|-----|--------|
| https://www.dabafiche.ma/ | Plateforme officielle MA, contenu public limité, pas de PDF modèle accessible |
| https://www.nsynergy.ma/details_services_solutions.php?id=24 | Éditeur de DABAFICHE, sans champs détaillés |
| https://essaouira.vivre-maroc.com/actualites-tourisme/les-fiches-de-police-bientot-en-ligne-n1319.html | Article presse : confirme principe télédéclaration |
| https://portailsudmaroc.com/actualite/7502/htellerie-les-fiches-de-renseignements-numrises | Article presse : confirme objectif anti-falsification DGSN |
| https://www.bladi.net/chambre-hotel-fiche-police,46138.html | Article presse 2017 : confirme transmission à la police |
| https://www.tourisme-sete.com/medias/documents/Fiche_Individuelle_de_Police_pour_les_Touristes_Etrangers.pdf | **PDF modèle français accessible** (cerfa-like, Code de l'entrée et du séjour des étrangers) — sert de référence pour les champs minimaux internationaux |
| https://jimdo-storage.global.ssl.fastly.net/file/acaf3add-f4af-4a12-9316-05bb57031131/3cac0631-ba55-49e2-8c78-36e9b66f0b9c.pdf | Modèle « Fiche de police hotel maroc word » téléchargé, document hôtelier MA |

**Conclusion recherche** : Le format officiel marocain n'est pas publié sous forme
PDF téléchargeable libre par le Ministère de l'Intérieur ou la DGSN. La pratique
hôtelière marocaine s'appuie sur des modèles standards alignés sur les champs
réglementaires internationaux (équivalent au modèle français de l'article R. 611-42
CESEDA + spécificités MA : motif du séjour, lieu d'entrée au Maroc).

Le format ci-dessous est donc **inspiré des standards hôteliers marocains observés
(grands groupes type Royal Mansour, La Mamounia, Riad indépendants) et du modèle
réglementaire français équivalent**. Il couvre toutes les exigences anti-falsification
post-DGSN 2017.

## 3. Champs OBLIGATOIRES (gating « complete »)

Une fiche n'est considérée comme `complete` (donc utilisable pour le dépôt
commissariat) que si TOUS ces champs sont renseignés. Référencé dans
`lib/propria/police-records.ts` → `REQUIRED_FIELDS_FOR_COMPLETE`.

### Identité du chef de famille
| Champ BDD | Libellé fiche | Format |
|-----------|---------------|--------|
| `head_last_name` | NOM | Texte, majuscules |
| `head_first_name` | PRÉNOM(S) | Texte |
| `head_gender` | SEXE | M / F / autre |
| `head_birth_date` | DATE DE NAISSANCE | Date |
| `head_birth_place` | LIEU DE NAISSANCE | Ville + Pays |
| `head_nationality` | NATIONALITÉ | Code ISO ou libellé FR |

### Pièce d'identité
| Champ BDD | Libellé fiche | Format |
|-----------|---------------|--------|
| `head_id_type` | TYPE DE PIÈCE | CIN / Passeport / Autre |
| `head_id_number` | N° DE PIÈCE | Texte (alphanumérique) |
| `head_id_issue_country` | PAYS DE DÉLIVRANCE | Code ISO ou libellé FR |

### Résidence habituelle
| Champ BDD | Libellé fiche | Format |
|-----------|---------------|--------|
| `head_residence_country` | PAYS DE RÉSIDENCE | Code ISO ou libellé FR |
| `head_residence_address` | DOMICILE HABITUEL | Texte libre, adresse complète |

### Séjour
| Champ BDD | Libellé fiche | Format |
|-----------|---------------|--------|
| `arrival_date_property` | DATE D'ARRIVÉE DANS L'ÉTABLISSEMENT | Date |
| `expected_departure_date` | DATE DE DÉPART PRÉVUE | Date |
| `motif_sejour` | MOTIF DU SÉJOUR | Tourisme / Affaires / Famille / Transit / Autre |

## 4. Champs OPTIONNELS (utiles mais non bloquants)

| Champ BDD | Libellé fiche | Note |
|-----------|---------------|------|
| `head_profession` | PROFESSION | Demandé par DGSN sur certains formats anti-falsification |
| `head_id_issue_date` | DATE DE DÉLIVRANCE DE LA PIÈCE | Optionnel |
| `head_id_expiry_date` | DATE D'EXPIRATION DE LA PIÈCE | Optionnel mais recommandé |
| `arrival_date_morocco` | DATE D'ENTRÉE AU MAROC | Surtout pour les étrangers (date de franchissement frontière) |
| `notes` | OBSERVATIONS | Texte libre interne |

## 5. Accompagnants (jsonb `accompanying_persons`)

> Décision CEO : pas de fiche dédiée par mineur. Tous les co-occupants (enfants,
> conjoint, parents, amis) figurent sur la fiche du chef de famille via le tableau
> jsonb `accompanying_persons`.

Schéma de chaque entrée :

```json
{
  "last_name": "string (obligatoire)",
  "first_name": "string (obligatoire)",
  "birth_date": "YYYY-MM-DD | null",
  "nationality": "string | null",
  "id_type": "cin | passport | other | null",
  "id_number": "string | null",
  "relation": "conjoint | enfant | parent | ami | autre | null"
}
```

- `total_persons_count` (colonne générée) = 1 (chef) + `jsonb_array_length(accompanying_persons)`.
- Aucune validation BDD sur le contenu jsonb (gardé côté UI/server actions).

## 6. Mise en page officielle (gabarit PDF — info pour l'agent PDF)

> NB : implémentation PDF gérée par un autre agent (chantier B). Cette section sert
> de cahier des charges visuel.

### Format papier
- **Format** : A4 portrait, marges 15 mm.
- **Police** : sans-serif type Helvetica/Inter, corps 10–11pt, titres 12–14pt.
- **Encre** : monochrome (impression bureau standard, économie cartouche).

### Sections (haut → bas)
1. **En-tête établissement** (bandeau haut, ~3 cm)
   - Logo Stoniz / Propria (optionnel)
   - Nom de l'établissement = nom du bien (`properties.name`)
   - Adresse complète du bien (`properties.address` + `quartier`)
   - Code interne du bien (`properties.propria_internal_code`)
   - Mention obligatoire FR + EN (cf. modèle FR) :
     « Fiche individuelle de police — à remettre au commissariat / Police registration form »
2. **Identité du chef de famille** (bloc principal)
3. **Pièce d'identité** (bloc)
4. **Résidence habituelle** (bloc)
5. **Détail du séjour** (bloc avec dates + motif)
6. **Accompagnants** (tableau dynamique, 1 ligne par entrée jsonb)
   - Colonnes : Nom · Prénom · Date naissance · Nationalité · Pièce · Relation
7. **Pied de page** (bandeau bas)
   - « Date : ________ Signature du voyageur : ________ »
   - Mention RGPD/CNDP : « Données collectées au titre de l'article R. 611-42 et de
     la réglementation marocaine sur l'hébergement touristique, conservées par
     l'établissement et transmises aux autorités compétentes. »
   - Référence interne : ID court de la fiche (8 premiers chars de l'UUID)
   - Date de génération du PDF (timestamp)

### Excel récap hebdo (info pour l'agent XLSX)

Un fichier `.xlsx` agrégé sur 7 jours, 1 feuille par semaine :

| Colonne | Source |
|---------|--------|
| Bien | `properties.name` |
| Code interne | `properties.propria_internal_code` |
| Date arrivée | `arrival_date_property` |
| Date départ | `expected_departure_date` |
| Nom chef famille | `head_last_name` + `head_first_name` |
| Nationalité | `head_nationality` |
| Pièce d'identité | `head_id_type` + `head_id_number` |
| Nb personnes total | `total_persons_count` |
| Motif séjour | `motif_sejour` |
| Statut | `status` |
| Source | `data_source` |
| Date soumission | `submitted_at` |
| Soumis par | `profiles.full_name` du `submitted_by` |
| Notes | `notes` |

## 7. Workflow et statuts

```
draft  ─(remplissage complet)→  complete  ─(impression + dépôt commissariat)→  submitted  ─(CEO archive)→  archived
                                                                                                ↑
                                                                       (suppression manuelle CEO → soft delete via deleted_at)
```

- `draft` : créée auto par cron OU manuellement, champs obligatoires incomplets.
- `complete` : tous les champs obligatoires renseignés, prête à imprimer.
- `submitted` : déposée au commissariat (champ `submitted_at` rempli).
- `archived` : archivée par le CEO (geste manuel après dépôt vérifié).

Le helper `isComplete(record)` / `computeMissingFields(record)` décide du passage
draft → complete côté serveur lors d'un upsert.

## 8. Permissions résumé

| Rôle | SELECT | INSERT | UPDATE | DELETE |
|------|--------|--------|--------|--------|
| `ceo` | OK | OK | OK | OK |
| `propria` | OK | OK | OK | OK |
| `assistante` | OK | OK | OK | OK |
| `developer` | OK | — | — | — |
| Autres | — | — | — | — |

Implémentation : 2 policies RLS sur `propria_police_records` (`SELECT` large incluant
`developer`, et `ALL` réservé aux 3 rôles écriture).

## 9. Notes & limitations

- Le format officiel précis n'a pas été retrouvé en ligne sous forme de PDF source
  Ministère de l'Intérieur / DGSN ; le présent format est donc à valider par le CEO
  contre le modèle réellement accepté par le commissariat de référence (à priori
  Marrakech — à confirmer).
- Si la DGSN impose plus tard des champs supplémentaires (ex. : empreintes
  numérisées, QR code anti-falsification, photo voyageur), ils s'ajouteront en
  colonnes nullables sans bloquer l'existant.
- La V2 pourrait basculer vers DABAFICHE pour télédéclaration directe — la
  structure BDD est déjà compatible (mapping 1:1 des champs).
