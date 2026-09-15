-- QA-BUG-029 / 030 / 031 — Élargir la LECTURE artisans & partners aux rôles dont
-- la page s'ouvre déjà (écriture INCHANGÉE), et VERSIONNER la policy prod ad-hoc
-- `achats_read_artisans` (drift repo↔prod). Décision CEO 2026-06-14 : élargir la lecture.
--
-- Avant : developer voyait une liste artisans vide ; developer/commercial/assistante
-- voyaient une liste partners vide (page ouverte mais RLS trop étroite). Prouvé par
-- simulation JWT en prod (35 artisans, 59 partners réels → 0 visible).

-- ── Artisans ────────────────────────────────────────────────────────────────
-- Lecture = staff opérationnel + achats (fournisseurs/déco) + developer.
-- Écriture inchangée : artisans_staff_all (FOR ALL) reste [ceo,chef_projet,finance,assistante].
DROP POLICY IF EXISTS achats_read_artisans ON artisans;   -- absorbe le drift non versionné
DROP POLICY IF EXISTS artisans_read_staff ON artisans;
CREATE POLICY artisans_read_staff ON artisans FOR SELECT
  USING (is_staff(ARRAY['ceo','chef_projet','finance','assistante','achats','developer']));

-- ── Partners ──────────────────────────────────────────────────────────────--
-- Lecture élargie à developer/commercial/assistante (page déjà ouverte à ces rôles).
-- Écriture inchangée : partners_staff (FOR ALL) reste [ceo,chef_projet,sourcing].
DROP POLICY IF EXISTS partners_read_staff ON partners;
CREATE POLICY partners_read_staff ON partners FOR SELECT
  USING (is_staff(ARRAY['ceo','chef_projet','sourcing','developer','commercial','assistante']));
