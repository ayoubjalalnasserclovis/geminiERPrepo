-- ============================================================================
-- Soft blocks : alertes pré-transition de phase (jamais bloquantes RPC)
-- ============================================================================
-- Distinct des hard blocks de `advance_project_phase` qui throw une exception :
-- ici on retourne juste une liste de warnings que le UI affiche AVANT le bouton
-- "Avancer en phase X". Le chef projet peut quand même cliquer pour avancer.
--
-- Warnings actuellement implémentés :
--   - permis_construire_missing  (Design → Travaux)
--   - artisans_unpaid            (Livraison → Mise en location)
--   - honoraires_unpaid          (Mise en location → Terminé)
-- ============================================================================

CREATE OR REPLACE FUNCTION get_phase_advance_warnings(
  p_project_id UUID,
  p_target_phase project_phase
) RETURNS JSONB
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_warnings JSONB := '[]'::jsonb;
  v_unpaid_lots_count INTEGER;
  v_unpaid_lots_total NUMERIC;
  v_honoraires_expected NUMERIC;
  v_honoraires_paid NUMERIC;
  v_honoraires_diff NUMERIC;
BEGIN

  -- ─── Design → Travaux : autorisation travaux / permis pas uploadée ──────
  IF p_target_phase = 'travaux' THEN
    IF NOT EXISTS (
      SELECT 1 FROM documents
      WHERE project_id = p_project_id
        AND type IN ('autorisation_travaux','permis_construire')
        AND deleted_at IS NULL
    ) THEN
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'permis_missing',
        'severity', 'high',
        'title', 'Autorisation de travaux / permis non uploadé',
        'detail', 'Lancer un chantier sans autorisation expose le client à un risque pénal et Stoniz à une obligation de remise en état. Upload requis avant démarrage chantier.'
      );
    END IF;
  END IF;

  -- ─── Livraison → Mise en location : soldes artisans pas tous payés ─────
  IF p_target_phase = 'mise_en_location' THEN
    SELECT
      COUNT(*),
      COALESCE(SUM(due_remaining), 0)
    INTO v_unpaid_lots_count, v_unpaid_lots_total
    FROM (
      SELECT
        l.id,
        l.devis_artisan_mad - COALESCE((
          SELECT SUM(p.amount_mad) FROM travaux_payments p
          WHERE p.lot_id = l.id AND p.deleted_at IS NULL
        ), 0) AS due_remaining
      FROM travaux_lots l
      WHERE l.project_id = p_project_id
        AND l.deleted_at IS NULL
        AND l.status NOT IN ('annule')
        AND l.devis_artisan_mad IS NOT NULL
    ) sub
    WHERE due_remaining > 0.01;  -- tolérance arrondi

    IF v_unpaid_lots_count > 0 THEN
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'artisans_unpaid',
        'severity', 'high',
        'title', format('%s lot%s artisan%s avec solde restant à payer',
          v_unpaid_lots_count,
          CASE WHEN v_unpaid_lots_count > 1 THEN 's' ELSE '' END,
          CASE WHEN v_unpaid_lots_count > 1 THEN 's' ELSE '' END
        ),
        'detail', format('Reste à verser : %s MAD. Déclarer la mise en location avec des créances artisans ouvertes expose Stoniz à un recours et empêche les artisans de revenir lever les réserves PV.',
          to_char(v_unpaid_lots_total, 'FM999999990D00'))
      );
    END IF;
  END IF;

  -- ─── Mise en location → Terminé : honoraires Stoniz pas totalement encaissés ─
  IF p_target_phase = 'termine' THEN
    SELECT
      COALESCE(SUM(amount_expected), 0),
      COALESCE(SUM(amount_paid), 0)
    INTO v_honoraires_expected, v_honoraires_paid
    FROM payments
    WHERE project_id = p_project_id
      AND type IN ('acompte_stoniz','honoraires_compromis','honoraires_3d','honoraires_chantier','honoraires_livraison')
      AND deleted_at IS NULL;

    v_honoraires_diff := v_honoraires_expected - v_honoraires_paid;

    IF v_honoraires_diff > 0.01 THEN
      v_warnings := v_warnings || jsonb_build_object(
        'code', 'honoraires_unpaid',
        'severity', 'high',
        'title', 'Honoraires Stoniz non totalement encaissés',
        'detail', format('Reste %s € à encaisser sur les 21 000 € d''honoraires. Clore le projet maintenant rend la créance invisible dans le suivi commercial.',
          to_char(v_honoraires_diff, 'FM999990D00'))
      );
    END IF;
  END IF;

  RETURN v_warnings;
END;
$$;

COMMENT ON FUNCTION get_phase_advance_warnings IS
  'Retourne un tableau JSONB d''alertes (soft blocks) pour une transition de phase. NE BLOQUE PAS la transition — destiné à l''affichage UI uniquement.';
