-- ============================================================================
-- 11 — Storage buckets + politiques
-- À exécuter SUR LE PROJET PROD via Supabase Studio si auto-création échoue
-- ============================================================================

-- ─── Création des buckets (privés) ──────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES
    ('documents',      'documents',      false),
    ('property-media', 'property-media', false),
    ('avatars',        'avatars',        false)
  ON CONFLICT (id) DO NOTHING;

-- ─── Politiques pour bucket `documents` ─────────────────────────────────────
-- Convention : documents/{project_id}/{type}/{uuid}-{filename}

CREATE POLICY "documents_staff_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'documents' AND is_staff())
  WITH CHECK (bucket_id = 'documents' AND is_staff());

CREATE POLICY "documents_client_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1 FROM documents d
      WHERE d.storage_path = name
        AND d.is_visible_to_client = true
        AND d.deleted_at IS NULL
        AND d.project_id IN (SELECT client_project_ids())
    )
  );

CREATE POLICY "documents_client_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documents'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM projects
      WHERE client_id IN (SELECT id FROM clients WHERE profile_id = auth.uid())
    )
  );

-- ─── Politiques pour bucket `property-media` ────────────────────────────────
-- Convention : property-media/{property_id}/{uuid}-{filename}

CREATE POLICY "property_media_staff_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'property-media' AND is_staff(ARRAY['ceo','chef_projet','sourcing']))
  WITH CHECK (bucket_id = 'property-media' AND is_staff(ARRAY['ceo','chef_projet','sourcing']));

CREATE POLICY "property_media_client_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'property-media'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT property_id FROM property_proposals
      WHERE project_id IN (SELECT client_project_ids())
    )
  );

-- ─── Politiques pour bucket `avatars` ───────────────────────────────────────
-- Convention : avatars/{user_id}/{filename}

CREATE POLICY "avatars_self_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "avatars_staff_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatars' AND is_staff());
