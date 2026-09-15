-- ============================================================================
-- Fix : autoriser le client a uploader sa piece d'identite a l'onboarding
-- meme si aucun projet ne lui est encore rattache.
--
-- La policy existante documents_client_upload exigeait project_id IN (...),
-- ce qui bloquait l'upload pendant l'onboarding (avant assignation d'un projet).
-- On ajoute une policy permissive qui autorise l'upload si :
--   - role = client
--   - uploaded_by = auth.uid()
--   - client_id correspond au profil du user connecte
-- ============================================================================

DROP POLICY IF EXISTS documents_client_upload_self ON documents;
CREATE POLICY documents_client_upload_self ON documents FOR INSERT
  WITH CHECK (
    uploaded_by_role = 'client'
    AND uploaded_by = auth.uid()
    AND client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid())
  );

-- Permet aussi au client de relire ses propres documents (meme sans projet rattache)
DROP POLICY IF EXISTS documents_client_read_self ON documents;
CREATE POLICY documents_client_read_self ON documents FOR SELECT
  USING (
    client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid())
    AND is_visible_to_client = true
    AND deleted_at IS NULL
  );
