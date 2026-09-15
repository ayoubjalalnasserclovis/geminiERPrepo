# Affichage des lots Propria sur les fiches

## Composant central

`components/propria/propria-units-list.tsx` — server-friendly, dumb component qui reçoit `units` en prop.

## Utilisations

### Fiche bien `/propria/biens/[id]`
- `compact={false}` (par défaut)
- Affiche **tous les lots** avec détails complets : WiFi, code serrure, boîte à clé, nb clés, Airbnb, Booking, photos Drive, observations

### Fiche projet `/projects/[id]`
- `compact={true}` + `maxRows={3}`
- Affiche uniquement si `propria_managed_at IS NOT NULL` sur le bien lié
- Top 3 lots avec résumé (code, prix, voyageurs, badges Airbnb/Booking)
- Lien "Voir tous" → fiche bien complète

## Pourquoi pas un async server component

`PropriaUnitsList` reçoit `units` en prop au lieu de fetch lui-même. Ça permet :
- Fetch unique au niveau page parent (perf : pas de cascade)
- Composant testable / Storybookable
- Pas de duplication de logique RLS

## Données affichées

Pour chaque lot :
- `code` (ex "BEJ GUENI 1")
- `propria_capacity_voyageurs`, `propria_nb_chambres`, `propria_type_lits`
- `propria_base_price_per_night` (MAD)
- `propria_wifi_ssid`, `propria_lock_code`, `propria_key_box_suite`, `propria_nb_keys`
- Liens externes : Airbnb, Booking, photos Drive
- `propria_observations` (mode complet seulement)
