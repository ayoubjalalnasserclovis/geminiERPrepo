-- ============================================================================
-- Tâches terrain Propria — assignation, preuve (photo/vidéo) & validation
-- ----------------------------------------------------------------------------
-- POURQUOI (métier) :
--   Le back office confie une tâche terrain (du trivial — papier toilette,
--   double de clés — au sérieux) à un collaborateur terrain (rôle `propria`).
--   Le terrain exécute, dépose une PREUVE photo/vidéo, puis le back office
--   VALIDE ou REFUSE (à refaire). Aujourd'hui le module ne sait pas :
--     1) assigner une tâche à un AUTRE collaborateur (seul `responsable_id`
--        existait — un seul interne « qui gère ») ;
--     2) stocker une preuve photo/vidéo sur une intervention ;
--     3) gérer une étape de validation avec refus.
--
-- CHOIX D'ARCHITECTURE :
--   On ÉTEND le module intervention existant (pas de nouveau module ni de
--   table dupliquée) : ~80% de la structure (bien, type, urgence, statut,
--   responsable, prestataire, audit, RLS) est déjà là et réutilisée.
--   Seule exception justifiée : une table dédiée `propria_intervention_proofs`
--   (photo ET vidéo, multi-fichiers, traçabilité qui/quand/IP) — un simple
--   TEXT[] perdrait la traçabilité, qui EST le point de contrôle recherché.
--
--   Le bien (`property_id`) reste OBLIGATOIRE (décision CEO : sinon « le
--   bordel »). Aucune intervention sans bien.
--
-- SÉCURITÉ (RLS) :
--   `is_staff()` renvoie vrai pour tous les rôles internes, y compris
--   `propria`. On RESSERRE donc la RLS de propria_interventions pour que le
--   terrain ne voie/modifie que SES tâches (assigned_to_id = auth.uid()),
--   sans rien changer pour les autres rôles internes (back office).
--
-- Idempotent : IF NOT EXISTS / DROP ... IF EXISTS / CREATE OR REPLACE.
--   Rejouable sans effet de bord. Aucune donnée existante n'est modifiée
--   (les nouvelles colonnes sont NULL / 0 par défaut, les anciens statuts
--   restent valides).
-- ============================================================================

-- ─── 1. Statut : ajout des états « à valider » et « refusée » ───────────────
-- Cycle complet : a_traiter → en_cours → a_valider → cloture
--                                          ↘ refusee → (retour) a_traiter
ALTER TABLE propria_interventions
  DROP CONSTRAINT IF EXISTS propria_interventions_status_check;
ALTER TABLE propria_interventions
  ADD CONSTRAINT propria_interventions_status_check CHECK (status IN (
    'a_traiter','en_cours','a_valider','cloture','refusee','annule'
  ));

-- ─── 2. Nouveaux champs : assignation terrain, échéance, validation ─────────
ALTER TABLE propria_interventions
  ADD COLUMN IF NOT EXISTS assigned_to_id  UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS due_date        DATE,
  ADD COLUMN IF NOT EXISTS submitted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS validated_by    UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS validated_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refusal_reason  TEXT,
  ADD COLUMN IF NOT EXISTS refused_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS refused_count   INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN propria_interventions.assigned_to_id IS
  'Collaborateur terrain (rôle propria) à qui la tâche est confiée. Distinct de responsable_id (suivi back office).';
COMMENT ON COLUMN propria_interventions.due_date IS
  'Échéance souhaitée de la tâche. Base du KPI « en retard ».';
COMMENT ON COLUMN propria_interventions.submitted_at IS
  'Date à laquelle le terrain a soumis la tâche pour validation (passage en a_valider).';
COMMENT ON COLUMN propria_interventions.validated_by IS
  'Qui (back office / CEO) a validé la tâche.';
COMMENT ON COLUMN propria_interventions.refused_count IS
  'Nombre de refus cumulés (proxy qualité terrain). Incrémenté à chaque refus.';

CREATE INDEX IF NOT EXISTS propria_interventions_assigned_idx
  ON propria_interventions (assigned_to_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS propria_interventions_due_idx
  ON propria_interventions (due_date)
  WHERE deleted_at IS NULL AND status NOT IN ('cloture','annule');

-- ─── 3. Table des preuves photo/vidéo ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS propria_intervention_proofs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intervention_id  UUID NOT NULL REFERENCES propria_interventions(id) ON DELETE CASCADE,
  storage_path     TEXT NOT NULL,
  media_type       TEXT NOT NULL CHECK (media_type IN ('photo','video')),
  mime_type        TEXT,
  file_size_bytes  BIGINT,
  caption          TEXT,
  uploaded_by      UUID REFERENCES profiles(id),
  uploaded_ip      TEXT,
  uploaded_user_agent TEXT,
  hash_sha256      TEXT,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE propria_intervention_proofs IS
  'Preuves photo/vidéo déposées par le terrain pour une intervention. Soft-delete + audit (qui/quand/IP).';

CREATE INDEX IF NOT EXISTS propria_intervention_proofs_int_idx
  ON propria_intervention_proofs (intervention_id) WHERE deleted_at IS NULL;

-- ─── 4. RLS — table des preuves ─────────────────────────────────────────────
ALTER TABLE propria_intervention_proofs ENABLE ROW LEVEL SECURITY;

-- Lecture : back office plein ; terrain uniquement les preuves de SES tâches.
DROP POLICY IF EXISTS propria_intervention_proofs_read ON propria_intervention_proofs;
CREATE POLICY propria_intervention_proofs_read ON propria_intervention_proofs
  FOR SELECT USING (
    is_staff(ARRAY['ceo','chef_projet','assistante'])
    OR EXISTS (
      SELECT 1 FROM propria_interventions i
      WHERE i.id = intervention_id AND i.assigned_to_id = auth.uid()
    )
  );

-- Insertion : on doit déposer en son propre nom ; back office partout, terrain
-- uniquement sur SES tâches assignées.
DROP POLICY IF EXISTS propria_intervention_proofs_insert ON propria_intervention_proofs;
CREATE POLICY propria_intervention_proofs_insert ON propria_intervention_proofs
  FOR INSERT WITH CHECK (
    uploaded_by = auth.uid()
    AND (
      is_staff(ARRAY['ceo','chef_projet','assistante'])
      OR EXISTS (
        SELECT 1 FROM propria_interventions i
        WHERE i.id = intervention_id AND i.assigned_to_id = auth.uid()
      )
    )
  );

-- Mise à jour (ex : soft-delete d'une preuve) : back office seulement.
DROP POLICY IF EXISTS propria_intervention_proofs_update ON propria_intervention_proofs;
CREATE POLICY propria_intervention_proofs_update ON propria_intervention_proofs
  FOR UPDATE USING (is_staff(ARRAY['ceo','chef_projet','assistante']))
  WITH CHECK (is_staff(ARRAY['ceo','chef_projet','assistante']));

-- Suppression dure : CEO / chef_projet (cohérent avec le reste de Propria).
DROP POLICY IF EXISTS propria_intervention_proofs_delete ON propria_intervention_proofs;
CREATE POLICY propria_intervention_proofs_delete ON propria_intervention_proofs
  FOR DELETE USING (is_staff(ARRAY['ceo','chef_projet']));

-- ─── 5. RLS — resserrement de propria_interventions pour le terrain ─────────
-- On remplace les politiques génériques créées en foundations (boucle staff)
-- par des politiques qui scopent le rôle `propria` à SES tâches, sans changer
-- l'accès des autres rôles internes (back office et assimilés).
DROP POLICY IF EXISTS propria_interventions_staff_read   ON propria_interventions;
DROP POLICY IF EXISTS propria_interventions_staff_write  ON propria_interventions;
DROP POLICY IF EXISTS propria_interventions_staff_update ON propria_interventions;
DROP POLICY IF EXISTS propria_interventions_staff_delete ON propria_interventions;

-- Lecture : tout interne SAUF propria voit tout ; propria voit ses tâches.
DROP POLICY IF EXISTS propria_interventions_read ON propria_interventions;
CREATE POLICY propria_interventions_read ON propria_interventions
  FOR SELECT USING (
    (is_staff() AND current_role_name() <> 'propria')
    OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
  );

-- Création : le terrain ne crée pas de tâche (c'est le back office qui assigne).
DROP POLICY IF EXISTS propria_interventions_write ON propria_interventions;
CREATE POLICY propria_interventions_write ON propria_interventions
  FOR INSERT WITH CHECK (
    is_staff() AND current_role_name() <> 'propria'
  );

-- Mise à jour : back office plein ; terrain uniquement ses tâches (avancer le
-- statut + déclarer réalisé). La VALIDATION reste contrôlée applicativement
-- (Server Action réservée au back office) — le terrain ne peut pas se valider.
DROP POLICY IF EXISTS propria_interventions_update ON propria_interventions;
CREATE POLICY propria_interventions_update ON propria_interventions
  FOR UPDATE USING (
    (is_staff() AND current_role_name() <> 'propria')
    OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
  ) WITH CHECK (
    (is_staff() AND current_role_name() <> 'propria')
    OR (current_role_name() = 'propria' AND assigned_to_id = auth.uid())
  );

-- Suppression : CEO / chef_projet (inchangé).
DROP POLICY IF EXISTS propria_interventions_delete ON propria_interventions;
CREATE POLICY propria_interventions_delete ON propria_interventions
  FOR DELETE USING (is_staff(ARRAY['ceo','chef_projet']));

-- ─── 6. Bucket de stockage `intervention-proofs` (privé) ────────────────────
-- Upload DIRECT navigateur → stockage (URL signée) pour supporter la vidéo
-- au-delà du plafond ~4,5 Mo des Server Actions Vercel.
-- Convention de chemin : intervention-proofs/{intervention_id}/{uuid}.{ext}
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES (
    'intervention-proofs', 'intervention-proofs', false,
    209715200,  -- 200 Mo / fichier (clips courts de preuve)
    ARRAY[
      'image/png','image/jpeg','image/webp','image/heic','image/heif',
      'video/mp4','video/quicktime','video/webm'
    ]
  )
  ON CONFLICT (id) DO UPDATE
    SET file_size_limit = EXCLUDED.file_size_limit,
        allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Politiques storage.objects pour ce bucket
-- Back office : accès complet.
DROP POLICY IF EXISTS "intervention_proofs_staff_all" ON storage.objects;
CREATE POLICY "intervention_proofs_staff_all"
  ON storage.objects FOR ALL TO authenticated
  USING (bucket_id = 'intervention-proofs' AND is_staff(ARRAY['ceo','chef_projet','assistante']))
  WITH CHECK (bucket_id = 'intervention-proofs' AND is_staff(ARRAY['ceo','chef_projet','assistante']));

-- Terrain : lecture de SES preuves (dossier = intervention assignée).
DROP POLICY IF EXISTS "intervention_proofs_field_read" ON storage.objects;
CREATE POLICY "intervention_proofs_field_read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'intervention-proofs'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM propria_interventions WHERE assigned_to_id = auth.uid()
    )
  );

-- Terrain : dépôt de preuve uniquement sur SES tâches assignées.
DROP POLICY IF EXISTS "intervention_proofs_field_upload" ON storage.objects;
CREATE POLICY "intervention_proofs_field_upload"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'intervention-proofs'
    AND (storage.foldername(name))[1]::uuid IN (
      SELECT id FROM propria_interventions WHERE assigned_to_id = auth.uid()
    )
  );

-- ─── 7. Vue enrichie — re-expansion i.* + indicateurs KPI ───────────────────
-- DROP + CREATE obligatoire : i.* est figé à la création de la vue ; l'ajout
-- de colonnes ci-dessus impose de la recréer (piège récurrent documenté).
DROP VIEW IF EXISTS propria_interventions_enriched CASCADE;

CREATE VIEW propria_interventions_enriched AS
SELECT
  i.*,
  CASE
    WHEN i.client_billing_mad IS NOT NULL AND i.cost_propria_mad IS NOT NULL
    THEN i.client_billing_mad - i.cost_propria_mad
    ELSE NULL
  END AS marge_mad,
  -- En retard : échéance dépassée et tâche non terminée/annulée.
  (i.due_date IS NOT NULL
    AND i.due_date < CURRENT_DATE
    AND i.status NOT IN ('cloture','annule')) AS is_overdue,
  -- En attente de validation back office.
  (i.status = 'a_valider') AS is_awaiting_validation,
  -- Délai de validation back office (jours entre soumission terrain et validation).
  CASE
    WHEN i.validated_at IS NOT NULL AND i.submitted_at IS NOT NULL
    THEN EXTRACT(EPOCH FROM (i.validated_at - i.submitted_at)) / 86400.0
    ELSE NULL
  END AS validation_delay_days
FROM propria_interventions i
WHERE i.deleted_at IS NULL;

ALTER VIEW propria_interventions_enriched SET (security_invoker = on);

COMMENT ON VIEW propria_interventions_enriched IS
  'Interventions/tâches Propria enrichies : marge calculée, indicateurs is_overdue / is_awaiting_validation / validation_delay_days + toutes les colonnes source (i.*).';
