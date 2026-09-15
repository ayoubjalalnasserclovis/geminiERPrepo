# Hostaway Guest Portal — Audit API pour Fiches de police

**Date audit** : 2026-06-20
**Auteur** : Senior Backend Engineer (audit en lecture seule)
**Tâche** : Hostaway police A — audit API guest portal
**Objectif** : Savoir ce qu'on peut récupérer programmatiquement de Hostaway pour pré-remplir `propria_police_records` (pièce d'identité, photo, nationalité, etc.) au-delà du nom + dates.

---

## 1. Synthèse exécutive

- **Verdict : on a TRÈS PEU automatiquement aujourd'hui.** L'API Hostaway, telle qu'utilisée et configurée sur le compte 183142, ne retourne ni n° de pièce, ni date d'émission/expiration, ni date de naissance, ni adresse de résidence, ni photo de la pièce d'identité.
- **Ce qu'on a déjà** : `guestFirstName`, `guestLastName`, `guestEmail`, `phone`, `guestPicture` (avatar Airbnb, PAS la pièce), `guestLocale` (langue, proxy faible de nationalité), `guestPortalUrl` (URL à envoyer au voyageur).
- **Ce qu'on n'a PAS** : aucune des 11 colonnes obligatoires `propria_police_records` (passport, CIN, n°, dates, pays, profession, adresse) n'est exposée par les payloads `/v1/reservations/{id}` observés sur 2296 réservations en prod.
- **Cause** : Hostaway expose les infos détaillées du voyageur via les **Custom Fields** que l'host doit configurer dans le dashboard + une éventuelle intégration de **Guest Portal / Online Check-In** que le voyageur remplit. **Aucun custom field n'est configuré actuellement** (0 résa sur 2296 ont `customFieldValues` non vide).
- **Action CEO requise** : décider entre (a) configurer le module "Online Check-In" Hostaway avec custom fields passeport/CIN/etc., ou (b) saisie manuelle systématique dans Propria avec le helper interne, ou (c) lien WhatsApp/email vers un formulaire Stoniz autonome.

---

## 2. Auth & client existant (rappel)

**Fichier** : `lib/hostaway/client.ts`

- OAuth2 `client_credentials` :
  - `POST https://api.hostaway.com/v1/accessTokens` avec `HOSTAWAY_ACCOUNT_ID` + `HOSTAWAY_API_KEY` (env vars).
  - Token cache en mémoire process-wide, marge 60s avant expiration, refresh auto.
  - Retry 1x sur 401 (invalidation + nouveau token).
- Wrapper générique `hostawayFetch<T>(endpoint, opts)` → `GET/POST/PUT/DELETE/PATCH` avec query params, body JSON, headers `Authorization: Bearer …` + `Content-Type: application/json`.
- Helpers existants :
  - `hostawayPing()` → diag credentials.
  - `hostawayListListings(limit)` → `GET /listings`.
  - `hostawayListReviews({ sinceDate, pageSize })` → `GET /reviews` avec pagination auto.
- **Pas de helper guest portal aujourd'hui.** À ajouter dans la vague suivante.

**Fichier** : `lib/hostaway/match.ts` — uniquement matching Jaccard listing ↔ propria_unit, hors scope.

**Endpoints actuellement utilisés en prod** :
- `/v1/accessTokens` (auth)
- `/v1/listings` (sync biens)
- `/v1/reservations` (sync réservations, on stocke `raw_data` jsonb)
- `/v1/reviews` (avis voyageurs cross-canal)

---

## 3. Inventaire des champs réellement exposés par `/v1/reservations/{id}`

**Source** : SELECT sur `hostaway_reservations.raw_data` (2296 résa en prod, échantillon des 8 dernières + agrégat sur toutes).

### 3.1 Champs PERTINENTS pour fiches de police

| Champ Hostaway                  | Type      | Présent ? | Couverture prod (n=2296) | Utilité fiche police                          |
|---------------------------------|-----------|-----------|--------------------------|-----------------------------------------------|
| `guestFirstName`                | string    | OUI       | ~majoritaire             | `head_first_name`                             |
| `guestLastName`                 | string    | OUI       | ~majoritaire             | `head_last_name`                              |
| `guestName`                     | string    | OUI       | 100%                     | fallback split                                |
| `guestEmail`                    | string    | partiel   | (souvent proxy `…@guest.airbnb.com`) | contact, pas police                |
| `phone`                         | string    | partiel   | ~variable                | contact, pas police                           |
| `guestLocale`                   | string    | OUI       | 100%                     | proxy FAIBLE nationalité (ex: "pt" ≠ Portugal) |
| `guestAddress`                  | string    | NON       | **0 / 2296**             | aurait été `head_residence_address`           |
| `guestCity`                     | string    | NON       | 0 / 2296                 | aurait fait partie adresse                    |
| `guestCountry`                  | string    | NON       | **6 / 2296** (0.26%)     | aurait été `head_residence_country`           |
| `guestZipCode`                  | string    | NON       | 0 / 2296                 | adresse                                       |
| `guestWork`                     | string    | NON       | 0 / 2296                 | aurait été `head_profession`                  |
| `guestPicture`                  | URL       | OUI       | 1706 / 2296 (74%)        | **AVATAR Airbnb**, **PAS** la pièce d'identité|
| `isGuestVerifiedByGovernmentId` | int 0/1   | OUI       | **0 / 2296 = 1**         | indicateur seul, **aucune copie de pièce**    |
| `customFieldValues`             | array     | OUI mais  | **0 / 2296 non-vide**    | container OFFICIEL des infos custom, vide ici |
| `listingCustomFields`           | array     | OUI mais  | 0 / 2296 non-vide        | custom fields niveau listing                  |
| `rentalAgreementFileUrl`        | URL       | NON       | 0 / 2296                 | aurait pu contenir contrat signé              |
| `reservationAgreement`          | enum      | OUI       | "not_required"/"not_signed" majoritaire | statut signature, pas le contenu |
| `guestPortalUrl`                | URL       | OUI       | quasi 100%               | URL portail pour relance voyageur             |
| `guestAuthHash`                 | string    | OUI       | 100%                     | token portail (cf. URL)                       |

**Champs ABSENTS du payload Hostaway, donc impossibles** :
- `head_id_type`, `head_id_number`, `head_id_issue_date`, `head_id_expiry_date`, `head_id_issue_country`
- `head_birth_date`, `head_birth_place`
- `head_nationality` (différent de `guestLocale` qui est la langue UI)
- `head_profession`
- `head_residence_address`
- Photo de la pièce d'identité

### 3.2 Champs financiers/techniques (hors scope police)

Stockés mais non pertinents : `totalPrice`, `cleaningFee`, `currency`, `paymentStatus`, `airbnb*`, `bookingcom*`, `cancellation*`, `ccNumber`, `cvc`, `doorCode`, etc. Voir `docs/propria/hostaway-guest-portal-sample.json`.

---

## 4. Endpoints candidats pour récupérer le détail guest portal

La doc Hostaway publique (`https://api.hostaway.com/documentation`) est une SPA qui ne charge pas tous les détails par crawl HTTP simple. J'ai identifié les endpoints ci-dessous comme candidats à probe LIVE, plus 2 endpoints documentés à coup sûr.

### 4.1 Endpoints CONFIRMÉS par la doc Hostaway

| Endpoint                                | Méthode | Auth   | Réponse attendue                                   |
|-----------------------------------------|---------|--------|----------------------------------------------------|
| `GET /v1/reservations/{id}`             | GET     | Bearer | Objet réservation complet (cf. sample, mais customFieldValues=[] aujourd'hui) |
| `GET /v1/reservations`                  | GET     | Bearer | Liste paginée (déjà utilisé pour sync)             |
| `GET /v1/customFields`                  | GET     | Bearer | Liste des custom fields configurés sur le compte   |
| `GET /v1/customFieldValues`             | GET     | Bearer | Filtrable par `reservationId` (à confirmer)        |

### 4.2 Endpoints candidats (à PROBE en live)

À tester via le script `scripts/test/test-hostaway-guest-portal.ts` :

| Endpoint                                              | Pari                                       |
|-------------------------------------------------------|--------------------------------------------|
| `GET /v1/reservations/{id}?includeResources=1`        | Voir si Hostaway expose un mode "full"     |
| `GET /v1/reservations/{id}/customFieldValues`         | Variant subpath                            |
| `GET /v1/customFieldValues?reservationId={id}`        | Variant query                              |
| `GET /v1/reservations/{id}/guestPortalInformation`    | Naming spéculatif                          |
| `GET /v1/reservations/{id}/personalInformation`       | Naming spéculatif                          |
| `GET /v1/reservations/{id}/attachments`               | Pour photos/documents                      |
| `GET /v1/reservations/{id}/guestForms`                | Si "Guest Forms" est un module séparé      |
| `GET /v1/reservations/{id}/guestIdentityVerification` | Pour copie pièce                           |

**Verdict probable** (à confirmer avec le script live) : seul `/customFields` + `/customFieldValues` retourneront 200. Les autres → 404.

### 4.3 Le mécanisme RÉEL côté Hostaway (synthèse écosystème)

D'après la structure de l'objet réservation et la convention Hostaway :

1. L'host configure dans le dashboard Hostaway → *Custom Fields* → ajoute par exemple :
   - `passport_number` (text)
   - `passport_issue_date` (date)
   - `passport_expiry_date` (date)
   - `passport_country` (text)
   - `birth_date` (date)
   - `nationality` (text)
   - `residence_address` (text)
   - `profession` (text)
   - `id_photo_front` (file/image)
2. L'host active le **Guest Portal / Online Check-In** côté listing.
3. Hostaway envoie automatiquement le lien `guestPortalUrl` au voyageur (peut aussi être relayé via template message).
4. Le voyageur remplit le formulaire + upload photo dans le portail.
5. Les valeurs sont stockées dans `customFieldValues` du reservation object, accessibles via l'API.
6. Les uploads de fichiers (photo pièce) génèrent une URL stockée dans la valeur du custom field correspondant.

**Aujourd'hui sur le compte 183142** : étape 1 non faite → étapes 2-6 sans données.

---

## 5. Photos de la pièce d'identité

**Mécanisme attendu** (à confirmer en live une fois configurés les custom fields) :

- Si le custom field est de type `file` ou `image`, sa valeur dans `customFieldValues[i].value` sera une URL Hostaway signée (typiquement `https://api.hostaway.com/...` ou un CDN dédié).
- Le téléchargement se fait par `fetch(url, { headers: { Authorization: 'Bearer …' } })` ou potentiellement sans auth si URL signée.
- À downloader en serveur Stoniz puis upload dans Supabase Storage bucket `propria-police-id-photos` (à créer dans la vague B).

**Pas de base64 inline observé** dans les payloads `/v1/reservations`. Les fichiers attachés (s'ils existent) sont toujours référencés par URL.

---

## 6. Mapping Hostaway → `propria_police_records`

| Champ BDD                       | Source Hostaway (chemin)                                   | Confiance | Notes                                        |
|---------------------------------|------------------------------------------------------------|-----------|----------------------------------------------|
| `head_first_name`               | `raw_data.guestFirstName` (fallback split `guestName`)      | OK        | Déjà fait via `splitGuestName`               |
| `head_last_name`                | `raw_data.guestLastName` (fallback split `guestName`)       | OK        | idem                                         |
| `head_gender`                   | —                                                          | KO        | Saisie manuelle obligatoire                  |
| `head_birth_date`               | `customFieldValues[X="birth_date"].value`                  | conditionnel | Si custom field configuré                  |
| `head_birth_place`              | `customFieldValues[X="birth_place"].value`                 | conditionnel | idem                                       |
| `head_nationality`              | `customFieldValues[X="nationality"].value` ou `guestCountry` (rare) | conditionnel | `guestLocale` n'est PAS la nationalité  |
| `head_profession`               | `customFieldValues[X="profession"].value` (ou `guestWork`) | conditionnel | `guestWork` toujours null aujourd'hui      |
| `head_id_type`                  | `customFieldValues[X="id_type"].value`                     | conditionnel |                                            |
| `head_id_number`                | `customFieldValues[X="passport_number"].value`             | conditionnel |                                            |
| `head_id_issue_date`            | `customFieldValues[X="passport_issue_date"].value`         | conditionnel |                                            |
| `head_id_expiry_date`           | `customFieldValues[X="passport_expiry_date"].value`        | conditionnel |                                            |
| `head_id_issue_country`         | `customFieldValues[X="passport_country"].value`            | conditionnel |                                            |
| `head_residence_country`        | `customFieldValues[X="residence_country"].value` ou `guestCountry` (6/2296) | conditionnel |                       |
| `head_residence_address`        | `customFieldValues[X="residence_address"].value` (concat `guestAddress`+`guestCity`+`guestZipCode` si jamais) | conditionnel | 0/2296 aujourd'hui |
| `arrival_date_property`         | `raw_data.arrivalDate`                                     | OK        | Déjà fait                                    |
| `expected_departure_date`       | `raw_data.departureDate`                                   | OK        | Déjà fait                                    |
| `motif_sejour`                  | —                                                          | KO        | Toujours "tourisme" pour Propria, ou saisie  |
| `accompanying_persons`          | `raw_data.adults`+`children`+`infants` (compte seul)       | partiel   | Détails (nom, pièce) impossibles via API     |
| **Photo pièce d'identité**      | `customFieldValues[X="id_photo_front"].value` (URL)        | conditionnel | À downloader → Supabase Storage             |

**Constat** : 100% des champs marqués "conditionnel" dépendent de la **configuration côté Hostaway** + **du remplissage par le voyageur**. Aucun n'est garanti.

---

## 7. Limitations & cas non couverts

1. **Aucun custom field configuré** sur le compte 183142 → aucune donnée détaillée aujourd'hui (0/2296).
2. **Accompagnants** : Hostaway ne capture que des compteurs (`adults`, `children`, `infants`). Le détail nominatif (nom, pièce, date de naissance) doit forcément être saisi à la main ou demandé via un autre canal (formulaire externe, WhatsApp).
3. **Photos pièce identité** : uniquement si custom field type `file` configuré, sinon aucun mécanisme natif.
4. **Réservations directes** (Airbnb / Booking via Hostaway sans Online Check-In activé) : Hostaway ne force pas le voyageur à remplir le portail. Taux de remplissage attendu < 50% même avec custom fields configurés.
5. **Confidentialité / RGPD** : photos pièce identité = données personnelles sensibles. Storage bucket Supabase à protéger via RLS stricte (rôles `ceo`/`propria`/`assistante` only) + chiffrement at rest activé.
6. **`guestEmail` souvent proxy** : Airbnb retourne souvent `…@guest.airbnb.com`, pas l'email réel — pas utile pour relance directe.
7. **`isGuestVerifiedByGovernmentId`** : indicateur booléen Airbnb, **ne donne accès à AUCUNE donnée** (pas de copie de pièce, pas de n°). Juste "Airbnb a vérifié l'identité".

---

## 8. Verdict

**On a TRÈS PEU automatiquement aujourd'hui.** Le pré-remplissage Hostaway pour fiches de police se limite à :
- Nom + prénom (split du `guestName`)
- Dates arrivée / départ
- Téléphone / email contact (souvent proxy)
- Avatar Airbnb (PAS la pièce d'identité)
- Lien `guestPortalUrl` à relayer au voyageur

C'est exactement ce que fait déjà `pullDataFromHostawayReservation` dans `lib/propria/police-records.ts` aujourd'hui.

Pour aller plus loin il faut **DEUX actions parallèles** :

---

## 9. Action CEO requise

### Option A — Activer "Online Check-In" + Custom Fields Hostaway (recommandé)

1. **Dashboard Hostaway → Settings → Custom Fields** : créer 10 custom fields type texte/date/file :
   - `police_birth_date` (date)
   - `police_birth_place` (text)
   - `police_nationality` (text)
   - `police_profession` (text)
   - `police_id_type` (dropdown : passport / cin / other)
   - `police_id_number` (text)
   - `police_id_issue_date` (date)
   - `police_id_expiry_date` (date)
   - `police_id_country` (text)
   - `police_residence_address` (text long)
   - `police_id_photo_front` (file/image, max 5 MB)
   - `police_id_photo_back` (file/image, optionnel)
2. **Activer Online Check-In** sur les ~40 listings (ou les principaux).
3. **Template message** auto-envoyé J-3 avant arrivée avec le lien `guestPortalUrl`.
4. **Côté Stoniz** : vague B BDD + vague C helper `pullCustomFieldsFromHostaway(reservationId)` qui mappe `customFieldValues[]` vers `propria_police_records`.

**Pros** : automatique, intégré au flux voyageur, le voyageur est déjà sur Hostaway.
**Cons** : taux de remplissage probable 40-60%, configuration manuelle dans Hostaway, format des custom fields impose une convention de slugs stable.

### Option B — Formulaire Stoniz autonome (lien WhatsApp/email)

Construire une page publique Stoniz `/propria/checkin/{token}` qui pré-remplit depuis Hostaway (nom + dates) et demande au voyageur de compléter le reste + uploader photo.

**Pros** : 100% contrôle UX/champs/branding, photos directement dans Supabase Storage.
**Cons** : encore un lien de plus à envoyer au voyageur en plus du portail Hostaway, doublon UX.

### Option C — Saisie manuelle 100% par l'équipe Propria

Statu quo + helper de saisie rapide existant.

**Pros** : zéro dépendance Hostaway.
**Cons** : 100% manuel, ralentit la team.

**Recommandation forte** : **Option A** (Hostaway custom fields) + **fallback Option C** pour les voyageurs qui ne remplissent pas. Option B en V2 si A < 30% de remplissage observé.

---

## 10. Artefacts livrés

- `docs/propria/hostaway-guest-portal.md` (ce fichier)
- `docs/propria/hostaway-guest-portal-sample.json` (sample anonymisé du payload `/v1/reservations/{id}` observé en prod)
- `scripts/test/test-hostaway-guest-portal.ts` (probe live des 8 endpoints candidats — à exécuter sur 1-2 résa pour confirmer ce qui répond 200 vs 404)

### Comment exécuter le probe live

```bash
cd stoniz-platform
# Récupérer un hostaway_id depuis BDD :
#   SELECT hostaway_id FROM hostaway_reservations WHERE deleted_at IS NULL ORDER BY arrival_date DESC LIMIT 5;
npx tsx scripts/test/test-hostaway-guest-portal.ts 58083962
```

Le script écrira un `docs/propria/hostaway-guest-portal-sample.json` actualisé avec les résultats anonymisés des 10 probes.

---

## 11. Prochaines vagues (référence tâches en cours)

- **#132 Hostaway police B** — BDD + Storage : créer bucket `propria-police-id-photos` (RLS stricte), étendre `propria_police_records` si besoin de stocker la photo URL Supabase.
- **#133 Hostaway police C** — helpers + UI + actions : `pullCustomFieldsFromHostaway`, écran de saisie pré-rempli, action upload photo.
- **#134 Hostaway police D** — cron + test E2E : daily-reminders ajoute "fiche police manquante" + sync delta custom fields.
