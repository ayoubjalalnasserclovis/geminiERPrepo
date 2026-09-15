# Import PROPRIA — Plan de mapping (à valider avant exécution)

**Source :** `Fiches biens PROPRIA-89976307.csv` (42 lignes de contenu)
**Date :** 2026-05-29
**Verdict :** rien n'est inséré tant que ce plan n'est pas validé.

---

## 1. Volumétrie source

| Compteur | Valeur |
|---|---|
| Lignes CSV non-vides | 42 |
| **Propriétaires distincts** | **12** |
| **Biens physiques distincts** (regroupés par adresse + préfixe) | **14** |
| **Lots = propria_units** | **41** |

### Détail propriétaires → biens → lots

| Propriétaire | Bien physique | # lots | Préfixe code |
|---|---|--:|---|
| Hakim Boucheniata | AV Allal el Fassi IM D APPT 7 ET 2 | 4 | AF |
| Hakim Boucheniata | Résidence Majorella, APT 15, ET 5 | 3 | MAJO |
| Hakim Boucheniata | Rue Rahal Ben Ahmed, Al Hanae, APT 9 | 4 | BEJGUENI |
| Redha Foudad | Naoufal 1 Camp El Ghoul, RDC, APT 3 | 2 | FOUDAD |
| Yassine El Badaoui | Al Warda 7, APT 13 ET 1 | 3 | WARDA |
| Yassine El Badaoui | Av Allal Fassi, Dar El Hamra mmD ET 3 APT 7 | 4 | BADAOUI AF |
| Steven Bouhriss | Résidence Poidomani, 58 Rue Tariq Bnou Ziad | 2 | STEVEN |
| Patrick le Sourd | Rés. Zineb Atlas 45 APT 6 ET 1 Rue Mauritani | 3 | PATRICK |
| El Eulj Mamoun | Rés. Mehdi 1 Camp El Ghoul ET 3 APT 15 | 3 | MAMOUN |
| Duc Nguyen | Rés. Majorella, APT 8 ET 3 | 2 | DUC |
| Paul Benneli | Rés. Asbahani 3, 12 Rue Ezzoubair Ben El Aoumam | 2 | PAUL |
| Catherine Everard | Rés. Les Orangers, Bd Mohamed Zerktouni | 2 | CATHERINE |
| Kamil Joundy | Av. Yacoub El Mansour, Rés. Jazoud, B, APT 3 ET 1 | 4 | JOUNDY |
| Paul Ferrera | Rue Moulay Abdellah, 1er ét, 183 | 1 | PATISSERIE KAWTAR |
| Yamina Hamouche | Imm Atlassi, Rue Yougoslavie, APT 12 ET 3 | 2 | YAMINA |

**À vérifier (collisions adresse/maps détectées) :**

⚠ **WARDA (Yassine El Badaoui) / BADAOUI AF (Yassine) / AF (Hakim)** — les 3 ont un **lien Google Maps identique** (`https://maps.app.goo.gl/RP5DZmFRx4FHka1K7`). Adresses formulées différemment :
- Hakim AF : "AV ALLAL EL FASSI IM D APPT 7 ETAGE 2" → étage 2 ou 3 ?
- Yassine BADAOUI AF : "Avenue Allal Fassi, complexe Dar el Hamra, immeuble mmD, 3ème étage, appartement 7" → étage 3

Le lien Maps identique suggère que c'est le **même immeuble** (Dar El Hamra, immeuble mmD, AV Allal el Fassi) avec **2 appartements distincts au 3ème étage** mais le CSV donne tantôt étage 2 tantôt 3 pour le bien Hakim. **À arbitrer.** Soit ce sont vraiment 2 immeubles distincts qui partagent l'épingle Google Maps (improbable), soit ce sont 2 appartements DIFFÉRENTS dans le même immeuble (à confirmer par les noms d'appartement).

---

## 2. 🚨 BLOCAGE — Emails clients absents

**Constat :** le CSV n'a pas de colonne email. La table `clients.email` est `NOT NULL UNIQUE`.

**Décision recommandée — NE CRÉER AUCUN CLIENT à partir du CSV PROPRIA.**

Les 12 propriétaires PROPRIA sont par définition des **clients Stoniz qui ont acheté un bien**. Ils ont donc déjà un projet → un client dans la base, importé depuis Notion ce soir.

**Stratégie :**
1. Pour chaque nom propriétaire du CSV → fuzzy match sur `clients.full_name` (ILIKE / similarity)
2. Si match unique fiable (similarity > 0.7) → on lie le bien au client existant
3. Si match ambigu (plusieurs candidats) ou si pas de match → **liste À VÉRIFIER**, Othmane arbitre nom par nom
4. **Aucun INSERT dans `clients`** dans ce script. Si un propriétaire n'existe pas en base, on le signale et on attend décision (création manuelle CEO via UI, ou seed séparé avec vrai email).

→ Stratégie validée par toi avant code ?

---

## 3. Mapping colonne CSV → table.colonne ERP

### A. Champs de niveau BIEN (vont sur `properties`)

| Colonne CSV | Table.colonne ERP | Note |
|---|---|---|
| Adresse complete | `properties.address` | |
| Lien Google Maps | `properties.propria_google_maps_url` | |
| Etage | `properties.floor` (TEXT pour gérer "RDC") | |
| Porte / appartement | `properties.propria_apartment_door` | porte de l'APPT global (niveau bien) |
| Type de bien | `properties.type` (mappé : "Appartement"→"appartement") | |
| Superficie (m2) | `properties.superficie` | vide partout dans le CSV |
| RIB pour reversements | `properties.propria_bank_rib` | sensible RLS |
| Banque | `properties.propria_bank_name` | vide partout dans le CSV |
| Date signature mandat | `properties.propria_mandate_start` | vide partout |
| Date fin mandat | `properties.propria_mandate_end` | vide partout |
| Taux commission PROPRIA | `properties.propria_commission_rate` | "20%" → 20.00 |
| Conditions particulieres | `properties.propria_mandate_conditions` | vide partout |
| Accès admin | `properties.propria_app_admin_access` | "Oui"/"Non" → BOOLEAN |
| Boite à clé immeuble / digicode | `properties.propria_badge_building` | |
| Badge / acces immeuble | `properties.propria_building_access_type` | mappé à enum : "Ouvert 24/24"→`ouvert_24_24`, "Clé"→`cle`, "Badge Asc + Clé"→`badge_asc_cle`, etc. |
| Code ascenseur | `properties.propria_elevator_code` | |
| Acces parking | `properties.propria_parking_info` | |
| Numero gardien / concierge | `properties.propria_guardian_phone` | |
| Nom Gardien | `properties.propria_guardian_name` | |
| Numéro Gardien (col 41) | `properties.propria_guardian_phone` | doublon, on prend la dernière non-vide |
| Vidéo d'arrivée | _flag_ | "Oui"/"Non" — info uniquement, pas de colonne dédiée |
| Lien de la vidéo d'arrivée | `properties.propria_arrival_video_url` | |
| Numero contrat eau | `properties.propria_water_contract` | sensible |
| Numero compteur eau | `properties.propria_water_meter` | |
| Numero contrat electricite | `properties.propria_electricity_contract` | |
| Numero compteur electricite | `properties.propria_electricity_meter` | |
| Numero contrat internet | `properties.propria_internet_contract` | |
| Fournisseur internet | `properties.propria_internet_provider` | vide partout |
| Syndic — à payer ? | `properties.propria_syndic_to_pay` | "Oui"/"Non" → BOOLEAN |
| Montant syndic (MAD) | `properties.propria_syndic_amount` + parse "X MAD par an/mois" → MAD/mois | normalisation : "3000 MAD par an" → 250/mois |
| Fiches d'infos à envoyer | `properties.propria_info_sheet_to_send` | |
| Caméra installé | `properties.propria_camera_installed` | |
| Accès admin par application | `properties.propria_app_admin_access` | |
| Artisan referent + tel | _ignoré_ | va dans `propria_providers` séparément, pas couvert ce script |
| Instructions d'arrivées | `properties.propria_arrival_instructions` | vide partout |
| _toutes lignes du même bien_ | `properties.propria_managed_at = NOW()` | au moment de l'import |
| _toutes lignes_ | `properties.propria_internal_code` | préfixe du code lot (ex "AF", "MAJO") |

### B. Champs de niveau LOT (vont sur `propria_units`)

| Colonne CSV | propria_units.colonne | Note |
|---|---|---|
| Nom interne du bien | `code` (laissé au trigger) + `code_locked = true` pour conserver "AF 1" | |
| _index dans le groupe bien_ | `order_index` (1..N par bien) | |
| Code serrure electronique | `propria_lock_code` | sensible |
| Boite à clé logement | `propria_key_box_home` | sensible |
| Emplacement boite a cles | _texte libre joint_ | OK : on concatène avec key_box_home |
| Nombre de cles disponibles | `propria_nb_keys` | |
| Nombre de cles immeuble disponibles | _ignoré_ | pas de colonne dédiée |
| Clé admin electronique | _ignoré_ | "Oui"/"Non" pas de colonne |
| Localisation cle reserve | _ignoré_ | pas de colonne |
| Nom reseau Wifi (SSID) | `propria_wifi_ssid` | |
| Mot de passe Wifi | `propria_wifi_password` | sensible |
| Lien annonce Airbnb | `propria_airbnb_url` | |
| Lien annonce Booking | `propria_booking_url` | vide partout |
| Date premiere mise en ligne | `propria_listing_published_at` | vide partout |
| Prix de base nuit (MAD) | `propria_base_price_per_night` | parse "429 MAD" → 429.00 |
| Lien dossier photos Drive | `propria_drive_photos_url` | |
| Capacite max voyageurs | `propria_capacity_voyageurs` | |
| Nombre de chambres | `propria_nb_chambres` | |
| Type(s) de lit(s) | `propria_type_lits` | "160*200" → on conserve tel quel |
| Observations | `propria_observations` | vide partout |
| _serrure connectée_ | `propria_smart_lock` | déduit : si `Code serrure electronique` non-vide → true |

### C. Champ de niveau CLIENT (sur `clients` existants)

| Colonne CSV | clients.colonne ERP | Note |
|---|---|---|
| Nom client / proprietaire | _matching only_ | NE PAS écrire, juste matcher |

### D. Champs sur `projects` (existants)

| Colonne CSV | projects.colonne ERP | Note |
|---|---|---|
| _aucune valeur écrite_ | `projects.property_id` | UPDATE pour lier le projet existant au bien |

---

## 4. Normalisations à appliquer

| Source | Cible | Règle |
|---|---|---|
| `20%` | `propria_commission_rate = 20.00` | parse %, normalise NUMERIC |
| `Oui` / `Non` | BOOLEAN | trim() puis equals |
| `Non applicable` | `NULL` | distinct de "vide" mais on stocke NULL |
| `Client paie` | `'client_paie'` text marker | sémantique distincte, **on garde le texte** dans la colonne contrat (ex `propria_water_contract = 'client_paie'`) pour ne pas perdre l'info |
| `Pas d'info` | `NULL` | |
| `429 MAD` | `429.00` | parse number |
| `3000 MAD par an` | conversion → `250.00` MAD/mois pour `propria_syndic_amount` | |
| `150 MAD par mois` | `150.00` | |
| `+212 6 26 11 32 42` | normalisé `+212626113242` | format E.164 |
| Adresse | trim + collapse whitespace | |
| Lien Google Maps | trim, vérification 1 URL par bien | |
| `Ouvert 24/24` | `ouvert_24_24` | enum building_access_type |
| `Clé` | `cle` | |
| `Badge Asc + Clé` | `badge_asc_cle` | |
| `Digicode` | `digicode` | |

---

## 5. Idempotence — clés naturelles d'UPSERT

| Table | Clé naturelle | Action sur conflit |
|---|---|---|
| `clients` | `LOWER(email)` UNIQUE | rien (pas d'INSERT depuis ce script) |
| `properties` | `(LOWER(address), propria_internal_code)` — pas d'UNIQUE en DB, donc on cherche + UPDATE ou INSERT | si pas de match → INSERT ; sinon UPDATE non-destructif |
| `propria_units` | `(property_id, order_index)` UNIQUE | UPSERT propre |
| `projects` | `id` (lookup par client_id) | UPDATE `property_id` uniquement |

**Règle non-destructive :** lors d'un UPDATE, on n'écrase une valeur existante non-vide que si elle est égale à NULL côté CSV ou si Othmane a explicitement autorisé. Sinon on logue le conflit dans un rapport.

---

## 6. Comptes attendus après pilote (1 client : Hakim Boucheniata)

| Compteur | Avant pilote | Après pilote |
|---|--:|--:|
| `clients` | inchangé | inchangé (pas d'INSERT) |
| `properties` Hakim avec propria_managed_at | 0 | **3** (AF, MAJO, BEJGUENI) |
| `propria_units` Hakim | actuellement présents si existent | **11** (4+3+4) |
| `projects.property_id` UPDATE | — | au moins 1 (RIAD 1 ↔ AF ?) à vérifier |

**Note importante :** Hakim a en base un projet `hakim-boucheniata-riad-1` en `current_phase = sourcing` + 1 BEJ GUENI termine. Le CSV ne mentionne pas "RIAD 1" — il a `AF`, `MAJO`, `BEJGUENI`. Il y a peut-être un mismatch entre les "biens" actuels en base et ce qu'on importe. **À arbitrer avant pilote.**

---

## 7. Liste À VÉRIFIER (ne pas insérer avant validation)

| # | Cas | Question |
|---|---|---|
| 1 | 3 biens partagent le même lien Google Maps (Hakim AF, Yassine BADAOUI AF, Yassine WARDA) | Vraiment 3 immeubles distincts ? Ou doublon de pin Maps ? |
| 2 | Étage Hakim AF : CSV dit `3` en colonne mais texte adresse dit `ETAGE 2` | Quel est le bon étage ? |
| 3 | RIAD 1 (Hakim, base actuelle) absent du CSV | Garde-t-on RIAD 1 séparé ou est-il un alias de AF / MAJO / BEJGUENI ? |
| 4 | Patrick le Sourd CSV vs "Fatima Rahmane & Patrick SOURD" base | Même client ? Sinon 2 emails, 2 clients distincts. |
| 5 | Steven Bouhriss CSV vs "Steven Le Bouhris" base | Orthographe différente — confirme matching ? |
| 6 | Paul Benneli vs Paul Ferrera | 2 clients distincts, à confirmer (pas de match avec base ?) |
| 7 | El Eulj Mamoun | Pas vu dans la session — existe-t-il en base ? |
| 8 | Catherine Everard | Idem |
| 9 | Kamil Joundy | "JOUNDY Kamil" existe en base (parmi les 5 PDFs trop gros mentionnés en mémoire) |

---

## 8. Champs CSV non couverts par le schéma (signalés comme manquants)

- **Numero gardien / concierge** apparaît 2 fois (col 31 et col 41), même cible → on prend la dernière non-vide
- **Vidéo d'arrivée** (Oui/Non) : pas de colonne (info "il y a une vidéo" déjà implicite via URL)
- **Nombre de cles immeuble disponibles** : pas de colonne dédiée
- **Clé admin electronique** (Oui/Non) : pas de colonne
- **Localisation cle reserve** : pas de colonne
- **Artisan referent + tel** : table dédiée `propria_providers`, hors scope ce script

---

## 9. Workflow d'exécution proposé

### Phase 0 — Préalable (à toi)
- **Décider stratégie email** (recommandation : aucun INSERT clients depuis ce CSV)
- **Arbitrer les 9 cas À VÉRIFIER** ci-dessus

### Phase 1 — Génération du rapport de matching (lecture seule)
Je sors un SQL qui produit pour chaque nom CSV : la liste des clients candidats en base + score similarity + leurs project.id + property.id existants. Tu valides 1 par 1.

### Phase 2 — Pilote Hakim Boucheniata
Script transactionnel BEGIN/COMMIT qui :
1. Crée/Update 3 `properties` (AF, MAJO, BEJGUENI) avec tous les champs niveau-bien
2. Crée 11 `propria_units` (UPSERT sur `(property_id, order_index)`)
3. UPDATE projects.property_id pour lier (avec ton arbitrage RIAD 1)
4. Sort un rapport SELECT post-exécution avec compteurs + détails

Tu valides visuellement ce qui sort.

### Phase 3 — Déploiement reste
Si pilote OK → on déroule les 11 autres propriétaires par lot, transaction par client.

### Phase 4 — Rapport final
- Lignes À VÉRIFIER résiduelles
- Champs manquants par bien
- Statistiques finales (vs comptes attendus)

---

## 10. Sécurité

- **RIB / IBAN / SWIFT / passwords WiFi / codes serrure / boîtes à clés** : écrits dans les colonnes correspondantes, protégées par RLS staff (lecture restreinte CEO + chef_projet + finance + propria selon les politiques existantes).
- **Aucune donnée sensible dans les logs ou rapports** : les scripts n'echo'eront que les compteurs, jamais les contenus sensibles.

---

## ⛔ STOP GATE — Validation requise

3 décisions à prendre avant que je commence à écrire le SQL :

1. **Stratégie email clients** : tu valides "aucun INSERT clients depuis ce script, matching par nom uniquement" ?
2. **Cas À VÉRIFIER** : tu réponds aux 9 cas du §7 (ou tu me dis "tranche toi par défaut sur X, je verrai en pilote")
3. **Pilote** : tu valides qu'on commence par Hakim Boucheniata (3 biens, 11 lots), puis on étend au reste après ta revue ?

Une fois ces 3 points actés, je rédige le script de matching (Phase 1) puis on déroule.
