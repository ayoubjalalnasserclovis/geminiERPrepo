-- ============================================================================
-- RPC soft_delete_property + table audit
-- ============================================================================
-- Permet au CEO (ou super-admin) de soft-delete un bien Propria depuis l'UI.
-- Soft delete = pose deleted_at = NOW() sur properties + propria_units.
-- Les FK des satellites ne posent pas problème car toutes les vues filtrent
-- déjà sur deleted_at IS NULL.
--
-- Restauration manuelle possible via SQL : UPDATE properties SET deleted_at = NULL
-- WHERE id = ...
-- ============================================================================

-- ─── Table audit ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS property_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL,                  -- pas de FK : la property peut être restaurée plus tard
  property_snapshot JSONB NOT NULL,           -- état complet au moment du soft-delete
  units_snapshot JSONB,                       -- liste des units soft-deleted en cascade
  deleted_by UUID NOT NULL REFERENCES profiles(id),
  deleted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  restored_at TIMESTAMPTZ,                    -- NULL = encore supprimé
  restored_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS property_deletion_log_property_idx
  ON property_deletion_log (property_id, deleted_at DESC);

COMMENT ON TABLE property_deletion_log IS
  'Audit des soft-deletes de biens Propria. Permet restauration manuelle via SQL et traçabilité.';

ALTER TABLE property_deletion_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS property_deletion_log_ceo_read ON property_deletion_log;
CREATE POLICY property_deletion_log_ceo_read ON property_deletion_log FOR SELECT
  USING (is_staff(ARRAY['ceo']));
DROP POLICY IF EXISTS property_deletion_log_ceo_insert ON property_deletion_log;
CREATE POLICY property_deletion_log_ceo_insert ON property_deletion_log FOR INSERT
  WITH CHECK (is_staff(ARRAY['ceo']));

-- ─── RPC soft_delete_property ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION soft_delete_property(
  p_property_id UUID,
  p_reason TEXT
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_role TEXT;
  v_is_super BOOLEAN;
  v_property properties;
  v_units_snapshot JSONB;
  v_now TIMESTAMPTZ := now();
  v_deleted_units_count INT;
BEGIN
  -- Auth
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;

  SELECT role, is_super_admin INTO v_role, v_is_super
  FROM profiles WHERE id = v_user_id;

  IF v_role <> 'ceo' AND COALESCE(v_is_super, false) = false THEN
    RAISE EXCEPTION 'Action réservée au CEO ou super-admin (rôle actuel: %)', COALESCE(v_role, 'inconnu');
  END IF;

  -- Validation entrée
  IF p_reason IS NULL OR length(trim(p_reason)) < 5 THEN
    RAISE EXCEPTION 'Raison requise (min 5 caractères)';
  END IF;

  -- Verrouillage + check existence
  SELECT * INTO v_property FROM properties WHERE id = p_property_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bien introuvable';
  END IF;
  IF v_property.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Bien déjà supprimé le %', v_property.deleted_at::date;
  END IF;

  -- Snapshot des units AVANT soft-delete (pour audit + restauration)
  SELECT COALESCE(jsonb_agg(row_to_json(u)::jsonb), '[]'::jsonb)
    INTO v_units_snapshot
    FROM propria_units u
    WHERE u.property_id = p_property_id AND u.deleted_at IS NULL;

  -- Soft-delete units
  UPDATE propria_units
  SET deleted_at = v_now, updated_at = v_now
  WHERE property_id = p_property_id AND deleted_at IS NULL;
  GET DIAGNOSTICS v_deleted_units_count = ROW_COUNT;

  -- Soft-delete property
  UPDATE properties
  SET deleted_at = v_now, updated_at = v_now
  WHERE id = p_property_id;

  -- INSERT log
  INSERT INTO property_deletion_log (
    property_id, property_snapshot, units_snapshot,
    deleted_by, deleted_at, reason
  ) VALUES (
    p_property_id, to_jsonb(v_property), v_units_snapshot,
    v_user_id, v_now, p_reason
  );

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_units_count', v_deleted_units_count,
    'deleted_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION soft_delete_property(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION soft_delete_property IS
  'Soft-delete un bien Propria + ses units. Réservé CEO/super-admin. Audit complet dans property_deletion_log.';
