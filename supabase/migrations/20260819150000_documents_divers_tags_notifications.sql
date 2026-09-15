-- ============================================================================
-- DOCUMENTS PROJET — Divers/tags + suivi consultation client + bucket 1 Go
-- (CEO 2026-08-19, session C roadmap évolutions)
-- ============================================================================
-- 3 besoins du cahier des charges :
--   2.1 Rubrique libre "Documents divers" : libellé personnalisé + tags par
--       document (le type 'autre' existait mais sans nommage structuré).
--   2.2 Fichiers volumineux : plafond du bucket documents relevé à 1 Go
--       (aligné sur property-media, migration 20260531100000). Les vidéos de
--       chantier sont autorisées côté app (ALLOWED_MIME) — le bucket reste
--       sans restriction MIME (contrôle applicatif, comme aujourd'hui).
--   2.4 Notification dépôt : badge « Nouveau » côté portail — on trace la
--       première consultation client (client_first_viewed_at, posé quand le
--       client ouvre/télécharge le document).
--
-- Colonnes additives, aucune ligne existante cassée. Idempotent.

BEGIN;

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS tags TEXT[],
  ADD COLUMN IF NOT EXISTS client_first_viewed_at TIMESTAMPTZ;

COMMENT ON COLUMN documents.label IS
  'Libellé personnalisé affiché à la place du nom de fichier (rubrique Documents divers et au-delà). NULL = on affiche name.';
COMMENT ON COLUMN documents.tags IS
  'Tags libres pour retrouver un document (ex : {cuisine, plan, v2}). Saisie côté upload équipe.';
COMMENT ON COLUMN documents.client_first_viewed_at IS
  'Première ouverture du document par le client (posée par getDocumentSignedUrl). NULL + visible + déposé par Stoniz = badge « Nouveau » sur le portail.';

-- Bucket documents : 1 Go par fichier (précédent : property-media 1 Go).
-- NB dashboard Supabase : "Storage → Global file size limit" doit être ≥ 1 Go
-- (déjà le cas depuis property-media, sinon le plafond bucket est écrêté).
UPDATE storage.buckets
SET file_size_limit = 1073741824
WHERE id = 'documents';

COMMIT;
