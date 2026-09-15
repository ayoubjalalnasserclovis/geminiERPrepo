-- ─── Chantier 3 marathon (U15) — codecs WhatsApp sur le bucket de preuves ───
--
-- CAUSE RACINE du bug « Habiba ne peut pas uploader depuis WhatsApp » :
-- le bucket intervention-proofs n'autorisait que png/jpeg/webp/heic/heif +
-- mp4/quicktime/webm. Les médias WhatsApp arrivent en :
--   - audio/ogg ou audio/opus (notes vocales .opus/.ogg)
--   - audio/aac, audio/mp4 (.m4a)
--   - video/3gpp (vieilles vidéos Android)
--   - video/x-matroska (.mkv selon appareil)
-- → rejet silencieux au niveau storage, alors que l'UI semblait accepter.
--
-- Fix combiné avec le front : accept élargi + suppression de
-- capture="environment" (qui forçait l'appareil photo sur Android et
-- empêchait de piocher dans le dossier WhatsApp).

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/png','image/jpeg','image/webp','image/heic','image/heif','image/gif',
  'video/mp4','video/quicktime','video/webm','video/3gpp','video/x-matroska',
  'audio/ogg','audio/opus','audio/aac','audio/mp4','audio/mpeg','audio/wav'
]
WHERE id = 'intervention-proofs';
