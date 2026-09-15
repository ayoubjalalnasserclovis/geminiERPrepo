-- ============================================================================
-- Normalisation des chaînes vides en NULL — cleanup historique
-- ============================================================================
-- L'anti-pattern `clean()` + `.or(z.literal(''))` a laissé des chaînes vides
-- dans plusieurs colonnes nullable au fil des versions. Cette migration les
-- normalise en NULL pour garantir une représentation canonique unique du
-- "champ vide" à travers tout le repo.
--
-- Cible : colonnes email + URL + identifiants optionnels qui ont historiquement
-- pu recevoir '' au lieu de NULL via les Server Actions.
--
-- IDEMPOTENT : la migration peut être ré-exécutée sans risque (les UPDATE ne
-- font rien si toutes les valeurs sont déjà NULL).
-- ============================================================================

-- ─── Clients ──────────────────────────────────────────────────────────────
UPDATE clients SET email = NULL WHERE email = '';

-- ─── Properties (champs URL + email Propria) ──────────────────────────────
UPDATE properties SET propria_owner_email      = NULL WHERE propria_owner_email      = '';
UPDATE properties SET propria_airbnb_url       = NULL WHERE propria_airbnb_url       = '';
UPDATE properties SET propria_booking_url      = NULL WHERE propria_booking_url      = '';
UPDATE properties SET propria_google_maps_url  = NULL WHERE propria_google_maps_url  = '';
UPDATE properties SET drive_url                = NULL WHERE drive_url                = '';

-- ─── Artisans (email) ──────────────────────────────────────────────────────
UPDATE artisans SET email = NULL WHERE email = '';

-- ─── Propria providers (email + téléphone) ────────────────────────────────
-- Le schéma intervention.ts gère un email provider optionnel.
UPDATE propria_providers SET email = NULL WHERE email = '';

-- ─── Properties (autres champs texte historiquement '') ──────────────────
-- video_url est typé URL côté schéma, peut avoir des '' historiques.
UPDATE properties SET conditions_offre = NULL WHERE conditions_offre = '';

COMMENT ON COLUMN clients.email IS
  'Email du client. NULL si non fourni. La chaîne vête est interdite — utiliser le helper Zod optionalEmail côté Server Actions.';
