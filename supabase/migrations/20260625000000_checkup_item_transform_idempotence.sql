-- Empêche de transformer 2× le même item checkup en intervention/tâche
-- Suite à Chantier 2 (validateCheckupAction multi-cible) — le bouton Transformer
-- inline (Phase C1) peut être cliqué en parallèle de la validation finale.
-- L'idempotence garantit qu'on ne crée pas 2 interventions pour le même item.

-- 1. Ajouter une colonne pour tracker l'item source côté interventions
ALTER TABLE propria_interventions
  ADD COLUMN IF NOT EXISTS source_checkup_item_key text;

-- 2. Index unique partiel — bloquer les doublons (source_checkup_id + item_key + kind)
CREATE UNIQUE INDEX IF NOT EXISTS propria_interventions_checkup_item_unique
  ON propria_interventions (source_checkup_id, source_checkup_item_key, kind)
  WHERE deleted_at IS NULL
    AND source_checkup_id IS NOT NULL
    AND source_checkup_item_key IS NOT NULL;

-- 3. Idem pour litiges
ALTER TABLE propria_litiges
  ADD COLUMN IF NOT EXISTS source_checkup_item_key text;

CREATE UNIQUE INDEX IF NOT EXISTS propria_litiges_checkup_item_unique
  ON propria_litiges (source_checkup_id, source_checkup_item_key)
  WHERE deleted_at IS NULL
    AND source_checkup_id IS NOT NULL
    AND source_checkup_item_key IS NOT NULL;

COMMENT ON COLUMN propria_interventions.source_checkup_item_key IS
  'Item check-up source (item_key). NULL si création hors checkup. Garantit idempotence avec index unique partiel.';

COMMENT ON COLUMN propria_litiges.source_checkup_item_key IS
  'Item check-up source (item_key). NULL si création hors checkup. Garantit idempotence avec index unique partiel.';
