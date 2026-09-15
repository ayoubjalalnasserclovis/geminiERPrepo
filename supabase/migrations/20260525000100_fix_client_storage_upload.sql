-- ============================================================================
-- Fix : autoriser le client a uploader dans Storage sous clients/{client_id}/...
-- (cas onboarding ou que le client n'a pas encore de projet rattache)
--
-- La policy existante documents_client_upload n'autorise que les uploads
-- sous {project_id}/..., ce qui bloque l'onboarding.
-- ============================================================================

DROP POLICY IF EXISTS "documents_client_upload_self" ON storage.objects;
CREATE POLICY "documents_client_upload_self"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'clients'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM clients WHERE profile_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "documents_client_read_self" ON storage.objects;
CREATE POLICY "documents_client_read_self"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] = 'clients'
    AND (storage.foldername(name))[2] IN (
      SELECT id::text FROM clients WHERE profile_id = auth.uid()
    )
  );
