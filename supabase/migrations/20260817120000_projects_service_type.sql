-- ═══════════════════════════════════════════════════════════════════════════
-- Distinction clients Clé-en-main vs Coaching (CEO 2026-08-17)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Contexte : jusqu'ici tous les projets étaient traités comme "clé en main"
-- (5 milestones honoraires = 21 000 €). Or Stoniz vend aussi du "coaching" à
-- 5 000 € forfaitaire : on suit juste l'avancée du client sans facturer les
-- 5 milestones. Ces projets faussaient les prévisions du pipeline honoraires
-- (page /finance/tresorerie/honoraires-a-percevoir) parce qu'on leur
-- imputait 21 000 € à percevoir alors que le vrai forfait est 5 000 €.
--
-- Fix : nouvelle colonne projects.service_type (enum PG) qui permet
-- d'exclure les coachings des calculs standard sans casser le canon
-- honoraires existant.

CREATE TYPE project_service_type AS ENUM ('cle_en_main', 'coaching');

ALTER TABLE projects
  ADD COLUMN service_type project_service_type NOT NULL DEFAULT 'cle_en_main';

COMMENT ON TYPE project_service_type IS
  'Type de service Stoniz. cle_en_main = 5 milestones honoraires 21 000 €.
   coaching = 5 000 € forfaitaire, pas de milestone BDD, exclus des
   prévisions honoraires standard.';

COMMENT ON COLUMN projects.service_type IS
  'CEO 2026-08-17 : distingue clients clé-en-main (canon 21k) des clients
   coaching (5k forfaitaire). Les coachings sont exclus par défaut des
   dashboards prévisionnels d''honoraires. Default cle_en_main pour ne pas
   casser les projets existants — le CEO / chef_projet re-tag manuellement
   les projets coaching depuis la fiche projet.';

-- Index partiel : la majorité des projets restera cle_en_main.
-- L'index rend rapide le filtre "coaching only" pour les futurs dashboards.
CREATE INDEX idx_projects_service_type_coaching
  ON projects (service_type)
  WHERE service_type = 'coaching' AND deleted_at IS NULL;
