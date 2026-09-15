-- ============================================================================
-- IMPORT PROPRIA — Rapport de matching v2 (UNE SEULE requête)
-- ============================================================================
-- Retourne 12 lignes (1 par email CSV) avec toutes les colonnes utiles
-- pour décider du pilote.
-- ============================================================================

SELECT
  cs.email_csv,
  cs.fullname_csv,
  cs.biens_attendus,
  cs.lots_attendus,

  -- Client
  c.id            AS client_id,
  c.full_name     AS client_fullname_base,
  CASE
    WHEN c.id IS NULL THEN '🔴 CLIENT INTROUVABLE'
    WHEN lower(trim(c.full_name)) = lower(trim(cs.fullname_csv)) THEN '✅ Match exact'
    ELSE '⚠ Nom diffère'
  END             AS verdict_client,

  -- Projets liés à ce client
  (
    SELECT COUNT(*) FROM projects p
    WHERE p.client_id = c.id AND p.deleted_at IS NULL
  ) AS nb_projets,

  -- Détail concis des projets (code | phase | status | is_prep)
  (
    SELECT STRING_AGG(
      COALESCE(p.code, p.reference) || ' [' || p.current_phase || '|' || p.status ||
      CASE WHEN p.is_preparation THEN '|PREP' ELSE '' END || ']',
      ' / ' ORDER BY p.created_at
    )
    FROM projects p
    WHERE p.client_id = c.id AND p.deleted_at IS NULL
  ) AS projets_detail,

  -- Properties liées via projects
  (
    SELECT COUNT(DISTINCT pr.id) FROM projects p
    JOIN properties pr ON pr.id = p.property_id
    WHERE p.client_id = c.id AND p.deleted_at IS NULL AND pr.deleted_at IS NULL
  ) AS nb_properties,

  -- Properties déjà en PROPRIA
  (
    SELECT COUNT(DISTINCT pr.id) FROM projects p
    JOIN properties pr ON pr.id = p.property_id
    WHERE p.client_id = c.id AND p.deleted_at IS NULL AND pr.deleted_at IS NULL
      AND pr.propria_managed_at IS NOT NULL
  ) AS nb_properties_propria,

  -- Propria_units déjà existants pour ce client
  (
    SELECT COUNT(u.id) FROM projects p
    JOIN properties pr ON pr.id = p.property_id
    JOIN propria_units u ON u.property_id = pr.id
    WHERE p.client_id = c.id AND p.deleted_at IS NULL AND pr.deleted_at IS NULL
      AND u.deleted_at IS NULL
  ) AS nb_units_existants

FROM (VALUES
  ('boucheniata.hakim@gmail.com',        'Hakim Boucheniata',        3, 11),
  ('foudadredha@gmail.com',              'Redha Foudad',             1, 2),
  ('elbadaoui.yassine@hotmail.com',      'Yassine El Badaoui',       2, 7),
  ('steven.lebourhis@gmail.com',         'Steven Bouhriss',          1, 2),
  ('patsourd@aol.com',                   'Patrick le Sourd',         1, 3),
  ('cafc.eleulj.elmamoun@gmail.com',     'El Eulj Mamoun',           1, 3),
  ('ducduy.n@gmail.com',                 'Duc NGUYEN',               1, 2),
  ('paulbenelli1@gmail.com',             'Paul Benneli',             1, 2),
  ('catherinevrard@hotmail.com',         'Catherine Everard',        1, 2),
  ('kamil.joundy@gmail.com',             'Kamil Joundy',             1, 4),
  ('souad.meziane@hotmail.com',          'Paul Ferrera',             1, 1),
  ('hammoucheyamina@gmail.com',          'Yamina Hamouche',          1, 2)
) AS cs(email_csv, fullname_csv, biens_attendus, lots_attendus)
LEFT JOIN clients c ON lower(c.email) = lower(trim(cs.email_csv))
ORDER BY cs.email_csv;
