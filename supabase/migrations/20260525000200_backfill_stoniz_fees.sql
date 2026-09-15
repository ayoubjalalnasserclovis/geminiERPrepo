-- Backfill : tous les projets existants sans honoraires renseignes
-- recoivent les valeurs par defaut (8800 + 12200 = 21 000 EUR)
UPDATE projects
SET
  stoniz_fees_acquisition = COALESCE(stoniz_fees_acquisition, 8800),
  stoniz_fees_travaux     = COALESCE(stoniz_fees_travaux, 12200)
WHERE deleted_at IS NULL
  AND (stoniz_fees_acquisition IS NULL OR stoniz_fees_travaux IS NULL
       OR stoniz_fees_acquisition = 0   OR stoniz_fees_travaux = 0);
