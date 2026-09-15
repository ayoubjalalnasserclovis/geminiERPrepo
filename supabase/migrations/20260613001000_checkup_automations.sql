-- ─── Chantier 11.b marathon — Automatisations check-up (consultant U27/U28/U29) ─
--
-- S'appuie sur le module check-up MVP (20260613000000_checkup_module.sql).
-- Trois automatisations quotidiennes (cron /api/cron/checkups-auto, logique
-- partagée lib/propria/checkups-auto.ts, relançable par le CEO depuis
-- /propria/checkups) :
--   U27 — fréquence       : check-up auto tous les N mois OU N séjours
--   U28 — aléatoire       : contrôle bureau (tâche photos ménage de la veille)
--                           + check-up terrain aléatoire LUN/MER/VEN
--   U29 — logement du jour : 1 check-up/jour sur le lot contrôlé le moins
--                           récemment (jamais contrôlé en premier)
--
-- Le « retard vs fréquence » affiché sur /propria/checkups et la fiche bien
-- est DÉRIVÉ à la lecture (dernier validated_at + checkup_every_months),
-- jamais stocké — convention n°1.
--
-- Idempotent : rejouable sans effet de bord.

-- ─── 1) Colonne auto_source — traçabilité + idempotence des créations auto ──
ALTER TABLE public.propria_checkups
  ADD COLUMN IF NOT EXISTS auto_source text;

ALTER TABLE public.propria_checkups
  DROP CONSTRAINT IF EXISTS propria_checkups_auto_source_check;
ALTER TABLE public.propria_checkups
  ADD CONSTRAINT propria_checkups_auto_source_check
  CHECK (auto_source IS NULL OR auto_source IN
    ('frequence','aleatoire_bureau','aleatoire_terrain','logement_du_jour'));

COMMENT ON COLUMN public.propria_checkups.auto_source IS
  'Origine de la création automatique (chantier 11.b) : frequence (U27 — tous les N mois / N séjours), aleatoire_terrain (U28 — tirage LUN/MER/VEN), logement_du_jour (U29 — lot contrôlé le moins récemment). aleatoire_bureau réservé (le contrôle bureau crée une tâche propria_interventions, pas un check-up). NULL = check-up créé manuellement. Sert au dedupe quotidien du cron (aleatoire_terrain / logement_du_jour : max 1 création par jour, repérée via auto_source + created_at) et au reporting 11.c.';

-- Index partiel : dedupe quotidien (« existe-t-il déjà un logement_du_jour /
-- aleatoire_terrain créé aujourd'hui ? ») + reporting par origine.
CREATE INDEX IF NOT EXISTS idx_propria_checkups_auto_source
  ON public.propria_checkups(auto_source, created_at)
  WHERE auto_source IS NOT NULL;

-- ─── 2) Paramètres (propria_settings, clé/valeur jsonb, écriture CEO-only) ──
-- Modifiable sans redéploiement. ON CONFLICT DO NOTHING : un re-run de la
-- migration n'écrase JAMAIS une valeur ajustée par le CEO.
INSERT INTO public.propria_settings (key, value, comment) VALUES
  ('checkup_every_months', '3'::jsonb,
   'U27 — Fréquence check-up : un check-up auto est dû si le dernier check-up validé du lot date de plus de N mois (consultant : 3).'),
  ('checkup_every_stays', '10'::jsonb,
   'U27 — Fréquence check-up : un check-up auto est dû si N séjours terminés (départs Hostaway) se sont écoulés depuis le dernier check-up validé du lot (consultant : 10). Condition OU avec checkup_every_months.'),
  ('random_office_per_day', '5'::jsonb,
   'U28 — Contrôle bureau : nombre max de lots tirés au sort chaque jour parmi ceux nettoyés la veille (ménage clôturé). Cible = MIN(ce paramètre, nb nettoyés hier), avec un plancher de random_office_pct %.'),
  ('random_office_pct', '10'::jsonb,
   'U28 — Contrôle bureau : pourcentage plancher (arrondi supérieur) des lots nettoyés la veille à contrôler, si supérieur au tirage de base. Consultant : « 5/jour OU 10 % des nettoyés la veille ».'),
  ('random_terrain_per_week', '3'::jsonb,
   'U28 — Check-up terrain aléatoire : nombre visé par semaine. Implémenté comme 1 tirage les LUN/MER/VEN (≈3/semaine) — paramètre documentaire, le rythme effectif est porté par le planning du cron.'),
  ('logement_du_jour_enabled', 'true'::jsonb,
   'U29 — Logement du jour : active la création quotidienne d''un check-up sur le lot dont le dernier check-up validé est le plus ancien (jamais contrôlé en premier). false = désactivé.')
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
