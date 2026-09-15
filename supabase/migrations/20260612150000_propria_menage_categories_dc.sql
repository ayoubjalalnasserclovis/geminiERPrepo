-- ─── Chantier 3 marathon — Ménage : catégories dérivées + Deep Cleaning auto ─
--
-- Décisions cadrage 2026-06-12 :
--   B2 : « avec / sans arrivée » est DÉRIVÉ des réservations Hostaway, jamais
--        saisi. « Gros ménage » devient LE « Deep Cleaning » (renommage, pas
--        de doublon de type).
--   B3 : Deep Cleaning auto tous les 10 séjours — paramètre GLOBAL, stocké en
--        BDD (propria_settings), modifiable CEO sans redéploiement.
--
-- Le remplacement « DC tombe le même jour qu'un ménage standard → remplace »
-- est implémenté côté sync (lib/propria/cleanings-auto.ts) : le ménage
-- voyageur du séjour-seuil est UPGRADÉ en Deep Cleaning (pas de doublon).
--
-- Idempotent.

-- ─── 1. Renommage Gros ménage → Deep Cleaning ───────────────────────────────
UPDATE public.propria_cleaning_types
SET name = 'Deep Cleaning', updated_at = now()
WHERE name = 'Gros ménage';

-- ─── 2. Paramètres Propria (clé/valeur, CEO-only en écriture) ───────────────
CREATE TABLE IF NOT EXISTS public.propria_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  comment    text,
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.propria_settings IS
  'Paramètres métier Propria (seuils, fréquences). Évite les valeurs en dur dans le code. Écriture CEO uniquement.';

ALTER TABLE public.propria_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "staff read settings" ON public.propria_settings;
DROP POLICY IF EXISTS "ceo write settings"  ON public.propria_settings;
DROP POLICY IF EXISTS "ceo update settings" ON public.propria_settings;
DROP POLICY IF EXISTS "ceo delete settings" ON public.propria_settings;
CREATE POLICY "staff read settings" ON public.propria_settings FOR SELECT USING (public.is_staff());
CREATE POLICY "ceo write settings"  ON public.propria_settings FOR INSERT WITH CHECK (public.is_staff(ARRAY['ceo']));
CREATE POLICY "ceo update settings" ON public.propria_settings FOR UPDATE USING (public.is_staff(ARRAY['ceo'])) WITH CHECK (public.is_staff(ARRAY['ceo']));
CREATE POLICY "ceo delete settings" ON public.propria_settings FOR DELETE USING (public.is_staff(ARRAY['ceo']));

INSERT INTO public.propria_settings (key, value, comment)
VALUES ('deep_cleaning_every_stays', '10'::jsonb,
        'Deep Cleaning automatique tous les N séjours (cadrage CEO 2026-06-12 : 10).')
ON CONFLICT (key) DO NOTHING;

-- ─── 3. Vue enrichie : type + catégorie dérivée avec/sans arrivée ───────────
-- ATTENTION : même pattern que l'existant (pas de security_invoker — la vue
-- est lue par le rôle terrain `menage` qui n'a pas de grant direct sur
-- hostaway_reservations ; la RLS de propria_cleanings reste le point d'entrée).
CREATE OR REPLACE VIEW public.propria_cleanings_enriched AS
SELECT
  c.id, c.property_id, c.propria_unit_id, c.cleaning_type_id, c.description,
  c.occurred_at, c.due_date, c.urgency, c.status, c.closed_at,
  c.assigned_to_id, c.responsable_id, c.observations,
  c.submitted_at, c.validated_by, c.validated_at,
  c.refusal_reason, c.refused_at, c.refused_count,
  c.deleted_at, c.created_by, c.created_at, c.updated_at,
  (c.due_date IS NOT NULL AND c.due_date < CURRENT_DATE
    AND c.status NOT IN ('cloture','annule')) AS is_overdue,
  (c.status = 'a_valider') AS is_awaiting_validation,
  CASE
    WHEN c.validated_at IS NOT NULL AND c.submitted_at IS NOT NULL
      THEN EXTRACT(epoch FROM c.validated_at - c.submitted_at) / 86400.0
    ELSE NULL::numeric
  END AS validation_delay_days,
  CASE
    WHEN c.submitted_at IS NOT NULL
      THEN EXTRACT(epoch FROM c.submitted_at - COALESCE(c.started_at, c.created_at)) / 3600.0
    ELSE NULL::numeric
  END AS realisation_hours,
  c.started_at,
  c.hostaway_reservation_id,
  c.auto_source,
  ct.name AS cleaning_type_name,
  -- Une arrivée Hostaway le même jour sur la même suite ? (DÉRIVÉ, jamais saisi)
  EXISTS (
    SELECT 1
    FROM public.hostaway_reservations r
    JOIN public.hostaway_listings l ON l.id = r.hostaway_listing_db_id
    WHERE l.propria_unit_id = c.propria_unit_id
      AND r.arrival_date = c.due_date
      AND r.status IN ('new','modified')
      AND r.deleted_at IS NULL
  ) AS has_same_day_arrival,
  -- Catégorie visuelle consultant (U7) : 🧽 DC · 🌬 poussière · 👤 post-prop ·
  -- 🛏 avec arrivée · 🏠 sans arrivée
  CASE
    WHEN ct.name = 'Deep Cleaning'        THEN 'deep_cleaning'
    WHEN ct.name = 'Poussière'            THEN 'poussiere'
    WHEN ct.name = 'Ménage propriétaire'  THEN 'post_proprietaire'
    WHEN EXISTS (
      SELECT 1
      FROM public.hostaway_reservations r2
      JOIN public.hostaway_listings l2 ON l2.id = r2.hostaway_listing_db_id
      WHERE l2.propria_unit_id = c.propria_unit_id
        AND r2.arrival_date = c.due_date
        AND r2.status IN ('new','modified')
        AND r2.deleted_at IS NULL
    )                                     THEN 'avec_arrivee'
    ELSE 'sans_arrivee'
  END AS category
FROM public.propria_cleanings c
LEFT JOIN public.propria_cleaning_types ct ON ct.id = c.cleaning_type_id
WHERE c.deleted_at IS NULL;

NOTIFY pgrst, 'reload schema';
