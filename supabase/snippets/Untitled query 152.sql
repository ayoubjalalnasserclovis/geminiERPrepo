SELECT
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NULL)        AS biens_actifs,
  (SELECT COUNT(*) FROM properties WHERE deleted_at IS NOT NULL)    AS biens_supprimes,
  (SELECT COUNT(*) FROM projects WHERE property_id IS NOT NULL AND deleted_at IS NULL) AS projets_avec_bien_lie,
  (SELECT COUNT(DISTINCT property_id) FROM projects WHERE property_id IS NOT NULL) AS biens_distincts_dans_projets;
  SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE '%note%';