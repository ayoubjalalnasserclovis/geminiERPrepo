-- ============================================================================
-- Médias du bien : relève le plafond du bucket `property-media` à 1 Go
-- ----------------------------------------------------------------------------
-- POURQUOI (métier) :
--   Les vidéos de visite d'un bien (sourcing) dépassaient la limite d'upload.
--   On passe désormais par un upload DIRECT navigateur → stockage Supabase
--   (signed upload URL), ce qui contourne le plafond ~4,5 Mo des Server Actions
--   sur Vercel. Le bucket doit donc accepter jusqu'à 1 Go par fichier.
--
-- ATTENTION (à faire UNE FOIS dans le dashboard Supabase, hors migration) :
--   Le réglage projet "Storage → Global file size limit" doit être ≥ 1 Go,
--   sinon le plafond du bucket ci-dessous est écrêté par la limite globale.
--
-- Idempotent : simple UPDATE, rejouable sans effet de bord.
-- ============================================================================

UPDATE storage.buckets
SET
  file_size_limit = 1073741824,  -- 1 Go en octets
  allowed_mime_types = ARRAY[
    'image/png','image/jpeg','image/webp','image/heic','image/heif',
    'video/mp4','video/quicktime','video/webm'
  ]
WHERE id = 'property-media';
