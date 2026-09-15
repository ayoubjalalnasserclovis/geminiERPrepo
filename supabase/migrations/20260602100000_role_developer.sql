-- ============================================================================
-- Nouveau rôle : developer
-- ============================================================================
-- Décision CEO 2026-06-02 — Permettre aux développeurs internes d'avoir un
-- compte studio.stoniz.co dédié pour tester leurs changements de bout en bout.
--
-- Philosophie du rôle :
--   - LECTURE seule sur quasi tout (y compris dashboard financier, marges
--     consolidées, /team) — pour qu'il puisse vérifier ses changements
--   - ÉCRITURE sur l'opérationnel "safe" (projets, biens, interventions,
--     payments) — au même niveau que chef_projet
--   - AUCUNE action destructrice ou de masse : suppressions, imports CSV,
--     modifs honoraires, création/désactivation de comptes équipe restent
--     strictement réservés au CEO
--
-- Bloqués pour developer (vérifications côté Server Actions assertRole(['ceo'])) :
--   - Suppressions (clients, projets, biens, propria)
--   - Imports CSV travaux/achats
--   - Modifs des échéances honoraires (updateStonizScheduleAction)
--   - Création/désactivation/changement de rôle d'un membre équipe
--   - Lifecycle CEO-only (transition vers "perdu" définitif, force phase)
--   - Modifs des paramètres caisse Stoniz et Propria (création wallet,
--     virements, ajustements de solde)
-- ============================================================================

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY[
    'ceo'::text,
    'chef_projet'::text,
    'sourcing'::text,
    'commercial'::text,
    'finance'::text,
    'marketing'::text,
    'assistante'::text,
    'propria'::text,
    'developer'::text,
    'client'::text
  ]));

COMMENT ON COLUMN public.profiles.role IS
  'Rôle métier du collaborateur. Valeurs : ceo, chef_projet, sourcing, commercial, finance, marketing, assistante, propria, developer, client. Le rôle "developer" est destiné aux ingénieurs internes — lecture quasi totale + écriture sur l''opérationnel, mais aucune action destructrice.';
